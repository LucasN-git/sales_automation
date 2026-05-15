import type { LetterLoopPlanT } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/firecrawl";
import {
  extractAlgoliaCredentials,
  type AlgoliaCredentials,
} from "@/lib/algolia-extractor";
import { browseAlgoliaIndex, mapHitToExhibitor } from "@/lib/algolia-client";
import type { StrategyProgress } from "./shared";

export type AlgoliaApiResult = {
  exhibitors: ExhibitorListing[];
  sessionSec: number;
  /** Set when extraction failed, caller should fall back to browserbase loop. */
  fallbackReason?: string;
  creds?: AlgoliaCredentials | null;
};

/**
 * Fast path: open the listing once with Browserbase, sniff the live algolia.net
 * network requests for credentials, then hit /browse from Node directly to
 * paginate through ALL hits. ~30 seconds total for any size index, regardless
 * of how many letters / filters the public UI supports.
 */
export async function executeAlgoliaApi(
  plan: LetterLoopPlanT,
  onProgress: StrategyProgress,
): Promise<AlgoliaApiResult> {
  await onProgress("algolia_extract_credentials");
  const { creds, sessionSec } = await extractAlgoliaCredentials(plan.base_url);

  if (!creds) {
    await onProgress("algolia_extract_failed", {
      message: "No algolia.net request captured — fallback to browserbase",
    });
    return {
      exhibitors: [],
      sessionSec,
      fallbackReason: "credentials_extraction_failed",
      creds: null,
    };
  }

  await onProgress("algolia_extracted", {
    message: `Algolia: ${creds.appId} / ${creds.indexName || "(index unbekannt)"}${creds.filters ? ` [${creds.filters}]` : ""}`,
    app_id: creds.appId,
    index: creds.indexName,
    filters: creds.filters,
  });

  if (!creds.indexName) {
    return {
      exhibitors: [],
      sessionSec,
      fallbackReason: "no_index_name",
      creds,
    };
  }

  // The Algolia search key on multi-tenant Sitecore indexes is usually
  // pagination-capped (paginationLimitedTo=1000). Pass the discovered
  // letter-facet so the client can split queries when nbHits > cap.
  const splitByFacet = plan.algolia?.filter_attribute ?? undefined;

  let hits;
  try {
    hits = await browseAlgoliaIndex(creds, {
      hitsPerPage: 1000,
      filters: creds.filters,
      splitByFacet,
    });
  } catch (err) {
    return {
      exhibitors: [],
      sessionSec,
      fallbackReason: `browse_failed: ${err instanceof Error ? err.message : String(err)}`,
      creds,
    };
  }

  await onProgress("algolia_hits_fetched", {
    message: `${hits.length} Hits aus Algolia geholt`,
    count: hits.length,
  });

  const seen = new Set<string>();
  const out: ExhibitorListing[] = [];
  // Resolve relative profile-page paths against the listing's base URL.
  let baseOrigin: string | null = null;
  try {
    baseOrigin = new URL(plan.base_url).origin;
  } catch {
    baseOrigin = null;
  }
  for (const h of hits) {
    const m = mapHitToExhibitor(h);
    if (!m) continue;
    const key = m.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    let profile_url: string | null = null;
    if (m.profile_url_path) {
      if (/^https?:\/\//i.test(m.profile_url_path)) {
        profile_url = m.profile_url_path;
      } else if (baseOrigin) {
        profile_url = baseOrigin + (m.profile_url_path.startsWith("/") ? "" : "/") + m.profile_url_path;
      }
    }

    out.push({
      name: m.name,
      website: m.website,
      booth: m.booth,
      profile_url,
      profile_data: m.profile_data,
    });
  }

  return { exhibitors: out, sessionSec, creds };
}
