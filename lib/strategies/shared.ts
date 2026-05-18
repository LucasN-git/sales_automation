import FirecrawlApp from "@mendable/firecrawl-js";
import { ExhibitorListSchema, type ExhibitorListing } from "@/lib/firecrawl";

let _app: FirecrawlApp | null = null;
export function fc() {
  if (!_app) {
    _app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
  }
  return _app;
}

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
 * Standard Firecrawl scrape with our exhibitor JSON-Schema. Returns parsed list
 * or empty array on any failure (caller decides how to react).
 *
 * Firecrawl Free-Tier defaults to 30s timeout. With many click-actions we hit
 * that easily, so we set an explicit `timeout`. On Free this is capped server
 * side; Pro plans accept higher values.
 *
 * When `detailPathPrefix` is supplied, the function takes a much faster &
 * cheaper path: rawHtml + deterministic regex extraction of all <a> links
 * matching the prefix. No LLM-extraction, no "sometimes 0 items" drift, 1
 * Firecrawl credit instead of 5. Use this whenever the Discovery phase has
 * identified a stable detail-page URL pattern.
 *
 * For static pages without a detailPathPrefix: tries markdown scrape + table
 * parsing first (deterministic, captures full tables of any size). Falls back
 * to JSON LLM-extraction only when no markdown table is found — the LLM path
 * is reliable for card-grid layouts but caps internally around 50-80 rows for
 * large tables.
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
      const result: any = await fc().scrapeUrl(url, {
        formats: ["rawHtml"],
        onlyMainContent: false,
        waitFor: opts.waitFor ?? 2500,
        timeout: opts.timeoutMs ?? 30_000,
        ...(opts.actions ? { actions: opts.actions } : {}),
      });
      if (!result?.success) return [];
      const html: string =
        result.rawHtml ?? result.data?.rawHtml ?? result.html ?? result.data?.html ?? "";
      if (!html) return [];
      return extractExhibitorLinksFromHtml(html, opts.detailPathPrefix, url);
    } catch {
      return [];
    }
  }

  // --- Primary path: markdown scrape + deterministic table parser ---
  // Handles static HTML pages with <table> or markdown-table structures.
  // Captures full lists of any size; costs 1 Firecrawl credit.
  if (!opts.actions) {
    try {
      const mdResult: any = await fc().scrapeUrl(url, {
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor: opts.waitFor ?? 2500,
        timeout: opts.timeoutMs ?? 30_000,
      });
      if (mdResult?.success) {
        const markdown: string =
          mdResult.markdown ?? mdResult.data?.markdown ?? "";
        const tableRows = parseMarkdownExhibitorTable(markdown);
        if (tableRows.length >= 5) return tableRows;
      }
    } catch {
      // fall through to JSON extraction
    }
  }

  // --- Fallback path: Firecrawl JSON LLM-extraction ---
  // Best for card-grid / list layouts without a table structure.
  try {
    const result: any = await fc().scrapeUrl(url, {
      formats: ["json"],
      jsonOptions: {
        schema: ExhibitorListSchema,
        prompt: EXHIBITOR_EXTRACTION_PROMPT,
      },
      onlyMainContent: false,
      waitFor: opts.waitFor ?? 2500,
      timeout: opts.timeoutMs ?? 60_000,
      ...(opts.actions ? { actions: opts.actions } : {}),
    });
    if (!result?.success) return [];
    const json = result.json ?? result.data?.json;
    if (!json) return [];
    const parsed = ExhibitorListSchema.safeParse(json);
    if (!parsed.success) return [];
    return parsed.data.exhibitors as ExhibitorListing[];
  } catch {
    return [];
  }
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
 * Single-call show-more scraping: one Firecrawl session, hits Show-more up to
 * `capClicks` times, snapshots once. Much more efficient than reloading the
 * page on every iteration — Firecrawl performs all clicks in the same browser
 * tab, the list grows incrementally, then the final DOM is extracted.
 */
export async function scrapeWithShowMoreLoop(
  url: string,
  showMoreSelector: string | null,
  capClicks: number,
  onProgress: StrategyProgress,
): Promise<ExhibitorListing[]> {
  // Single-pass strategy. We intentionally DO NOT use click-actions here:
  // Firecrawl-style synthetic clicks on Algolia/React InstantSearch widgets
  // either navigate away (hitting a wrapper card link via event-bubbling) or
  // are no-ops because the React listener checks event.isTrusted. Both modes
  // result in 0 exhibitors for the page. Single-pass guarantees the initial
  // ~10 visible items at minimum.
  //
  // For sites that genuinely need pagination we'll add a per-site adapter or
  // direct Algolia-API client in V4 — see CLAUDE.md.
  await onProgress(`single_pass_start`);
  const batch = await scrapeExhibitorPage(url, {
    waitFor: 3500,
    timeoutMs: 30_000,
  });
  await onProgress(`single_pass_done_count_${batch.length}`);
  return batch;
}
