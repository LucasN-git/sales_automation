import { priceFor } from "./pricing";

/**
 * Per-call token defaults used when a show has no historical short/deep
 * stats yet. Conservative ballpark — actual per-call cost is recomputed
 * from the running average as soon as a few calls have completed.
 *
 * Short: 4-field structured-output call against the capability catalog,
 *        typical input ~3k tokens with the cached system block, ~200 out.
 * Deep:  8-field call with web-search context, ~6k in / ~800 out.
 */
const DEFAULT_TOKENS = {
  short: { in: 3_000, out: 200 },
  deep: { in: 6_000, out: 800 },
} as const;

export type Phase = "short" | "deep";

export type TokenStatsRow = {
  tin: number;
  tout: number;
  cnt: number;
};

/**
 * Estimate USD cost of ONE call for the given phase + model. Uses the show's
 * historical average when at least one call has completed, otherwise falls
 * back to the conservative default token shape.
 */
export function estimatePerCallUsd(
  phase: Phase,
  model: string,
  stats: TokenStatsRow | null,
): number {
  if (stats && stats.cnt > 0) {
    return priceFor(model, stats.tin / stats.cnt, stats.tout / stats.cnt);
  }
  const def = DEFAULT_TOKENS[phase];
  return priceFor(model, def.in, def.out);
}

/**
 * Estimate USD cost of running `count` calls in bulk. Pure multiplication —
 * caller decides what `count` means (e.g. pendingCount for bulk-short).
 */
export function estimateBulkUsd(
  phase: Phase,
  model: string,
  stats: TokenStatsRow | null,
  count: number,
): number {
  return estimatePerCallUsd(phase, model, stats) * count;
}

/**
 * "true" if the estimate was computed from real historical data rather than
 * the default token shape. Used to label tooltips honestly.
 */
export function estimateIsHistorical(stats: TokenStatsRow | null): boolean {
  return !!stats && stats.cnt > 0;
}
