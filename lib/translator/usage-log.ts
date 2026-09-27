// usage-log.ts — 작업 기록과 누적 비용
//
// 지금까지는 요청 한 건의 비용만 화면에 떴다. 월 누적을 보려면 남겨야 한다.
// 한 줄이 번역 요청 한 번이다.
//
// 저장은 월별로 나눈다 — data/usage/2026-09.json.
// 한 파일에 계속 쌓으면 몇 달 뒤 통째로 읽는 비용이 커진다.

import * as fs from 'fs';
import * as path from 'path';
import type { TargetLang, TokenUsage } from './types';
import { calculateCost, emptyUsage, addUsage } from './pricing';

export type WorkKind = 'text' | 'sheet' | 'excel';

export interface UsageEntry {
  at: string;              // ISO
  kind: WorkKind;
  label?: string;          // 시트 제목·파일명 등 사람이 알아볼 이름
  langs: TargetLang[];
  items: number;           // 번역한 텍스트 수
  reused: number;          // 그중 검수본 재사용으로 API 를 안 탄 수
  usage: TokenUsage;
  model?: string;
}

const DIR = () => path.join(process.cwd(), 'data', 'usage');
const fileFor = (month: string) => path.join(DIR(), `${month}.json`);

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

function read(month: string): UsageEntry[] {
  try {
    return JSON.parse(fs.readFileSync(fileFor(month), 'utf8')) as UsageEntry[];
  } catch {
    return [];
  }
}

function write(month: string, entries: UsageEntry[]): void {
  try {
    fs.mkdirSync(DIR(), { recursive: true });
    fs.writeFileSync(fileFor(month), JSON.stringify(entries, null, 2));
  } catch (e) {
    console.error('[Usage] 기록 실패:', e instanceof Error ? e.message : e);
  }
}

/** 번역 한 건을 기록한다. 실패해도 번역 자체를 막지 않는다. */
export function recordUsage(entry: Omit<UsageEntry, 'at'> & { at?: string }): void {
  const at = entry.at ?? new Date().toISOString();
  const month = monthOf(at);
  const all = read(month);
  all.push({ ...entry, at });
  write(month, all);
}

export interface UsageSummary {
  month: string;
  entries: number;
  items: number;
  reused: number;
  usage: TokenUsage;
  totalUSD: number;
  totalKRW: number;
  /** 검수본 재사용으로 아낀 돈 — 재사용분이 평균 단가로 나갔다고 가정한 추정치 */
  savedKRW: number;
  cacheHitRate: number;
  recent: UsageEntry[];
}

export function summarize(month?: string): UsageSummary {
  const m = month ?? new Date().toISOString().slice(0, 7);
  const all = read(m);

  let usage = emptyUsage();
  let items = 0;
  let reused = 0;
  for (const e of all) {
    usage = addUsage(usage, e.usage);
    items += e.items;
    reused += e.reused;
  }

  const cost = calculateCost(usage);
  const billed = items - reused;
  const perItemKRW = billed > 0 ? cost.totalKRW / billed : 0;

  const cacheTotal = usage.cacheReadTokens + usage.cacheWriteTokens;
  const cacheHitRate = cacheTotal > 0 ? usage.cacheReadTokens / cacheTotal : 0;

  return {
    month: m,
    entries: all.length,
    items,
    reused,
    usage,
    totalUSD: cost.totalUSD,
    totalKRW: cost.totalKRW,
    savedKRW: Math.round(perItemKRW * reused),
    cacheHitRate,
    recent: all.slice(-8).reverse(),
  };
}

/** 최근 몇 달치 월별 합계 — 추이를 보여줄 때 */
export function monthlyTotals(months = 6): { month: string; krw: number; items: number }[] {
  const out: { month: string; krw: number; items: number }[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const s = summarize(m);
    out.push({ month: m, krw: Math.round(s.totalKRW), items: s.items });
  }
  return out.reverse();
}
