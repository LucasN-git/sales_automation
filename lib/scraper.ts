import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

let _client: Anthropic | null = null;
function scraperClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

// ── Schemas (moved from lib/firecrawl.ts) ─────────────────────────────────────

export const ExhibitorListSchema = z.object({
  exhibitors: z
    .array(
      z.object({
        name: z.string().min(1),
        website: z.string().nullable().optional(),
        booth: z.string().nullable().optional(),
        profile_url: z.string().nullable().optional(),
        profile_data: z.record(z.unknown()).nullable().optional(),
      }),
    )
    .max(2000),
});

export type ExhibitorListing = z.infer<typeof ExhibitorListSchema>["exhibitors"][number];

const ShowSiteSchema = z.object({
  event_name: z.string().optional(),
  next_edition_dates: z.string().optional(),
  location_city: z.string().optional(),
  venue_name: z.string().optional(),
  exhibitor_count: z.number().optional(),
  visitor_count: z.number().optional(),
});

export type ShowSiteExtracted = z.infer<typeof ShowSiteSchema>;

// ── Low-level fetch helpers ───────────────────────────────────────────────────

const BOT_UA = "Mozilla/5.0 (compatible; ISPSalesBot/1.0; +https://ispps.com)";

/** Raw HTML fetch — no stripping. Used for platform detection and link extraction. */
export async function fetchRawHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "User-Agent": BOT_UA, Accept: "text/html" },
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, 200_000);
  } catch {
    return "";
  }
}

/** Plain fetch + HTML stripping. Fast, free. Cap 8 k chars for LLM input. */
async function fetchSiteLightweight(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6_000),
      headers: { "User-Agent": BOT_UA, Accept: "text/html" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    const noScript = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ");
    return noScript
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s{2,}/g, " ")
      .trim()
      .slice(0, 8_000);
  } catch {
    return "";
  }
}

/** Jina Reader — free, renders JS-heavy SPAs, returns clean Markdown. */
export async function fetchSiteJina(url: string, capChars = 8_000): Promise<string> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: "text/markdown", "X-Return-Format": "markdown" },
    });
    if (!res.ok) return "";
    return (await res.text()).slice(0, capChars);
  } catch {
    return "";
  }
}

/** Strip script/style blocks and HTML tags — used to get readable text from raw HTML. */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Public scraping functions ─────────────────────────────────────────────────

/**
 * Fetch a company website and return clean text/markdown.
 * Tier 1: plain fetch + HTML strip (free, instant, ~80% of sites)
 * Tier 2: Jina Reader (free, JS-rendering, for SPAs)
 * Cap at 8 000 chars.
 */
export async function scrapeCompanySite(url: string): Promise<string> {
  const lightweight = await fetchSiteLightweight(url);
  if (lightweight.length >= 400) return lightweight;
  const jina = await fetchSiteJina(url);
  return jina || lightweight;
}

const EXHIBITOR_EXTRACTION_PROMPT = `Extract every exhibiting company that appears in the result list on this page. For each, return:
- name: official company name (no booth/country/industry suffix)
- website: the official company website URL if linked, otherwise null
- booth: the booth or stand number if shown, otherwise null

Skip the trade-show organiser, navigation, ads, and footer-companies. Return AT MOST what the page renders right now (do not invent entries).`;

const EXHIBITOR_LIST_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    exhibitors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          website: { type: ["string", "null"] },
          booth: { type: ["string", "null"] },
        },
        required: ["name"],
      },
    },
  },
  required: ["exhibitors"],
};

/**
 * Fetch the exhibitor list from a trade-show URL.
 * Uses Jina Reader for content, then Claude Haiku for extraction.
 */
export async function getExhibitorList(url: string): Promise<ExhibitorListing[]> {
  const markdown = await fetchSiteJina(url, 20_000);
  if (!markdown || markdown.length < 100) return [];

  try {
    const response = await scraperClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: `${EXHIBITOR_EXTRACTION_PROMPT}\n\nPage content:\n${markdown}`,
        },
      ],
      tools: [
        {
          name: "extract_exhibitors",
          description: "Extract the structured exhibitor list from the page.",
          input_schema: EXHIBITOR_LIST_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "extract_exhibitors" },
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") return [];
    const parsed = ExhibitorListSchema.safeParse(toolBlock.input);
    if (!parsed.success) return [];

    const seen = new Set<string>();
    return parsed.data.exhibitors
      .map((e) => ({ ...e, name: e.name.trim(), website: e.website?.trim() || null, booth: e.booth?.trim() || null }))
      .filter((e) => {
        const key = e.name.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  } catch {
    return [];
  }
}

const SHOW_SITE_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    event_name: { type: "string", description: "Official event name" },
    next_edition_dates: { type: "string", description: "Next edition dates as text" },
    location_city: { type: "string", description: "City where the event takes place" },
    venue_name: { type: "string", description: "Venue name" },
    exhibitor_count: { type: "number", description: "Approximate number of exhibitors" },
    visitor_count: { type: "number", description: "Approximate number of visitors" },
  },
};

/**
 * Scrape a trade-show website and extract structured metadata.
 * Returns null on failure.
 */
export async function scrapeShowSite(
  url: string,
): Promise<{ extracted: ShowSiteExtracted; confirmedUrl: string } | null> {
  try {
    const html = await fetchRawHtml(url);
    const stripped = stripTags(html);
    const content = stripped.length >= 200 ? stripped.slice(0, 8_000) : await fetchSiteJina(url);
    if (!content || content.length < 100) return null;

    const response = await scraperClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Extract trade show metadata from this page content.\n\n${content}`,
        },
      ],
      tools: [
        {
          name: "extract_show",
          description: "Extract structured trade show metadata",
          input_schema: SHOW_SITE_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "extract_show" },
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") return null;
    const parsed = ShowSiteSchema.safeParse(toolBlock.input);
    return {
      extracted: parsed.success ? parsed.data : (toolBlock.input as ShowSiteExtracted),
      confirmedUrl: url,
    };
  } catch {
    return null;
  }
}

/**
 * Map all URLs reachable from a given URL via plain link extraction.
 * Returns a flat list of same-origin links (empty on failure).
 */
export async function mapShowUrl(url: string): Promise<string[]> {
  try {
    const html = await fetchRawHtml(url);
    if (!html) return [];
    const origin = new URL(url).origin;
    const links = new Set<string>();
    const re = /href="([^"#?][^"]*?)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      try {
        const resolved = new URL(m[1], url).href;
        if (resolved.startsWith(origin)) links.add(resolved);
      } catch {
        // skip malformed URLs
      }
    }
    return [...links];
  } catch {
    return [];
  }
}
