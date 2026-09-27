/**
 * translate.ts — Core translation engine using Claude API
 *
 * Pipeline (언어별로 1회씩 수행):
 * 1. 용어집 → {{G_N}} 플레이스홀더 치환                         (glossary-engine)
 * 2. 시스템 프롬프트 생성 — anti-pattern / few-shot / 언어 규칙  (prompt-builder)
 * 3. Claude 호출 (extended thinking + 시스템 프롬프트 캐싱)
 * 4. JSON 파싱 { translated, confidence, ambiguities }
 * 5. 플레이스홀더를 target 언어 고정 용어로 복원
 * 6. 사후 검증 — anti-pattern / 문자체계 / 숫자 보존 / 플레이스홀더 누락 (validator)
 *
 * 2026-09-16: 1·2·5·6 단계는 구현되어 있으면서도 호출되지 않았다. 이전 구현은
 * 인라인 프롬프트로 전 언어를 1회에 번역했고 치환·검증을 모두 건너뛰었다.
 * 주석이 설명하던 파이프라인을 실제로 연결한다.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  GlossaryEntry,
  TargetLang,
  TranslationContext,
  TranslateResponse,
  TranslationUnit,
} from './types';
import { substituteGlossary, buildPlaceholderLegend } from './glossary-engine';
import { buildSystemPrompt, buildUserPrompt, getThinkingBudget } from './prompt-builder';
import { validateTranslation } from './validator';
import { getLanguageProfile } from './language-profile';
import { lookupMemory, recordTranslation } from './review-store';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

// Sonnet 전용 번역 클라이언트
const translatorClient = new Anthropic({ apiKey: process.env.TRANSLATOR_API_KEY || process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';

// thinking 토큰에 더할 실제 출력 여유분. budget_tokens < max_tokens 는 API 제약이다.
const OUTPUT_HEADROOM = 4000;

// ---------------------------------------------------------------------------
// Concurrency gate
//
// 언어 수만큼 호출이 늘어난다(4개 언어 = 4회). 엑셀 배치는 청크 단위로 병렬
// 호출하므로 청크 크기 × 언어 수까지 불어난다. 전역 상한으로 429를 막는다.
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 6;
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

// ---------------------------------------------------------------------------
// Single-language call
// ---------------------------------------------------------------------------

interface LangResult {
  target: TargetLang;
  unit: TranslationUnit;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
}

async function translateOne(
  sourceText: string,
  processedText: string,
  legend: { placeholder: string; kind: string }[],
  target: TargetLang,
  context: TranslationContext,
  glossary: GlossaryEntry[],
  restore: (translated: string, target: TargetLang) => string,
  model: string,
): Promise<LangResult> {
  const thinkingBudget = getThinkingBudget(context);

  // 시스템 프롬프트는 (언어, context) 조합마다 고정 — 그래서 캐시가 걸린다.
  // 본문 텍스트는 user 메시지에만 들어가므로 캐시 prefix 를 깨지 않는다.
  const systemPrompt = buildSystemPrompt({
    targetLang: target,
    context,
    glossaryEntries: glossary,
    thinkingBudget,
    profile: getLanguageProfile(target),
  });

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await withSlot(() =>
        translatorClient.messages.create({
          model,
          max_tokens: thinkingBudget + OUTPUT_HEADROOM,
          // extended thinking 사용 시 temperature 는 지정하지 않는다.
          thinking: { type: 'enabled', budget_tokens: thinkingBudget },
          system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: buildUserPrompt(processedText, legend) }],
        }),
      );
      break;
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { type?: string } };
      if ((err.status === 529 || err.error?.type === 'overloaded_error') && attempt < 2) {
        console.warn(`[Translator] overloaded, 재시도 ${attempt + 1}/3 (${target}, ${model})`);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  if (!response) throw new Error('번역 API 응답 없음');

  // thinking 블록을 건너뛰고 text 블록만 취한다.
  let rawOutput = '';
  for (const block of response.content) {
    if (block.type === 'text') {
      rawOutput = block.text;
      break;
    }
  }

  let translated: string;
  let confidence: number;
  let ambiguities: TranslationUnit['ambiguities'];

  try {
    const cleaned = rawOutput.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    translated = typeof parsed.translated === 'string' ? parsed.translated : String(parsed.translated ?? '');
    confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.8;
    ambiguities = Array.isArray(parsed.ambiguities) && parsed.ambiguities.length > 0 ? parsed.ambiguities : undefined;
  } catch {
    // 파싱 실패 — 원문을 그대로 돌려주되 confidence 로 표시한다.
    translated = rawOutput.trim();
    confidence = 0.3;
  }

  // 플레이스홀더 복원 후 검증. 검증은 복원된 최종 문자열 기준이어야 한다.
  const restored = restore(translated, target);
  const validation = validateTranslation(sourceText, restored, target);

  if (!validation.passed) {
    const codes = validation.issues.filter((i) => i.severity === 'block').map((i) => i.code);
    console.warn(`[Translator] ${target} 검증 차단: ${codes.join(', ')}`);
  }

  // 검수 대기로 올린다. 이미 사람이 본 항목은 review-store 가 덮어쓰지 않는다.
  recordTranslation({
    lang: target,
    context,
    source: sourceText,
    machine: restored,
    confidence,
    issues: validation.issues,
  });

  return {
    target,
    unit: { text: restored, confidence, ambiguities, validation },
    inputTokens: response.usage?.input_tokens || 0,
    cacheWriteTokens: response.usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: response.usage?.cache_read_input_tokens || 0,
    outputTokens: response.usage?.output_tokens || 0,
  };
}

// ---------------------------------------------------------------------------
// Multi-language translation
// ---------------------------------------------------------------------------

export async function translate(
  text: string,
  targets: TargetLang[],
  context: TranslationContext,
  glossary: GlossaryEntry[],
  modelOverride?: string,
): Promise<TranslateResponse> {
  if (!text || text.trim() === '') {
    return {
      translations: {},
      glossaryApplied: [],
      cached: false,
    };
  }

  // 1. 용어집 치환 — 언어와 무관하므로 1회만 수행한다.
  const { processedText, matches, restore } = substituteGlossary(text, glossary);
  const legend = buildPlaceholderLegend(matches);
  const useModel = modelOverride || MODEL;

  const results = await Promise.all(
    targets.map((target): Promise<LangResult> => {
      // 검수를 거친 번역이 있으면 그대로 쓴다 — API 호출도 비용도 0.
      const remembered = lookupMemory(target, context, text);
      if (remembered) {
        return Promise.resolve({
          target,
          unit: {
            text: remembered.text,
            confidence: 1,
            validation: { passed: true, issues: [] },
            reviewed: remembered.status,
          },
          inputTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          outputTokens: 0,
        });
      }
      return translateOne(text, processedText, legend, target, context, glossary, restore, useModel);
    }),
  );

  const translations: Partial<Record<TargetLang, TranslationUnit>> = {};
  let inputTokens = 0;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  for (const r of results) {
    translations[r.target] = r.unit;
    inputTokens += r.inputTokens;
    cacheWriteTokens += r.cacheWriteTokens;
    cacheReadTokens += r.cacheReadTokens;
    outputTokens += r.outputTokens;
  }

  const fromMemory = results.filter((r) => r.unit.reviewed).length;
  console.log(
    `[Translator] ${targets.join(',')} tokens: in=${inputTokens} cacheW=${cacheWriteTokens} cacheR=${cacheReadTokens} out=${outputTokens}` +
      (fromMemory > 0 ? ` (검수본 재사용 ${fromMemory}/${targets.length})` : ''),
  );

  return {
    translations,
    glossaryApplied: [...new Set(matches.map((m) => m.korean))],
    cached: false,
    usage: { inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens },
  };
}

// ---------------------------------------------------------------------------
// Batch translation (for Excel rows)
// ---------------------------------------------------------------------------

export interface BatchItem {
  id: string;
  text: string;
  context: TranslationContext;
}

export interface BatchResult {
  id: string;
  translations: Partial<Record<TargetLang, TranslationUnit>>;
  glossaryApplied: string[];
}

/**
 * Translate multiple items. Groups by context for efficiency.
 * Uses concurrency limit to avoid rate limiting.
 */
export async function translateBatch(
  items: BatchItem[],
  targets: TargetLang[],
  glossary: GlossaryEntry[],
  concurrency = 3,
): Promise<BatchResult[]> {
  const results: BatchResult[] = [];

  // Process in chunks
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        const res = await translate(item.text, targets, item.context, glossary);
        return {
          id: item.id,
          translations: res.translations,
          glossaryApplied: res.glossaryApplied,
        };
      }),
    );
    results.push(...chunkResults);
  }

  return results;
}
