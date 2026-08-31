/**
 * glossary-engine.ts — Glossary matching & placeholder substitution engine
 *
 * Core strategy: GLOSSARY-FIRST SUBSTITUTION
 * Before sending text to Claude, we replace known glossary terms with
 * placeholders ({{G_0}}, {{G_1}}, ...). Claude translates only the
 * remaining context words. After translation, we restore placeholders
 * with the correct target-language term from the glossary.
 *
 * This makes it STRUCTURALLY IMPOSSIBLE for Claude to mistranslate
 * locked terms like 톤즈의원 → 議員 or 이동선 → "Moving line".
 */

import type {
  GlossaryEntry,
  GlossaryMatch,
  GlossarySubstitution,
  TargetLang,
} from './types';

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

/**
 * Scan Korean text for glossary matches, replace with {{G_N}} placeholders.
 * Uses longest-match-first to avoid partial overlaps.
 */
export function substituteGlossary(
  text: string,
  entries: GlossaryEntry[],
): GlossarySubstitution {
  if (!text || entries.length === 0) {
    return {
      processedText: text,
      matches: [],
      restore: (t: string) => t,
    };
  }

  // Sort entries by Korean length DESC (longest match first)
  const sorted = [...entries]
    .filter((e) => e.korean && e.korean.length > 0)
    .sort((a, b) => b.korean.length - a.korean.length);

  const matches: GlossaryMatch[] = [];
  const working = text;
  let placeholderIdx = 0;

  // Track occupied ranges to prevent overlapping matches
  const occupied: Array<{ start: number; end: number }> = [];

  for (const entry of sorted) {
    const korean = entry.korean;
    let searchFrom = 0;

    while (true) {
      const idx = working.indexOf(korean, searchFrom);
      if (idx === -1) break;

      const end = idx + korean.length;

      // Check overlap with existing matches
      const overlaps = occupied.some(
        (r) => idx < r.end && end > r.start,
      );

      if (!overlaps) {
        const placeholder = `{{G_${placeholderIdx}}}`;
        matches.push({
          index: idx,
          length: korean.length,
          korean,
          placeholder,
          entry,
        });
        occupied.push({ start: idx, end });
        placeholderIdx++;
      }

      searchFrom = end;
    }
  }

  // Sort matches by position (left to right)
  matches.sort((a, b) => a.index - b.index);

  // Replace from right to left to preserve indices
  let processedText = text;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    processedText =
      processedText.substring(0, m.index) +
      m.placeholder +
      processedText.substring(m.index + m.length);
  }

  // Build restore function.
  // 2026-05-19 fix: replace() → replaceAll() — Claude 응답이 같은 placeholder를 여러 번 echo하면
  // 첫 번째만 치환되고 나머지는 literal {{G_N}}으로 노출되던 버그 차단.
  const restore = (translated: string, target: TargetLang): string => {
    let result = translated;
    for (const m of matches) {
      const replacement = target === 'ko' ? m.entry.korean : (m.entry[target as Exclude<typeof target, 'ko'>] ?? m.entry.korean);
      result = result.replaceAll(m.placeholder, replacement);
    }
    return result;
  };

  return { processedText, matches, restore };
}

// ---------------------------------------------------------------------------
// Tag lookup (zero API calls)
// ---------------------------------------------------------------------------

const TAG_TRANSLATIONS: Record<string, Record<string, string>> = {
  '가성비': { en: 'Cost-effective', cn: '高性价比', sg: '高性價比', ja: 'コスパ◎' },
  'BEST': { en: 'BEST', cn: 'BEST', sg: 'BEST', ja: 'BEST' },
  '20/30대 추천': { en: 'For 20s-30s', cn: '推荐20-30岁', sg: '推薦20-30歲', ja: '20-30代おすすめ' },
  '40/50대 추천': { en: 'For 40s-50s', cn: '推荐40-50岁', sg: '推薦40-50歲', ja: '40-50代おすすめ' },
  'VIP': { en: 'VIP', cn: 'VIP', sg: 'VIP', ja: 'VIP' },
  '원장 픽': { en: "Director's Pick", cn: '院长推荐', sg: '院長推薦', ja: '院長のおすすめ' },
};

/**
 * Translate a tag value using direct lookup. No API call needed.
 * Returns original if not found.
 */
