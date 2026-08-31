/**
 * translator/types.ts — Tones Translator type definitions
 */

// ---------------------------------------------------------------------------
// Glossary
// ---------------------------------------------------------------------------

export type GlossaryCategory =
  | 'brand'      // 브랜드명 (톤즈의원, 톤즈클리닉)
  | 'person'     // 의사/직원 이름
  | 'device'     // 의료기기 브랜드 (울쎄라, 인모드)
  | 'equipment'  // 장비 (울쎄라 피프라임, 에어젯 등)
  | 'medical'    // 의료 용어 (시술, 원장, 비급여)
  | 'treatment'  // 시술 (보톡스, 필러, 리쥬란 등)
  | 'location'   // 지명/역명
  | 'category'   // 시술 카테고리 (리프팅, 기미)
  | 'tag'        // UI 태그 (가성비, BEST)
  | 'product';   // 필러/주사 제품명 (레스틸렌, 벨로테로)

export interface GlossaryEntry {
  id?: string;
  korean: string;
  category: GlossaryCategory;
  en: string | null;
  cn: string | null;  // 简体中文
  sg: string | null;  // 繁體中文
  ja: string | null;  // 日本語
  note?: string | null;
  locked: boolean;     // true = 절대 번역 대상에서 제외
  created_at?: string;
  updated_at?: string;
}

export type TargetLang = 'en' | 'cn' | 'sg' | 'ja' | 'ko';
export const ALL_TARGETS: TargetLang[] = ['en', 'cn', 'sg', 'ja'];

export const LANG_LABELS: Record<TargetLang, string> = {
  en: 'English',
  cn: '简体中文',
  sg: '繁體中文',
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
}

export interface TranslateResponse {
  translations: Partial<Record<TargetLang, TranslationUnit>>;
  glossaryApplied: string[];
  cached: boolean;
  usage?: { inputTokens: number; outputTokens: number };
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
