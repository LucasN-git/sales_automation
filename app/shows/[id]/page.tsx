import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import { ExhibitorList } from "./ExhibitorList";
import { RestartButton } from "./RestartButton";
import { PauseResumeButton } from "./PauseResumeButton";
import { BulkOverviewButton } from "./BulkOverviewButton";
import { CrawlPlanOverride } from "./CrawlPlanOverride";

export const dynamic = "force-dynamic";

export default async function ShowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; sector?: string; sort?: string; prio?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: show } = await supabase
    .from("trade_shows")
    .select(
      "id, name, source_url, year, status, expected_exhibitor_count, error_message, created_at, crawl_plan",
    )
    .eq("id", id)
    .single();

  if (!show) notFound();

  let query = supabase
    .from("exhibitors")
    .select(
      "id, company_name, website, booth, short_status, deep_status, current_step, exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match)",
    )
    .eq("trade_show_id", id);

  if (sp.q) {
    query = query.ilike("company_name", `%${sp.q}%`);
  }
  if (sp.sector) {
    query = query.contains("exhibitor_short.isp_sector_match", [sp.sector]);
  }

  const sortKey = sp.sort ?? "match";
  query = query.order("company_name", { ascending: true });

  const { data: exhibitors } = await query;

  let enriched = (exhibitors ?? []).map((e: any) => ({
    id: e.id,
    company_name: e.company_name,
    website: e.website,
    booth: e.booth,
    short_status: e.short_status as string,
    deep_status: e.deep_status as string,
    current_step: e.current_step ?? null,
    one_liner: e.exhibitor_short?.one_liner ?? null,
    priority_label: e.exhibitor_short?.priority_label ?? null,
    isp_sector_match: (e.exhibitor_short?.isp_sector_match ?? []) as string[],
    match_confidence: e.exhibitor_short?.match_confidence ?? null,
  }));

  if (sp.prio) {
    enriched = enriched.filter((e) => e.priority_label === sp.prio);
  }

  if (sortKey === "match") {
    enriched.sort((a, b) => (b.match_confidence ?? -1) - (a.match_confidence ?? -1));
  }

  const allCount = (exhibitors ?? []).length;
  const shortDone = (exhibitors ?? []).filter((e: any) => e.short_status === "done").length;
  const shortRunning = (exhibitors ?? []).filter(
    (e: any) => e.short_status === "running",
  ).length;
  const shortPending = (exhibitors ?? []).filter(
    (e: any) => e.short_status === "pending",
  ).length;
  const shortFailed = (exhibitors ?? []).filter(
    (e: any) => e.short_status === "failed",
  ).length;

  return (
    <>
      <div className="mb-6 text-meta">
        <Link href="/" className="hover:text-[var(--color-near-black)] transition-colors">
          ← Sales Intelligence
        </Link>
      </div>

      <header className="mb-10">
        <h1 className="text-display">
          {show.name}
          {(show.status === "crawling" || shortRunning > 0) && (
            <span style={{ color: "var(--color-gold)" }}>.</span>
          )}
        </h1>
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
          <span className="tabular-nums">short {shortDone}/{allCount}</span>
          <span className="inline-flex items-center gap-2">
            {(show.status === "crawling" || shortRunning > 0) && <GoldDot size={6} />}
            {show.status}
          </span>
        </div>
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <PauseResumeButton showId={id} status={show.status} />
          <BulkOverviewButton
            showId={id}
            pendingCount={shortPending + shortFailed}
            runningCount={shortRunning}
          />
          {!show.crawl_plan && <RestartButton showId={id} />}
          <Link
            href={`/shows/${id}/settings`}
            className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)] transition-colors"
          >
            einstellungen
          </Link>
        </div>
      </header>

      {show.crawl_plan ? (
        <CrawlPlanOverride
          showId={id}
          plan={show.crawl_plan as Record<string, unknown>}
        />
      ) : null}

      <ExhibitorList
        exhibitors={enriched}
        showId={id}
        sectors={ISP_CATALOG.sectors}
        currentQuery={sp.q ?? ""}
        currentSector={sp.sector ?? ""}
        currentSort={sortKey}
        currentPrio={sp.prio ?? ""}
      />
    </>
  );
}
