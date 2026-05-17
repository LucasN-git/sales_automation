import type { CrawlPlan } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/firecrawl";
import {
  extractDimedisConfigFromHtml,
  type DimedisConfig,
} from "@/lib/dimedis-extractor";
import { fc, type StrategyProgress } from "./shared";

export type DimedisApiResult = {
  exhibitors: ExhibitorListing[];
  /** Always 0 for dimedis_api (no Browserbase session). Kept for caller shape. */
  sessionSec: number;
  fallbackReason?: string;
  config?: DimedisConfig | null;
};

/**
 * DIMEDIS VIS listing engine. The plan only needs the base_url; if `dimedis`
 * hints are missing, we firecrawl the listing once to read the config block.
 * Then a single GET against the REST endpoint returns the complete exhibitor
 * list as structured JSON; no LLM extraction, no scrolling, no letters.
 */
export async function executeDimedisApi(
  plan: CrawlPlan,
  onProgress: StrategyProgress,
): Promise<DimedisApiResult> {
  let config: DimedisConfig | null = plan.dimedis
    ? { visDomain: plan.dimedis.vis_domain, lang: plan.dimedis.lang }
    : null;

  if (!config) {
    await onProgress("dimedis_resolve_config");
    config = await fetchDimedisConfig(plan.base_url);
    if (!config) {
      return {
        exhibitors: [],
        sessionSec: 0,
        fallbackReason: "config_not_found",
        config: null,
      };
    }
  }

  await onProgress("dimedis_resolved", {
    message: `DIMEDIS: ${config.visDomain} / ${config.lang}`,
    vis_domain: config.visDomain,
    lang: config.lang,
  });

  const apiUrl = `${config.visDomain}/vis-api/vis/v2/${encodeURIComponent(
    config.lang,
  )}/exhibitors`;

  let rows: unknown;
  try {
    const res = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
        "X-Vis-Domain": config.visDomain,
      },
    });
    if (!res.ok) {
      return {
        exhibitors: [],
        sessionSec: 0,
        fallbackReason: `api_http_${res.status}`,
        config,
      };
    }
    rows = await res.json();
  } catch (err) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: `api_fetch_error: ${err instanceof Error ? err.message : String(err)}`,
      config,
    };
  }

  if (!Array.isArray(rows)) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: "api_not_array",
      config,
    };
  }

  const exhibitors = mapDimedisRows(rows, config);

  await onProgress("dimedis_done", {
    message: `${exhibitors.length} Aussteller aus DIMEDIS-API geholt.`,
    count: exhibitors.length,
    sample: exhibitors.slice(0, 3).map((e) => e.name),
  });

  return { exhibitors, sessionSec: 0, config };
}

async function fetchDimedisConfig(url: string): Promise<DimedisConfig | null> {
  try {
    const result: any = await fc().scrapeUrl(url, {
      formats: ["rawHtml"],
      onlyMainContent: false,
      waitFor: 2000,
      timeout: 30_000,
    });
    if (!result?.success) return null;
    const html: string =
      result.rawHtml ??
      result.data?.rawHtml ??
      result.html ??
      result.data?.html ??
      "";
    return extractDimedisConfigFromHtml(html);
  } catch {
    return null;
  }
}

function mapDimedisRows(
  rows: unknown[],
  config: DimedisConfig,
): ExhibitorListing[] {
  const seen = new Set<string>();
  const out: ExhibitorListing[] = [];

  for (const row of rows) {
    const ex = mapSingleDimedisRow(row, config);
    if (!ex) continue;
    const key = ex.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ex);
  }

  return out;
}

function mapSingleDimedisRow(
  row: unknown,
  config: DimedisConfig,
): ExhibitorListing | null {
  if (!row || typeof row !== "object") return null;
  const profile =
    (row as Record<string, unknown>).profile &&
    typeof (row as Record<string, unknown>).profile === "object"
      ? ((row as Record<string, unknown>).profile as Record<string, unknown>)
      : null;
  if (!profile) return null;

  const name =
    typeof profile.name === "string" ? profile.name.trim() : "";
  if (!name) return null;

  return {
    name,
    website: pickWebsite(profile),
    booth: pickBooth(profile),
    profile_url: buildProfileUrl(name, config),
    profile_data: null,
  };
}

function pickWebsite(profile: Record<string, unknown>): string | null {
  const links = profile.links;
  if (!Array.isArray(links)) return null;
  for (const l of links) {
    if (!l || typeof l !== "object") continue;
    const link = l as Record<string, unknown>;
    if (link.type === "link" && typeof link.link === "string" && link.link.trim()) {
      return link.link.trim();
    }
  }
  return null;
}

function pickBooth(profile: Record<string, unknown>): string | null {
  const locations = profile.locations;
  if (!Array.isArray(locations)) return null;
  const stands: string[] = [];
  for (const loc of locations) {
    if (!loc || typeof loc !== "object") continue;
    const stand = (loc as Record<string, unknown>).stand;
    if (typeof stand === "string" && stand.trim()) {
      stands.push(stand.trim());
    }
  }
  if (stands.length === 0) return null;
  return Array.from(new Set(stands)).join(", ");
}

function buildProfileUrl(name: string, config: DimedisConfig): string {
  // DIMEDIS detail pages route by URL-encoded company name. Confirmed against
  // xponential-europe: spaces as `+`, special chars percent-encoded.
  const encoded = encodeURIComponent(name).replace(/%20/g, "+");
  return `${config.visDomain}/vis/v1/${encodeURIComponent(config.lang)}/directory/${encoded}`;
}
