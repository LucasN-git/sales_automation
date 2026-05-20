import type { LetterLoopPlanT } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/scraper";
import {
  mergeBatch,
  scrapeExhibitorPage,
  scrapeWithShowMoreLoop,
  type StrategyProgress,
} from "./shared";

export async function executeLetterLoop(
  plan: LetterLoopPlanT,
  onProgress: StrategyProgress,
): Promise<ExhibitorListing[]> {
  const all = new Map<string, ExhibitorListing>();

  for (const letter of plan.letters) {
    const url = plan.url_template
      .replace("{base}", plan.base_url)
      .replace("{letter}", encodeURIComponent(letter));

    // Diagnostic: include URL and selector in start-event meta for debugging.
    await onProgress(`letter_${letter}_start`, {
      letter,
      url,
      show_more_selector: plan.show_more_selector,
      cap: plan.max_show_more_per_letter ?? 80,
    });

    let batch: ExhibitorListing[];
    if (plan.has_show_more && plan.show_more_selector) {
      const cap = plan.max_show_more_per_letter ?? 80;
      batch = await scrapeWithShowMoreLoop(
        url,
        plan.show_more_selector,
        cap,
        async (sub) => onProgress(`letter_${letter}_${sub}`),
      );
    } else {
      batch = await scrapeExhibitorPage(url, { waitFor: 3000 });
    }

    const before = all.size;
    mergeBatch(all, batch);
    const added = all.size - before;
    const total = all.size;
    await onProgress(
      `letter_${letter}_done`,
      {
        letter,
        added,
        total,
        sample: batch.slice(0, 3).map((e) => e.name),
        message: `Buchstabe ${letter} — ${added} gefunden (gesamt ${total})`,
      },
    );
  }

  return Array.from(all.values());
}
