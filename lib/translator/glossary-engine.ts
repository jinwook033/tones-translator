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
import { CATEGORY_META } from './types';

// ---------------------------------------------------------------------------
// 치환 여부 판정
//
// 플레이스홀더는 모델에게 불투명한 토큰이다. 고유명사를 가릴 때는 이게 정확히
// 원하는 동작이지만, 문장의 뼈대 역할을 하는 일반어까지 가리면 모델이 앞뒤
// 관계를 조립할 수 없어 어순이 깨진다.
//
//   실측: '톤즈의원 이동선 원장의 리프팅 시술'
//   → Tone's CLINIC Lee Dong-seon Dr. Lifting treatment   (원장이 토큰이라 소유격이 사라짐)
//   기대: Dr. Lee Dong-seon's ...
//
// 그래서 anatomy / condition / general 분류는 토큰화하지 않는다. 대신 두 겹이 받친다.
//   1. 시스템 프롬프트의 <glossary> 블록에 226건 전부가 그대로 들어간다
//      (buildGlossaryReference) — 모델은 여전히 '원장 → Dr.' 를 본다.
//   2. validator.ts 가 JA_LEDGER(원장→元帳), EN_SURGERY(시술→surgery) 등으로 사후에 잡는다.
//
// 분류만으로 안 되는 예외는 항목의 substitute 로 뒤집는다 — 팔자(→figure eight),
// 애교살(→エギョサル), 자갈턱, 나비존, 눈가는 anatomy 지만 직역하면 틀리므로 치환한다.
// ---------------------------------------------------------------------------

/**
 * 이 용어를 플레이스홀더로 가릴 것인가.
 * 분류(CATEGORY_META)가 기본값을 정하고, 항목의 substitute 가 있으면 그게 이긴다.
 */
export function shouldSubstitute(entry: GlossaryEntry): boolean {
  if (typeof entry.substitute === 'boolean') return entry.substitute;
  return CATEGORY_META[entry.category]?.substitute ?? true;
}

// ---------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------

/**
 * Scan Korean text for glossary matches, replace with {{G_N}} placeholders.
 * Uses longest-match-first to avoid partial overlaps.
 * shouldSubstitute() 가 false 인 항목은 건너뛴다 — 위 주석 참고.
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
    .filter((e) => e.korean && e.korean.length > 0 && shouldSubstitute(e))
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

/** 분류를 모델이 읽을 역할 설명으로. 값은 알려주지 않는다. */
const KIND_LABEL: Partial<Record<GlossaryEntry['category'], string>> = {
  brand: 'a clinic/brand name',
  person: "a person's name (a doctor or staff member)",
  location: 'a place or branch name',
  device: 'a medical device brand',
  equipment: 'a device mode or component',
  product: 'a product name',
  procedure: 'a treatment name',
  category: 'a treatment category',
  menu: 'a website menu label',
  anatomy: 'a body area',
  condition: 'a skin condition',
  general: 'a common noun',
  tag: 'a badge label',
};

/** 이번 문장에 쓰인 플레이스홀더가 각각 무엇인지 — buildUserPrompt 에 넘긴다. */
export function buildPlaceholderLegend(matches: GlossaryMatch[]): { placeholder: string; kind: string }[] {
  return matches.map((m) => ({
    placeholder: m.placeholder,
    kind: KIND_LABEL[m.entry.category] ?? 'a fixed term',
  }));
}

// ---------------------------------------------------------------------------
// Tag lookup (zero API calls)
// ---------------------------------------------------------------------------

