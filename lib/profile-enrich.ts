import FirecrawlApp from "@mendable/firecrawl-js";
import { z } from "zod";

let _app: FirecrawlApp | null = null;
function fc() {
  if (!_app) {
    _app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
  }
  return _app;
}

/**
 * Loose schema for what we want from a per-exhibitor trade-show profile page.
 * Different organisers (NürnbergMesse, Messe Frankfurt, Messe München) lay
 * these out differently, so we let Firecrawl's LLM-extraction do the matching
 * and we treat every field as optional.
 */
export const ProfileScrapeSchema = z.object({
  external_website: z
    .string()
    .nullable()
    .optional()
    .describe(
      "The exhibitor's OWN external website (e.g. https://example.com), NOT the trade-show profile page itself. Look for a 'Website' link, often with a globe icon. Return null if no external link is shown.",
    ),
  phone: z
    .string()
    .nullable()
    .optional()
    .describe("Primary phone number if listed (any format), otherwise null."),
  email: z
    .string()
    .nullable()
    .optional()
    .describe("Primary contact email if listed, otherwise null."),
  description_long: z
    .string()
    .nullable()
    .optional()
    .describe(
      "Long-form company description / 'About us' text from the profile page if present. Return as-is, no editing. Null if absent.",
    ),
  products_offered: z
    .array(z.string())
    .nullable()
    .optional()
    .describe(
      "List of products / services / offerings shown under headings like 'We offer', 'Products', 'Services'. Up to 30 entries. Null or empty if absent.",
    ),
  contact_persons: z
    .array(z.string())
    .nullable()
    .optional()
    .describe(
      "Named contact persons / managers shown on the page (with role if given, e.g. 'Jane Doe, Head of Sales'). Up to 10. Null if absent.",
    ),
});

export type ProfileScrape = z.infer<typeof ProfileScrapeSchema>;

/**
 * Scrape a single per-exhibitor profile page and extract the fields we care
 * about. Tolerant of missing fields — most pages won't have all of them.
 *
 * Returns null on hard failure (network, 5xx, etc) so callers can mark the
 * row failed without losing the existing profile_data.
 */
export async function scrapeExhibitorProfile(
  url: string,
): Promise<ProfileScrape | null> {
  let result: { success: boolean; json?: unknown; error?: string };
  try {
    result = (await fc().scrapeUrl(url, {
      formats: ["json"],
      jsonOptions: {
        schema: ProfileScrapeSchema,
        prompt:
          "Extract the per-exhibitor profile fields described in the schema. The page is the trade-show's listing page for ONE exhibiting company. Pay special attention to: (1) the EXTERNAL website link (the exhibitor's own site, often shown as a 'Website' button with a globe icon, NOT the profile page itself, NOT social-media links), (2) phone and email if listed, (3) the 'We offer' / products section, (4) any named contact persons. Return null for fields that are not present.",
      },
      onlyMainContent: true,
      waitFor: 1500,
    })) as { success: boolean; json?: unknown; error?: string };
  } catch {
    return null;
  }

  if (!result.success || !result.json) return null;
  const parsed = ProfileScrapeSchema.safeParse(result.json);
  if (!parsed.success) return null;

  // Normalise external_website to absolute http(s) — drop relative paths and
  // links that point back to the same trade-show domain (those are profile
  // links to other exhibitors, not the company's own site).
  const ext = parsed.data.external_website;
  if (ext) {
    if (!/^https?:\/\//i.test(ext)) {
      parsed.data.external_website = null;
    } else {
      try {
        const own = new URL(ext);
        const profile = new URL(url);
        if (own.host === profile.host) {
          parsed.data.external_website = null;
        }
      } catch {
        parsed.data.external_website = null;
      }
    }
  }

  return parsed.data;
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
