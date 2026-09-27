/**
 * translator/types.ts — Tones Translator type definitions
 */

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

/**
 * 용어 분류.
 *
 * 2026-09-16 재정리: 기존 'medical' 이 뼈대 일반어·신체 부위·사이트 메뉴·시술명
 * 네 종류를 한꺼번에 담는 잡동사니 서랍이 되어 있었다. 성격별로 쪼개고,
 * 'treatment' 는 'procedure' 로 흡수했다(‘시술 카테고리’인 category 와 혼동됐다).
 *
 * 분류 기준은 단 하나 — 이 단어를 문맥 없이 모델에게 던지면 뜻을 복원할 수 있는가.
 *   복원 불가(고유명사)  → 치환한다. 플레이스홀더로 가려 오역을 원천 차단.
 *   복원 가능(일반어)    → 치환하지 않는다. 가리면 어순이 깨진다.
 * 실제 치환 여부는 CATEGORY_META.substitute 가 정하고, 예외는 항목별로 뒤집는다.
 */
export type GlossaryCategory =
  // ── 치환하는 분류 (고유명사) ────────────────────────────────
  | 'brand'      // 브랜드명 — 톤즈의원, 톤즈클리닉
  | 'person'     // 인명 — 의료진·직원 이름
  | 'location'   // 지점·지명 — 강남, 일산, 건대입구역
  | 'device'     // 의료기기 — 울쎄라, 인모드
  | 'equipment'  // 장비 구성·모드 — 울쎄라 피프라임, 에어젯
  | 'product'    // 제품명 — 레스틸렌, 벨로테로
  | 'procedure'  // 시술명 — 물톡스, 톤즈존팩, 침샘보톡스
  | 'category'   // 시술 카테고리 — 리프팅, 보톡스, 스킨부스터
  | 'menu'       // 사이트 메뉴·페이지명 — 이용약관, 전국 지점
  // ── 치환하지 않는 분류 (일반어) ──────────────────────────────
  | 'anatomy'    // 신체 부위 — 이마, 미간, 턱라인
  | 'condition'  // 피부 고민·증상 — 기미, 여드름, 흉터
  | 'general'    // 일반 용어 — 시술, 원장, 의원
  // ── 별도 경로 ──────────────────────────────────────────────
  | 'tag';       // UI 태그 — 가성비, BEST (translateTag 가 직접 처리, API 호출 없음)

export interface CategoryMeta {
  label: string;        // 화면에 보여줄 한글 이름
  substitute: boolean;  // 이 분류의 기본 치환 여부
  hint: string;         // 어떤 용어를 넣는 칸인지
}

/**
 * 분류별 한글 이름과 기본 동작.
 * 화면에는 "procedure (시술명)" 처럼 영문 코드와 한글을 함께 보여준다 —
 * 코드는 소스·DB 에 저장되는 값이고, 한글은 표시 전용이다.
 */
export const CATEGORY_META: Record<GlossaryCategory, CategoryMeta> = {
  brand:     { label: '브랜드',          substitute: true,  hint: '병원·브랜드 이름' },
  person:    { label: '인명',            substitute: true,  hint: '의료진·직원 이름' },
  location:  { label: '지점·지명',       substitute: true,  hint: '지점명, 지역명, 역명' },
  device:    { label: '의료기기',        substitute: true,  hint: '기기 브랜드명' },
  equipment: { label: '장비 구성',       substitute: true,  hint: '기기의 세부 모드·팁·구성' },
  product:   { label: '제품명',          substitute: true,  hint: '필러·주사제 등 제품 이름' },
  procedure: { label: '시술명',          substitute: true,  hint: '개별 시술 이름' },
  category:  { label: '시술 카테고리',   substitute: true,  hint: '사이트 시술 분류' },
  menu:      { label: '사이트 메뉴',     substitute: true,  hint: '페이지명·메뉴 라벨' },
  anatomy:   { label: '신체 부위',       substitute: false, hint: '시술 부위를 가리키는 말' },
  condition: { label: '피부 고민·증상',  substitute: false, hint: '기미·여드름 같은 증상명' },
  general:   { label: '일반 용어',       substitute: false, hint: '문장 뼈대가 되는 보통 명사' },
  // 이벤트에서 선택하는 배지 전용 값이다(엑셀 C~E열). 배지 자체는 translateTag() 가
  // API 없이 직접 옮기고 본문에 섞여 나오지 않으므로, 표기를 고정한다.
  tag:       { label: 'UI 태그',         substitute: true,  hint: '이벤트에서 선택하는 노출 배지' },
};

