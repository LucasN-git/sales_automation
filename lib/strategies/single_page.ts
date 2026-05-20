import type { SinglePagePlanT } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/scraper";
import { mergeBatch, scrapeExhibitorPage, type StrategyProgress } from "./shared";

export async function executeSinglePage(
  plan: SinglePagePlanT,
  onProgress: StrategyProgress,
): Promise<ExhibitorListing[]> {
  await onProgress("scraping_single_page");
  const batch = await scrapeExhibitorPage(plan.base_url, { waitFor: 3500 });
  const acc = new Map<string, ExhibitorListing>();
  mergeBatch(acc, batch);
  return Array.from(acc.values());
}
