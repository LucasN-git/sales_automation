import Anthropic from "@anthropic-ai/sdk";
import FirecrawlApp from "@mendable/firecrawl-js";
import { CrawlPlanSchema, type CrawlPlan } from "./crawl-plan";

let _firecrawl: FirecrawlApp | null = null;
function firecrawl() {
  if (!_firecrawl) {
    _firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
  }
  return _firecrawl;
}

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

const DISCOVERY_SYSTEM_INSTRUCTION = `You analyse trade-show exhibitor listing pages and choose BOTH a strategy AND an engine to extract the COMPLETE exhibitor list.

You will be shown the rendered HTML and Markdown of one listing page. Submit the plan via the submit_crawl_plan tool.

ENGINE SELECTION (required field "engine"):
- "algolia_api" — pick if you see Algolia InstantSearch hints anywhere in the HTML: \`window.__ALGOLIA__\`, \`data-app-id\`, \`aa-Input\`, classes starting with \`ais-\`, calls to \`algolia.net\`. This is fastest and cheapest (~0.10 €/show) because we hit Algolia's REST API directly.
- "browserbase" — pick for any other React/Vue/Angular SPA where listings render client-side or "Show more" buttons need real user clicks. Costs 1–2.50 €/show but works on every modern SPA reliably. PREFER this over firecrawl whenever the page looks dynamic.
- "firecrawl" — pick ONLY for static server-rendered HTML where a single Firecrawl scrape returns the full list. Cheapest if it works, but useless on SPAs.

When in doubt between browserbase and firecrawl: prefer browserbase. Completeness > cost.

STRATEGIES (required field "strategy"):

1. "letter_loop" — page has an A–Z (often plus "#") filter where each letter shows a subset. Prefer this whenever a letter bar is visible and clicking a letter changes the URL with a filter param. Common Algolia pattern: ?state[menu][filterAZ]=X.
   Required fields when chosen: url_template, letters, has_show_more, show_more_selector.
   - url_template uses {base} and {letter} placeholders, e.g. "{base}?state[menu][filterAZ]={letter}"
   - letters is typically ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","#"]
   - has_show_more: true if a "Show more" button still appears WITHIN a letter view
   - show_more_selector: CSS selector for that button, or null if has_show_more=false

2. "show_more" — list with "Show more" / "Load more" button only, no letter filter.
   Required fields when chosen: show_more_selector, max_clicks (5–20).

CRITICAL — show_more_selector must be SPECIFIC and match ONLY the visible "load more results" button. Modern sites often have multiple buttons with text "Show more" that toggle filter sections, expand FAQs, etc. Those are not the right target. Pick a selector that uniquely identifies the results-pagination button:
- Prefer a class combination unique to this button. Example: "button.primary.w-full" if the real button has these classes and the dummies do not.
- Avoid generic text-based selectors like \`button:has-text("Show more")\` — they match all buttons containing that text, including hidden filter toggles.
- If the real button has a unique parent (e.g. inside the results grid container), use a descendant selector: ".results-grid > button.primary".
- If unsure, prefer specificity over generality. A wrong narrow selector = no clicks; a wrong broad selector = clicks on hidden dummy buttons (much worse).
- Consider :not() to exclude dummies: e.g. "button.primary:not(.as-link):not(.icon-button)" excludes link/icon variants.

3. "pagination" — URL-based pagination, e.g. ?page=1, ?page=2, or /page/1.
   Required fields when chosen: page_url_template (with {base} and {n} placeholders), start_page (usually 1), max_pages.

4. "single_page" — all exhibitors visible without interaction (small lists).
   No extra fields required.

For hints.detail_path_prefix: if exhibitor detail pages share a URL prefix (e.g. "/en/exhibitors/"), put that string. Otherwise null.

base_url MUST equal the user-supplied URL verbatim.`;