export function translateTag(tag: string, target: TargetLang): string {
  if (!tag || tag.trim() === '') return '';
  const trimmed = tag.trim();
  return TAG_TRANSLATIONS[trimmed]?.[target] ?? trimmed;
}

// ---------------------------------------------------------------------------
// Variant/product name lookup
// ---------------------------------------------------------------------------

const VARIANT_TRANSLATIONS: Record<string, Record<string, string>> = {
  '국산': { en: 'Domestic', cn: '韩产', sg: '韓產', ja: '韓国産' },
  '국산프리미엄': { en: 'Domestic Premium', cn: '韩产高端', sg: '韓產高端', ja: '韓国産プレミアム' },
  '국산 프리미엄': { en: 'Domestic Premium', cn: '韩产高端', sg: '韓產高端', ja: '韓国産プレミアム' },
  '순수톡신': { en: 'Coretox', cn: 'Coretox', sg: 'Coretox', ja: 'コアトックス' },
  '코어톡스': { en: 'Coretox', cn: 'Coretox', sg: 'Coretox', ja: 'コアトックス' },
  '제오민(독일)': { en: 'Xeomin (Germany)', cn: 'Xeomin（德国）', sg: 'Xeomin（德國）', ja: 'ゼオミン（ドイツ）' },
  '제오민 독일산': { en: 'Xeomin (Germany)', cn: 'Xeomin（德国产）', sg: 'Xeomin（德國產）', ja: 'ゼオミン（ドイツ産）' },
  '디스포트(영국)': { en: 'Dysport (UK)', cn: 'Dysport（英国）', sg: 'Dysport（英國）', ja: 'ディスポート（英国）' },
  '디스포트 영국산': { en: 'Dysport (UK)', cn: 'Dysport（英国产）', sg: 'Dysport（英國產）', ja: 'ディスポート（英国産）' },
  '디스포트/앨러간': { en: 'Dysport/Allergan', cn: 'Dysport/Allergan', sg: 'Dysport/Allergan', ja: 'ディスポート/アラガン' },
  '수입': { en: 'Imported', cn: '进口', sg: '進口', ja: '輸入' },
  '수입 프리미엄': { en: 'Imported Premium', cn: '进口高端', sg: '進口高端', ja: '輸入プレミアム' },
  '아띠에르': { en: 'ATIERE', cn: 'ATIERE', sg: 'ATIERE', ja: 'アティエール' },
  '아띠': { en: 'ATIERE', cn: 'ATIERE', sg: 'ATIERE', ja: 'アティエール' },
  '뉴라미스': { en: 'Neuramis', cn: 'Neuramis', sg: 'Neuramis', ja: 'ニューラミス' },
  '벨로테로': { en: 'Belotero', cn: 'Belotero', sg: 'Belotero', ja: 'ベロテロ' },
  '레스틸렌': { en: 'Restylane', cn: 'Restylane', sg: 'Restylane', ja: 'レスチレン' },
  '레스틸렌 키쎄': { en: 'Restylane Kysse', cn: 'Restylane Kysse', sg: 'Restylane Kysse', ja: 'レスチレン キッセ' },
  '레스틸렌 리프트': { en: 'Restylane Lyft', cn: 'Restylane Lyft', sg: 'Restylane Lyft', ja: 'レスチレン リフト' },
  '체험가': { en: 'Trial Price', cn: '体验价', sg: '體驗價', ja: '体験価格' },
  '앨러간 미국산': { en: 'Allergan (USA)', cn: 'Allergan（美国产）', sg: 'Allergan（美國產）', ja: 'アラガン（米国産）' },
  '앨러간': { en: 'Allergan', cn: 'Allergan', sg: 'Allergan', ja: 'アラガン' },
  '바이리즌': { en: 'Byrizen', cn: 'Byrizen', sg: 'Byrizen', ja: 'バイリジン' },
};

// 택1 패턴 번역 (택1→Choose 1)
const TAEK_PATTERN_TRANSLATIONS: Record<string, Record<string, string>> = {
  '택1': { en: '(Choose 1)', cn: '(任选1)', sg: '(任選1)', ja: '(1つ選択)' },
  '택 1': { en: '(Choose 1)', cn: '(任选1)', sg: '(任選1)', ja: '(1つ選択)' },
};

