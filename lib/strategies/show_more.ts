import type { ShowMorePlanT } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/firecrawl";
import { mergeBatch, scrapeExhibitorPage, type StrategyProgress } from "./shared";

export async function executeShowMore(
  plan: ShowMorePlanT,
  onProgress: StrategyProgress,
): Promise<ExhibitorListing[]> {
  await onProgress("clicking_show_more");

  const actions: any[] = [];
  for (let i = 0; i < plan.max_clicks; i++) {
    actions.push({ type: "click", selector: plan.show_more_selector });
    actions.push({ type: "wait", milliseconds: 1500 });
  }

  const batch = await scrapeExhibitorPage(plan.base_url, {
    actions,
    waitFor: 3000,
  });

  const acc = new Map<string, ExhibitorListing>();
  mergeBatch(acc, batch);
  return Array.from(acc.values());
}
