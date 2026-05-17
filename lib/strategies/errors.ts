/**
 * Signals that a high-confidence API engine (algolia_api, dimedis_api,
 * mapyourshow_api, expofp_api) could not complete the listing extraction.
 *
 * The Inngest listing function catches this and marks the trade-show as
 * failed with a user-facing message. The AI orchestrator picks that up and
 * proposes the next-best engine (browserbase / firecrawl) to the user.
 *
 * Difference from a generic Error: it carries the engine name and a stable
 * `reason` code so downstream logic (and the orchestrator prompt) can react.
 */
export class EngineApiError extends Error {
  readonly engine: string;
  readonly reason: string;
  readonly userMessage: string;

  constructor(opts: { engine: string; reason: string; userMessage: string }) {
    super(`${opts.engine}: ${opts.reason}`);
    this.name = "EngineApiError";
    this.engine = opts.engine;
    this.reason = opts.reason;
    this.userMessage = opts.userMessage;
  }
}

export function isEngineApiError(err: unknown): err is EngineApiError {
  return err instanceof EngineApiError;
}
