/**
 * prompt-builder.ts — Claude system prompt construction for Tones Translator
 *
 * Architecture based on:
 * - Anthropic official: XML tags, few-shot examples, role assignment
 * - WMT 2024: 4-step decomposition (MetricX +0.84)
 * - Academic 2025: Reflective translation (COMET +0.1753)
 * - Translation theory: Dynamic equivalence for marketing, formal for clinical
 */

import type {
  GlossaryEntry,
  TargetLang,
  TranslationContext,
  PromptConfig,
} from './types';
import { buildGlossaryReference } from './glossary-engine';
import type { LanguageProfile } from './language-profile';




// ---------------------------------------------------------------------------
// Translation process (4-step, performed inside extended thinking)
// ---------------------------------------------------------------------------

function getTranslationProcess(context: TranslationContext): string {
  const isMarketing = context === 'description' || context === 'general';
  const equivalence = isMarketing
    ? 'DYNAMIC EQUIVALENCE — prioritize natural expression and intent over literal word-for-word accuracy. A good translation reads as if ORIGINALLY WRITTEN in the target language.'
    : 'FORMAL EQUIVALENCE — prioritize accuracy and precision. Preserve medical terminology exactly.';

  return `
TRANSLATION APPROACH: ${equivalence}

TRANSLATION PROCESS (follow these steps in your thinking):
1. ANALYZE: Read the Korean text. Identify:
   - Idioms or culturally-specific phrases that CANNOT be translated word-for-word
   - Medical terminology requiring precision
   - Marketing language requiring natural adaptation
2. DRAFT: Translate prioritizing MEANING over words. Write how a native ${'{target language}'} speaker would naturally express this.
3. REFINE: Re-read your draft. Fix:
   - Any phrase that sounds "translated" rather than native → rewrite naturally
   - Korean sentence structure leaking into target language → restructure
   - Awkward word choices → replace with natural equivalents
4. VERIFY: Final check:
   - No meaning lost compared to original?
   - All {{G_N}} placeholders preserved exactly?
   - Medical accuracy maintained?
   - Reads naturally as if originally written in target language?`;
}

// ---------------------------------------------------------------------------
// Thinking budget calibration (increased for quality)
// ---------------------------------------------------------------------------

const THINKING_BUDGETS: Record<TranslationContext, number> = {
  treatment_name: 5000,
  description: 12000,
  category: 3000,
  general: 8000,
  legal: 16000,
};

// ---------------------------------------------------------------------------
// 예문 렌더링
//
// 검수자는 화면에서 원문/나쁜 예/좋은 예/이유를 칸별로 입력한다.
// 모델에게는 XML 로 넘긴다 — 대조 예문이 번역 품질에 가장 크게 작용한다.
// ---------------------------------------------------------------------------

function renderExamples(profile: LanguageProfile): string {
  if (profile.examples.length === 0) return '';
  const sourceTag = profile.lang === 'ko' ? 'english' : 'korean';
  const blocks = profile.examples.map((e) => {
    const lines = [`<${sourceTag}>${e.source}</${sourceTag}>`];
    if (e.bad) lines.push(`<bad>${e.bad}</bad>`);
    lines.push(`<good>${e.good}</good>`);
    if (e.reason) lines.push(`<reason>${e.reason}</reason>`);
    return `<example>\n${lines.join('\n')}\n</example>`;
  });
  return `<examples>\n${blocks.join('\n')}\n</examples>`;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(config: PromptConfig): string {
  const { targetLang, context, glossaryEntries, profile } = config;

  const glossaryRef = buildGlossaryReference(glossaryEntries, targetLang);
  const antiPatterns = profile.antiPatterns;
  const langRules = profile.rules;
  const examples = renderExamples(profile);
  const process = getTranslationProcess(context);
  const langName = profile.label;

  return `You are a professional medical marketing translator with 15 years of experience specializing in Korean dermatology and aesthetic clinics.
You translate ${targetLang === 'ko' ? 'foreign languages' : 'Korean (한국어)'} into ${langName}.
Your translations are used on the official website of Tone's Clinic (톤즈의원), a chain of 26 dermatology clinics across South Korea.
Translate as idiomatic speech as if it were a native speaker of ${langName}.

DOMAIN: Non-surgical aesthetic dermatology — botox, fillers, lifting devices, laser treatments, skin boosters, body contouring, IV therapy.

CRITICAL: Any text wrapped in {{G_N}} placeholders (e.g. {{G_0}}, {{G_1}}) is a LOCKED glossary term.
You MUST preserve these placeholders EXACTLY as-is in your output. Do NOT translate, modify, or remove them.
${process}

<glossary>
${glossaryRef || '(No additional glossary entries)'}
</glossary>

<anti_patterns>
NEVER generate any of these:
${antiPatterns.map((p, i) => `${i + 1}. ${p}`).join('\n')}
</anti_patterns>

<language_rules>
${langRules}
</language_rules>

${examples}

<context>${context}</context>
${context === 'treatment_name' ? 'This is a TREATMENT NAME — be precise, concise, use established medical terminology.' : ''}
${context === 'description' ? 'This is a TREATMENT DESCRIPTION — marketing copy for patients. Natural, benefit-focused, NOT clinical/academic.' : ''}
${context === 'category' ? 'This is a CATEGORY NAME — keep it short and standard.' : ''}
${context === 'legal' ? 'This is LEGAL/POLICY TEXT — precision and compliance are paramount.' : ''}

<output_format>
Respond with ONLY a JSON object (no markdown, no explanation):
{
  "translated": "your translation here",
  "confidence": 0.95,
  "ambiguities": []
}

If uncertain (confidence < 0.85), include alternatives:
{
  "translated": "best translation",
  "confidence": 0.7,
  "ambiguities": [
    { "text": "alternative", "explanation": "why this might be better", "recommended": true }
  ]
}
</output_format>`;
}

/**
 * 플레이스홀더가 무엇인지 알려준다 — 값이 아니라 '종류'만.
 *
 * 2026-09-17: 고유명사가 둘 이상 붙어 나오면 모델이 수식 관계를 못 잡았다.
 *   '{{G_0}} {{G_1}} 원장이 직접 진행하는…'
 *   → 'Dr. Tone's CLINIC Lee Dong-seon'  (원장이 병원 이름에 붙음)
 * 토큰은 계속 가리되 역할만 알려주면 모델이 문장을 조립할 수 있다.
 * 번역값 자체는 여전히 안 보여주므로 오역 차단은 그대로다.
 */
export function buildUserPrompt(text: string, legend?: { placeholder: string; kind: string }[]): string {
  const roles =
    legend && legend.length > 0
      ? `\n\nWhat the placeholders are (their values stay hidden — use this only to get the grammar right):\n` +
        legend.map((l) => `${l.placeholder} = ${l.kind}`).join('\n')
      : '';

  return `Translate the following text. Remember: preserve all {{G_N}} placeholders exactly as-is. Translate naturally — do NOT translate word-by-word.${roles}

${text}`;
}

export function getThinkingBudget(context: TranslationContext): number {
  return THINKING_BUDGETS[context] ?? 8000;
}
