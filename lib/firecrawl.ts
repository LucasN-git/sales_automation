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
 * Scrape a company's website and return clean markdown.
 * Returns up to ~30k chars to stay token-efficient.
 */
export async function scrapeCompanySite(url: string): Promise<string> {
  try {
    const result: any = await app().scrapeUrl(url, {
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 1000,
    });
    if (!result?.success) return "";
    const md: string = result.markdown ?? result.data?.markdown ?? "";
    return md.slice(0, 30_000);
  } catch {
    return "";
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
