import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";

let _app: FirecrawlApp | null = null;
function app() {
  if (!_app) {
    _app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
  }
  return _app;
}

export const ExhibitorListSchema = z.object({
  exhibitors: z
    .array(
      z.object({
        name: z.string().min(1),
        website: z.string().nullable().optional(),
        booth: z.string().nullable().optional(),
        /** Absolute URL of the trade-show's per-exhibitor detail page. */
        profile_url: z.string().nullable().optional(),
        /** Rich pre-scraped enrichment from the listing source (e.g. Algolia). */
        profile_data: z.record(z.unknown()).nullable().optional(),
      }),
    )
    .max(2000),
});

export type ExhibitorListing = z.infer<typeof ExhibitorListSchema>["exhibitors"][number];

/**
 * Fetch the exhibitor list from a trade-show URL.
 * Uses Firecrawl's own LLM-extraction with our Zod schema (no Claude call here).
 */
export async function getExhibitorList(url: string): Promise<ExhibitorListing[]> {
  const result: any = await app().scrapeUrl(url, {
    formats: ["json"],
    jsonOptions: {
      schema: ExhibitorListSchema,
      prompt:
        "Extract every exhibiting company on the page. For each, return the company name, the official company website if linked, and the booth or stand number if shown. Skip navigation menus, ads, and the trade-show organiser itself. If the page lazy-loads exhibitors, extract whatever is visible.",
    },
    onlyMainContent: true,
    waitFor: 3000,
  });

  if (!result?.success) {
    throw new Error(
      `Firecrawl scrape failed: ${result?.error ?? "unknown error"}`,
    );
  }

  const json = result.json ?? result.data?.json;
  if (!json) return [];

  const parsed = ExhibitorListSchema.safeParse(json);
  if (!parsed.success) return [];

  // Dedup by lowercased name; trim whitespace.
  const seen = new Set<string>();
  return parsed.data.exhibitors
    .map((e) => ({
      name: e.name.trim(),
      website: e.website?.trim() || null,
      booth: e.booth?.trim() || null,
    }))
    .filter((e) => {
      const key = e.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const ShowSiteSchema = z.object({
  event_name: z.string().optional(),
  next_edition_dates: z.string().optional(),
  location_city: z.string().optional(),
  venue_name: z.string().optional(),
  exhibitor_count: z.number().optional(),
  visitor_count: z.number().optional(),
});

export type ShowSiteExtracted = z.infer<typeof ShowSiteSchema>;

/**
 * Scrape a trade-show website and extract structured metadata.
 * Returns null on failure.
 */
export async function scrapeShowSite(
  url: string,
): Promise<{ extracted: ShowSiteExtracted; confirmedUrl: string } | null> {
  try {
    const result: any = await app().scrapeUrl(url, {
      formats: ["json"],
      jsonOptions: {
        schema: ShowSiteSchema,
        prompt:
          "Extract: official event name, next edition dates (as text), city, venue name, approximate number of exhibitors, approximate number of visitors.",
      },
      onlyMainContent: false,
      waitFor: 2000,
    });
    if (!result?.success) return null;
    const json = result.json ?? result.data?.json;
    if (!json) return null;
    const parsed = ShowSiteSchema.safeParse(json);
    return {
      extracted: parsed.success ? parsed.data : (json as ShowSiteExtracted),
      confirmedUrl: result.metadata?.url ?? url,
    };
  } catch {
    return null;
  }
}

/**
 * Try to fetch a company site with a plain HTTP GET + HTML stripping.
 * Returns empty string on failure or when the page needs JS rendering.
 * Cap at 8 000 chars — enough for Short analysis.
 */
async function fetchSiteLightweight(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ISPSalesBot/1.0; +https://ispps.com)",
        Accept: "text/html",
      },
    });
    if (!res.ok) return "";
    const html = await res.text();

    // If the page is mostly a JS shell, the meaningful text will be tiny.
    // Strip tags, collapse whitespace, drop script/style blocks.
    const noScript = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    const text = noScript
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s{2,}/g, " ")
      .trim();

    return text.slice(0, 8_000);
  } catch {
    return "";
  }
}

/**
 * Fetch clean markdown via Jina Reader (free, no API key).
 * Works on JS-heavy SPAs too since Jina renders server-side.
 */
async function fetchSiteJina(url: string): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        Accept: "text/markdown",
        "X-Return-Format": "markdown",
      },
    });
    if (!res.ok) return "";
    const md = await res.text();
    return md.slice(0, 8_000);
  } catch {
    return "";
  }
}

/**
 * Scrape a company's website and return clean text/markdown.
 * Tier 1: plain HTTP fetch + HTML strip (free, instant, ~80 % of sites)
 * Tier 2: Jina Reader (free, JS-rendering, for SPAs)
 * Tier 3: Firecrawl (paid, only if FIRECRAWL_SCRAPE_ENABLED=true in env)
 * Cap at 8 000 chars.
 */
export async function scrapeCompanySite(url: string): Promise<string> {
  // Tier 1 — plain fetch
  const lightweight = await fetchSiteLightweight(url);
  if (lightweight.length >= 400) return lightweight;

  // Tier 2 — Jina Reader (free)
  const jina = await fetchSiteJina(url);
  if (jina.length >= 400) return jina;

  // Tier 3 — Firecrawl (opt-in via env var to avoid surprise credit spend)
  if (process.env.FIRECRAWL_SCRAPE_ENABLED !== "true") return jina || lightweight;

  try {
    const result: any = await app().scrapeUrl(url, {
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 1000,
    });
    if (!result?.success) return jina || lightweight;
    const md: string = result.markdown ?? result.data?.markdown ?? "";
    return md.slice(0, 8_000);
  } catch {
    return jina || lightweight;
  }
}

/**
 * Map all URLs reachable from a given URL using Firecrawl Map.
 * Returns a flat list of discovered links (empty on failure).
 */
export async function mapShowUrl(url: string): Promise<string[]> {
  try {
    const result: any = await app().mapUrl(url);
    return (result?.links ?? result ?? []) as string[];
  } catch {
    return [];
  }
}

/**
 * Web search via Firecrawl. Returns up to `limit` result URLs.
 */
export async function searchFirecrawl(
  query: string,
  limit = 5,
): Promise<Array<{ url: string; title?: string }>> {
  try {
    const result: any = await app().search(query, { limit });
    const items: any[] = result?.data ?? result ?? [];
    return items
      .map((r: any) => ({ url: r.url ?? r, title: r.title }))
      .filter((r) => typeof r.url === "string");
  } catch {
    return [];
  }
}
