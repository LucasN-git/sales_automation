import Anthropic from "@anthropic-ai/sdk";
import { fetchRawHtml, fetchSiteJina } from "./scraper";
import { CrawlPlanSchema, type CrawlPlan } from "./crawl-plan";

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

const DISCOVERY_SYSTEM_INSTRUCTION = `You analyse trade-show exhibitor listing pages and choose BOTH a strategy AND an engine to extract the COMPLETE exhibitor list.

You will be shown the rendered HTML and Markdown of one listing page. Submit the plan via the submit_crawl_plan tool.

ENGINE SELECTION (required field "engine"). Scan top to bottom — first match wins. Platform-specific REST engines first, then generic.

- "dimedis_api" — pick if you see ANY of these DIMEDIS VIS signals: a script tag like \`<script id="finder-base-config" type="application/json">…</script>\` whose JSON contains "visDomain" and "lang"; references to \`window.DIMEDIS\`; URL path matching \`/vis/v\\d+/<lang>/(directory|catalogue)\`; \`finder-frontend\` in script/CSS asset paths. DIMEDIS hosts the Koelnmesse family (xponential, anuga, drupa, photokina, IDS, idem) and many other German trade shows. One unauthenticated GET against \`{visDomain}/vis-api/vis/v2/{lang}/exhibitors\` returns the entire list. When you pick this, set strategy="single_page" and fill the \`dimedis\` hint with {vis_domain, lang} parsed from the finder-base-config JSON.

- "mapyourshow_api" — pick if the listing subdomain matches \`*.mapyourshow.com\` (very strong signal). Corroborating hints: path contains \`/8_0/\`, asset URLs reference \`mys_shared/\`, inline JS mentions \`path2approot\` or \`remote-proxy.cfm\` or \`quicklists-min.js\`. MapYourShow hosts ~1000 US trade shows (InfoComm, ISE, MODEX, NADA, EXHIBITORLIVE, IWF, Display Week, OFC, NRF). The full list comes from one JSON proxy call after a session-cookie GET. When you pick this, set strategy="single_page" and fill the \`mapyourshow\` hint with {show_code, app_root}. show_code = uppercase first hostname label (e.g. "INFOCOMM26"). app_root = origin + "/8_0".

- "expofp_api" — pick if the listing subdomain matches \`*.expofp.com\` (but NOT www/app/developer/help.expofp.com), or the page embeds \`packages/main/expofp.js\` plus a \`window.__fpDataVersion\` reference. ExpoFP hosts interactive floor plans; the unauthenticated \`{origin}/data/data.json\` blob carries every exhibitor with name, website, address, phone, plus booths. When you pick this, set strategy="single_page" and fill the \`expofp\` hint with {event_id = first hostname label}.

- "algolia_api" — pick if you see Algolia InstantSearch hints anywhere in the HTML: \`window.__ALGOLIA__\`, \`data-app-id\`, \`aa-Input\`, classes starting with \`ais-\`, calls to \`algolia.net\`. This is fastest and cheapest (~0.10 €/show) because we hit Algolia's REST API directly.
- "browserbase" — pick for any other React/Vue/Angular SPA where listings render client-side or "Show more" buttons need real user clicks. Costs 1–2.50 €/show but works on every modern SPA reliably. PREFER this over jina whenever the page looks dynamic.
- "jina" — pick for static server-rendered HTML where a single page scrape returns the full list. Uses Jina Reader (free). Useless on SPAs.

When in doubt between browserbase and jina: prefer browserbase. Completeness > cost.

STRATEGIES (required field "strategy"):

1. "letter_loop" — page has an A–Z (often plus "#") filter where each letter shows a subset. Prefer this whenever a letter bar is visible and clicking a letter changes the URL with a filter param. Common Algolia pattern: ?state[menu][filterAZ]=X.
   Required fields when chosen: url_template, letters, has_show_more, show_more_selector.
   - url_template uses {base} and {letter} placeholders, e.g. "{base}?state[menu][filterAZ]={letter}"
   - letters is typically ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","#"] — each entry must be 1-2 chars, no empty strings
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

INFINITE-SCROLL DETECTION (letter_loop and show_more, engine=browserbase):
Some SPAs lazy-load extra cards only when the viewport hits the bottom — there is NO visible "show more" button. Signals: the visible card count stays around 20-30 even when long lists are expected; HTML references \`IntersectionObserver\`, \`react-window\`, \`react-virtualized\`, or CSS classes like \`infinite-scroll\` / \`virtualized-list\`. When you see this AND pick engine="browserbase", set \`has_infinite_scroll=true\` and pick a generous \`max_scrolls\` (15-30). The executor scrolls to the bottom in a loop until the count stalls.

3. "pagination" — URL-based pagination, e.g. ?page=1, ?page=2, or /page/1.
   Required fields when chosen: page_url_template (with {base} and {n} placeholders), start_page (usually 1), max_pages.

   IMPORTANT — JS-infinite-scroll trigger detection: many sites hide pagination behind a scroll-loader and show no visible "Next page" link. The list looks single-page-ish but is actually paginated server-side. Treat ANY of these as a strong "pick pagination" signal:
   - HTML attributes carrying a paginated URL: \`data-url="...?page=2"\`, \`data-page=\`, \`data-next=\`, \`data-load-more=\`, \`data-paginate-url=\`, \`data-href="...?page="\`, \`data-ajax-url="...?page="\`
   - Result-list container with a sibling/inner element containing such a data-url
   - Hidden anchors / preloaded pagination links anywhere in the HTML (including inside script tags or comments) matching the pattern \`[?&]page=N\`, \`[?&]p=N\`, \`/page/N\`, \`[?&]start=NN\`, \`[?&]offset=NN\`
   When you see this, pick \`strategy=pagination\` with the matching template (e.g. \`{base}?page={n}\`) even if no visible "next page" button exists. The server renders each page independently, so direct URL fetches work reliably. Set \`max_pages\` to a generous cap (30–50). The executor stops on 2 consecutive empty pages, so over-estimating is safe.

   COUNTER-EXAMPLE: do NOT pick pagination just because the URL contains "page" anywhere (e.g. \`/our-pages/\`, \`/page-builder/\`). The pattern must be a query-param value or a numbered path-segment.

4. "single_page" — all exhibitors visible without interaction (small lists).
   No extra fields required.

   STRONG DEFAULT BIAS: only pick this if the listing is genuinely small (< 30 items visible AND no scroll-loader / data-url / pagination attributes anywhere in the HTML). If the visible list shows ~20 items and you also see ANY infinite-scroll trigger (see strategy 3 above), pick pagination instead — single_page only captures the initial SSR snapshot and misses everything loaded via scroll.

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
      items: { type: "string", minLength: 1, maxLength: 2 },
      description:
        "Required for letter_loop. Letters to iterate through. Each entry must be exactly 1-2 chars (e.g. 'A', '#'). No empty strings, no words like 'All'.",
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
      enum: [
        "jina",
        "browserbase",
        "algolia_api",
        "dimedis_api",
        "mapyourshow_api",
        "expofp_api",
      ],
      description:
        "Listing engine. Platform-specific REST engines (dimedis_api, mapyourshow_api, expofp_api) are fastest and require strategy='single_page'. algolia_api is cheap when Algolia is detected. browserbase for generic React/SPA pages needing real clicks (most robust). jina for static server-rendered HTML (free).",
    },
    algolia: {
      type: ["object", "null"],
      properties: {
        app_id_hint: { type: ["string", "null"] },
        index_hint: { type: ["string", "null"] },
        filter_attribute: { type: ["string", "null"] },
      },
      description:
        "When engine='algolia_api', any Algolia hints visible in the HTML. app_id_hint = Algolia App ID if found in script-tags or data-attributes; index_hint = the index name (e.g. 'exhibitors_prod'); filter_attribute = the facet attribute used for letter filtering (e.g. 'filterAZ'). All optional; the runtime sniffs live algolia.net network requests too.",
    },
    dimedis: {
      type: ["object", "null"],
      properties: {
        vis_domain: { type: "string" },
        lang: { type: "string" },
      },
      description:
        "When engine='dimedis_api', the values parsed from the <script id='finder-base-config'> JSON block in the HTML. vis_domain = the 'visDomain' field (e.g. 'https://www.xponential-europe.com'), lang = the 'lang' field (e.g. 'en' or 'de'). Both required when engine is dimedis_api.",
    },
    mapyourshow: {
      type: ["object", "null"],
      properties: {
        show_code: { type: "string" },
        app_root: { type: "string" },
      },
      description:
        "When engine='mapyourshow_api', the values derived from the URL. show_code = the uppercase first hostname label (e.g. 'INFOCOMM26'). app_root = the origin plus '/8_0' (e.g. 'https://infocomm26.mapyourshow.com/8_0').",
    },
    expofp: {
      type: ["object", "null"],
      properties: {
        event_id: { type: "string" },
      },
      description:
        "When engine='expofp_api', the first hostname label of the listing URL (e.g. 'newyorkbuildexpo2026' for newyorkbuildexpo2026.expofp.com).",
    },
    has_infinite_scroll: {
      type: "boolean",
      description:
        "For letter_loop and show_more with engine='browserbase'. True if the page lazy-loads more cards on scroll without a visible 'show more' button. Triggers the scroll-to-bottom loop.",
    },
    max_scrolls: {
      type: "integer",
      description:
        "For has_infinite_scroll=true. Hard cap on scroll iterations per page/letter (default 15, max 50). The executor stops earlier when two consecutive reads return the same card count.",
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
 * Scan HTML for Algolia InstantSearch signals. Returns extracted hints if
 * found (app_id_hint, index_hint) plus a human-readable summary string that
 * gets injected into the Claude prompt so it reliably picks algolia_api even
 * when the React app hasn't hydrated yet in Firecrawl's snapshot.
 */
function detectAlgoliaSignals(html: string): {
  found: boolean;
  app_id_hint: string | null;
  index_hint: string | null;
  summary: string;
} {
  const signals: string[] = [];

  if (/\bais-[A-Za-z]/.test(html)) signals.push("ais- CSS classes");
  if (/algolia\.net/.test(html)) signals.push("algolia.net reference");
  if (/window\.__ALGOLIA__/.test(html)) signals.push("window.__ALGOLIA__");
  if (/aa-Input|aa-Form/.test(html)) signals.push("Algolia Autocomplete widget");

  const appIdMatch = html.match(/(?:data-app-id|appId)[=:\s"']+([A-Z0-9]{8,12})/);
  const app_id_hint = appIdMatch?.[1] ?? null;
  if (app_id_hint) signals.push(`appId="${app_id_hint}"`);

  const indexMatch = html.match(/(?:indexName|index_name|searchIndex)[=:\s"']+([A-Za-z0-9_\-]{4,60})/);
  const index_hint = indexMatch?.[1] ?? null;
  if (index_hint) signals.push(`indexName="${index_hint}"`);

  const found = signals.length > 0;
  return {
    found,
    app_id_hint,
    index_hint,
    summary: found ? `ALGOLIA DETECTED in HTML: ${signals.join(", ")}.` : "",
  };
}

/**
 * Attempt to read DIMEDIS finder-base-config from the raw page HTML.
 * Works when the config is part of the initial SSR payload (most DIMEDIS sites).
 */
function extractDimedisFromHtml(
  html: string,
): { vis_domain: string; lang: string } | null {
  const m = html.match(
    /<script[^>]+id=["']finder-base-config["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!m) return null;
  try {
    const config = JSON.parse(m[1].trim());
    if (typeof config.visDomain === "string" && typeof config.lang === "string") {
      return { vis_domain: config.visDomain, lang: config.lang };
    }
  } catch {
    // malformed JSON — fall through
  }
  return null;
}

/**
 * Probe the DIMEDIS REST API directly. Catches cases where the finder-base-config
 * is injected after hydration (dynamic JS) so neither Firecrawl nor Claude see it.
 * Tries /en then /de. Timeout: 4 s per attempt.
 */
async function probeDimedisApi(
  url: string,
): Promise<{ vis_domain: string; lang: string } | null> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  for (const lang of ["en", "de"]) {
    try {
      const res = await fetch(
        `${origin}/vis-api/vis/v2/${lang}/exhibitors?limit=10`,
        {
          signal: AbortSignal.timeout(4_000),
          headers: { Accept: "application/json" },
        },
      );
      if (res.ok) {
        const data: unknown = await res.json();
        if (
          data !== null &&
          typeof data === "object" &&
          ("hits" in data || "result" in data || "exhibitors" in data || "total" in data)
        ) {
          return { vis_domain: origin, lang };
        }
      }
    } catch {
      // timeout or network error — try next lang
    }
  }
  return null;
}

/**
 * Look at the listing URL once and return a CrawlPlan.
 * Uses Firecrawl to fetch HTML+markdown, then Claude (via tool_use) to pick a strategy.
 */
export async function discoverSiteStrategy(url: string): Promise<DiscoveryResult> {
  const [html, markdown] = await Promise.all([
    fetchRawHtml(url),
    fetchSiteJina(url, 10_000),
  ]);

  if (!html && !markdown) {
    throw new Error("Discovery fetch failed: no content retrieved from URL");
  }

  const htmlTruncated = html.slice(0, 30_000);

  // ── Pre-Claude deterministic platform checks ────────────────────────────────
  // Faster and more reliable than HTML analysis for known platforms.
  // Return immediately without spending a Claude call.

  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();

  // MapYourShow: reliable subdomain signal
  if (hostname.endsWith(".mapyourshow.com") && hostname.split(".").length >= 3) {
    const showCode = hostname.split(".")[0].toUpperCase();
    const appRoot = `${parsedUrl.origin}/8_0`;
    const plan = CrawlPlanSchema.parse({
      strategy: "single_page",
      base_url: url,
      hints: { detail_path_prefix: null },
      engine: "mapyourshow_api",
      mapyourshow: { show_code: showCode, app_root: appRoot },
    });
    return {
      plan,
      log: `Engine: mapyourshow_api (URL-Signal — kein LLM-Call nötig)\nShow-Code: ${showCode}`,
      expectedTotalCount: null,
      promptPreview: "",
      responseRaw: {},
    };
  }

  // ExpoFP: reliable subdomain signal
  const expofpSkip = new Set(["www", "app", "developer", "help"]);
  if (
    hostname.endsWith(".expofp.com") &&
    !expofpSkip.has(hostname.split(".")[0])
  ) {
    const eventId = hostname.split(".")[0];
    const plan = CrawlPlanSchema.parse({
      strategy: "single_page",
      base_url: url,
      hints: { detail_path_prefix: null },
      engine: "expofp_api",
      expofp: { event_id: eventId },
    });
    return {
      plan,
      log: `Engine: expofp_api (URL-Signal — kein LLM-Call nötig)\nEvent-ID: ${eventId}`,
      expectedTotalCount: null,
      promptPreview: "",
      responseRaw: {},
    };
  }

  // Algolia: scan HTML for strong InstantSearch signals.
  // We can't bypass Claude here (credentials only appear in live network traffic),
  // but we inject the findings into the user message so Claude is forced to
  // pick algolia_api even if the HTML snapshot looks sparse.
  const algoliaSignals = detectAlgoliaSignals(html);

  // DIMEDIS: finder-base-config script block in the initial HTML
  const dimedisFromHtml = extractDimedisFromHtml(html);
  if (dimedisFromHtml) {
    const plan = CrawlPlanSchema.parse({
      strategy: "single_page",
      base_url: url,
      hints: { detail_path_prefix: null },
      engine: "dimedis_api",
      dimedis: dimedisFromHtml,
    });
    return {
      plan,
      log: `Engine: dimedis_api (HTML-Signal — kein LLM-Call nötig)\nDomain: ${dimedisFromHtml.vis_domain}, Lang: ${dimedisFromHtml.lang}`,
      expectedTotalCount: null,
      promptPreview: "",
      responseRaw: {},
    };
  }

  const algoliaNote = algoliaSignals.found
    ? `\n\n⚠ PRE-SCAN RESULT: ${algoliaSignals.summary} You MUST pick engine="algolia_api".${algoliaSignals.app_id_hint ? ` Set algolia.app_id_hint="${algoliaSignals.app_id_hint}".` : ""}${algoliaSignals.index_hint ? ` Set algolia.index_hint="${algoliaSignals.index_hint}".` : ""}`
    : "";

  const userContent = `User-supplied URL:\n${url}\n\n--- HTML (truncated) ---\n${htmlTruncated}\n\n--- Markdown (truncated) ---\n${markdown}${algoliaNote}\n\nCall submit_crawl_plan with the chosen strategy.`;

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

  // Sanity-fix: Claude occasionally produces "" or "All"/"0-9" (>2 chars) in the letters array.
  if (Array.isArray(planInput.letters)) {
    planInput.letters = (planInput.letters as unknown[]).filter(
      (l) => typeof l === "string" && l.length >= 1 && l.length <= 2,
    );
  }

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

  // ── Post-Claude DIMEDIS API probe ──────────────────────────────────────────
  // If Claude picked a browser-based engine, probe the DIMEDIS REST endpoint.
  // Some sites load finder-base-config dynamically (after JS hydration), so
  // Firecrawl's HTML snapshot misses it even with waitFor:3500. A direct API
  // call is unambiguous and costs only 1 fetch with a 4 s timeout.
  const chosenEngine = (parsed as { engine?: string }).engine ?? "firecrawl";
  if (chosenEngine === "browserbase" || chosenEngine === "firecrawl" || chosenEngine === "algolia_api") {
    const dimedisProbe = await probeDimedisApi(url);
    if (dimedisProbe) {
      const overridePlan = CrawlPlanSchema.parse({
        strategy: "single_page",
        base_url: url,
        hints: parsed.hints,
        engine: "dimedis_api",
        dimedis: dimedisProbe,
      });
      return {
        plan: overridePlan,
        log: `Engine: dimedis_api (API-Probe — Claude hatte "${chosenEngine}" gewählt)\nDomain: ${dimedisProbe.vis_domain}, Lang: ${dimedisProbe.lang}`,
        expectedTotalCount,
        promptPreview: userContent.slice(0, 4000),
        responseRaw: rawInput,
      };
    }
  }

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
