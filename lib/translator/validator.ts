/**
 * validator.ts — Post-translation automatic validation
 *
 * Scans Claude's output for known anti-patterns, script inconsistencies,
 * and numeric preservation violations. Blocks dangerous mistranslations
 * before they reach the user.
 */

import type { TargetLang, ValidationIssue, ValidationResult } from './types';

// ---------------------------------------------------------------------------
// Anti-pattern rules
// ---------------------------------------------------------------------------

interface AntiPatternRule {
  pattern: RegExp;
  code: string;
  message: string;
  suggestion: string;
  severity: 'block' | 'warning';
}

const RULES: Partial<Record<TargetLang, AntiPatternRule[]>> = {
  en: [
    { pattern: /Moving\s*line/i, code: 'EN_NAME_MOVING_LINE', message: 'Person name 이동선 translated as "Moving line"', suggestion: 'Lee Dong-seon', severity: 'block' },
    { pattern: /\bpolitician\b/i, code: 'EN_POLITICIAN', message: '"politician" found — likely 의원 mistranslation', suggestion: 'clinic', severity: 'block' },
    { pattern: /\bsurgery\b/i, code: 'EN_SURGERY', message: '"surgery" found — 시술 should be "treatment" in non-surgical context', suggestion: 'treatment/procedure', severity: 'warning' },
    { pattern: /\bweightlifting\b/i, code: 'EN_WEIGHTLIFTING', message: '"weightlifting" for 리프팅', suggestion: 'lifting', severity: 'block' },
    { pattern: /Juvéderm|Juvederm/i, code: 'EN_COMPETITOR_JUVEDERM', message: 'Competitor brand Juvéderm used for 쥬베룩', suggestion: 'Juvelook', severity: 'block' },
    { pattern: /Refractional/i, code: 'EN_REFRACTIONAL', message: '"Refractional" is wrong for 프락셀', suggestion: 'Fraxel', severity: 'block' },
    { pattern: /\bPure\s*Toxin\b/i, code: 'EN_PURE_TOXIN', message: '"Pure Toxin" for 코어톡스/순수톡신', suggestion: 'Coretox', severity: 'block' },
    { pattern: /\bTonz\b|TONZ/i, code: 'EN_TONZ', message: '"Tonz/TONZ" for 톤즈 brand', suggestion: "Tone's", severity: 'block' },
    { pattern: /LHA\s+LALA\s+Peel/i, code: 'EN_LALA_PEEL', message: '"LHA LALA Peel" for 라라필', suggestion: 'LHALA Peel', severity: 'block' },
    { pattern: /ULTRAFORMER\s*MPT/i, code: 'EN_ULTRAFORMER', message: '"ULTRAFORMER MPT" — use Shurink Universe', suggestion: 'Shurink Universe', severity: 'block' },
    { pattern: /Regenerative\s*Genesis/i, code: 'EN_REGEN_GENESIS', message: '"Regenerative Genesis" for 헬제네시스', suggestion: 'Laser Genesis', severity: 'block' },
    { pattern: /[\u0400-\u04FF]/, code: 'EN_CYRILLIC', message: 'Cyrillic characters in English output — likely corruption', suggestion: 'Replace with Latin characters', severity: 'block' },
  ],
  cn: [
    { pattern: /议员/, code: 'CN_POLITICIAN', message: '"议员" (politician) for 의원', suggestion: '诊所/医院', severity: 'block' },
    { pattern: /举重/, code: 'CN_WEIGHTLIFTING', message: '"举重" (weightlifting) for 리프팅', suggestion: '面部提升/紧致提升', severity: 'block' },
    { pattern: /手术/, code: 'CN_SURGERY', message: '"手术" (surgery) for 시술', suggestion: '疗程/项目', severity: 'warning' },
    { pattern: /元帐|元帳/, code: 'CN_LEDGER', message: '"元帐" (ledger) for 원장', suggestion: '院长', severity: 'block' },
    { pattern: /移动线/, code: 'CN_MOVING_LINE', message: '"移动线" for person name 이동선', suggestion: 'Approved transliteration', severity: 'block' },
    { pattern: /热魔法/, code: 'CN_COUNTERFEIT', message: '"热魔法" (counterfeit slang for Thermage)', suggestion: 'Official name', severity: 'block' },
    { pattern: /Juvéderm|Juvederm|聚德美/, code: 'CN_COMPETITOR', message: 'Competitor brand for 쥬베룩', suggestion: 'Juvelook', severity: 'block' },
    { pattern: /纯毒素/, code: 'CN_PURE_TOXIN', message: '"纯毒素" (literal translation) for 코어톡스', suggestion: 'Coretox', severity: 'block' },
    { pattern: /通斯/, code: 'CN_TONGSI', message: '"通斯" (Chinese transliteration) for 톤즈', suggestion: "Tone's", severity: 'block' },
    { pattern: /修复针/, code: 'CN_HEALER_WRONG', message: '"修复针" for 리쥬란 힐러', suggestion: 'Rejuran Healer', severity: 'block' },
    { pattern: /三选一/, code: 'CN_THREE_CHOOSE', message: '"三选一" (choose 1 of 3) — wrong number assumption', suggestion: '任选1', severity: 'warning' },
    { pattern: /LHA\s+LALA\s+Peel/i, code: 'CN_LALA_PEEL', message: '"LHA LALA Peel" for 라라필', suggestion: 'LHALA Peel', severity: 'block' },
    { pattern: /水毒素/, code: 'CN_WATER_TOXIN', message: '"水毒素" (water toxin) for 물톡스', suggestion: '水光注射', severity: 'block' },
    { pattern: /洗牙/, code: 'CN_DENTAL', message: '"洗牙" (dental scaling) for 스케일링', suggestion: '去角质', severity: 'block' },
    { pattern: /再生创世纪/, code: 'CN_GENESIS', message: '"再生创世纪" (literal) for 헬제네시스', suggestion: 'Laser Genesis', severity: 'block' },
    { pattern: /德玛V|德瑪V/, code: 'CN_DERMAV', message: '"德玛V" (phonetic) for 더마브이', suggestion: 'DermaV', severity: 'block' },
    { pattern: /音调/, code: 'CN_MUSICAL_TONE', message: '"音调" (musical tone) for 토닝', suggestion: '净肤', severity: 'block' },
  ],
  sg: [
    { pattern: /議員|议员/, code: 'SG_POLITICIAN', message: '"議員/议员" for 의원', suggestion: '診所', severity: 'block' },
    { pattern: /舉重|举重/, code: 'SG_WEIGHTLIFTING', message: '"舉重" for 리프팅', suggestion: '拉提/緊緻拉提', severity: 'block' },
    { pattern: /手術/, code: 'SG_SURGERY', message: '"手術" (surgery) for 시술', suggestion: '療程', severity: 'warning' },
    { pattern: /元帳/, code: 'SG_LEDGER', message: '"元帳" for 원장', suggestion: '院長', severity: 'block' },
    { pattern: /移動線/, code: 'SG_MOVING_LINE', message: '"移動線" for 이동선', suggestion: 'Approved transliteration', severity: 'block' },
    { pattern: /日產|日产/, code: 'SG_NISSAN', message: '"日產/日产" (Nissan) for 일산', suggestion: '一山', severity: 'block' },
    { pattern: /Juvéderm|Juvederm/, code: 'SG_COMPETITOR', message: 'Competitor brand for 쥬베룩', suggestion: 'Juvelook', severity: 'block' },
    { pattern: /純毒素/, code: 'SG_PURE_TOXIN', message: '"純毒素" for 코어톡스', suggestion: 'Coretox', severity: 'block' },
    { pattern: /通斯/, code: 'SG_TONGSI', message: '"通斯" for 톤즈', suggestion: "Tone's", severity: 'block' },
    { pattern: /修復針/, code: 'SG_HEALER_WRONG', message: '"修復針" for 리쥬란 힐러', suggestion: 'Rejuran Healer', severity: 'block' },
    { pattern: /三選一/, code: 'SG_THREE_CHOOSE', message: '"三選一" — wrong number assumption', suggestion: '任選1', severity: 'warning' },
    { pattern: /LHA\s+LALA\s+Peel/i, code: 'SG_LALA_PEEL', message: '"LHA LALA Peel" for 라라필', suggestion: 'LHALA Peel', severity: 'block' },
    { pattern: /水毒素/, code: 'SG_WATER_TOXIN', message: '"水毒素" for 물톡스', suggestion: '水光注射', severity: 'block' },
    { pattern: /洗牙/, code: 'SG_DENTAL', message: '"洗牙" (dental) for 스케일링', suggestion: '去角質', severity: 'block' },
    { pattern: /再生創世紀/, code: 'SG_GENESIS', message: '"再生創世紀" for 헬제네시스', suggestion: 'Laser Genesis', severity: 'block' },
    { pattern: /德瑪V|德玛V/, code: 'SG_DERMAV', message: '"德瑪V" for 더마브이', suggestion: 'DermaV', severity: 'block' },
    { pattern: /音調/, code: 'SG_MUSICAL_TONE', message: '"音調" (musical tone) for 토닝', suggestion: '淨膚', severity: 'block' },
  ],
  ja: [
    { pattern: /議員/, code: 'JA_POLITICIAN', message: '"議員" (politician) for 의원', suggestion: '医院/クリニック', severity: 'block' },
    { pattern: /持ち上がる/, code: 'JA_INTRANSITIVE', message: '"持ち上がる" (intransitive) for 리프팅', suggestion: 'リフティング', severity: 'block' },
    { pattern: /元帳/, code: 'JA_LEDGER', message: '"元帳" (ledger) for 원장', suggestion: '院長', severity: 'block' },
    { pattern: /手術/, code: 'JA_SURGERY', message: '"手術" for 시술', suggestion: '施術', severity: 'warning' },
    { pattern: /電池店/, code: 'JA_BATTERY', message: '"電池店" (battery shop) — data corruption', suggestion: 'Remove', severity: 'block' },
    { pattern: /熱魔法/, code: 'JA_COUNTERFEIT', message: '"熱魔法" counterfeit slang', suggestion: 'Official name', severity: 'block' },
    { pattern: /Juvéderm|Juvederm/, code: 'JA_COMPETITOR', message: 'Competitor brand for 쥬베룩', suggestion: 'Juvelook/ジュベルック', severity: 'block' },
    { pattern: /ビッタミン/, code: 'JA_VITAMIN', message: '"ビッタミン" is wrong katakana', suggestion: 'ビタミン', severity: 'block' },
    { pattern: /エギョサル/, code: 'JA_AEGYO', message: '"エギョサル" — Korean loanword not natural', suggestion: '涙袋', severity: 'block' },
    { pattern: /LHAラッラ/, code: 'JA_LALA', message: '"LHAラッラピール" for 라라필', suggestion: 'LHALA Peel', severity: 'block' },
  ],
};

