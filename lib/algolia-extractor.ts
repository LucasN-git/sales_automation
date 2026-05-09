import { withSession, acceptCookies } from "./browserbase";

export type AlgoliaCredentials = {
  appId: string;
  searchKey: string;
  indexName: string;
  /**
   * Optional Algolia filter expression for multi-tenant indexes that share
   * data across multiple shows (e.g. NürnbergMesse Sitecore: "site:enfor").
   * Passed through to /browse so we only get the current show's exhibitors.
   */
  filters?: string;
};

type AlgoliaConfigBlock = {
  appID?: string;
  appId?: string;
  apiKey?: string;
  searchIndexTemplate?: string;
  indexName?: string;
  pageName?: string;
  site?: { name?: string };
};

/**
 * Walk an arbitrary JSON tree and return the first object that has BOTH an
 * `appID`/`appId` and an `apiKey` string field. That's how Next.js/Sitecore
 * sites typically embed their Algolia config inside __NEXT_DATA__.
 */
function findAlgoliaBlock(node: unknown): AlgoliaConfigBlock | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  const appCandidate = obj.appID ?? obj.appId;
  if (typeof appCandidate === "string" && typeof obj.apiKey === "string") {
    return obj as AlgoliaConfigBlock;
  }
  for (const v of Object.values(obj)) {
    const found = findAlgoliaBlock(v);
    if (found) return found;
  }
  return null;
}

/**
 * Try to pull Algolia credentials directly from the SSR HTML. Many
 * Next.js/Sitecore hybrids (NürnbergMesse fairs: Enforce Tac, FachPack,
 * Embedded World, BIOFACH, Spielwarenmesse, etc.) embed appID + apiKey in
 * __NEXT_DATA__. Plain HTTP fetch — no Browserbase, no minutes burned.
 * Returns null if the page doesn't expose creds in its SSR output.
 */
export async function extractAlgoliaCredentialsFromHtml(
  url: string,
): Promise<AlgoliaCredentials | null> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
      },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const scriptMatch = html.match(
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!scriptMatch) return null;

  let data: unknown;
  try {
    data = JSON.parse(scriptMatch[1]);
  } catch {
    return null;
  }

  const cfg = findAlgoliaBlock(data);
  if (!cfg) return null;

  const appId = cfg.appID ?? cfg.appId;
  const searchKey = cfg.apiKey;
  if (!appId || !searchKey) return null;

  // Resolve index name. NürnbergMesse Sitecore convention:
  //   searchIndexTemplate = "prod_website_{{category}}_en"
  // and the exhibitor-listing page maps to the "companies" category.
  let indexName = cfg.indexName ?? "";
  if (!indexName && cfg.searchIndexTemplate) {
    indexName = cfg.searchIndexTemplate.replace("{{category}}", "companies");
  }
  if (!indexName) return null;

  const tenant = cfg.pageName ?? cfg.site?.name;
  const filters = tenant ? `site:${tenant}` : undefined;

  return { appId, searchKey, indexName, filters };
}

/**
 * Browserbase-based extraction. Open the listing page in a real Cloud-Chrome
 * session, capture algolia.net network requests, read appId + searchKey from
 * URL/headers. Used only as a fallback when SSR-extraction yields nothing.
 */
async function extractAlgoliaCredentialsViaBrowser(
  url: string,
): Promise<{ creds: AlgoliaCredentials | null; sessionSec: number }> {
  const { result, durationSec } = await withSession(async (page) => {
    const isAlgolia = (u: string) =>
      u.includes("algolia.net") || u.includes("algolianet.com");
    const captured: { url: string; headers: Record<string, string> }[] = [];
    page.on("request", (req) => {
      const u = req.url();
      if (isAlgolia(u)) captured.push({ url: u, headers: req.headers() });
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });

    // Race a request-listener promise against a 25s timeout. Some Algolia sites
    // only fire their search bundle AFTER cookie consent, so we set up the wait
    // BEFORE accepting and let consent trigger the request mid-race.
    const algoliaSeen = page
      .waitForRequest((req) => isAlgolia(req.url()), { timeout: 25_000 })
      .then(() => true)
      .catch(() => false);

    await acceptCookies(page);
    const seen = await algoliaSeen;

    // If we've seen one request, give follow-ups a brief window to land — the
    // /queries endpoint often follows /1/indexes/<name>/settings, and we want
    // the queries one for cleanest creds.
    if (seen) await page.waitForTimeout(1_500);

    return captured;
  });

  if (result.length === 0) {
    return { creds: null, sessionSec: durationSec };
  }

  const candidate =
    result.find((r) => r.url.includes("/queries") || r.url.includes("/browse")) ??
    result[0];

  const m =
    candidate.url.match(/https:\/\/([^.]+)-dsn\.algolia\.net/) ??
    candidate.url.match(/https:\/\/([^.]+)\.algolia\.net/) ??
    candidate.url.match(/https:\/\/([^.]+)-1\.algolianet\.com/);
  const appId = m?.[1] ?? "";
  const searchKey =
    candidate.headers["x-algolia-api-key"] ??
    candidate.headers["x-algolia-application-id-key"] ??
    "";

  let indexName = "";
  const pathMatch = candidate.url.match(/\/1\/indexes\/([^/?]+)/);
  if (pathMatch) indexName = decodeURIComponent(pathMatch[1]);

  if (!appId || !searchKey) {
    return { creds: null, sessionSec: durationSec };
  }

  return {
    creds: { appId, searchKey, indexName },
    sessionSec: durationSec,
  };
}

/**
 * Two-stage Algolia credential extraction:
 *   1. SSR-first: parse __NEXT_DATA__ from plain HTML (zero-cost, ~1s).
 *   2. Browserbase fallback: open the page, sniff algolia.net requests.
 *
 * Most Next.js+Algolia sites are caught by stage 1. Stage 2 is reserved for
 * pure SPAs where creds are bundled in JS, not HTML.
 */
export async function extractAlgoliaCredentials(
  url: string,
): Promise<{ creds: AlgoliaCredentials | null; sessionSec: number }> {
  const fromHtml = await extractAlgoliaCredentialsFromHtml(url);
  if (fromHtml) {
    return { creds: fromHtml, sessionSec: 0 };
  }
  return await extractAlgoliaCredentialsViaBrowser(url);
}
