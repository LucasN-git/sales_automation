import type { AlgoliaCredentials } from "./algolia-extractor";

export type AlgoliaHit = Record<string, unknown> & { objectID?: string };

/**
 * Stream-paginate ALL hits of an Algolia index.
 *
 * Three strategies, in order:
 *   1. /browse with cursor (best — no per-query cap). Available only to keys
 *      with the `browse` ACL.
 *   2. /queries page-by-page. Capped at paginationLimitedTo (default 1000).
 *   3. /queries split by a facet (e.g. filterAZ:A, filterAZ:B, …). Used when
 *      total nbHits exceeds the pagination cap and a split-facet is provided.
 */
export async function browseAlgoliaIndex(
  creds: AlgoliaCredentials,
  opts: {
    hitsPerPage?: number;
    filters?: string;
    splitByFacet?: string;
  } = {},
): Promise<AlgoliaHit[]> {
  if (!creds.appId || !creds.searchKey || !creds.indexName) {
    throw new Error("incomplete Algolia credentials");
  }
  const hitsPerPage = opts.hitsPerPage ?? 1000;

  const browseResult = await tryBrowseEndpoint(creds, hitsPerPage, opts.filters);
  if (browseResult.ok) return browseResult.hits;
  if (browseResult.status !== 403) {
    throw new Error(`Algolia browse ${browseResult.status}: ${browseResult.body}`);
  }

  return await pageQueryEndpoint(
    creds,
    hitsPerPage,
    opts.filters,
    opts.splitByFacet,
  );
}

async function tryBrowseEndpoint(
  creds: AlgoliaCredentials,
  hitsPerPage: number,
  filters: string | undefined,
): Promise<
  | { ok: true; hits: AlgoliaHit[] }
  | { ok: false; status: number; body: string }
> {
  const all: AlgoliaHit[] = [];
  let cursor: string | undefined = undefined;
  let safetyPages = 0;

  while (true) {
    const body: Record<string, unknown> = { hitsPerPage };
    if (cursor) body.cursor = cursor;
    if (filters) body.filters = filters;

    const url = `https://${creds.appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(creds.indexName)}/browse`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Algolia-Application-Id": creds.appId,
        "X-Algolia-API-Key": creds.searchKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, body: text };
    }
    const json: { hits?: AlgoliaHit[]; cursor?: string } = await res.json();
    if (json.hits?.length) all.push(...json.hits);
    if (!json.cursor) break;
    cursor = json.cursor;
    safetyPages++;
    if (safetyPages > 50) break; // sanity cap, ~50k items
  }
  return { ok: true, hits: all };
}

type QueryResult = {
  hits: AlgoliaHit[];
  nbHits: number;
  nbPages: number;
  facets: Record<string, Record<string, number>>;
};

async function singleQuery(
  creds: AlgoliaCredentials,
  paramsObj: Record<string, string | number | string[]>,
): Promise<QueryResult> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) {
    if (Array.isArray(v)) params.set(k, JSON.stringify(v));
    else params.set(k, String(v));
  }
  const url = `https://${creds.appId}-dsn.algolia.net/1/indexes/*/queries`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": creds.appId,
      "X-Algolia-API-Key": creds.searchKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [{ indexName: creds.indexName, params: params.toString() }],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Algolia queries ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }
  const json: {
    results?: {
      hits?: AlgoliaHit[];
      nbHits?: number;
      nbPages?: number;
      facets?: Record<string, Record<string, number>>;
    }[];
  } = await res.json();
  const r = json.results?.[0] ?? {};
  return {
    hits: r.hits ?? [],
    nbHits: r.nbHits ?? 0,
    nbPages: r.nbPages ?? 1,
    facets: r.facets ?? {},
  };
}

