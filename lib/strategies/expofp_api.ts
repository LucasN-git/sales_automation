import type { CrawlPlan } from "@/lib/crawl-plan";
import type { ExhibitorListing } from "@/lib/scraper";
import {
  extractExpoFpConfigFromUrl,
  type ExpoFpConfig,
} from "@/lib/expofp-extractor";
import type { StrategyProgress } from "./shared";

export type ExpoFpApiResult = {
  exhibitors: ExhibitorListing[];
  sessionSec: number;
  fallbackReason?: string;
  config?: ExpoFpConfig | null;
};

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36";

/**
 * ExpoFP listing engine. One unauthenticated GET against `/data/data.json`
 * returns every exhibitor with name, website, address, phone, email plus a
 * separate booths array linking back via `booth.exhibitors`. The blob is
 * UTF-8-with-BOM in the wild, so we strip the BOM before parsing.
 */
export async function executeExpoFpApi(
  plan: CrawlPlan,
  onProgress: StrategyProgress,
): Promise<ExpoFpApiResult> {
  const config: ExpoFpConfig | null = plan.expofp
    ? extractExpoFpConfigFromUrl(`https://${plan.expofp.event_id}.expofp.com`) ??
      extractExpoFpConfigFromUrl(plan.base_url)
    : extractExpoFpConfigFromUrl(plan.base_url);

  if (!config) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: "config_not_found",
      config: null,
    };
  }

  await onProgress("expofp_resolved", {
    message: `ExpoFP: ${config.eventId}`,
    event_id: config.eventId,
    origin: config.origin,
  });

  const dataUrl = `${config.origin}/data/data.json`;
  let payload: any;
  try {
    const res = await fetch(dataUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) {
      return {
        exhibitors: [],
        sessionSec: 0,
        fallbackReason: `data_http_${res.status}`,
        config,
      };
    }
    const text = await res.text();
    // ExpoFP ships data.json with a UTF-8 BOM. JSON.parse rejects that.
    const cleaned = text.replace(/^﻿/, "");
    payload = JSON.parse(cleaned);
  } catch (err) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: `data_fetch_error: ${err instanceof Error ? err.message : String(err)}`,
      config,
    };
  }

  const exhibitors = Array.isArray(payload?.exhibitors) ? payload.exhibitors : null;
  if (!exhibitors) {
    return {
      exhibitors: [],
      sessionSec: 0,
      fallbackReason: "no_exhibitors_array",
      config,
    };
  }

  const booths = Array.isArray(payload?.booths) ? payload.booths : [];
  const exhibitorBooths = buildBoothIndex(booths);

  const mapped = mapExpoFpRows(exhibitors, exhibitorBooths, config);

  await onProgress("expofp_done", {
    message: `${mapped.length} Aussteller aus ExpoFP geholt.`,
    count: mapped.length,
    sample: mapped.slice(0, 3).map((e) => e.name),
  });

  return { exhibitors: mapped, sessionSec: 0, config };
}

function buildBoothIndex(booths: unknown[]): Map<number, string[]> {
  const idx = new Map<number, string[]>();
  for (const b of booths) {
    if (!b || typeof b !== "object") continue;
    const obj = b as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) continue;
    const exhs = obj.exhibitors;
    if (!Array.isArray(exhs)) continue;
    for (const eid of exhs) {
      if (typeof eid !== "number") continue;
      const arr = idx.get(eid) ?? [];
      arr.push(name);
      idx.set(eid, arr);
    }
  }
  return idx;
}

function mapExpoFpRows(
  rows: unknown[],
  boothIndex: Map<number, string[]>,
  config: ExpoFpConfig,
): ExhibitorListing[] {
  const seen = new Set<string>();
  const out: ExhibitorListing[] = [];

  for (const r of rows) {
    const mapped = mapExpoFpRow(r, boothIndex, config);
    if (!mapped) continue;
    const key = mapped.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(mapped);
  }

  return out;
}

function mapExpoFpRow(
  row: unknown,
  boothIndex: Map<number, string[]>,
  config: ExpoFpConfig,
): ExhibitorListing | null {
  if (!row || typeof row !== "object") return null;
  const obj = row as Record<string, unknown>;

  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  if (!name) return null;

  const website = typeof obj.website === "string" ? obj.website.trim() || null : null;
  const id = typeof obj.id === "number" ? obj.id : null;
  const booths = id ? (boothIndex.get(id) ?? []) : [];
  const booth = booths.length > 0 ? Array.from(new Set(booths)).join(", ") : null;

  const externalId = typeof obj.externalId === "string" ? obj.externalId : null;
  const profile_url = externalId
    ? `${config.origin}/?exhibitor=${encodeURIComponent(externalId)}`
    : id
      ? `${config.origin}/?exhibitor=${id}`
      : null;

  return {
    name,
    website,
    booth,
    profile_url,
    profile_data: null,
  };
}
