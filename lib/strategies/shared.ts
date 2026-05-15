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
