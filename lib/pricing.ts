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

/** Browserbase pricing estimate (USD per minute, mid-range). Adjust if pricing changes. */
const BROWSERBASE_USD_PER_MIN = 0.17;
export function priceForBrowserSec(seconds: number): number {
  return (seconds / 60) * BROWSERBASE_USD_PER_MIN;
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return "<0.01 $";
  if (usd < 1) return `${usd.toFixed(2)} $`;
  return `${usd.toFixed(2)} $`;
}
