/**
 * Anthropic-Pricing pro 1M Tokens (USD). Values approximate, treat as
 * indicative for in-app cost display. Adjust if Anthropic changes pricing.
 */
const PRICING_USD_PER_M: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-7": { input: 15, output: 75 },
};

const FALLBACK = { input: 3, output: 15 };

export function priceFor(model: string, tokensIn: number, tokensOut: number): number {
  const p = PRICING_USD_PER_M[model] ?? FALLBACK;
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}

// Anthropic cache-aware Pricing fuer Chat-Calls.
// cache_creation: 1.25x input rate (Anthropics Premium fuer Cache-Writes).
// cache_read:     0.1x input rate (Cache-Hits sind ~10% des Input-Preises).
// input:          regulaere Input-Tokens (NICHT-gecached).
export type ChatTokenBreakdown = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export function priceForChat(
  model: string,
  tokens: ChatTokenBreakdown,
): number {
  const p = PRICING_USD_PER_M[model] ?? FALLBACK;
  const inputCost = tokens.input_tokens * p.input;
  const outputCost = tokens.output_tokens * p.output;
  const cacheCreateCost = tokens.cache_creation_input_tokens * p.input * 1.25;
  const cacheReadCost = tokens.cache_read_input_tokens * p.input * 0.1;
  return (inputCost + outputCost + cacheCreateCost + cacheReadCost) / 1_000_000;
}

/** Browserbase pricing estimate (USD per minute, mid-range). Adjust if pricing changes. */
const BROWSERBASE_USD_PER_MIN = 0.17;
export function priceForBrowserSec(seconds: number): number {
  return (seconds / 60) * BROWSERBASE_USD_PER_MIN;
}

// Anthropic Native Web-Search: $10 / 1000 requests = $0.01 / request.
// Quelle: anthropic.com/api Pricing (Stand 2026-05). Wird separat von Token-Cost
// erfasst, weil die Kosten pro Discovery-/Deep-Lauf signifikant beitragen koennen.
const WEB_SEARCH_USD_PER_REQUEST = 0.01;
export function priceForWebSearch(uses: number): number {
  if (uses <= 0) return 0;
  return uses * WEB_SEARCH_USD_PER_REQUEST;
}

// Firecrawl entfernt — Funktion bleibt für DB-Altdaten (credits = 0 für alle neuen Läufe).
const FIRECRAWL_USD_PER_CREDIT = 0.0032;
export function priceForFirecrawlCredits(credits: number): number {
  return credits * FIRECRAWL_USD_PER_CREDIT;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return "<0.01 $";
  if (usd < 1) return `${usd.toFixed(2)} $`;
  return `${usd.toFixed(2)} $`;
}
