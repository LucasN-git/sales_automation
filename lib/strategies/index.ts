import type { CrawlPlan } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/firecrawl";
import { executeLetterLoop } from "./letter_loop";
import { executeShowMore } from "./show_more";
import { executePagination } from "./pagination";
import { executeSinglePage } from "./single_page";
import { executeBrowserbaseLetterLoop } from "./browserbase_loop";
import { executeAlgoliaApi } from "./algolia_api";
import { executeDimedisApi } from "./dimedis_api";
import { executeMapYourShowApi } from "./mapyourshow_api";
import { executeExpoFpApi } from "./expofp_api";
import { EngineApiError } from "./errors";
import type { StrategyProgress } from "./shared";

export type CrawlPlanResult = {
  exhibitors: ExhibitorListing[];
  /**
   * Browser-session seconds consumed. > 0 for engine="browserbase" and for the
   * 1x Browserbase session inside algolia_api credential extraction. The
   * platform-specific REST engines (dimedis_api, mapyourshow_api, expofp_api)
   * do not open a browser at all and always return 0.
   */
  browserSec: number;
};

export async function executeCrawlPlan(
  plan: CrawlPlan,
  onProgress: StrategyProgress,
): Promise<CrawlPlanResult> {
  const engine = (plan as { engine?: string }).engine ?? "firecrawl";

  // engine="dimedis_api": single REST call, no browser. Fail -> EngineApiError;
  // the listing function catches it and asks the orchestrator to pick the next
  // best engine. No silent fallback.
  if (engine === "dimedis_api") {
    const r = await executeDimedisApi(plan, onProgress);
    if (r.fallbackReason) {
      throw new EngineApiError({
        engine: "dimedis_api",
        reason: r.fallbackReason,
        userMessage: `DIMEDIS-API konnte nicht abgefragt werden (${r.fallbackReason}). Bitte andere Engine wählen (browserbase oder firecrawl) und neu starten.`,
      });
    }
    return { exhibitors: r.exhibitors, browserSec: r.sessionSec };
  }

  if (engine === "mapyourshow_api") {
    const r = await executeMapYourShowApi(plan, onProgress);
    if (r.fallbackReason) {
      throw new EngineApiError({
        engine: "mapyourshow_api",
        reason: r.fallbackReason,
        userMessage: `MapYourShow-API konnte nicht abgefragt werden (${r.fallbackReason}). Bitte andere Engine wählen (browserbase oder firecrawl) und neu starten.`,
      });
    }
    return { exhibitors: r.exhibitors, browserSec: r.sessionSec };
  }

  if (engine === "expofp_api") {
    const r = await executeExpoFpApi(plan, onProgress);
    if (r.fallbackReason) {
      throw new EngineApiError({
        engine: "expofp_api",
        reason: r.fallbackReason,
        userMessage: `ExpoFP-API konnte nicht abgefragt werden (${r.fallbackReason}). Bitte andere Engine wählen (browserbase oder firecrawl) und neu starten.`,
      });
    }
    return { exhibitors: r.exhibitors, browserSec: r.sessionSec };
  }

  // engine="browserbase" only meaningful for letter_loop (the real challenge).
  // Other strategies (show_more, pagination, single_page) keep the V3 firecrawl
  // path for now — extend later if needed.
  if (engine === "browserbase" && plan.strategy === "letter_loop") {
    const { exhibitors, sessionSec } = await executeBrowserbaseLetterLoop(
      plan,
      onProgress,
    );
    return { exhibitors, browserSec: sessionSec };
  }

  // engine="algolia_api": fast path via /browse REST endpoint. On failure we
  // surface an EngineApiError so the orchestrator can prompt the user to pick
  // another engine, instead of silently burning Browserbase minutes.
  if (engine === "algolia_api" && plan.strategy === "letter_loop") {
    const algolia = await executeAlgoliaApi(plan, onProgress);
    if (algolia.fallbackReason || algolia.exhibitors.length === 0) {
      throw new EngineApiError({
        engine: "algolia_api",
        reason: algolia.fallbackReason ?? "no_hits",
        userMessage: `Algolia-Extraktion fehlgeschlagen (${algolia.fallbackReason ?? "no_hits"}). Bitte Engine auf 'browserbase' umstellen und neu starten.`,
      });
    }
    return { exhibitors: algolia.exhibitors, browserSec: algolia.sessionSec };
  }

  // Default: V3 firecrawl path.
  let exhibitors: ExhibitorListing[];
  switch (plan.strategy) {
    case "letter_loop":
      exhibitors = await executeLetterLoop(plan, onProgress);
      break;
    case "show_more":
      exhibitors = await executeShowMore(plan, onProgress);
      break;
    case "pagination":
      exhibitors = await executePagination(plan, onProgress);
      break;
    case "single_page":
      exhibitors = await executeSinglePage(plan, onProgress);
      break;
  }
  return { exhibitors, browserSec: 0 };
}
