// 미등록 용어 번역 후보 — 실제 웹 검색으로 제조사 표기를 확인한다.
//
// 2026-09-17: 예전에는 파일 이름과 주석만 "웹검색"이고 실제로는 모델이 아는 지식만
// 썼다(tools 선언 없음). 신형 기기·신제품은 틀릴 수밖에 없었고, 함께 오던
// confidence 값도 근거가 없었다. 웹 검색 도구를 붙여 출처 URL 까지 받는다.
//
// 쥬베룩을 Juvéderm(경쟁사)으로 쓰던 사고가 실제로 있었다. 제조사 페이지를
// 확인하면 그런 게 막힌다.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getTenantId } from "@/lib/tenant";
import { checkAuth } from "@/lib/auth";

const client = new Anthropic({ apiKey: process.env.TRANSLATOR_API_KEY || process.env.ANTHROPIC_API_KEY });

// 웹 검색을 붙이면 Haiku 로는 판단이 약하다. 번역 본체와 같은 모델을 쓴다.
const MODEL = "claude-sonnet-4-6";
const MAX_SEARCHES = 4;

export const runtime = "nodejs";
export const maxDuration = 180;

// 인메모리 Rate Limiter — 테넌트당 분당 10회 제한
const _rateLimits = new Map<number, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

export async function POST(req: NextRequest) {
  try {
    const denied = checkAuth(req);
    if (denied) return denied;

    const tenantId = getTenantId(req);

    const now = Date.now();
    const rl = _rateLimits.get(tenantId) || { count: 0, resetAt: now + RATE_WINDOW };
    if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + RATE_WINDOW; }
    rl.count++;
    _rateLimits.set(tenantId, rl);
    if (rl.count > RATE_LIMIT) {
      return NextResponse.json({ error: "요청이 너무 많습니다. 1분 후 다시 시도하세요." }, { status: 429 });
    }

    const { term, context } = (await req.json()) as { term: string; context?: string };
    if (!term?.trim()) {
      return NextResponse.json({ error: "term 필수" }, { status: 400 });
    }

    const prompt = `You are building a glossary entry for a Korean dermatology clinic's translation system.

Term: "${term}"
Context: ${context || "Korean dermatology clinic — device, product, or treatment name"}

Search the web to find out what this actually is. Prioritise, in order:
1. The manufacturer's own site or official product page
2. Korean dermatology clinic sites that carry it
3. Regulatory or distributor listings

Then give up to 3 translation candidates for EN, CN (Simplified), TW (Traditional, Taiwan usage), JA.

Rules:
- If it is a brand/device/product name, use the manufacturer's own romanisation. Do NOT invent a phonetic rendering.
- NEVER substitute a competitor's brand (e.g. 쥬베룩 is Juvelook, not Juvéderm).
- If the web gave you nothing useful, say so in "source" and set confidence below 0.5.

Respond with ONLY this JSON, no markdown:
{
  "candidates": [
    {
      "en": "...", "cn": "...", "tw": "...", "ja": "...",
      "source": "what you found and where",
      "url": "the page you relied on, or empty string",
      "confidence": 0.9
    }
  ],
  "category": "one of: device, product, procedure, brand, equipment, location, general"
}`;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
    let response: Anthropic.Message | undefined;

    // 웹 검색 도중 pause_turn 으로 끊길 수 있다. 그대로 두면 답이 잘린 채 끝난다.
    for (let turn = 0; turn < 4; turn++) {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 4000,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
        messages,
      });
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
    }
    if (!response) throw new Error("검색 응답 없음");

    // 마지막 text 블록이 답이다 — 앞쪽에는 검색 결과 블록이 섞여 있다.
    let rawOutput = "";
    const sources: string[] = [];
    for (const block of response.content) {
      // JSON 을 담은 블록을 우선한다. 없으면 마지막 텍스트 블록.
      if (block.type === "text" && block.text.trim()) {
        if (block.text.includes('"candidates"') || !rawOutput) rawOutput = block.text;
      }
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if ("url" in r && r.url) sources.push(r.url);
        }
      }
    }

    // 웹 검색을 거치면 모델이 JSON 앞뒤에 조사 내용을 덧붙인다. 블록 전체가
    // JSON 이라고 가정하면 파싱이 깨진다 — 중괄호 범위만 떼어낸다.
    let parsed: { candidates?: unknown[]; category?: string };
    try {
      const fenced = rawOutput.match(/```json?\s*([\s\S]*?)```/i);
      const body = fenced ? fenced[1] : rawOutput;
      const start = body.indexOf("{");
      const end = body.lastIndexOf("}");
      if (start === -1 || end <= start) throw new Error("JSON 없음");
      parsed = JSON.parse(body.slice(start, end + 1));
    } catch {
      return NextResponse.json(
        { error: "검색 결과를 해석하지 못했습니다", raw: rawOutput.slice(0, 400) },
        { status: 502 },
      );
    }

    return NextResponse.json({
      term,
      candidates: parsed.candidates || [],
      category: parsed.category || "product",
      searchedUrls: [...new Set(sources)].slice(0, 8),
      usage: {
        input: response.usage?.input_tokens || 0,
        output: response.usage?.output_tokens || 0,
        searches: response.usage?.server_tool_use?.web_search_requests ?? 0,
      },
    });
  } catch (e) {
    console.error("[search-term] 오류:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "검색 실패" },
      { status: 500 },
    );
  }
}