export interface GlossaryEntry {
  id?: string;
  korean: string;
  category: GlossaryCategory;
  en: string | null;
  cn: string | null;  // 简体中文
  tw: string | null;  // 繁體中文 (대만)
  ja: string | null;  // 日本語
  note?: string | null;
  locked: boolean;     // true = 이 번역값을 강제한다 (치환 여부와는 다른 축)
  /**
   * 분류 기본값을 뒤집고 싶을 때만 지정한다. 없으면 CATEGORY_META 를 따른다.
   *   true  — 일반어 분류지만 직역하면 틀리는 말 (팔자→figure eight, 애교살→エギョサル)
   *   false — 고유명사 분류지만 모델이 확실히 아는 말 (제모→Hair Removal)
   */
  substitute?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type TargetLang = 'en' | 'cn' | 'tw' | 'ja' | 'ko';
export const ALL_TARGETS: TargetLang[] = ['en', 'cn', 'tw', 'ja'];

export const LANG_LABELS: Record<TargetLang, string> = {
  en: 'English',
  cn: '简体中文',
  tw: '繁體中文 (대만)',
  ja: '日本語',
  ko: '한국어',
};

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

export type TranslationContext =
  | 'treatment_name'   // 시술명 (짧은 텍스트, 정확도 최우선)
  | 'description'      // 시술 설명 (마케팅 카피)
  | 'category'         // 카테고리명
  | 'general'          // 일반 텍스트
  | 'legal';           // 약관/정책

export interface TranslateRequest {
  text: string;
  source?: 'ko';
  targets: TargetLang[];
  context: TranslationContext;
}

export interface AmbiguityOption {
  text: string;
  explanation: string;
  recommended: boolean;
}

export interface TranslationUnit {
  text: string;
  confidence: number;
  ambiguities?: AmbiguityOption[];
  validation?: ValidationResult;   // 사후 검증 결과 (validator.ts)
  /** 검수된 번역을 재사용한 경우 그 상태 — API 를 호출하지 않았다는 뜻 */
  reviewed?: 'approved' | 'corrected';
}

export interface TokenUsage {
  inputTokens: number;       // 캐시를 안 탄 입력 — 정가
  cacheWriteTokens: number;  // 캐시에 새로 쓴 입력 — 정가의 1.25배
  cacheReadTokens: number;   // 캐시에서 읽은 입력 — 정가의 0.1배
  outputTokens: number;
}

export interface TranslateResponse {
  translations: Partial<Record<TargetLang, TranslationUnit>>;
  glossaryApplied: string[];
  cached: boolean;
  usage?: TokenUsage;
}

// ---------------------------------------------------------------------------
// Glossary Engine
// ---------------------------------------------------------------------------

export interface GlossaryMatch {
  index: number;           // position in source text
  length: number;          // match length
  korean: string;          // matched Korean term
  placeholder: string;     // e.g. "{{G_0}}"
  entry: GlossaryEntry;   // full glossary entry
}

export interface GlossarySubstitution {
  processedText: string;                         // text with placeholders
  matches: GlossaryMatch[];                      // ordered matches
  restore: (translated: string, target: TargetLang) => string;  // reverse substitution
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export type ValidationSeverity = 'block' | 'warning';

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  found: string;       // the problematic text
  suggestion?: string; // what it should be
}

export interface ValidationResult {
  passed: boolean;
  issues: ValidationIssue[];
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export interface ExcelRow {
  rowNumber: number;
  category: string;         // 중분류 (from row 9 pattern)
  subcategory: string;      // A열 소분류
  multiValue: string;       // B열 복수값
  tag1: string;             // C열
  tag2: string;             // D열
  tag3: string;             // E열
  procedureInfo: string;    // F열 시술정보
  procedureName: string;    // G열 시술명 (번역 대상)
  description: string;      // H열 내용 (번역 대상)
  variant: string;          // I열 횟수/제품 바리에이션
  marketingPrice: number | null;  // J열
  requiredPrice: number | null;   // K열
  discountPrice: number | null;   // L열
  discountRate: string;           // M열
}

export interface ParsedExcel {
  fileName: string;
  sheetName: string;
  categories: string[];           // 114-item _categoryList
  rows: ExcelRow[];
  rawWorkbook: unknown;           // original workbook for structure preservation
}

export interface TranslatedExcelRow extends ExcelRow {
  procedureName_translated: Partial<Record<TargetLang, string>>;
  description_translated: Partial<Record<TargetLang, string>>;
  procedureInfo_translated: Partial<Record<TargetLang, string>>;
  tag1_translated: Partial<Record<TargetLang, string>>;
  tag2_translated: Partial<Record<TargetLang, string>>;
  tag3_translated: Partial<Record<TargetLang, string>>;
  variant_translated: Partial<Record<TargetLang, string>>;
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

export interface PromptConfig {
  targetLang: TargetLang;
  context: TranslationContext;
  glossaryEntries: GlossaryEntry[];
  thinkingBudget: number;
  /** 이 언어의 검수 설정 — 금지표현·예문·문체규칙 (language-profile.ts) */
  profile: import('./language-profile').LanguageProfile;
}

// ---------------------------------------------------------------------------
// API (Spring integration)
// ---------------------------------------------------------------------------

export interface ApiTranslateRequest {
  text: string;
  source: 'ko';
  targets: TargetLang[];
  context: TranslationContext;
}

export interface ApiTranslateExcelRequest {
  file: File;
  targets: TargetLang[];
}
