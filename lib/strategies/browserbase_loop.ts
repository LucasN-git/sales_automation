import type { LetterLoopPlanT } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/firecrawl";
import { withSession, acceptCookies } from "@/lib/browserbase";
import {
  autoScrollUntilStall,
  extractExhibitorLinksFromHtml,
  mergeBatch,
  type StrategyProgress,
} from "./shared";

export type BrowserbaseLoopResult = {
  exhibitors: ExhibitorListing[];
  sessionSec: number;
};

/**
 * Letter-by-letter listing via a real Cloud-hosted Playwright browser
 * (Browserbase). Critical for Algolia/React SPAs where Firecrawl synthetic
 * clicks fail (event.isTrusted=false → React listener no-op) or navigate to
 * card-detail pages instead of the show-more handler.
 *
 * Per letter: open URL, click show-more until it's gone or stalled, snapshot
 * the DOM, regex-extract exhibitor links. One Browserbase session per letter.
 */
export async function executeBrowserbaseLetterLoop(
  plan: LetterLoopPlanT,
  onProgress: StrategyProgress,
): Promise<BrowserbaseLoopResult> {
  const all = new Map<string, ExhibitorListing>();
  let totalSec = 0;
  const cap = Math.min(plan.max_show_more_per_letter ?? 30, 50);
  const detailPrefix = plan.hints.detail_path_prefix ?? "/exhibitor";

  for (const letter of plan.letters) {
    await onProgress(`letter_${letter}_start`, { letter });
    const url = plan.url_template
      .replace("{base}", plan.base_url)
      .replace("{letter}", encodeURIComponent(letter));

    let letterAdded = 0;
    let letterSec = 0;

    try {
      const { result, durationSec } = await withSession(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
        await acceptCookies(page);
        // Algolia/React SPAs hydrate over multiple seconds — wait for an actual
        // exhibitor card to land in the DOM before snapshotting. If nothing
        // shows up within 15s, snapshot anyway so the failure is visible.
        await page
          .waitForSelector(`a[href*="${detailPrefix}"]`, { timeout: 15_000 })
          .catch(() => {});

        // Infinite-scroll first: many SPAs (xponential-europe et al) load
        // additional cards only when the viewport reaches the bottom, with no
        // show-more button at all. Plan must opt in via has_infinite_scroll.
        if (plan.has_infinite_scroll) {
          const max = plan.max_scrolls ?? 15;
          const finalCount = await autoScrollUntilStall(
            page,
            `a[href*="${detailPrefix}"]`,
            max,
          );
          await onProgress(`letter_${letter}_scroll_done`, {
            cards_after_scroll: finalCount,
            max_scrolls: max,
          });
        }

        // If show-more selector is set, click it until gone / stalled.
        if (plan.has_show_more && plan.show_more_selector) {
          const sel = plan.show_more_selector;
          let stalled = 0;
          let lastCount = 0;

          for (let i = 0; i < cap; i++) {
            const isVisible = await page
              .locator(sel)
              .first()
              .isVisible()
              .catch(() => false);
            if (!isVisible) break;

            await page
              .locator(sel)
              .first()
              .click({ timeout: 5_000 })
              .catch(() => {});
            await page.waitForTimeout(700);

            const count = await page
              .locator(`a[href*="${detailPrefix}"]`)
              .count()
              .catch(() => 0);

            if (count === lastCount) {
              stalled++;
              if (stalled >= 2) break;
            } else {
              stalled = 0;
            }
            lastCount = count;
          }
        }

        return await page.content();
      });

      letterSec = durationSec;
      const batch = extractExhibitorLinksFromHtml(result, detailPrefix);
      const before = all.size;
      mergeBatch(all, batch);
      letterAdded = all.size - before;
    } catch (err) {
      await onProgress(`letter_${letter}_error`, {
        letter,
        error: err instanceof Error ? err.message : String(err),
      });
      // continue to next letter — partial is better than aborting
    }

    totalSec += letterSec;
    await onProgress(`letter_${letter}_done`, {
      letter,
      added: letterAdded,
      total: all.size,
      browser_seconds: letterSec,
      message: `Buchstabe ${letter} — ${letterAdded} (gesamt ${all.size}, ${letterSec}s)`,
    });
  }

  return { exhibitors: Array.from(all.values()), sessionSec: totalSec };
}
