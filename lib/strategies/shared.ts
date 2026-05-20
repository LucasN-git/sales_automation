import { ExhibitorListSchema, type ExhibitorListing, fetchRawHtml, fetchSiteJina, getExhibitorList } from "@/lib/scraper";

export const EXHIBITOR_EXTRACTION_PROMPT = `Extract every exhibiting company that appears in the result list on this page. For each, return:
- name: official company name (no booth/country/industry suffix)
- website: the official company website URL if linked, otherwise null
- booth: the booth or stand number if shown, otherwise null

Skip the trade-show organiser, navigation, ads, and footer-companies. Return AT MOST what the page renders right now (don't invent entries).`;

export type StrategyProgress = (
  sub: string,
  meta?: Record<string, unknown>,
) => Promise<void>;

/**
 * Pull exhibitor entries out of a rendered HTML snapshot, given the
 * detail-page path-prefix the Discovery phase identified (e.g. "/en/exhibitors/").
 * Robust regex match — no LLM needed, deterministic, free.
 *
 * If baseUrl is given, the matched href is resolved into an absolute URL and
 * stored as profile_url so the per-exhibitor profile-enrich step can scrape
 * the detail page directly.
 */
export function extractExhibitorLinksFromHtml(
  html: string,
  prefix: string,
  baseUrl?: string,
): ExhibitorListing[] {
  if (!prefix) return [];
  const seen = new Set<string>();
  const out: ExhibitorListing[] = [];
  let origin: string | null = null;
  if (baseUrl) {
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      origin = null;
    }
  }
  // Match <a href="...prefix..." >...</a>. Inner text becomes the company name.
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<a[^>]+href="([^"]*${escapedPrefix}[^"]+?)"[^>]*>([\\s\\S]*?)<\\/a>`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const innerHtml = m[2];
    // Strip nested tags, decode entities crudely
    const text = innerHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    // The first non-empty segment is usually the company name (cards often
    // include hall/booth/country/etc on subsequent lines).
    const name = text.split(/\s{2,}|\s\|\s/)[0]?.trim() ?? text;
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let profile_url: string | null = null;
    if (/^https?:\/\//i.test(href)) {
      profile_url = href;
    } else if (origin) {
      profile_url = origin + (href.startsWith("/") ? "" : "/") + href;
    }
    out.push({ name, website: null, booth: null, profile_url });
  }
  return out;
}

/**
 * Merge a batch of newly-found exhibitors into the global dedup map.
 */
export function mergeBatch(
  acc: Map<string, ExhibitorListing>,
  batch: ExhibitorListing[],
): number {
  let added = 0;
  for (const ex of batch) {
    const name = ex.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (acc.has(key)) continue;
    acc.set(key, {
      name,
      website: ex.website?.trim() || null,
      booth: ex.booth?.trim() || null,
      profile_url: ex.profile_url?.trim() || null,
      profile_data: ex.profile_data ?? null,
    });
    added++;
  }
  return added;
}

/**
 * Parse a markdown table into exhibitor entries. Handles column headers in any
 * language (Entreprise/Company/Firma/Name for name, Site Web/Website/URL for
 * website, Stand/Booth/Halle for booth). Returns empty array if no recognisable
 * table is found. Deterministic, no LLM, no Firecrawl credits beyond the scrape.
 */
export function parseMarkdownExhibitorTable(markdown: string): ExhibitorListing[] {
  const results: ExhibitorListing[] = [];
  const seen = new Set<string>();
  const lines = markdown.split("\n");

  let nameCol = -1;
  let websiteCol = -1;
  let boothCol = -1;
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      if (inTable) break;
      continue;
    }

    const cells = trimmed
      .split("|")
      .map((c) => c.trim())
      .slice(1, -1); // drop empty first/last after split on leading/trailing |

    if (cells.length === 0) continue;

    // Separator row (| --- | --- |) — skip
    if (cells.every((c) => /^[-: ]+$/.test(c))) continue;

    if (!inTable) {
      // Try to identify header row by recognisable column keywords
      const lower = cells.map((c) => c.toLowerCase().replace(/\*/g, "").trim());
      const nameIdx = lower.findIndex((c) =>
        /entreprise|company|companies|firma|aussteller|exhibitor|name/.test(c),
      );
      const webIdx = lower.findIndex((c) =>
        /site web|website|web site|url|homepage/.test(c),
      );
      const boothIdx = lower.findIndex((c) => /booth|stand|halle|hall/.test(c));

      if (nameIdx >= 0) {
        nameCol = nameIdx;
        websiteCol = webIdx;
        boothCol = boothIdx;
        inTable = true;
      }
      continue;
    }

    // Data row
    const rawName = nameCol < cells.length ? cells[nameCol] : "";
    const name = rawName.replace(/\*\*/g, "").trim();
    if (!name || name.length < 2) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let website: string | null = null;
    if (websiteCol >= 0 && websiteCol < cells.length) {
      const cell = cells[websiteCol];
      const mdLink = cell.match(/\[.*?\]\((https?:\/\/[^)]+)\)/);
      const plainUrl = cell.match(/https?:\/\/\S+/);
      website = mdLink?.[1] ?? plainUrl?.[0] ?? null;
    }

    const boothRaw =
      boothCol >= 0 && boothCol < cells.length ? cells[boothCol].trim() : null;
    const booth = boothRaw && boothRaw !== "" ? boothRaw : null;

    results.push({ name, website, booth, profile_url: null });
  }

  return results;
}

/**
 * Scrape an exhibitor listing page and return structured entries.
 *
 * When `detailPathPrefix` is supplied: fetches raw HTML, then deterministically
 * extracts all <a> links matching the prefix (no LLM, no external credits).
 *
 * Without a prefix: tries Jina Reader + markdown table parsing first
 * (deterministic). Falls back to Jina + Claude Haiku extraction for card-grid
 * layouts where no table structure is present.
 */
export async function scrapeExhibitorPage(
  url: string,
  opts: {
    actions?: any[];
    waitFor?: number;
    timeoutMs?: number;
    detailPathPrefix?: string | null;
  } = {},
): Promise<ExhibitorListing[]> {
  if (opts.detailPathPrefix) {
    try {
      const html = await fetchRawHtml(url);
      if (!html) return [];
      return extractExhibitorLinksFromHtml(html, opts.detailPathPrefix, url);
    } catch {
      return [];
    }
  }

  // Primary path: Jina markdown + deterministic table parser
  try {
    const markdown = await fetchSiteJina(url, 20_000);
    if (markdown) {
      const tableRows = parseMarkdownExhibitorTable(markdown);
      if (tableRows.length >= 5) return tableRows;
    }
  } catch {
    // fall through to Claude extraction
  }

  // Fallback: Jina + Claude Haiku extraction (card-grid layouts)
  return getExhibitorList(url);
}

/**
 * Auto-scroll an open Playwright page to the bottom repeatedly until the
 * watched-element count stops growing (two consecutive identical reads). Used
 * for SPAs that load more cards via IntersectionObserver instead of an
 * explicit show-more button (xponential-europe being the motivating case).
 *
 * Returns the final card count. Uses both `window.scrollTo` (covers most
 * IntersectionObserver setups) and `page.mouse.wheel` (covers libraries
 * that only listen to real wheel events).
 */
export async function autoScrollUntilStall(
  page: any,
  cardSelector: string,
  maxScrolls: number,
  idleMs: number = 1200,
): Promise<number> {
  let lastCount = -1;
  let stalled = 0;
  let finalCount = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await page
      .evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      .catch(() => {});
    await page.mouse.wheel(0, 800).catch(() => {});
    await page.waitForTimeout(idleMs);

    finalCount = await page
      .locator(cardSelector)
      .count()
      .catch(() => 0);

    if (finalCount === lastCount) {
      stalled++;
      if (stalled >= 2) break;
    } else {
      stalled = 0;
    }
    lastCount = finalCount;
  }

  return finalCount;
}

/**
 * Show-more scraping: single-pass via Jina Reader.
 * Pages that genuinely need real clicks should use the browserbase engine instead.
 */
export async function scrapeWithShowMoreLoop(
  url: string,
  showMoreSelector: string | null,
  capClicks: number,
  onProgress: StrategyProgress,
): Promise<ExhibitorListing[]> {
  await onProgress(`single_pass_start`);
  const batch = await scrapeExhibitorPage(url, {
    waitFor: 3500,
    timeoutMs: 30_000,
  });
  await onProgress(`single_pass_done_count_${batch.length}`);
  return batch;
}
