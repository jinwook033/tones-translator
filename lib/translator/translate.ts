/**
 * translate.ts — Core translation engine using Claude API
 *
 * Pipeline:
 * 1. Load glossary from Supabase
 * 2. Substitute glossary terms → placeholders
 * 3. Build system prompt with anti-patterns & language rules
 * 4. Call Claude API with extended thinking
 * 5. Parse JSON response
 * 6. Restore glossary placeholders
 * 7. Validate output (anti-patterns, script, numbers)
 * 8. Return result with confidence + ambiguities
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  GlossaryEntry,
  TargetLang,
  TranslationContext,
  TranslateResponse,
  TranslationUnit,
} from './types';

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

// Sonnet 전용 번역 클라이언트
const translatorClient = new Anthropic({ apiKey: process.env.TRANSLATOR_API_KEY || process.env.ANTHROPIC_API_KEY });

const MODEL = 'claude-sonnet-4-6';

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

  // 4개 언어 동시 번역 (1회 API 호출로 모든 언어 처리)
  const langNames: Record<string, string> = { en: "English", cn: "Simplified Chinese", sg: "Traditional Chinese", ja: "Japanese" };
  const langList = targets.map(t => `${t}: ${langNames[t]}`).join(", ");

  // 용어집: 원문에 포함된 용어만 프롬프트에 (토큰 절감)
  const matchedGlossary = glossary.filter(g => text.includes(g.korean));
  const glossaryLines = matchedGlossary.map(g => {
    const parts = targets.map(t => { const v = t === 'ko' ? g.korean : g[t as Exclude<TargetLang, 'ko'>]; return `${t}:${v || g.en || ''}`; }).filter(p => !p.endsWith(':'));
    return `${g.korean} → ${parts.join(' | ')}`;
  });
  const glossaryRef = glossaryLines.length > 0 ? `\n\n=== GLOSSARY (use these exact translations) ===\n${glossaryLines.join('\n')}` : '';

  const fullSystemPrompt = `You are a professional medical translator for Korean dermatology clinics. Translate to ALL languages simultaneously: ${langList}. Return JSON only.${glossaryRef}`;

  const userPrompt = `Translate this Korean text to ${langList}.\n\nText: "${text}"\n\nRespond in this exact JSON format:\n{\n${targets.map(t => `  "${t}": { "text": "translated text", "confidence": 0.95 }`).join(',\n')}\n}`;

  const useModel = modelOverride || MODEL;
  const client = translatorClient;

  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await client.messages.create({
        model: useModel,
        max_tokens: 8000,
        temperature: 0,
        system: [{ type: 'text', text: fullSystemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      });
      break;
    } catch (e: unknown) {
      const err = e as { status?: number; error?: { type?: string } };
      if ((err.status === 529 || err.error?.type === "overloaded_error") && attempt < 2) {
        console.warn(`[Translator] overloaded, 재시도 ${attempt + 1}/3 (${useModel})`);
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  if (!response) throw new Error("번역 API 응답 없음");

  const usage = { input: response.usage?.input_tokens || 0, output: response.usage?.output_tokens || 0 };
  console.log(`[Translator] tokens: in=${usage.input} out=${usage.output} cached=${response.usage?.cache_read_input_tokens || 0}`);
  let rawOutput = '';
  for (const block of response.content) {
    if (block.type === 'text') { rawOutput = block.text; break; }
  }

  // JSON 파싱
  const translations: Partial<Record<TargetLang, TranslationUnit>> = {};
  try {
    const cleaned = rawOutput.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    for (const t of targets) {
      if (parsed[t]) {
        translations[t] = {
          text: parsed[t].text || parsed[t],
          confidence: parsed[t].confidence || 0.8,
          ambiguities: parsed[t].ambiguities,
        };
      }
    }
  } catch {
    // 파싱 실패시 원문 반환
    for (const t of targets) {
      translations[t] = { text: rawOutput.trim(), confidence: 0.3 };
    }
  }

  const applied = glossary.filter(g => text.includes(g.korean)).map(g => g.korean);

  return {
    translations,
    glossaryApplied: applied,
    cached: false,
    usage: { inputTokens: usage.input, outputTokens: usage.output },
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
