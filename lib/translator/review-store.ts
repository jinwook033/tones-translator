// review-store.ts — 번역 검수 기록
//
// 네이티브 검수자가 고친 내용을 남겨두는 곳. 이게 없으면 검수가 매번 처음부터다 —
// 일본인이 "이건 틀렸다"고 해도 기록이 없어서 같은 문장을 다시 돌리면 또 틀린다.
//
// 세 가지를 한다.
//   1. 번역 결과를 '검수 대기'로 쌓는다
//   2. 검수자가 고친 내용을 저장한다
//   3. 같은 원문이 다시 오면 고쳐둔 번역을 그대로 쓴다 (API 호출 0, 비용 0)
//
// 저장은 용어집·언어설정과 같은 방식이다 — data/review.json.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { TargetLang, TranslationContext, ValidationIssue } from './types';

export type ReviewStatus =
  | 'pending'    // 번역만 된 상태
  | 'approved'   // 검수자가 그대로 써도 된다고 확인
  | 'corrected'; // 검수자가 고침

export interface ReviewItem {
  id: string;
  lang: TargetLang;
  context: TranslationContext;
  source: string;            // 한국어 원문
  machine: string;           // 모델이 낸 번역
  corrected?: string;        // 검수자가 고친 번역
  status: ReviewStatus;
  confidence: number;
  issues: ValidationIssue[]; // 검증기가 잡은 것
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

/** 원문·문맥·언어가 같으면 같은 항목으로 본다. */
export function reviewId(lang: TargetLang, context: TranslationContext, source: string): string {
  return crypto.createHash('sha1').update(`${lang}\u0000${context}\u0000${source}`).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// 파일 저장
// ---------------------------------------------------------------------------

const FILE = () => path.join(process.cwd(), 'data', 'review.json');

let cache: Record<string, ReviewItem> | null = null;

function load(): Record<string, ReviewItem> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Record<string, ReviewItem>;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify(cache ?? {}, null, 2));
  } catch (e) {
    console.error('[Review] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// 번역 메모리
// ---------------------------------------------------------------------------

/**
 * 이 원문을 전에 검수해둔 게 있으면 그 번역을 돌려준다.
 * 고친 것(corrected)과 그대로 승인한 것(approved) 둘 다 재사용한다.
 * 검수 전(pending)은 재사용하지 않는다 — 아직 사람이 안 봤으므로.
 */
export function lookupMemory(
  lang: TargetLang,
  context: TranslationContext,
  source: string,
): { text: string; status: Exclude<ReviewStatus, 'pending'> } | null {
  const item = load()[reviewId(lang, context, source)];
  if (!item || item.status === 'pending') return null;
  const text = item.status === 'corrected' ? item.corrected : item.machine;
  return text ? { text, status: item.status } : null;
}

// ---------------------------------------------------------------------------
// 기록
// ---------------------------------------------------------------------------

/**
 * 번역 결과를 검수 대기로 올린다.
 * 이미 검수된 항목은 건드리지 않는다 — 사람이 고친 걸 기계가 덮어쓰면 안 된다.
 */
export function recordTranslation(input: {
  lang: TargetLang;
  context: TranslationContext;
  source: string;
  machine: string;
  confidence: number;
  issues: ValidationIssue[];
}): void {
  const all = load();
  const id = reviewId(input.lang, input.context, input.source);
  const existing = all[id];
  if (existing && existing.status !== 'pending') return;

  all[id] = {
    id,
    lang: input.lang,
    context: input.context,
    source: input.source,
    machine: input.machine,
    status: 'pending',
    confidence: input.confidence,
    issues: input.issues,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  persist();
}

// ---------------------------------------------------------------------------
// 검수
// ---------------------------------------------------------------------------

export function saveCorrection(id: string, corrected: string, reviewedBy?: string): ReviewItem | null {
  const all = load();
  const item = all[id];
  if (!item) return null;

  const trimmed = corrected.trim();
  // 모델 번역과 같으면 '고침'이 아니라 '승인'이다.
  item.status = trimmed && trimmed !== item.machine ? 'corrected' : 'approved';
  item.corrected = trimmed && trimmed !== item.machine ? trimmed : undefined;
  item.reviewedBy = reviewedBy || item.reviewedBy;
  item.reviewedAt = new Date().toISOString();
  persist();
  return item;
}

export function approve(id: string, reviewedBy?: string): ReviewItem | null {
  const all = load();
  const item = all[id];
  if (!item) return null;
  item.status = 'approved';
  item.corrected = undefined;
  item.reviewedBy = reviewedBy || item.reviewedBy;
  item.reviewedAt = new Date().toISOString();
  persist();
  return item;
}

/** 검수를 취소하고 다시 대기로 — 잘못 눌렀을 때. */
export function reopen(id: string): ReviewItem | null {
  const all = load();
  const item = all[id];
  if (!item) return null;
  item.status = 'pending';
  item.corrected = undefined;
  item.reviewedBy = undefined;
  item.reviewedAt = undefined;
  persist();
  return item;
}

export function getReview(id: string): ReviewItem | null {
  return load()[id] ?? null;
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

export interface ReviewFilter {
  lang?: TargetLang;
  status?: ReviewStatus;
  /** true 면 검증기가 무언가 잡은 항목만 */
  issuesOnly?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export function listReviews(filter: ReviewFilter = {}): { items: ReviewItem[]; total: number } {
  let items = Object.values(load());

  if (filter.lang) items = items.filter((i) => i.lang === filter.lang);
  if (filter.status) items = items.filter((i) => i.status === filter.status);
  if (filter.issuesOnly) items = items.filter((i) => i.issues.length > 0);
  if (filter.search) {
    const q = filter.search.toLowerCase();
    items = items.filter(
      (i) =>
        i.source.toLowerCase().includes(q) ||
        i.machine.toLowerCase().includes(q) ||
        (i.corrected ?? '').toLowerCase().includes(q),
    );
  }

  // 손봐야 할 것부터: 차단 → 경고 → 신뢰도 낮은 순
  const weight = (i: ReviewItem) =>
    i.issues.some((x) => x.severity === 'block') ? 0 : i.issues.length > 0 ? 1 : 2;
  items.sort((a, b) => weight(a) - weight(b) || a.confidence - b.confidence);

  const total = items.length;
  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 50;
  return { items: items.slice(offset, offset + limit), total };
}

export function reviewStats(): Record<TargetLang, { pending: number; approved: number; corrected: number }> {
  const out = {} as Record<TargetLang, { pending: number; approved: number; corrected: number }>;
  for (const item of Object.values(load())) {
    out[item.lang] ??= { pending: 0, approved: 0, corrected: 0 };
    out[item.lang][item.status]++;
  }
  return out;
}
