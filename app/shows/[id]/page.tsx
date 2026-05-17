import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import {
  getSettings,
  SHORT_MODEL_DEFAULT,
  DEEP_MODEL_DEFAULT,
} from "@/lib/settings";
import { CrawlPlanSchema } from "@/lib/crawl-plan";
import { estimatePerCallUsd, estimateIsHistorical } from "@/lib/cost-estimate";
import { getShowExhibitorStatus, tallyStatuses } from "@/lib/show-status";
import { getCachedExhibitorList } from "@/lib/show-cache";
import { ExhibitorList } from "./ExhibitorList";
import { RestartButton } from "./RestartButton";
import { PauseResumeButton } from "./PauseResumeButton";
import { BulkOverviewButton } from "./BulkOverviewButton";
import { ShowViewLoader, ShowViewSkeleton } from "./ShowViewLoader";
import {
  UrlSearchBanner,
  type UrlSearchEvidence,
  type UrlSearchStatus,
} from "./UrlSearchBanner";
import { FavoriteToggle } from "@/components/FavoriteToggle";
import { SettingsIcon } from "@/components/brand/Icons";
import { RefreshButton } from "@/components/RefreshButton";

export const dynamic = "force-dynamic";

type ViewParam = "aussteller" | "prozess" | "log" | "kosten" | "progress";
const VIEWS: ViewParam[] = ["aussteller", "prozess", "log", "kosten", "progress"];

function parseView(v: string | undefined): ViewParam {
  return v && (VIEWS as string[]).includes(v) ? (v as ViewParam) : "aussteller";
}

export default async function ShowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    q?: string;
    sector?: string;
    sort?: string;
    prio?: string;
    view?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view = parseView(sp.view);
  const supabase = await createClient();

  async function getUserSettings() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user ? await getSettings(supabase, user.id) : null;
  }

  // All four DB calls in parallel — no sequential batches.
  const [{ data: show }, statusRows, settings, { data: tokenStatsData }] =
    await Promise.all([
      supabase
        .from("trade_shows")
        .select(
          "id, name, source_url, year, status, current_step, expected_exhibitor_count, error_message, created_at, crawl_plan, browserbase_session_seconds, is_favorite, url_search_status, url_search_evidence",
        )
        .eq("id", id)
        .single(),
      getShowExhibitorStatus(id),
      getUserSettings(),
      supabase.rpc("get_token_stats", { p_trade_show_id: id }),
    ]);

  if (!show) notFound();

  const shortModel = settings?.short_model ?? SHORT_MODEL_DEFAULT;
  const deepModel = settings?.deep_model ?? DEEP_MODEL_DEFAULT;

  const exhibitorsForViews = statusRows.map((e) => ({
    company_name: e.company_name,
    short_status: e.short_status,
    deep_status: e.deep_status,
    current_step: e.current_step,
  }));

  const crawlPlan =
    show.crawl_plan && CrawlPlanSchema.safeParse(show.crawl_plan).success
      ? CrawlPlanSchema.parse(show.crawl_plan)
      : null;
  const browserSec =
    (show as { browserbase_session_seconds?: number })
      .browserbase_session_seconds ?? 0;

  const counts = tallyStatuses(statusRows);
  const allCount = counts.total;
  const shortDone = counts.shortDone;
  const shortRunning = counts.shortRunning;
  const shortPending = counts.shortPending;
  const shortFailed = counts.shortFailed;

  type Stats = { tin: number; tout: number; cnt: number };
  const shortStats = (tokenStatsData as { short?: Stats } | null)?.short ?? null;
  const shortPerCallUsd = estimatePerCallUsd("short", shortModel, shortStats);
  const shortEstimateHistorical = estimateIsHistorical(shortStats);

  return (
    <>
      <header className="mb-10">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-display">
            {show.name}
            {(show.status === "crawling" || shortRunning > 0) && (
              <span style={{ color: "var(--color-gold)" }}>.</span>
            )}
          </h1>
          <div className="flex items-center gap-1">
            <RefreshButton />
            <FavoriteToggle
              showId={id}
              initialFavorite={Boolean(
                (show as { is_favorite?: boolean }).is_favorite,
              )}
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          {show.year && <span>{show.year}</span>}
          {show.source_url && (
            <a
              href={show.source_url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-[var(--color-gold)] transition-colors"
            >
              quelle
            </a>
          )}
          <span className="tabular-nums">
            listing {allCount}
            {show.expected_exhibitor_count
              ? ` / erwartet ~${show.expected_exhibitor_count}`
              : ""}
          </span>
          <span className="tabular-nums">
            short {shortDone}/{allCount}
            {shortRunning > 0 ? ` · ${shortRunning} laufen` : ""}
          </span>
          <span className="inline-flex items-center gap-2">
            {(show.status === "crawling" || shortRunning > 0) && <GoldDot size={6} />}
            {show.status}
          </span>
        </div>
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <PauseResumeButton
            showId={id}
            status={show.status}
            shortActive={shortPending + shortRunning}
          />
          <BulkOverviewButton
            showId={id}
            pendingCount={shortPending + shortFailed}
            runningCount={shortRunning}
            perCallUsd={shortPerCallUsd}
            estimateHistorical={shortEstimateHistorical}
            model={shortModel}
          />
          {!show.crawl_plan && <RestartButton showId={id} />}
          <a
            href={`/api/shows/${id}/export`}
            className="inline-flex items-center gap-1.5 text-ui-sm px-3 py-1.5 border border-[var(--border-color-soft)] rounded-md text-[var(--color-near-black)]/60 hover:text-[var(--color-blue)] hover:border-[var(--color-blue)]/50 transition-colors"
          >
            excel export
          </a>
          <Link
            href={`/shows/${id}/settings`}
            className="inline-flex items-center gap-1.5 text-ui-sm px-3 py-1.5 border border-[var(--border-color-soft)] rounded-md text-[var(--color-near-black)]/60 hover:text-[var(--color-blue)] hover:border-[var(--color-blue)]/50 transition-colors"
          >
            <SettingsIcon size={12} />
            einstellungen
          </Link>
        </div>
      </header>

      <UrlSearchBanner
        showId={id}
        status={
          ((show as { url_search_status?: string }).url_search_status ?? "idle") as UrlSearchStatus
        }
        sourceUrl={show.source_url ?? null}
        evidence={
          ((show as { url_search_evidence?: UrlSearchEvidence | null })
            .url_search_evidence ?? null) as UrlSearchEvidence | null
        }
      />

      {view === "aussteller" ? (
        <Suspense fallback={<AusstellerSkeleton />}>
          <AusstellerView showId={id} searchParams={sp} />
        </Suspense>
      ) : (
        <Suspense fallback={<ShowViewSkeleton />}>
          <ShowViewLoader
            view={view}
            showId={id}
            showStatus={show.status}
            showCurrentStep={show.current_step ?? null}
            errorMessage={show.error_message ?? null}
            crawlPlan={crawlPlan}
            exhibitors={exhibitorsForViews}
            browserSec={browserSec}
            shortModel={shortModel}
            deepModel={deepModel}
          />
        </Suspense>
      )}
    </>
  );
}

