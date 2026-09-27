// pricing.ts — API 비용 계산
//
// 2026-09-17: 기존 계산은 (a) 캐시 토큰을 아예 세지 않았고 (b) Opus 가격이 옛날 값이었다.
// 시스템 프롬프트(용어집 226건 + 금지표현 + 예문)를 통째로 캐시에 넣기 때문에
// 입력 토큰의 대부분이 cache_creation / cache_read 로 잡힌다. 그걸 빼고 세면
// 실제 비용이 크게 과소 집계된다.

import type { TokenUsage } from './types';

/** 100만 토큰당 달러. Anthropic 공식 가격. */
interface ModelPrice {
  label: string;
  input: number;
  output: number;
}

const PRICES: Record<string, ModelPrice> = {
  'claude-sonnet-4-6': { label: 'Sonnet 4.6', input: 3, output: 15 },
  'claude-sonnet-5': { label: 'Sonnet 5', input: 2, output: 10 },
  'claude-opus-5': { label: 'Opus 5', input: 5, output: 25 },
  'claude-haiku-4-5': { label: 'Haiku 4.5', input: 1, output: 5 },
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// 캐시 배수 — 쓸 때는 정가의 1.25배, 읽을 때는 0.1배.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface CostBreakdown {
  model: string;
  inputUSD: number;
  cacheWriteUSD: number;
  cacheReadUSD: number;
  outputUSD: number;
  totalUSD: number;
  totalKRW: number;
}

/** 원/달러. 대략치이고 화면 표시용이다. */
export const USD_TO_KRW = 1400;

export function priceFor(model?: string): ModelPrice {
  return PRICES[model ?? DEFAULT_MODEL] ?? PRICES[DEFAULT_MODEL];
}

export function calculateCost(usage: TokenUsage, model?: string): CostBreakdown {
  const p = priceFor(model);
  const per = (tokens: number, rate: number) => (tokens / 1_000_000) * rate;

  const inputUSD = per(usage.inputTokens, p.input);
  const cacheWriteUSD = per(usage.cacheWriteTokens, p.input * CACHE_WRITE_MULTIPLIER);
  const cacheReadUSD = per(usage.cacheReadTokens, p.input * CACHE_READ_MULTIPLIER);
  const outputUSD = per(usage.outputTokens, p.output);
  const totalUSD = inputUSD + cacheWriteUSD + cacheReadUSD + outputUSD;

  return {
    model: p.label,
    inputUSD,
    cacheWriteUSD,
    cacheReadUSD,
    outputUSD,
    totalUSD,
    totalKRW: totalUSD * USD_TO_KRW,
  };
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 };
}

export function addUsage(a: TokenUsage, b?: TokenUsage): TokenUsage {
  if (!b) return a;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
