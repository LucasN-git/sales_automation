import type { CrawlPlan } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/firecrawl";
import { executeLetterLoop } from "./letter_loop";
import { executeShowMore } from "./show_more";
import { executePagination } from "./pagination";
import { executeSinglePage } from "./single_page";
import { executeBrowserbaseLetterLoop } from "./browserbase_loop";
import { executeAlgoliaApi } from "./algolia_api";
import type { StrategyProgress } from "./shared";

export type CrawlPlanResult = {
  exhibitors: ExhibitorListing[];
  /**
   * Browser-session seconds consumed (only > 0 for engine="browserbase" or
   * engine="algolia_api" credential-extraction). Used for cost-tracking.
   */
  browserSec: number;
};

export async function executeCrawlPlan(
  plan: CrawlPlan,
  onProgress: StrategyProgress,
): Promise<CrawlPlanResult> {
  const engine = (plan as { engine?: string }).engine ?? "firecrawl";

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

  // engine="algolia_api": fast path via /browse REST endpoint. Falls back to
  // Browserbase-letter-loop if credentials can't be extracted or /browse fails.
  if (engine === "algolia_api" && plan.strategy === "letter_loop") {
    const algolia = await executeAlgoliaApi(plan, onProgress);
    if (!algolia.fallbackReason && algolia.exhibitors.length > 0) {
      return { exhibitors: algolia.exhibitors, browserSec: algolia.sessionSec };
    }
    await onProgress("algolia_fallback_to_browserbase", {
      reason: algolia.fallbackReason ?? "no_hits",
    });
    const browserResult = await executeBrowserbaseLetterLoop(plan, onProgress);
    return {
      exhibitors: browserResult.exhibitors,
      browserSec: algolia.sessionSec + browserResult.sessionSec,
    };
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
