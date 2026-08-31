// 미등록 용어 웹검색 API — Haiku로 번역 후보 생성
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getTenantId } from "@/lib/tenant";

const haiku = new Anthropic({ apiKey: process.env.TRANSLATOR_API_KEY || process.env.ANTHROPIC_API_KEY });

// 인메모리 Rate Limiter — 테넌트당 분당 10회 제한
const _rateLimits = new Map<number, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

export async function POST(req: NextRequest) {
  try {
    const tenantId = getTenantId(req);

    // Rate limit 체크
    const now = Date.now();
    const rl = _rateLimits.get(tenantId) || { count: 0, resetAt: now + RATE_WINDOW };
    if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + RATE_WINDOW; }
    rl.count++;
    _rateLimits.set(tenantId, rl);
    if (rl.count > RATE_LIMIT) {
      return NextResponse.json({ error: "요청이 너무 많습니다. 1분 후 다시 시도하세요." }, { status: 429 });
    }

    const { term, context } = await req.json() as { term: string; context?: string };
    if (!term?.trim()) {
      return NextResponse.json({ error: "term 필수" }, { status: 400 });
    }

    const prompt = `You are a medical/aesthetic translation expert. Translate this Korean dermatology term to 4 languages.

Term: "${term}"
Context: ${context || "Korean dermatology clinic treatment/equipment name"}

Provide up to 3 translation candidates. Each candidate should have translations for EN, CN (Simplified Chinese), SG (Traditional Chinese), JA (Japanese).

Respond in this exact JSON format:
{
  "candidates": [
    {
      "en": "English translation",
      "cn": "简体中文",
      "sg": "繁體中文",
      "ja": "日本語",
      "source": "brief explanation of this translation",
      "confidence": 0.95
    }
  ]
}

Only output valid JSON.`;

    const res = await haiku.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    let rawOutput = "";
    for (const block of res.content) {
      if (block.type === "text") { rawOutput = block.text; break; }
    }

    const cleaned = rawOutput.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned);

    return NextResponse.json({
      term,
      candidates: parsed.candidates || [],
      usage: { input: res.usage?.input_tokens || 0, output: res.usage?.output_tokens || 0 },
    });
  } catch (e) {
    console.error("[search-term] 오류:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "검색 실패" },
      { status: 500 },
    );
  }
}
