/**
 * POST /api/translator/translate
 *
 * Text translation API — translates Korean text to target language(s).
 * Supports both single and multi-language translation.
 * Usable by staff via web UI and by Spring backend via API key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { translate } from '@/lib/translator/translate';
import { getGlossary } from '@/lib/translator/glossary-data';
import { getTenantId } from '@/lib/tenant';
import type { TargetLang, TranslationContext } from '@/lib/translator/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MODEL_MAP: Record<string, string> = { opus: "claude-opus-4-6", sonnet: "claude-sonnet-4-6" };

// 인메모리 Rate Limiter — 테넌트당 분당 10회 제한
const _rateLimits = new Map<number, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

const RequestSchema = z.object({
  text: z.string().min(1).max(10000),
  source: z.literal('ko').default('ko'),
  targets: z.array(z.enum(['en', 'cn', 'sg', 'ja', 'ko'])).min(1).max(5),
  context: z.enum(['treatment_name', 'description', 'category', 'general', 'legal']).default('general'),
  model: z.enum(['opus', 'sonnet']).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 2026-05-19 fix: x-api-key 경로는 세션 미인증 외부 호출자(Spring 등)용.
    // 기존 fail-open(expectedKey 미설정 시 통과)을 fail-closed로 변경: API key 헤더가 있으면 환경변수 키와 일치해야만 통과.
    // 헤더가 없는 호출은 미들웨어 세션 인증으로 처리 (브라우저 UI flow).
    const apiKey = req.headers.get('x-api-key');
    if (apiKey !== null) {
      const expectedKey = process.env.TRANSLATOR_API_KEY;
      if (!expectedKey || apiKey !== expectedKey) {
        return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
      }
    }

    const tenantId = getTenantId(req);

    // Rate limit 체크
    const now = Date.now();
    const rl = _rateLimits.get(tenantId) || { count: 0, resetAt: now + RATE_WINDOW };
    if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + RATE_WINDOW; }
    rl.count++;
    _rateLimits.set(tenantId, rl);
    if (rl.count > RATE_LIMIT) {
      return NextResponse.json({ error: '요청이 너무 많습니다. 1분 후 다시 시도하세요.' }, { status: 429 });
    }

    const body = await req.json();
    const parsed = RequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { text, targets, context, model } = parsed.data;
    const modelId = model ? MODEL_MAP[model] : undefined;

    const glossary = await getGlossary(tenantId);

    // 일반 텍스트는 Claude가 번역 — 미등록 감지는 엑셀 variant(I열)에서만
    const unregisteredTerms: string[] = [];

    // Translate
    const result = await translate(
      text,
      targets as TargetLang[],
      context as TranslationContext,
      glossary,
      modelId,
    );

    return NextResponse.json({ ...result, unregisteredTerms });
  } catch (error) {
    console.error('[translator/translate] Error:', error);
    return NextResponse.json(
      { error: 'Translation failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