const CRAWL_PLAN_INPUT_SCHEMA = {
  type: "object",
  properties: {
    strategy: {
      type: "string",
      enum: ["letter_loop", "show_more", "pagination", "single_page"],
      description: "The crawl strategy chosen for this site.",
    },
    base_url: {
      type: "string",
      description: "The user-supplied listing URL, verbatim.",
    },
    url_template: {
      type: "string",
      description:
        "Required for letter_loop. URL template with {base} and {letter} placeholders.",
    },
    letters: {
      type: "array",
      items: { type: "string" },
      description: "Required for letter_loop. Letters to iterate through.",
    },
    has_show_more: {
      type: "boolean",
      description:
        "For letter_loop. True if a 'Show more' button appears inside each letter view.",
    },
    show_more_selector: {
      type: ["string", "null"],
      description:
        "CSS selector for the results-pagination Show-more button. MUST be specific enough to match ONLY this button — modern pages often have hidden filter-section toggles with the same text. Prefer unique class combinations (e.g. 'button.primary.w-full') or :not() exclusions over generic text-based selectors. Required for show_more strategy and for letter_loop when has_show_more=true.",
    },
    max_show_more_per_letter: {
      type: "integer",
      description:
        "For letter_loop with has_show_more=true. Hard cap on Show-more clicks per letter (default 30, max 100). The executor stops earlier when two consecutive scrapes yield no new exhibitors.",
    },
    max_clicks: {
      type: "integer",
      description:
        "For show_more strategy. Conservative upper bound on Show-more clicks (5–20).",
    },
    page_url_template: {
      type: "string",
      description:
        "Required for pagination. URL template with {base} and {n} placeholders.",
    },
    start_page: {
      type: "integer",
      description: "For pagination. Usually 1, sometimes 0.",
    },
    max_pages: {
      type: "integer",
      description: "For pagination. Conservative upper bound (e.g. 50).",
    },
    expected_total_count: {
      type: ["integer", "null"],
      description:
        "If the listing page prominently shows the total number of exhibitors (e.g. '1455 results', '1455 exhibitors total', 'Aussteller: 1455'), put that integer here. Otherwise null. Used to verify completeness after the crawl.",
    },
    engine: {
      type: "string",
      enum: ["firecrawl", "browserbase", "algolia_api"],
      description:
        "Listing engine. 'algolia_api' if Algolia InstantSearch detected (cheapest), 'browserbase' for React/SPA pages needing real clicks (most robust), 'firecrawl' only for static HTML.",
    },
    algolia: {
      type: ["object", "null"],
      properties: {
        app_id_hint: { type: ["string", "null"] },
        index_hint: { type: ["string", "null"] },
        filter_attribute: { type: ["string", "null"] },
      },
      description:
        "When engine='algolia_api', any Algolia hints visible in the HTML. app_id_hint = Algolia App ID if found in script-tags or data-attributes; index_hint = the index name (e.g. 'exhibitors_prod'); filter_attribute = the facet attribute used for letter filtering (e.g. 'filterAZ'). All optional — the runtime will sniff the live algolia.net network requests too.",
    },
    hints: {
      type: "object",
      properties: {
        detail_path_prefix: {
          type: ["string", "null"],
          description:
            "Common URL prefix for exhibitor detail pages, e.g. '/en/exhibitors/'. Null if none.",
        },
      },
      required: ["detail_path_prefix"],
    },
  },
  required: ["strategy", "base_url", "hints"],
} as const;

export type DiscoveryResult = {
  plan: CrawlPlan;
  log: string;
  expectedTotalCount: number | null;
  promptPreview: string;
  responseRaw: unknown;
};

/**
 * Look at the listing URL once and return a CrawlPlan.
 * Uses Firecrawl to fetch HTML+markdown, then Claude (via tool_use) to pick a strategy.
 */
export async function discoverSiteStrategy(url: string): Promise<DiscoveryResult> {
  const result: any = await firecrawl().scrapeUrl(url, {
    formats: ["html", "markdown"],
    onlyMainContent: false,
    waitFor: 3500,
  });

  if (!result?.success) {
    throw new Error(`Discovery scrape failed: ${result?.error ?? "unknown"}`);
  }

  const html: string = (result.html ?? result.data?.html ?? "").slice(0, 30_000);
  const markdown: string = (result.markdown ?? result.data?.markdown ?? "").slice(0, 10_000);

  const userContent = `User-supplied URL:\n${url}\n\n--- HTML (truncated) ---\n${html}\n\n--- Markdown (truncated) ---\n${markdown}\n\nCall submit_crawl_plan with the chosen strategy.`;

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      {
        type: "text",
        text: DISCOVERY_SYSTEM_INSTRUCTION,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "submit_crawl_plan",
        description:
          "Submit the chosen crawl plan for this listing page. Call this exactly once.",
        input_schema: CRAWL_PLAN_INPUT_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: "submit_crawl_plan" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(
      `Discovery did not produce a tool call. Stop reason: ${response.stop_reason}`,
    );
  }

  const rawInput = toolUse.input as Record<string, unknown>;
  // Strip the discovery-only field before plan validation (it's not part of CrawlPlan).
  const expectedTotalCount =
    typeof rawInput.expected_total_count === "number"
      ? rawInput.expected_total_count
      : null;
  const planInput = { ...rawInput };
  delete planInput.expected_total_count;

  let parsed: CrawlPlan;
  try {
    parsed = CrawlPlanSchema.parse(planInput);
  } catch (err) {
    throw new Error(
      `Plan validation failed: ${err instanceof Error ? err.message : String(err)}\n\nClaude's tool input was: ${JSON.stringify(rawInput).slice(0, 1500)}`,
    );
  }

  // Sanity-fix: force base_url to the user-supplied url so we never lose it.
  parsed.base_url = url;

  const log = `Strategie: ${parsed.strategy}\n${describePlan(parsed)}${expectedTotalCount ? `\nErwartet: ${expectedTotalCount} Aussteller` : ""}`;
  return {
    plan: parsed,
    log,
    expectedTotalCount,
    promptPreview: userContent.slice(0, 4000),
    responseRaw: rawInput,
  };
}

function describePlan(plan: CrawlPlan): string {
  const engine = (plan as any).engine ?? "firecrawl";
  const enginePrefix = `Engine: ${engine}\n`;
  switch (plan.strategy) {
    case "letter_loop":
      return `${enginePrefix}Letter-Loop über ${plan.letters.length} Buchstaben.\nTemplate: ${plan.url_template}\nShow-More on top: ${plan.has_show_more ? `ja (cap ${plan.max_show_more_per_letter} Klicks)` : "nein"}.`;
    case "show_more":
      return `${enginePrefix}Show-More-Button.\nSelector: ${plan.show_more_selector}\nMax. Klicks: ${plan.max_clicks}.`;
    case "pagination":
      return `${enginePrefix}URL-Pagination.\nTemplate: ${plan.page_url_template}\nStart: ${plan.start_page}, max: ${plan.max_pages}.`;
    case "single_page":
      return `${enginePrefix}Einzelseite, alle Aussteller direkt sichtbar.`;
  }
}
