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
import { checkAuth } from "@/lib/auth";
import { recordUsage } from '@/lib/translator/usage-log';
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
  targets: z.array(z.enum(['en', 'cn', 'tw', 'ja', 'ko'])).min(1).max(5),
  context: z.enum(['treatment_name', 'description', 'category', 'general', 'legal']).default('general'),
  model: z.enum(['opus', 'sonnet']).optional(),
});

export async function POST(req: NextRequest) {
  try {
    // 2026-09-16: 기존 검사는 (a) x-api-key 헤더가 없으면 그냥 통과시켰고 — 그 뒤를
    // 받아주던 미들웨어 세션 인증이 이 앱에는 없다 — (b) Claude 키를 외부 공유
    // 시크릿으로 썼다. 둘 다 lib/auth.ts 의 checkAuth 로 옮겼다.
    const denied = checkAuth(req);
    if (denied) return denied;

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

    // 월 누적 비용을 보려면 남겨야 한다 — usage-log.ts
    if (result.usage) {
      const done = Object.keys(result.translations) as TargetLang[];
      recordUsage({
        kind: 'text',
        langs: done,
        items: done.length,
        reused: done.filter((l) => result.translations[l]?.reviewed).length,
        usage: result.usage,
      });
    }

    return NextResponse.json({ ...result, unregisteredTerms });
  } catch (error) {
    console.error('[translator/translate] Error:', error);
    return NextResponse.json(
      { error: 'Translation failed', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