// 횟수 패턴 번역 (1회→1回, 16줄→16本 등)
function translateVariantPattern(variant: string, target: string): string | null {
  // N회
  let m = variant.match(/^(\d+)회$/);
  if (m) { const n = m[1]; return { en: `${n} Session(s)`, cn: `${n}次`, sg: `${n}次`, ja: `${n}回` }[target] ?? null; }
  // N회+M회
  m = variant.match(/^(\d+)회\+(\d+)회$/);
  if (m) return { en: `${m[1]}+${m[2]} Sessions`, cn: `${m[1]}+${m[2]}次`, sg: `${m[1]}+${m[2]}次`, ja: `${m[1]}+${m[2]}回` }[target] ?? null;
  // N+M회
  m = variant.match(/^(\d+)\+(\d+)회$/);
  if (m) return { en: `${m[1]}+${m[2]} Sessions`, cn: `${m[1]}+${m[2]}次`, sg: `${m[1]}+${m[2]}次`, ja: `${m[1]}+${m[2]}回` }[target] ?? null;
  // N줄 (실 리프팅)
  m = variant.match(/^(\d+)줄$/);
  if (m) { const n = m[1]; return { en: `${n} Threads`, cn: `${n}根线`, sg: `${n}根線`, ja: `${n}本` }[target] ?? null; }
  // N주간격,최대M회
  m = variant.match(/(\d+)주간격.*최대(\d+)회/);
  if (m) return { en: `Every ${m[1]} wks, up to ${m[2]} sessions`, cn: `每${m[1]}周，最多${m[2]}次`, sg: `每${m[1]}週，最多${m[2]}次`, ja: `${m[1]}週間隔、最大${m[2]}回` }[target] ?? null;
  return null;
}

/**
 * Translate variant/product specification. Returns original if not found.
 */
export function translateVariant(variant: string, target: TargetLang, glossaryEntries?: GlossaryEntry[]): string {
  if (!variant || variant.trim() === '') return '';
  const trimmed = variant.trim();
  // 0. '*' 접두사 제거 후 재검색 (예: *체험가 → 체험가)
  if (trimmed.startsWith('*')) {
    const stripped = trimmed.slice(1).trim();
    const result = translateVariant(stripped, target, glossaryEntries);
    return result !== stripped ? `*${result}` : trimmed;
  }
  // 1. 사전 매칭
  const direct = VARIANT_TRANSLATIONS[trimmed]?.[target];
  if (direct) return direct;
  // 2a. 택1 패턴 매칭
  const taek = TAEK_PATTERN_TRANSLATIONS[trimmed]?.[target];
  if (taek) return taek;
  // 2b. 패턴 매칭 (N회, N줄 등)
  const pattern = translateVariantPattern(trimmed, target);
  if (pattern) return pattern;
  // 3. glossary fallback
  if (glossaryEntries) {
    const match = glossaryEntries.find(e => e.korean === trimmed);
    const val = target === 'ko' ? match?.korean : match?.[target as Exclude<TargetLang, 'ko'>];
    if (val) return val;
  }
  // 4. 원본 반환
  return trimmed;
}

// ---------------------------------------------------------------------------
// Glossary reference for Claude prompt (non-matched entries)
// ---------------------------------------------------------------------------

/**
 * Build a glossary reference block for the Claude system prompt.
 * Includes entries that were NOT already substituted (so Claude knows
 * the domain vocabulary even for terms not in the current text).
 */
export function buildGlossaryReference(
  entries: GlossaryEntry[],
  target: TargetLang,
  excludeKorean?: Set<string>,
): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (excludeKorean?.has(e.korean)) continue;
    const trans = target === 'ko' ? e.korean : e[target as Exclude<typeof target, 'ko'>];
    if (!trans) continue;
    lines.push(`${e.korean} → ${trans}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Extract all Korean terms from matched glossary for display.
 */
export function formatAppliedGlossary(
  matches: GlossaryMatch[],
  target: TargetLang,
): string[] {
  return matches.map(
    (m) => `${m.korean}→${target === 'ko' ? m.entry.korean : (m.entry[target as Exclude<TargetLang, 'ko'>] ?? m.entry.korean)}`,
  );
}
