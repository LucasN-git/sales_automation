import type { PaginationPlanT } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/firecrawl";
import { mergeBatch, scrapeExhibitorPage, type StrategyProgress } from "./shared";

export async function executePagination(
  plan: PaginationPlanT,
  onProgress: StrategyProgress,
): Promise<ExhibitorListing[]> {
  const all = new Map<string, ExhibitorListing>();
  let consecutiveEmpty = 0;

  for (let p = plan.start_page; p < plan.start_page + plan.max_pages; p++) {
    await onProgress(`page_${p}`);
    const url = plan.page_url_template
      .replace("{base}", plan.base_url)
      .replace("{n}", String(p));

    const batch = await scrapeExhibitorPage(url, { waitFor: 2500 });
    const added = mergeBatch(all, batch);

    if (added === 0) {
      consecutiveEmpty++;
      // stop early if 2 consecutive pages add nothing
      if (consecutiveEmpty >= 2) break;
    } else {
      consecutiveEmpty = 0;
    }
  }

  return Array.from(all.values());
}
