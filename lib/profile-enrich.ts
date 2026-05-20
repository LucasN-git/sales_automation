import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { fetchSiteJina } from "@/lib/scraper";

let _client: Anthropic | null = null;
function profileClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export const ProfileScrapeSchema = z.object({
  external_website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  description_long: z.string().nullable().optional(),
  products_offered: z.array(z.string()).nullable().optional(),
  contact_persons: z.array(z.string()).nullable().optional(),
});

export type ProfileScrape = z.infer<typeof ProfileScrapeSchema>;

const SOCIAL_DOMAINS = new Set([
  "linkedin.com", "twitter.com", "x.com", "facebook.com",
  "instagram.com", "youtube.com", "xing.com", "tiktok.com",
]);

function isSocialOrSameDomain(linkUrl: string, profileUrl: string): boolean {
  try {
    const d = new URL(linkUrl).hostname.replace(/^www\./, "");
    const p = new URL(profileUrl).hostname.replace(/^www\./, "");
    return d === p || SOCIAL_DOMAINS.has(d);
  } catch {
    return true;
  }
}

/**
 * Extract the exhibitor's own external website from Jina markdown.
 * Prefers links labeled "Website"/"Web"/"Homepage", falls back to first
 * external non-social link.
 */
function extractExternalWebsite(markdown: string, profileUrl: string): string | null {
  const profileDomain = new URL(profileUrl).hostname.replace(/^www\./, "");

  // Priority: link immediately following a "Website" keyword
  const websiteKeywordRe =
    /(?:website|web site|homepage|web)[^[\n]{0,30}\[(.*?)\]\((https?:\/\/[^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = websiteKeywordRe.exec(markdown)) !== null) {
    const candidate = m[2];
    if (!isSocialOrSameDomain(candidate, profileUrl)) return candidate;
  }

  // Fallback: first external non-social http(s) link in the markdown
  const anyLinkRe = /\[.*?\]\((https?:\/\/[^)]+)\)/g;
  while ((m = anyLinkRe.exec(markdown)) !== null) {
    const candidate = m[1];
    try {
      const d = new URL(candidate).hostname.replace(/^www\./, "");
      if (d !== profileDomain && !SOCIAL_DOMAINS.has(d)) return candidate;
    } catch {
      // skip
    }
  }

  return null;
}

const PROFILE_FIELDS_TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    phone: {
      type: ["string", "null"] as unknown as "string",
      description: "Primary phone number if listed (any format), otherwise null.",
    },
    description_long: {
      type: ["string", "null"] as unknown as "string",
      description: "Long-form company description / 'About us' text. Return as-is. Null if absent.",
    },
    products_offered: {
      type: "array",
      items: { type: "string" },
      description: "Products / services listed under headings like 'We offer', 'Products', 'Services'. Up to 30 entries.",
    },
    contact_persons: {
      type: "array",
      items: { type: "string" },
      description: "Named contact persons with role if given (e.g. 'Jane Doe, Head of Sales'). Up to 10.",
    },
  },
};

/**
 * Scrape a single per-exhibitor profile page and extract the fields we care about.
 * Uses Jina Reader for content, regex for external_website + email, Claude Haiku
 * for the remaining fields.
 *
 * Returns null on hard failure so callers can mark the row failed.
 */
export async function scrapeExhibitorProfile(
  url: string,
): Promise<ProfileScrape | null> {
  const markdown = await fetchSiteJina(url, 15_000);
  if (!markdown || markdown.length < 50) return null;

  // external_website — free, no LLM
  const external_website = extractExternalWebsite(markdown, url);

  // email — simple regex
  const emailMatch = markdown.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch?.[0] ?? null;

  // Remaining fields via Claude Haiku (~300 tokens, ~0.0002 EUR)
  let phone: string | null = null;
  let description_long: string | null = null;
  let products_offered: string[] | null = null;
  let contact_persons: string[] | null = null;

  try {
    const response = await profileClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: `Extract fields from this trade-show exhibitor profile page. Return null for absent fields.\n\n${markdown.slice(0, 8_000)}`,
        },
      ],
      tools: [
        {
          name: "extract_profile",
          description: "Extract profile fields from the exhibitor page.",
          input_schema: PROFILE_FIELDS_TOOL_SCHEMA,
        },
      ],
      tool_choice: { type: "tool", name: "extract_profile" },
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (toolBlock && toolBlock.type === "tool_use") {
      const inp = toolBlock.input as Record<string, unknown>;
      phone = typeof inp.phone === "string" ? inp.phone : null;
      description_long = typeof inp.description_long === "string" ? inp.description_long : null;
      products_offered = Array.isArray(inp.products_offered)
        ? (inp.products_offered as string[]).slice(0, 30)
        : null;
      contact_persons = Array.isArray(inp.contact_persons)
        ? (inp.contact_persons as string[]).slice(0, 10)
        : null;
    }
  } catch {
    // Claude call optional — we still return what we extracted for free
  }

  return { external_website, phone, email, description_long, products_offered, contact_persons };
}

/**
 * Merge scraped fields into an existing profile_data jsonb. Scraped values
 * win over Algolia values for `phone` and `description_long`/`description`,
 * but we keep Algolia values for fields we know it has reliably (address,
 * sector categories). Existing scraped values from an earlier run also win
 * over `null` from a later run so we never lose data on a flaky re-scrape.
 */
export function mergeScrapeIntoProfile(
  current: Record<string, unknown> | null,
  scrape: ProfileScrape,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };

  if (scrape.phone) next.phone = scrape.phone;
  if (scrape.email && !next.email) next.email = scrape.email;
  if (scrape.description_long) next.description_long = scrape.description_long;
  if (scrape.contact_persons && scrape.contact_persons.length > 0) {
    next.contact_persons = scrape.contact_persons;
  }
  if (scrape.products_offered && scrape.products_offered.length > 0) {
    // Don't blow away the Algolia `products` array — store both if both exist.
    next.products_scraped = scrape.products_offered;
  }
  return next;
}