async function pageQueryEndpoint(
  creds: AlgoliaCredentials,
  hitsPerPage: number,
  filters: string | undefined,
  splitByFacet: string | undefined,
): Promise<AlgoliaHit[]> {
  const baseParams: Record<string, string | number> = { hitsPerPage };
  if (filters) baseParams.filters = filters;

  // First page tells us nbHits + the pagination cap.
  const first = await singleQuery(creds, { ...baseParams, page: 0 });

  // Path A: total fits in one page.
  if (first.nbHits <= first.hits.length) return first.hits;

  // Path B: total fits within the index's paginationLimitedTo — paginate.
  const totalPagesNeeded = Math.ceil(first.nbHits / hitsPerPage);
  if (totalPagesNeeded <= first.nbPages) {
    const all: AlgoliaHit[] = [...first.hits];
    for (let page = 1; page < totalPagesNeeded; page++) {
      const r = await singleQuery(creds, { ...baseParams, page });
      if (r.hits.length) all.push(...r.hits);
    }
    return all;
  }

  // Path C: pagination is capped (most public Sitecore keys hit this). Split
  // by a facet so each sub-query stays under the cap. Without a facet we'd
  // silently truncate to the first page — caller must opt in.
  if (!splitByFacet) return first.hits;

  const dist = await singleQuery(creds, {
    ...baseParams,
    hitsPerPage: 0,
    facets: [splitByFacet],
  });
  const facetCounts = dist.facets[splitByFacet] ?? {};

  const seen = new Set<string>();
  const all: AlgoliaHit[] = [];
  for (const value of Object.keys(facetCounts)) {
    if (facetCounts[value] === 0) continue;
    let page = 0;
    while (true) {
      const r = await singleQuery(creds, {
        ...baseParams,
        page,
        facetFilters: [`${splitByFacet}:${value}`],
      });
      for (const h of r.hits) {
        const id = (h.objectID as string | undefined) ?? "";
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        all.push(h);
      }
      if (page + 1 >= r.nbPages) break;
      page++;
    }
  }
  return all;
}

/**
 * Best-effort mapping from a generic Algolia hit to our ExhibitorListing
 * shape. Each Algolia setup uses different field names — try the common ones.
 */
export type MappedExhibitor = {
  name: string;
  website: string | null;
  booth: string | null;
  /** Relative or absolute URL of the trade-show's per-exhibitor detail page. */
  profile_url_path: string | null;
  /** Rich enrichment harvested from the same hit. */
  profile_data: Record<string, unknown> | null;
};

