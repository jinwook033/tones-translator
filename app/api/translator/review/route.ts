/**
 * /api/translator/review
 *
 * 번역 검수. 네이티브 검수자가 항목별로 고치고 승인하는 곳.
 *
 *   GET   — 검수 목록 (언어·상태·이슈 유무로 거르기)
 *   PUT   — 한 항목 처리: correct(고침) / approve(승인) / reopen(대기로 되돌림)
 *   POST  — 고친 내용을 언어 설정의 대조 예문으로 승격
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { checkAuth } from '@/lib/auth';
import {
  listReviews,
  reviewStats,
  saveCorrection,
  approve,
  reopen,
  getReview,
} from '@/lib/translator/review-store';
import { getLanguageProfile, saveLanguageProfile } from '@/lib/translator/language-profile';

export const runtime = 'nodejs';

const LangEnum = z.enum(['en', 'cn', 'tw', 'ja', 'ko']);
const StatusEnum = z.enum(['pending', 'approved', 'corrected']);

export async function GET(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const q = req.nextUrl.searchParams;
  const lang = LangEnum.safeParse(q.get('lang'));
  const status = StatusEnum.safeParse(q.get('status'));

  const { items, total } = listReviews({
    lang: lang.success ? lang.data : undefined,
    status: status.success ? status.data : undefined,
    issuesOnly: q.get('issuesOnly') === 'true',
    search: q.get('search') || undefined,
    limit: Math.min(Number(q.get('limit')) || 50, 200),
    offset: Number(q.get('offset')) || 0,
  });

  return NextResponse.json({ items, total, stats: reviewStats() });
}

const ActionSchema = z.object({
  id: z.string().min(1).max(64),
  action: z.enum(['correct', 'approve', 'reopen']),
  corrected: z.string().max(5000).optional(),
  reviewedBy: z.string().max(60).optional(),
});

export async function PUT(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다' }, { status: 400 });
  }

  const { id, action, corrected, reviewedBy } = parsed.data;

  let item;
  if (action === 'correct') {
    if (typeof corrected !== 'string') {
      return NextResponse.json({ error: '고친 번역이 필요합니다' }, { status: 400 });
    }
    item = saveCorrection(id, corrected, reviewedBy);
  } else if (action === 'approve') {
    item = approve(id, reviewedBy);
  } else {
    item = reopen(id);
  }

  if (!item) return NextResponse.json({ error: '해당 항목이 없습니다' }, { status: 404 });
  return NextResponse.json({ ok: true, item });
}

const PromoteSchema = z.object({
  id: z.string().min(1).max(64),
  reason: z.string().max(2000),
  reviewedBy: z.string().max(60).optional(),
});

/**
 * 고친 내용을 그 언어의 대조 예문으로 올린다.
 * 한 건을 고치면 그 문장만 해결되지만, 예문으로 올리면 비슷한 문장 전체에 영향을 준다.
 */
export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다' }, { status: 400 });
  }

  const parsed = PromoteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '입력값이 올바르지 않습니다' }, { status: 400 });
  }

  const item = getReview(parsed.data.id);
  if (!item) return NextResponse.json({ error: '해당 항목이 없습니다' }, { status: 404 });
  if (!item.corrected) {
    return NextResponse.json({ error: '고친 내용이 있어야 예문으로 올릴 수 있습니다' }, { status: 400 });
  }

  const profile = getLanguageProfile(item.lang);
  const already = profile.examples.some((e) => e.source === item.source);
  if (already) {
    return NextResponse.json({ error: '이 원문은 이미 예문에 있습니다' }, { status: 409 });
  }

  saveLanguageProfile({
    ...profile,
    examples: [
      ...profile.examples,
      {
        source: item.source,
        bad: item.machine,
        good: item.corrected,
        reason: parsed.data.reason,
      },
    ],
    updatedBy: parsed.data.reviewedBy || profile.updatedBy,
  });

  return NextResponse.json({ ok: true, exampleCount: profile.examples.length + 1 });
}
