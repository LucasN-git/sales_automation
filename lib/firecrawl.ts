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
      }),
    )
    .max(500),
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
