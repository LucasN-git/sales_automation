/**
 * Smoke test for the three platform-specific REST engines (dimedis_api,
 * mapyourshow_api, expofp_api). Hits real production listing pages so it
 * doubles as a canary for endpoint drift.
 *
 * Run with `npx tsx --env-file=.env.local scripts/smoke-listing-engines.ts`.
 * Pass an engine name (dimedis | mapyourshow | expofp) to limit the run.
 * Exits non-zero if any engine returns zero exhibitors or trips a fallback.
 *
 * Three real targets:
 *  - DIMEDIS:     xponential-europe.com (~363 exhibitors expected)
 *  - MapYourShow: infocomm26.mapyourshow.com (~832 expected)
 *  - ExpoFP:      newyorkbuildexpo2026.expofp.com (~262 expected)
 */

import { executeDimedisApi } from "../lib/strategies/dimedis_api";
import { executeMapYourShowApi } from "../lib/strategies/mapyourshow_api";
import { executeExpoFpApi } from "../lib/strategies/expofp_api";
import {
  extractDimedisConfigFromHtml,
  looksLikeDimedisUrl,
} from "../lib/dimedis-extractor";
import {
  extractMapYourShowConfigFromUrl,
  looksLikeMapYourShowUrl,
} from "../lib/mapyourshow-extractor";
import {
  extractExpoFpConfigFromUrl,
  looksLikeExpoFpUrl,
} from "../lib/expofp-extractor";
import type { CrawlPlan } from "../lib/crawl-plan";

const log = (sub: string, meta?: Record<string, unknown>) => {
  const m = meta?.message ?? sub;
  console.log(`  · ${m}`);
  return Promise.resolve();
};

async function runDimedis() {
  console.log("\n[DIMEDIS] xponential-europe.com");
  const plan: CrawlPlan = {
    strategy: "single_page",
    base_url: "https://www.xponential-europe.com/vis/v1/en/directory",
    hints: { detail_path_prefix: null },
    engine: "dimedis_api",
    algolia: null,
    dimedis: null,
    mapyourshow: null,
    expofp: null,
  };
  const r = await executeDimedisApi(plan, log);
  assertResult("dimedis_api", r);
  console.log(`  · profile_url example: ${r.exhibitors[0]?.profile_url}`);
  console.log(`  · website example: ${r.exhibitors[0]?.website}`);
  console.log(`  · booth example: ${r.exhibitors[0]?.booth}`);
}

async function runMapYourShow() {
  console.log("\n[MapYourShow] infocomm26.mapyourshow.com");
  const plan: CrawlPlan = {
    strategy: "single_page",
    base_url:
      "https://infocomm26.mapyourshow.com/8_0/explore/exhibitor-gallery.cfm",
    hints: { detail_path_prefix: null },
    engine: "mapyourshow_api",
    algolia: null,
    dimedis: null,
    mapyourshow: null,
    expofp: null,
  };
  const r = await executeMapYourShowApi(plan, log);
  assertResult("mapyourshow_api", r);
  console.log(`  · profile_url example: ${r.exhibitors[0]?.profile_url}`);
  console.log(`  · booth example: ${r.exhibitors[0]?.booth}`);
}

async function runExpoFp() {
  console.log("\n[ExpoFP] newyorkbuildexpo2026.expofp.com");
  const plan: CrawlPlan = {
    strategy: "single_page",
    base_url: "https://newyorkbuildexpo2026.expofp.com/",
    hints: { detail_path_prefix: null },
    engine: "expofp_api",
    algolia: null,
    dimedis: null,
    mapyourshow: null,
    expofp: null,
  };
  const r = await executeExpoFpApi(plan, log);
  assertResult("expofp_api", r);
  console.log(`  · profile_url example: ${r.exhibitors[0]?.profile_url}`);
  console.log(`  · website example: ${r.exhibitors[0]?.website}`);
  console.log(`  · booth example: ${r.exhibitors[0]?.booth}`);
}

function assertResult(
  engine: string,
  r: { exhibitors: unknown[]; fallbackReason?: string },
) {
  if (r.fallbackReason) {
    throw new Error(`${engine} fallbackReason=${r.fallbackReason}`);
  }
  if (r.exhibitors.length === 0) {
    throw new Error(`${engine} returned 0 exhibitors`);
  }
  console.log(`  · OK · ${r.exhibitors.length} exhibitors`);
}

function unitChecks() {
  console.log("\n[UNIT] extractors");

  // DIMEDIS config extraction from HTML
  const html = `
    <head>
      <script id="finder-base-config" type="application/json">
        {"apiBaseUrl":"","routerBaseUrl":"/vis/v1/en","lang":"en","visDomain":"https://www.x.com"}
      </script>
    </head>`;
  const d = extractDimedisConfigFromHtml(html);
  if (!d || d.visDomain !== "https://www.x.com" || d.lang !== "en") {
    throw new Error("dimedis config extraction failed");
  }
  if (extractDimedisConfigFromHtml("<html></html>") !== null) {
    throw new Error("dimedis null-html should yield null");
  }
  if (!looksLikeDimedisUrl("https://x.com/vis/v1/en/directory")) {
    throw new Error("looksLikeDimedisUrl missed positive case");
  }
  if (looksLikeDimedisUrl("https://x.com/exhibitors")) {
    throw new Error("looksLikeDimedisUrl flagged false positive");
  }
  console.log("  · dimedis OK");

  // MapYourShow URL → config
  const m = extractMapYourShowConfigFromUrl(
    "https://infocomm26.mapyourshow.com/8_0/explore/exhibitor-gallery.cfm",
  );
  if (
    !m ||
    m.appRoot !== "https://infocomm26.mapyourshow.com/8_0" ||
    m.showCode !== "INFOCOMM26"
  ) {
    throw new Error("mapyourshow config extraction failed");
  }
  if (extractMapYourShowConfigFromUrl("https://random.com/x") !== null) {
    throw new Error("mapyourshow non-mys host should yield null");
  }
  if (!looksLikeMapYourShowUrl("https://ise2026.mapyourshow.com/8_0/")) {
    throw new Error("looksLikeMapYourShowUrl missed positive case");
  }
  console.log("  · mapyourshow OK");

  // ExpoFP URL → config
  const e = extractExpoFpConfigFromUrl(
    "https://newyorkbuildexpo2026.expofp.com/",
  );
  if (!e || e.eventId !== "newyorkbuildexpo2026") {
    throw new Error("expofp config extraction failed");
  }
  if (extractExpoFpConfigFromUrl("https://www.expofp.com/") !== null) {
    throw new Error("expofp marketing host should be excluded");
  }
  if (!looksLikeExpoFpUrl("https://anything.expofp.com/")) {
    throw new Error("looksLikeExpoFpUrl missed positive case");
  }
  console.log("  · expofp OK");
}

async function main() {
  const target = process.argv[2];
  let failed = 0;

  try {
    unitChecks();
  } catch (err) {
    console.error("UNIT FAIL:", err instanceof Error ? err.message : err);
    failed++;
  }

  const runners: Record<string, () => Promise<void>> = {
    dimedis: runDimedis,
    mapyourshow: runMapYourShow,
    expofp: runExpoFp,
  };
  const todo = target ? [target] : Object.keys(runners);
  for (const key of todo) {
    const fn = runners[key];
    if (!fn) {
      console.error(`unknown target ${key}; available: ${Object.keys(runners).join(", ")}`);
      failed++;
      continue;
    }
    try {
      await fn();
    } catch (err) {
      console.error(`ENGINE FAIL [${key}]:`, err instanceof Error ? err.message : err);
      failed++;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nALL GREEN");
}

main();