export function mapHitToExhibitor(hit: AlgoliaHit): MappedExhibitor | null {
  const name =
    (hit.name as string | undefined) ??
    (hit.companyName as string | undefined) ??
    (hit.company_name as string | undefined) ??
    (hit.title as string | undefined) ??
    (hit.exhibitor_name as string | undefined);
  if (!name || typeof name !== "string") return null;

  // `website` must be the company's real external URL (downstream uses it as
  // a Firecrawl scrape target). Many indexes also expose `url` as the trade-
  // show's internal profile path (e.g. "/en/exhibitors/abc-123") — that's
  // useless as a "website" and breaks the scraper, so accept only absolute
  // http(s) URLs.
  const websiteCandidates = [
    hit.website,
    hit.companyWebsite,
    hit.homepage,
    hit.websiteUrl,
    hit.url,
  ];
  let website: string | null = null;
  for (const c of websiteCandidates) {
    if (typeof c === "string" && /^https?:\/\//i.test(c)) {
      website = c;
      break;
    }
  }

  // Booth shapes seen in the wild:
  //   - plain string: "3.0/D-12"
  //   - Sitecore array: [{ boothNumber: "...", boothHall: "..." }, ...]
  let booth: string | null = null;
  if (Array.isArray(hit.booth) && hit.booth.length > 0) {
    const first = hit.booth[0] as { boothNumber?: unknown; boothHall?: unknown };
    if (typeof first.boothNumber === "string") booth = first.boothNumber;
    else if (typeof first.boothHall === "string") booth = first.boothHall;
  } else {
    for (const k of ["booth", "stand", "hall"] as const) {
      const v = hit[k];
      if (typeof v === "string") {
        booth = v;
        break;
      }
    }
  }

  // Profile-page path on the trade-show site itself (e.g. /en/exhibitors/...)
  // — not the company's external website. Caller absolutizes with base URL.
  const profile_url_path =
    typeof hit.url === "string" && hit.url.length > 0 ? hit.url : null;

  // Pull the rich enrichment that Sitecore-style indexes ship with every hit.
  // Caller stores this verbatim as `profile_data` and the short prompt picks
  // out useful fields. Schema is intentionally loose — different organisers
  // (NürnbergMesse, Messe Frankfurt, Messe München) put fields under different
  // names and we don't want to drop anything just because we didn't recognise
  // it. Drop only the noise.
  const profile_data: Record<string, unknown> = {};

  // Address
  const address: Record<string, string> = {};
  if (typeof hit.streetno === "string" && hit.streetno) address.street = hit.streetno;
  if (typeof hit.postcode === "string" && hit.postcode) address.postcode = hit.postcode;
  if (typeof hit.city === "string" && hit.city) address.city = hit.city;
  if (typeof hit.country === "string" && hit.country) address.country = hit.country;
  if (Object.keys(address).length > 0) profile_data.address = address;

  // Contact
  if (typeof hit.email === "string" && hit.email) profile_data.email = hit.email;
  if (typeof hit.phone === "string" && hit.phone) profile_data.phone = hit.phone;

  // Description / company metadata
  for (const k of ["companyDescription", "slogan", "companyType"] as const) {
    const v = hit[k];
    if (typeof v === "string" && v) profile_data[k] = v;
  }
  if (Array.isArray(hit.employee) && hit.employee.length > 0)
    profile_data.employee = hit.employee;

  // Sector classification: NürnbergMesse uses filternomenclature_DEF.lvl2 for
  // the most-specific user-facing categories ("4.1.1. Software", etc).
  const cats = extractCategories(hit);
  if (cats.length > 0) profile_data.categories = cats;

  // Keywords / products / co-exhibitors — verbatim arrays
  for (const k of ["keyword", "products", "coExhibitors"] as const) {
    const v = hit[k];
    if (Array.isArray(v) && v.length > 0) profile_data[k] = v;
  }

  // Logo URL if present (some Sitecore sites populate this)
  if (typeof hit.logo === "string" && hit.logo) profile_data.logo = hit.logo;

  return {
    name: name.trim(),
    website,
    booth,
    profile_url_path,
    profile_data: Object.keys(profile_data).length > 0 ? profile_data : null,
  };
}

function extractCategories(hit: AlgoliaHit): string[] {
  const out = new Set<string>();
  // NürnbergMesse pattern: nested {lvl0,lvl1,lvl2,lvl3} arrays of "X. Title > Y. Sub > Z. Leaf"
  for (const facetName of [
    "filternomenclature_DEF",
    "filternomenclature_BRANCHE",
    "filternomenclature_SOND",
    "filternomenclature_ST",
    "filternomenclature_BERUF",
  ]) {
    const facet = hit[facetName];
    if (!facet || typeof facet !== "object") continue;
    // Prefer lvl2 (most-specific user-facing). Fall back to lvl1 if no lvl2.
    const obj = facet as Record<string, unknown>;
    const lvl2 = Array.isArray(obj.lvl2) ? (obj.lvl2 as unknown[]) : [];
    const lvl1 = Array.isArray(obj.lvl1) ? (obj.lvl1 as unknown[]) : [];
    const source = lvl2.length > 0 ? lvl2 : lvl1;
    for (const entry of source) {
      if (typeof entry !== "string") continue;
      // Take the leaf segment after the last "> "
      const leaf = entry.split(">").pop()?.trim() ?? entry;
      // Strip leading numbering like "4.1.1. " for a cleaner display
      const clean = leaf.replace(/^\d+(\.\d+)*\.\s*/, "").trim();
      if (clean) out.add(clean);
    }
  }
  return Array.from(out);
}