const TAG_TRANSLATIONS: Record<string, Record<string, string>> = {
  '가성비': { en: 'Cost-effective', cn: '高性价比', tw: '高性價比', ja: 'コスパ◎' },
  'BEST': { en: 'BEST', cn: 'BEST', tw: 'BEST', ja: 'BEST' },
  '20/30대 추천': { en: 'For 20s-30s', cn: '推荐20-30岁', tw: '推薦20-30歲', ja: '20-30代おすすめ' },
  '40/50대 추천': { en: 'For 40s-50s', cn: '推荐40-50岁', tw: '推薦40-50歲', ja: '40-50代おすすめ' },
  'VIP': { en: 'VIP', cn: 'VIP', tw: 'VIP', ja: 'VIP' },
  '원장 픽': { en: "Director's Pick", cn: '院长推荐', tw: '院長推薦', ja: '院長のおすすめ' },
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
  '국산': { en: 'Domestic', cn: '韩产', tw: '韓產', ja: '韓国産' },
  '국산프리미엄': { en: 'Domestic Premium', cn: '韩产高端', tw: '韓產高端', ja: '韓国産プレミアム' },
  '국산 프리미엄': { en: 'Domestic Premium', cn: '韩产高端', tw: '韓產高端', ja: '韓国産プレミアム' },
  '순수톡신': { en: 'Coretox', cn: 'Coretox', tw: 'Coretox', ja: 'コアトックス' },
  '코어톡스': { en: 'Coretox', cn: 'Coretox', tw: 'Coretox', ja: 'コアトックス' },
  '제오민(독일)': { en: 'Xeomin (Germany)', cn: 'Xeomin（德国）', tw: 'Xeomin（德國）', ja: 'ゼオミン（ドイツ）' },
  '제오민 독일산': { en: 'Xeomin (Germany)', cn: 'Xeomin（德国产）', tw: 'Xeomin（德國產）', ja: 'ゼオミン（ドイツ産）' },
  '디스포트(영국)': { en: 'Dysport (UK)', cn: 'Dysport（英国）', tw: 'Dysport（英國）', ja: 'ディスポート（英国）' },
  '디스포트 영국산': { en: 'Dysport (UK)', cn: 'Dysport（英国产）', tw: 'Dysport（英國產）', ja: 'ディスポート（英国産）' },
  '디스포트/앨러간': { en: 'Dysport/Allergan', cn: 'Dysport/Allergan', tw: 'Dysport/Allergan', ja: 'ディスポート/アラガン' },
  '수입': { en: 'Imported', cn: '进口', tw: '進口', ja: '輸入' },
  '수입 프리미엄': { en: 'Imported Premium', cn: '进口高端', tw: '進口高端', ja: '輸入プレミアム' },
  '아띠에르': { en: 'ATIERE', cn: 'ATIERE', tw: 'ATIERE', ja: 'アティエール' },
  '아띠': { en: 'ATIERE', cn: 'ATIERE', tw: 'ATIERE', ja: 'アティエール' },
  '뉴라미스': { en: 'Neuramis', cn: 'Neuramis', tw: 'Neuramis', ja: 'ニューラミス' },
  '벨로테로': { en: 'Belotero', cn: 'Belotero', tw: 'Belotero', ja: 'ベロテロ' },
  '레스틸렌': { en: 'Restylane', cn: 'Restylane', tw: 'Restylane', ja: 'レスチレン' },
  '레스틸렌 키쎄': { en: 'Restylane Kysse', cn: 'Restylane Kysse', tw: 'Restylane Kysse', ja: 'レスチレン キッセ' },
  '레스틸렌 리프트': { en: 'Restylane Lyft', cn: 'Restylane Lyft', tw: 'Restylane Lyft', ja: 'レスチレン リフト' },
  '체험가': { en: 'Trial Price', cn: '体验价', tw: '體驗價', ja: '体験価格' },
  '앨러간 미국산': { en: 'Allergan (USA)', cn: 'Allergan（美国产）', tw: 'Allergan（美國產）', ja: 'アラガン（米国産）' },
  '앨러간': { en: 'Allergan', cn: 'Allergan', tw: 'Allergan', ja: 'アラガン' },
  '바이리즌': { en: 'Byrizen', cn: 'Byrizen', tw: 'Byrizen', ja: 'バイリジン' },
};

// 택1 패턴 번역 (택1→Choose 1)
const TAEK_PATTERN_TRANSLATIONS: Record<string, Record<string, string>> = {
  '택1': { en: '(Choose 1)', cn: '(任选1)', tw: '(任選1)', ja: '(1つ選択)' },
  '택 1': { en: '(Choose 1)', cn: '(任选1)', tw: '(任選1)', ja: '(1つ選択)' },
};

// 횟수 패턴 번역 (1회→1回, 16줄→16本 등)
function translateVariantPattern(variant: string, target: string): string | null {
  // N회
  let m = variant.match(/^(\d+)회$/);
  if (m) { const n = m[1]; return { en: `${n} Session(s)`, cn: `${n}次`, tw: `${n}次`, ja: `${n}回` }[target] ?? null; }
  // N회+M회
  m = variant.match(/^(\d+)회\+(\d+)회$/);
  if (m) return { en: `${m[1]}+${m[2]} Sessions`, cn: `${m[1]}+${m[2]}次`, tw: `${m[1]}+${m[2]}次`, ja: `${m[1]}+${m[2]}回` }[target] ?? null;
  // N+M회
  m = variant.match(/^(\d+)\+(\d+)회$/);
  if (m) return { en: `${m[1]}+${m[2]} Sessions`, cn: `${m[1]}+${m[2]}次`, tw: `${m[1]}+${m[2]}次`, ja: `${m[1]}+${m[2]}回` }[target] ?? null;
  // N줄 (실 리프팅)
  m = variant.match(/^(\d+)줄$/);
  if (m) { const n = m[1]; return { en: `${n} Threads`, cn: `${n}根线`, tw: `${n}根線`, ja: `${n}本` }[target] ?? null; }
  // N주간격,최대M회
  m = variant.match(/(\d+)주간격.*최대(\d+)회/);
  if (m) return { en: `Every ${m[1]} wks, up to ${m[2]} sessions`, cn: `每${m[1]}周，最多${m[2]}次`, tw: `每${m[1]}週，最多${m[2]}次`, ja: `${m[1]}週間隔、最大${m[2]}回` }[target] ?? null;
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
