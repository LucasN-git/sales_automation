import { z } from "zod";

/**
 * A CrawlPlan tells the listing executor *how* to enumerate exhibitors on a
 * given trade-show site. It's produced by `lib/discovery.ts` (Claude analyses
 * the initial HTML) and persisted as `trade_shows.crawl_plan` so the same
 * plan is re-usable for follow-up years of the same show.
 */

const ExhibitorExtractionHints = z.object({
  /**
   * URL path-prefix that exhibitor detail-pages share, e.g. "/en/exhibitors/".
   * Used as a regex hint for extracting exhibitor links from the rendered page.
   * Null means: no obvious detail-page pattern, fall back to LLM extraction.
   */
  detail_path_prefix: z.string().nullable(),
});

/**
 * Listing engine. Picked by Discovery based on site characteristics:
 * - "firecrawl"       static HTML, single-pass scrape via Firecrawl is enough.
 * - "browserbase"     SPA needing real user-clicks (React, Algolia, etc).
 * - "algolia_api"     Algolia InstantSearch; fast path via /browse endpoint
 *                     after sniffing credentials in a 1x Browserbase session.
 * - "dimedis_api"     DIMEDIS VIS platform (Koelnmesse family, xponential,
 *                     anuga, drupa). One unauthenticated GET against
 *                     /vis-api/vis/v2/{lang}/exhibitors returns the full list.
 * - "mapyourshow_api" MapYourShow platform (~1000 US trade shows).
 *                     Browserbase session sniffs the bearer-token and show
 *                     code, then paginates the mysRest API.
 * - "expofp_api"      ExpoFP floor-plan platform. Listing capability is
 *                     uncertain; the engine may be stubbed depending on
 *                     spike findings.
 */
export const Engine = z
  .enum([
    "firecrawl",
    "browserbase",
    "algolia_api",
    "dimedis_api",
    "mapyourshow_api",
    "expofp_api",
  ])
  .default("firecrawl");

const AlgoliaHints = z
  .object({
    app_id_hint: z.string().nullable().optional(),
    index_hint: z.string().nullable().optional(),
    filter_attribute: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const DimedisHints = z
  .object({
    vis_domain: z.string().url(),
    lang: z.string().min(2).max(5),
  })
  .nullable()
  .optional();

const MapYourShowHints = z
  .object({
    show_code: z.string().min(1),
    app_root: z.string().url(),
  })
  .nullable()
  .optional();

const ExpoFpHints = z
  .object({
    event_id: z.string().min(1),
  })
  .nullable()
  .optional();

const ScrollFields = {
  has_infinite_scroll: z.boolean().default(false),
  max_scrolls: z.number().int().min(0).max(50).default(15),
} as const;

export const LetterLoopPlan = z.object({
  strategy: z.literal("letter_loop"),
  base_url: z.string().url(),
  /**
   * Template for the per-letter URL. `{letter}` is the placeholder, will be
   * URL-encoded by the executor. Example:
   *   "https://example.com/exhibitors?state[menu][filterAZ]={letter}"
   */
  url_template: z.string(),
  letters: z.array(z.string().min(1).max(2)).min(1).max(40),
  has_show_more: z.boolean(),
  show_more_selector: z.string().nullable(),
  /**
   * Hard cap on Show-more clicks per letter. With 1-call strategy this is the
   * actual click count Firecrawl performs in the same browser session. Default 25
   * (Firecrawl Free-Tier 30s timeout — 25 clicks × ~10 items = 250/letter, plenty).
   * Code clamps further in lib/strategies/shared.ts regardless of plan value.
   */
  max_show_more_per_letter: z.number().int().min(0).max(50).default(25),
  hints: ExhibitorExtractionHints,
  engine: Engine.optional(),
  algolia: AlgoliaHints,
  dimedis: DimedisHints,
  mapyourshow: MapYourShowHints,
  expofp: ExpoFpHints,
  ...ScrollFields,
});

export const ShowMorePlan = z.object({
  strategy: z.literal("show_more"),
  base_url: z.string().url(),
  show_more_selector: z.string(),
  max_clicks: z.number().int().min(1).max(30),
  hints: ExhibitorExtractionHints,
  engine: Engine.optional(),
  algolia: AlgoliaHints,
  dimedis: DimedisHints,
  mapyourshow: MapYourShowHints,
  expofp: ExpoFpHints,
  ...ScrollFields,
});

export const PaginationPlan = z.object({
  strategy: z.literal("pagination"),
  base_url: z.string().url(),
  /**
   * Template for the per-page URL. `{n}` is the placeholder. Example:
   *   "https://example.com/exhibitors?page={n}"
   */
  page_url_template: z.string(),
  start_page: z.number().int().min(0).default(1),
  max_pages: z.number().int().min(1).max(100),
  hints: ExhibitorExtractionHints,
  engine: Engine.optional(),
  algolia: AlgoliaHints,
  dimedis: DimedisHints,
  mapyourshow: MapYourShowHints,
  expofp: ExpoFpHints,
});

export const SinglePagePlan = z.object({
  strategy: z.literal("single_page"),
  base_url: z.string().url(),
  hints: ExhibitorExtractionHints,
  engine: Engine.optional(),
  algolia: AlgoliaHints,
  dimedis: DimedisHints,
  mapyourshow: MapYourShowHints,
  expofp: ExpoFpHints,
});

export const CrawlPlanSchema = z.discriminatedUnion("strategy", [
  LetterLoopPlan,
  ShowMorePlan,
  PaginationPlan,
  SinglePagePlan,
]);

export type CrawlPlan = z.infer<typeof CrawlPlanSchema>;
export type LetterLoopPlanT = z.infer<typeof LetterLoopPlan>;
export type ShowMorePlanT = z.infer<typeof ShowMorePlan>;
export type PaginationPlanT = z.infer<typeof PaginationPlan>;
export type SinglePagePlanT = z.infer<typeof SinglePagePlan>;

/**
 * Human-readable summary used in the UI sidebar.
 */
export function planSummary(plan: CrawlPlan): string {
  switch (plan.strategy) {
    case "letter_loop":
      return `Buchstaben-Filter (${plan.letters.length} Schritte)`;
    case "show_more":
      return `Show-more-Klicks (max. ${plan.max_clicks})`;
    case "pagination":
      return `Pagination (max. ${plan.max_pages} Seiten)`;
    case "single_page":
      return "Einzelseite";
  }
}
