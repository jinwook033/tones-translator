/**
 * /api/translator/language
 *
 * 언어별 번역 설정 — 금지표현 · 대조 예문 · 문체 규칙.
 * 일본어는 일본인이, 중국어는 중국인이 직접 고치는 화면이 여기에 붙는다.
 *
 *   GET            — 전체 언어 설정 (수정 여부 포함)
 *   PUT            — 한 언어 저장
 *   DELETE ?lang=  — 그 언어를 코드 기본값으로 되돌림
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkAuth } from '@/lib/auth';
import {
  getAllLanguageProfiles,
  getLanguageProfile,
  saveLanguageProfile,
  resetLanguageProfile,
  isCustomized,
} from '@/lib/translator/language-profile';
import type { TargetLang } from '@/lib/translator/types';

export const runtime = 'nodejs';

const LangEnum = z.enum(['en', 'cn', 'tw', 'ja', 'ko']);

const ProfileSchema = z.object({
  lang: LangEnum,
  label: z.string().min(1).max(60),
  region: z.string().max(60),
  rules: z.string().max(20000),
  antiPatterns: z.array(z.string().max(500)).max(100),
  examples: z
    .array(
      z.object({
        source: z.string().max(2000),
        bad: z.string().max(2000),
        good: z.string().max(2000),
        reason: z.string().max(2000),
      }),
    )
    .max(30),
  updatedBy: z.string().max(60).optional(),
});

export async function GET(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const profiles = getAllLanguageProfiles().map((p) => ({
    ...p,
    customized: isCustomized(p.lang),
  }));
  return NextResponse.json({ profiles });
}

export async function PUT(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const parsed = ProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: '입력값이 올바르지 않습니다', detail: parsed.error.issues },
      { status: 400 },
    );
  }

  // 빈 예문은 저장하지 않는다 — 프롬프트에 빈 블록이 들어가면 모델이 혼란스러워한다.
  const examples = parsed.data.examples.filter((e) => e.source.trim() && e.good.trim());
  const antiPatterns = parsed.data.antiPatterns.map((a) => a.trim()).filter(Boolean);

  saveLanguageProfile({ ...parsed.data, examples, antiPatterns });

  return NextResponse.json({
    ok: true,
    profile: getLanguageProfile(parsed.data.lang),
    dropped: {
      examples: parsed.data.examples.length - examples.length,
      antiPatterns: parsed.data.antiPatterns.length - antiPatterns.length,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const lang = req.nextUrl.searchParams.get('lang');
  const parsed = LangEnum.safeParse(lang);
  if (!parsed.success) {
    return NextResponse.json({ error: 'lang 파라미터가 필요합니다' }, { status: 400 });
  }

  resetLanguageProfile(parsed.data as TargetLang);
  return NextResponse.json({ ok: true, profile: getLanguageProfile(parsed.data as TargetLang) });
}