// ---------------------------------------------------------------------------
// Script consistency checks
// ---------------------------------------------------------------------------

// Simplified Chinese characters that should NOT appear in Traditional (SG) output
const SIMPLIFIED_CHARS = /[国学产发车这对质头时买计东专设说]/;
// Traditional Chinese characters that should NOT appear in Simplified (CN) output
const TRADITIONAL_CHARS = /[國學產發車這對質頭時買計東專設說]/;

function checkScript(text: string, target: TargetLang): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (target === 'cn') {
    const match = text.match(TRADITIONAL_CHARS);
    if (match) {
      issues.push({
        severity: 'warning',
        code: 'CN_TRAD_CHAR',
        message: `Traditional Chinese character "${match[0]}" found in 简体 output`,
        found: match[0],
        suggestion: 'Convert to simplified equivalent',
      });
    }
  }

  if (target === 'sg') {
    const match = text.match(SIMPLIFIED_CHARS);
    if (match) {
      issues.push({
        severity: 'warning',
        code: 'SG_SIMP_CHAR',
        message: `Simplified Chinese character "${match[0]}" found in 繁體 output`,
        found: match[0],
        suggestion: 'Convert to traditional equivalent',
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Numeric preservation check
// ---------------------------------------------------------------------------

function checkNumericPreservation(
  source: string,
  translated: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Extract all numbers from source
  const sourceNums = source.match(/\d[\d,]*/g) || [];
  // Filter out small numbers that might be part of glossary placeholders
  const significantNums = sourceNums.filter((n) => {
    const val = parseInt(n.replace(/,/g, ''), 10);
    return val >= 100; // Only check prices/counts >= 100
  });

  for (const num of significantNums) {
    const normalized = num.replace(/,/g, '');
    // Check if this number appears in translated text (with or without commas)
    const regex = new RegExp(normalized.replace(/(\d)/g, '$1,?'));
    if (!regex.test(translated.replace(/,/g, ''))) {
      issues.push({
        severity: 'warning',
        code: 'NUM_MISSING',
        message: `Number "${num}" from source not found in translation`,
        found: num,
        suggestion: 'Ensure all prices and quantities are preserved',
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main validator
// ---------------------------------------------------------------------------

export function validateTranslation(
  source: string,
  translated: string,
  target: TargetLang,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Anti-pattern checks
  const rules = RULES[target] || [];
  for (const rule of rules) {
    if (rule.pattern.test(translated)) {
      issues.push({
        severity: rule.severity,
        code: rule.code,
        message: rule.message,
        found: translated.match(rule.pattern)?.[0] ?? '',
        suggestion: rule.suggestion,
      });
    }
  }

  // 2. Script consistency
  issues.push(...checkScript(translated, target));

  // 3. Numeric preservation
  issues.push(...checkNumericPreservation(source, translated));

  // 4. Placeholder integrity — ensure no {{G_N}} leaked
  const placeholderLeaks = translated.match(/\{\{G_\d+\}\}/g);
  if (placeholderLeaks) {
    for (const leak of placeholderLeaks) {
      issues.push({
        severity: 'block',
        code: 'PLACEHOLDER_LEAK',
        message: `Unreplaced glossary placeholder ${leak} in output`,
        found: leak,
        suggestion: 'Check glossary restore function',
      });
    }
  }

  const hasBlocking = issues.some((i) => i.severity === 'block');

  return {
    passed: !hasBlocking,
    issues,
  };
}