function AusstellerSkeleton() {
  return (
    <>
      <div className="flex gap-5 mb-6">
        <div className="h-9 flex-1 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
        <div className="h-9 w-32 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
      </div>
      <div className="border-t border-[var(--border-color-soft)]" />
      <ul className="mt-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i} className="box-line px-5 py-4 flex items-center gap-4">
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-1/2 bg-[var(--color-near-black)]/[0.08] animate-pulse" />
              <div className="h-3 w-3/4 bg-[var(--color-near-black)]/[0.05] animate-pulse" />
            </div>
            <div className="h-5 w-12 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
            <div className="h-5 w-16 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
            <div className="h-7 w-10 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
          </li>
        ))}
      </ul>
    </>
  );
}

async function AusstellerView({
  showId,
  searchParams,
}: {
  showId: string;
  searchParams: { q?: string; sector?: string; sort?: string; prio?: string; battery?: string };
}) {
  // Cached query: one DB hit per show per 60 s, shared across all filter combos.
  // Filtering + sorting happens in JS so the cache key stays show-scoped.
  const rows = await getCachedExhibitorList(showId);

  const q = searchParams.q?.toLowerCase() ?? "";
  const sortKey = searchParams.sort ?? "match";

  let enriched = rows.map((e) => ({
    id: e.id,
    company_name: e.company_name,
    website: e.website,
    booth: e.booth,
    short_status: e.short_status,
    deep_status: e.deep_status,
    current_step: e.current_step ?? null,
    one_liner: e.exhibitor_short?.one_liner ?? null,
    priority_label: e.exhibitor_short?.priority_label ?? null,
    isp_sector_match: (e.exhibitor_short?.isp_sector_match ?? []) as string[],
    match_confidence: e.exhibitor_short?.match_confidence ?? null,
    user_group: (e.exhibitor_short?.user_group ?? null) as string | null,
    battery_need: (e.exhibitor_short?.battery_need ?? null) as string | null,
  }));

  if (q) enriched = enriched.filter((e) => e.company_name.toLowerCase().includes(q));
  if (searchParams.sector)
    enriched = enriched.filter((e) => e.isp_sector_match.includes(searchParams.sector!));
  if (searchParams.prio)
    enriched = enriched.filter((e) => e.priority_label === searchParams.prio);
  if (searchParams.battery)
    enriched = enriched.filter((e) => e.battery_need === searchParams.battery);
  if (sortKey === "match")
    enriched.sort((a, b) => (b.match_confidence ?? -1) - (a.match_confidence ?? -1));

  return (
    <ExhibitorList
      exhibitors={enriched}
      showId={showId}
      sectors={ISP_CATALOG.sectors}
      currentQuery={searchParams.q ?? ""}
      currentSector={searchParams.sector ?? ""}
      currentSort={sortKey}
      currentPrio={searchParams.prio ?? ""}
      currentBattery={searchParams.battery ?? ""}
    />
  );
}
