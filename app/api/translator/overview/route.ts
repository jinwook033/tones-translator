/**
 * GET /api/translator/overview
 *
 * 대시보드 한 화면에 필요한 집계를 한 번에 돌려준다.
 * 화면에서 3~4개 엔드포인트를 따로 부르면 숫자가 서로 다른 시점의 것이 된다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkAuth } from '@/lib/auth';
import { getTenantId } from '@/lib/tenant';
import { getGlossary } from '@/lib/translator/glossary-data';
import { getAllLanguageProfiles } from '@/lib/translator/language-profile';
import { listReviews, reviewStats } from '@/lib/translator/review-store';
import { getRuleStats } from '@/lib/translator/validator';
import { shouldSubstitute } from '@/lib/translator/glossary-engine';
import { CATEGORY_META, type GlossaryCategory } from '@/lib/translator/types';
import { summarize } from '@/lib/translator/usage-log';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const tenantId = getTenantId(req);
  const glossary = await getGlossary(tenantId);
  const profiles = getAllLanguageProfiles();

  // 분류별 건수 — 용어집 화면의 칩과 같은 값
  const byCategory: { code: string; label: string; count: number; substitute: boolean }[] = [];
  for (const code of Object.keys(CATEGORY_META) as GlossaryCategory[]) {
    const count = glossary.filter((e) => e.category === code).length;
    if (count > 0) {
      byCategory.push({ code, label: CATEGORY_META[code].label, count, substitute: CATEGORY_META[code].substitute });
    }
  }
  byCategory.sort((a, b) => b.count - a.count);

  // 시안의 「고정 용어 41건」은 근거 없는 값이었다. 실제로 토큰 고정되는 건수를 센다.
  const pinned = glossary.filter((e) => shouldSubstitute(e)).length;

  // 번역 대상 4개 언어만 — ko 는 설정만 있고 검수 대상이 아니다
  const targetLangs = profiles.filter((p) => p.lang !== 'ko');
  const antiPatterns = targetLangs.reduce((a, p) => a + p.antiPatterns.length, 0);
  const examples = targetLangs.reduce((a, p) => a + p.examples.length, 0);

  // 차단된 항목 — 손봐야 할 것
  const { items: blockedItems } = listReviews({ issuesOnly: true, status: 'pending', limit: 50 });
  const blocked = blockedItems
    .filter((i) => i.issues.some((x) => x.severity === 'block'))
    .slice(0, 5)
    .map((i) => {
      const first = i.issues.find((x) => x.severity === 'block')!;
      return {
        id: i.id,
        lang: i.lang,
        source: i.source,
        machine: i.machine,
        code: first.code,
        message: first.message,
      };
    });

  const rules = getRuleStats();
  const usage = summarize();

  return NextResponse.json({
    usage: {
      month: usage.month,
      items: usage.items,
      reused: usage.reused,
      totalKRW: Math.round(usage.totalKRW),
      savedKRW: usage.savedKRW,
      cacheHitRate: usage.cacheHitRate,
      recent: usage.recent,
    },
    review: reviewStats(),
    blocked,
    blockedTotal: blockedItems.filter((i) => i.issues.some((x) => x.severity === 'block')).length,
    glossary: { total: glossary.length, categories: byCategory.length, pinned, byCategory },
    language: {
      antiPatterns,
      examples,
      languages: targetLangs.length,
      customized: profiles.filter((p) => p.updatedAt).length,
    },
    rules,
  });
}
