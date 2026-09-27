// sheet-store.ts — 이벤트 시트
//
// 톤즈 월간 엑셀(excel-parser.ts)과는 다른 형식이다. 그쪽은 가격표라
// F·G·H열만 번역하고 J~M열 가격을 보존하지만, 이벤트 시트는 단순한 표다.
//
//   이벤트 명칭 | 한글 | 영어 | 중국어(간체) | 일본어 | 중국어(번체)
//
// 한글 칸을 채우고 실행하면 나머지 4칸이 채워진다. 저장하면 다시 불러 쓸 수 있고,
// 검수를 거친 문장은 재번역 없이 그대로 나온다(review-store 의 번역 메모리).

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { TargetLang } from './types';

/** 시트 열 순서 — 화면·엑셀 내보내기가 모두 이 순서를 따른다. */
export const SHEET_LANGS: TargetLang[] = ['en', 'cn', 'ja', 'tw'];

export const SHEET_COLUMNS = [
  { key: 'name', label: '이벤트 명칭' },
  { key: 'ko', label: '한글' },
  { key: 'en', label: '영어' },
  { key: 'cn', label: '중국어(간체)' },
  { key: 'ja', label: '일본어' },
  { key: 'tw', label: '중국어(번체)' },
] as const;

export interface SheetRow {
  id: string;
  name: string;                            // 이벤트 명칭
  ko: string;                              // 한국어 원문
  translations: Partial<Record<TargetLang, string>>;
  /** 각 언어가 검수본 재사용인지 — 화면에 표시하고 비용 판단에 쓴다 */
  reused?: Partial<Record<TargetLang, boolean>>;
  updatedAt?: string;
}

export interface Sheet {
  id: string;
  title: string;
  rows: SheetRow[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 파일 저장 — data/sheets.json
// ---------------------------------------------------------------------------

const FILE = () => path.join(process.cwd(), 'data', 'sheets.json');

let cache: Record<string, Sheet> | null = null;

function load(): Record<string, Sheet> {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE(), 'utf8')) as Record<string, Sheet>;
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
    console.error('[Sheet] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

function newId(): string {
  return crypto.randomBytes(6).toString('hex');
}

// ---------------------------------------------------------------------------

export function listSheets(): { id: string; title: string; rowCount: number; updatedAt: string }[] {
  return Object.values(load())
    .map((s) => ({ id: s.id, title: s.title, rowCount: s.rows.length, updatedAt: s.updatedAt }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getSheet(id: string): Sheet | null {
  return load()[id] ?? null;
}

/** 저장 요청으로 들어오는 행 — id 는 새 행이면 없다. */
export type SheetRowInput = Omit<SheetRow, 'id'> & { id?: string };

/** 시트를 통째로 저장한다. id 가 없으면 새로 만든다. */
export function saveSheet(input: { id?: string; title: string; rows: SheetRowInput[] }): Sheet {
  const all = load();
  const now = new Date().toISOString();
  const id = input.id && all[input.id] ? input.id : newId();

  const sheet: Sheet = {
    id,
    title: input.title.trim() || '이름 없는 시트',
    rows: input.rows.map((r) => ({
      id: r.id || newId(),
      name: r.name ?? '',
      ko: r.ko ?? '',
      translations: r.translations ?? {},
      reused: r.reused,
      updatedAt: r.updatedAt,
    })),
    createdAt: all[id]?.createdAt ?? now,
    updatedAt: now,
  };

  all[id] = sheet;
  persist();
  return sheet;
}

export function deleteSheet(id: string): boolean {
  const all = load();
  if (!all[id]) return false;
  delete all[id];
  persist();
  return true;
}

/**
 * 탭·쉼표로 구분된 텍스트를 행으로 바꾼다. 엑셀에서 복사해 붙여넣는 경로.
 * 첫 줄이 머리글처럼 보이면 건너뛴다.
 */
export function parsePasted(text: string): Omit<SheetRow, 'id'>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const split = (l: string) => (l.includes('\t') ? l.split('\t') : l.split(','));

  const first = split(lines[0]).map((c) => c.trim());
  const looksLikeHeader =
    first.some((c) => c.includes('이벤트') || c === '한글' || c === '영어' || c.includes('중국어') || c === '일본어');

  return lines.slice(looksLikeHeader ? 1 : 0).map((line) => {
    const c = split(line).map((x) => x.trim());
    return {
      name: c[0] ?? '',
      ko: c[1] ?? '',
      translations: {
        en: c[2] || undefined,
        cn: c[3] || undefined,
        ja: c[4] || undefined,
        tw: c[5] || undefined,
      },
    };
  });
}
