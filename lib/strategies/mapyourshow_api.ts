import type { CrawlPlan } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/scraper";
import {
  extractMapYourShowConfigFromUrl,
  type MapYourShowConfig,
} from "@/lib/mapyourshow-extractor";
import type { StrategyProgress } from "./shared";

export type MapYourShowApiResult = {
  exhibitors: ExhibitorListing[];
  /** Always 0 for mapyourshow_api (no Browserbase session). */
  sessionSec: number;
  fallbackReason?: string;
  config?: MapYourShowConfig | null;
};

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";

const SEARCHSIZE_CAP = 10_000;

/**
 * MapYourShow listing engine. Two HTTP calls:
 *   1. GET the gallery page so the CF server hands out CFID/CFTOKEN cookies.
 *   2. GET the JSON proxy with `searchsize=10000` to pull every exhibitor at
 *      once. The proxy refuses without those session cookies (HTTP 403).
 *
 * No browser, no token, no pagination cursor. Tested against InfoComm 2026
 * (832 exhibitors, 770 KB, ~2 s).
 */
export async function executeMapYourShowApi(
  plan: CrawlPlan,
  onProgress: StrategyProgress,
): Promise<MapYourShowApiResult> {
  const config: MapYourShowConfig | null = plan.mapyourshow
    ? { appRoot: plan.mapyourshow.app_root, showCode: plan.mapyourshow.show_code }
    : extractMapYourShowConfigFromUrl(plan.base_url);

  if (!config) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: "config_not_found",
      config: null,
    };
  }

  await onProgress("mapyourshow_resolved", {
    message: `MapYourShow: ${config.showCode} @ ${config.appRoot}`,
    show_code: config.showCode,
    app_root: config.appRoot,
  });

  const galleryUrl = `${config.appRoot}/explore/exhibitor-gallery.cfm`;
  let sessionCookie: string;
  try {
    const galleryRes = await fetch(galleryUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "follow",
    });
    if (!galleryRes.ok) {
      return {
        exhibitors: [],
        sessionSec: 0,
        fallbackReason: `gallery_http_${galleryRes.status}`,
        config,
      };
    }
    sessionCookie = extractCookieHeader(galleryRes.headers);
    if (!sessionCookie) {
      return {
        exhibitors: [],
        sessionSec: 0,
        fallbackReason: "no_session_cookie",
        config,
      };
    }
  } catch (err) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: `gallery_fetch_error: ${err instanceof Error ? err.message : String(err)}`,
      config,
    };
  }

  const searchUrl = `${config.appRoot}/ajax/remote-proxy.cfm?action=search&searchtype=exhibitorgallery&searchsize=${SEARCHSIZE_CAP}`;

  let payload: any;
  try {
    const searchRes = await fetch(searchUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Referer: galleryUrl,
        Cookie: sessionCookie,
      },
    });
    if (!searchRes.ok) {
      return {
        exhibitors: [],
        sessionSec: 0,
        fallbackReason: `search_http_${searchRes.status}`,
        config,
      };
    }
    payload = await searchRes.json();
  } catch (err) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: `search_fetch_error: ${err instanceof Error ? err.message : String(err)}`,
      config,
    };
  }

  if (!payload?.SUCCESS) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: `search_not_success: ${payload?.ERRORMESSAGE ?? "unknown"}`,
      config,
    };
  }

  const hits = payload?.DATA?.results?.exhibitor?.hit;
  if (!Array.isArray(hits)) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: "no_hits_array",
      config,
    };
  }

  const exhibitors = mapMysHits(hits, config);

  await onProgress("mapyourshow_done", {
    message: `${exhibitors.length} Aussteller aus MapYourShow geholt.`,
    count: exhibitors.length,
    total_hits_reported: payload?.DATA?.totalhits ?? null,
    sample: exhibitors.slice(0, 3).map((e) => e.name),
  });

  return { exhibitors, sessionSec: 0, config };
}

/**
 * Concatenate Set-Cookie headers into a Cookie request header.
 * Strips attributes (path, domain, secure, ...) — only name=value pairs matter
 * for the second request.
 */
function extractCookieHeader(headers: Headers): string {
  const cookies: string[] = [];
  // The fetch API in Node 18+ exposes getSetCookie(); fall back to raw "set-cookie".
  const anyHeaders = headers as unknown as {
    getSetCookie?: () => string[];
  };
  const raw = anyHeaders.getSetCookie
    ? anyHeaders.getSetCookie()
    : headers.get("set-cookie")?.split(/,(?=\s*[A-Za-z0-9_-]+=)/) ?? [];
  for (const c of raw) {
    const first = c.split(";")[0]?.trim();
    if (first) cookies.push(first);
  }
  return cookies.join("; ");
}

function mapMysHits(hits: unknown[], config: MapYourShowConfig): ExhibitorListing[] {
  const seen = new Set<string>();
  const out: ExhibitorListing[] = [];
  for (const h of hits) {
    const mapped = mapMysHit(h, config);
    if (!mapped) continue;
    const key = mapped.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }
  return out;
}

function mapMysHit(hit: unknown, config: MapYourShowConfig): ExhibitorListing | null {
  if (!hit || typeof hit !== "object") return null;
  const fields = (hit as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object") return null;
  const f = fields as Record<string, unknown>;

  const name = typeof f.exhname_t === "string" ? f.exhname_t.trim() : "";
  if (!name) return null;

  const exhid =
    typeof f.exhid_l === "string"
      ? f.exhid_l
      : typeof f.exhid_l === "number"
        ? String(f.exhid_l)
        : null;

  const booth = pickMysBooth(f);
  const profile_url = exhid
    ? `${config.appRoot}/exhibitor/exhibitor-details.cfm?exhid=${encodeURIComponent(exhid)}`
    : null;

  return {
    name,
    website: null,
    booth,
    profile_url,
    profile_data: null,
  };
}

/**
 * MYS booths come as `["N108randomstring", "C6553randomstring"]`. The trailing
 * "randomstring" is a literal anti-scrape suffix in the API; the UI strips it.
 * Several exhibitors share two booths (split across halls) — join with comma.
 */
function pickMysBooth(fields: Record<string, unknown>): string | null {
  const arr = fields.boothsdisplay_la;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const cleaned: string[] = [];
  for (const v of arr) {
    if (typeof v !== "string") continue;
    const trimmed = v.replace(/randomstring$/i, "").trim();
    if (trimmed) cleaned.push(trimmed);
  }
  if (cleaned.length === 0) return null;
  return Array.from(new Set(cleaned)).join(", ");
}
