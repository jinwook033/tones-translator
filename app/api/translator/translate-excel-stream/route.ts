// 엑셀 번역 SSE API — 행별 진행률 실시간 전송
import { NextRequest } from "next/server";
import { z } from "zod";
import { translate } from "@/lib/translator/translate";
import { getGlossary } from "@/lib/translator/glossary-data";
import { parseTonesExcel, writeTranslatedExcel, prepareTranslatedRows } from "@/lib/translator/excel-parser";
import type { TargetLang, TranslationContext } from "@/lib/translator/types";
import { getTenantId } from "@/lib/tenant";
import { calculateCost, emptyUsage, addUsage } from "@/lib/translator/pricing";
import { checkAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

const TargetsSchema = z
  .string()
  .min(1)
  .transform((s) => s.split(",").map((t) => t.trim()))
  .pipe(z.array(z.enum(["en", "cn", "tw", "ja"])).min(1).max(4));

export async function POST(req: NextRequest) {
  let tenantId: number;
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    tenantId = getTenantId(req);
  } catch {
    return new Response(JSON.stringify({ error: "인증 필요" }), { status: 401 });
  }
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: "잘못된 요청 형식입니다" }), { status: 400 });
  }
  const file = formData.get("file");
  if (!file || !(file instanceof File) || !file.name.endsWith(".xlsx")) {
    return new Response(JSON.stringify({ error: "Missing .xlsx file" }), { status: 400 });
  }

  const rawTargets = formData.get("targets");
  if (!rawTargets || typeof rawTargets !== "string") {
    return new Response(JSON.stringify({ error: "Missing targets" }), { status: 400 });
  }

  const targetsParsed = TargetsSchema.safeParse(rawTargets);
  if (!targetsParsed.success) {
    return new Response(JSON.stringify({ error: "Invalid targets" }), { status: 400 });
  }

  const targets = targetsParsed.data as TargetLang[];
  const rawModel = formData.get("model");
  const MODEL_MAP: Record<string, string> = { opus: "claude-opus-4-6", sonnet: "claude-sonnet-4-6" };
  const modelId = rawModel && typeof rawModel === "string" ? MODEL_MAP[rawModel] : undefined;
  const checkOnly = formData.get("checkOnly") === "true";
  const buffer = await file.arrayBuffer();

  // 파일 크기 제한 (10MB)
  if (buffer.byteLength > 10 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: "파일 크기가 10MB를 초과합니다" }), { status: 400 });
  }

  // SSE 스트림 생성
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(data: Record<string, unknown>) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { closed = true; }
      }
      function safeClose() {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      }

      try {
        // 파싱
        send({ type: "status", message: "엑셀 파싱 중..." });
        const parsed = parseTonesExcel(buffer, file.name);
        if (parsed.rows.length === 0) {
          send({ type: "error", message: "번역할 행이 없습니다" });
          safeClose();
          return;
        }

        // 중복 제거
        const uniqueTexts = new Map<string, { text: string; context: TranslationContext }>();
        for (const row of parsed.rows) {
          if (row.procedureName) uniqueTexts.set(`name:${row.procedureName}`, { text: row.procedureName, context: "treatment_name" });
          if (row.description) uniqueTexts.set(`desc:${row.description}`, { text: row.description, context: "description" });
          if (row.procedureInfo) uniqueTexts.set(`info:${row.procedureInfo}`, { text: row.procedureInfo, context: "general" });
        }

        const glossary = await getGlossary(tenantId);

        // 미등록 용어 감지 — variant(I열) + 시술명(G열)/설명(H열)/정보(F열)
        const { translateVariant, substituteGlossary } = await import("@/lib/translator/glossary-engine");
        const unknownTerms = new Set<string>();

        // 1) Variant 미등록 체크
        for (const row of parsed.rows) {
          if (row.variant) {
            const test = translateVariant(row.variant, "en", glossary);
            if (test === row.variant && /[가-힣]/.test(test)) {
              unknownTerms.add(row.variant);
            }
          }
        }

        // G/H/F열은 Claude가 번역 — 일반어는 미등록 대상 아님
        // variant(I열)만 미등록 감지 (기기명/제품명/시술 규격 등 고유명사)

        if (unknownTerms.size > 0) {
          send({ type: "unregistered", terms: [...unknownTerms] });
          if (checkOnly) {
            send({ type: "status", message: `미등록 용어 ${unknownTerms.size}개 발견` });
            safeClose();
            return;
          }
        }
        if (checkOnly) {
          send({ type: "status", message: "미등록 용어 없음" });
          safeClose();
          return;
        }

        const total = uniqueTexts.size;
        send({ type: "progress", current: 0, total, message: `${total}개 텍스트 번역 시작` });

        // 번역 (glossary는 위에서 이미 로드)
        const translationMap = new Map<string, Partial<Record<TargetLang, string>>>();
        const entries = Array.from(uniqueTexts.entries());
        let completed = 0;
        let usageTotal = emptyUsage();

        for (let i = 0; i < entries.length; i += 4) {
          const chunk = entries.slice(i, i + 4);
          const results = await Promise.all(
            chunk.map(async ([key, { text, context }]) => {
              const res = await translate(text, targets, context, glossary, modelId);
              const mapped: Partial<Record<TargetLang, string>> = {};
              for (const t of targets) mapped[t] = res.translations[t]?.text ?? "";
              return { key, mapped, usage: res.usage };
            }),
          );
          for (const { key, mapped, usage } of results) {
            translationMap.set(key, mapped);
            usageTotal = addUsage(usageTotal, usage);
          }
          completed += chunk.length;
          // 캐시 토큰까지 포함해 계산한다 — pricing.ts 주석 참고.
          const cost = calculateCost(usageTotal, modelId);
          send({ type: "progress", current: completed, total, message: `${completed}/${total} 번역 완료`,
            tokens: {
              input: usageTotal.inputTokens,
              cacheWrite: usageTotal.cacheWriteTokens,
              cacheRead: usageTotal.cacheReadTokens,
              output: usageTotal.outputTokens,
              cost: Math.round(cost.totalUSD * 10000) / 10000,
              costKRW: Math.round(cost.totalKRW),
            } });
        }

        // 행별 매핑
        send({ type: "status", message: "엑셀 생성 중..." });
        const claudeTranslations = new Map<string, Partial<Record<TargetLang, string>>>();
        for (const row of parsed.rows) {
          if (row.procedureName) claudeTranslations.set(`name:${row.rowNumber}`, translationMap.get(`name:${row.procedureName}`) ?? {});
          if (row.description) claudeTranslations.set(`desc:${row.rowNumber}`, translationMap.get(`desc:${row.description}`) ?? {});
          if (row.procedureInfo) claudeTranslations.set(`info:${row.rowNumber}`, translationMap.get(`info:${row.procedureInfo}`) ?? {});
        }

        const translatedRows = prepareTranslatedRows(parsed.rows, targets, claudeTranslations, glossary);

        // 엑셀 생성
        const files: { lang: string; fileName: string; base64: string }[] = [];
        for (const target of targets) {
          const xlsxBuffer = writeTranslatedExcel(parsed, translatedRows, target);
          const base64 = Buffer.from(xlsxBuffer).toString("base64");
          files.push({ lang: target, fileName: `${file.name.replace(/\.xlsx$/i, "")}_${target}.xlsx`, base64 });
        }

        send({ type: "complete", files, rowCount: parsed.rows.length, uniqueTexts: total });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "번역 실패" });
      } finally {
        safeClose();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
