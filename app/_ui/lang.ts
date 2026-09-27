// 화면에서 쓰는 언어 표기와 글꼴.
//
// LANG_LABELS(types.ts)는 원어 표기(日本語)라 화면 라벨과 용도가 다르다.
// 시안은 한국어 라벨(일본어)과 코드(JA)를 같이 보여준다.

import type { TargetLang } from '@/lib/translator/types';

export interface LangMeta {
  id: TargetLang;
  name: string;   // 일본어
  code: string;   // JA
  tag: string;    // lang 속성값 — 브라우저 글꼴 선택에 쓰인다
  font: string;   // CSS 변수
}

/** 번역 대상 4개. 검수·설정 화면의 탭 순서와 같다. */
export const LANGS: LangMeta[] = [
  { id: 'ja', name: '일본어', code: 'JA', tag: 'ja', font: 'var(--ja)' },
  { id: 'cn', name: '중국어', code: 'ZH-CN', tag: 'zh-CN', font: 'var(--sc)' },
  { id: 'tw', name: '대만어', code: 'ZH-TW', tag: 'zh-TW', font: 'var(--tc)' },
  { id: 'en', name: '영어', code: 'EN', tag: 'en', font: 'var(--fnt)' },
];

export const LANG_BY_ID: Record<string, LangMeta> = Object.fromEntries(
  LANGS.map((l) => [l.id, l]),
);

export function langMeta(id: string): LangMeta {
  return LANG_BY_ID[id] ?? { id: id as TargetLang, name: id, code: id.toUpperCase(), tag: id, font: 'var(--fnt)' };
}

/** 번역 문맥 — API 값과 화면 라벨. */
export const CONTEXTS = [
  { value: 'treatment_name', label: '시술명' },
  { value: 'description', label: '시술설명' },
  { value: 'category', label: '카테고리' },
  { value: 'general', label: '일반' },
  { value: 'legal', label: '약관' },
] as const;

export function contextLabel(value: string): string {
  return CONTEXTS.find((c) => c.value === value)?.label ?? value;
}
