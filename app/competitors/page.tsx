import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import { CompetitorsView, type CompetitorRow, type DiscoveryRun } from "./CompetitorsView";
import { CompetitorLogView } from "./CompetitorLogView";

export const dynamic = "force-dynamic";

type ViewParam = "konkurrenten" | "log";
const VIEWS: ViewParam[] = ["konkurrenten", "log"];
function parseView(v: string | undefined): ViewParam {
  return v && (VIEWS as string[]).includes(v) ? (v as ViewParam) : "konkurrenten";
}

type OverviewRow = {
  id: string;
  display_name: string;
  domain: string | null;
  website: string | null;
  hq_country: string | null;
  status: "suggested" | "active" | "archived" | "rejected";
  source_event: string | null;
  current_version_id: string | null;
  created_at: string;
  one_liner: string | null;
  positioning: string | null;
  isp_sector_match: string[] | null;
  threat_level: "low" | "medium" | "high" | null;
  version_count: number | null;
  customer_link_count: number | null;
  matched_customer_count: number | null;
  show_link_count: number | null;
};

type DiscoveryRunRow = {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  current_phase: string | null;
  model: string | null;
  candidates_total: number | null;
  candidates_kept: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  web_search_uses: number | null;
  web_search_cost_usd: number | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; run_id?: string }>;
}) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const supabase = await createClient();

  const { data: competitorsData, error: cErr } = await supabase
    .from("competitors_overview")
    .select(
      "id, display_name, domain, website, hq_country, status, source_event, current_version_id, created_at, one_liner, positioning, isp_sector_match, threat_level, version_count, customer_link_count, matched_customer_count, show_link_count",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (cErr) {
    return (
      <div className="text-body text-[var(--color-near-black)]/70">
        Fehler beim Laden der Wettbewerber: {cErr.message}
      </div>
    );
  }

  const { data: runsData } = await supabase
    .from("competitor_discovery_runs")
    .select(
      "id, status, current_phase, model, candidates_total, candidates_kept, tokens_in, tokens_out, web_search_uses, web_search_cost_usd, error_message, created_at, finished_at",
    )
    .order("created_at", { ascending: false })
    .limit(10);

  const competitors: CompetitorRow[] = ((competitorsData ?? []) as OverviewRow[]).map(
    (r) => ({
      id: r.id,
      display_name: r.display_name,
      domain: r.domain,
      website: r.website,
      hq_country: r.hq_country,
      status: r.status,
      source_event: r.source_event,
      one_liner: r.one_liner,
      isp_sector_match: r.isp_sector_match ?? [],
      threat_level: r.threat_level,
      version_count: r.version_count ?? 0,
      created_at: r.created_at,
    }),
  );

  const runs: DiscoveryRun[] = ((runsData ?? []) as DiscoveryRunRow[]).map((r) => ({
    id: r.id,
    status: r.status,
    current_phase: r.current_phase,
    model: r.model,
    candidates_total: r.candidates_total,
    candidates_kept: r.candidates_kept,
    web_search_uses: r.web_search_uses,
    web_search_cost_usd: r.web_search_cost_usd ? Number(r.web_search_cost_usd) : null,
    tokens_in: r.tokens_in,
    tokens_out: r.tokens_out,
    error_message: r.error_message,
    created_at: r.created_at,
    finished_at: r.finished_at,
  }));

  const totalCount = competitors.length;
  const suggestedCount = competitors.filter((c) => c.status === "suggested").length;
  const activeCount = competitors.filter((c) => c.status === "active").length;

  return (
    <>
      <div className="mb-6 text-meta">
        <Link
          href="/"
          className="hover:text-[var(--color-near-black)] transition-colors"
        >
          ← Sales Intelligence
        </Link>
      </div>

      <header className="mb-10">
        <h1 className="text-display">
          Konkurrenten<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          Auto-discovered Wettbewerber von ISP Power Systems. Claude recherchiert
          mit Web-Search den Markt, du kuratierst die Vorschlaege. Akzeptierte
          Konkurrenten landen in der Tier-Pipeline (Short / Deep) der zweiten Welle.
        </p>
        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          <span className="tabular-nums">{totalCount} gesamt</span>
          <span className="tabular-nums">{suggestedCount} vorgeschlagen</span>
          <span className="tabular-nums">{activeCount} aktiv</span>
        </div>
        <div className="mt-4">
          <p className="text-body-sm text-[var(--color-near-black)]/50">
            Discovery und Analyse werden ueber den Chat rechts gesteuert.
          </p>
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="flex items-center gap-1 border-b border-[var(--border-color-soft)] mb-8">
        {(
          [
            { key: "konkurrenten", label: "konkurrenten" },
            { key: "log", label: "log" },
          ] as Array<{ key: ViewParam; label: string }>
        ).map((tab) => (
          <Link
            key={tab.key}
            href={`/competitors${tab.key !== "konkurrenten" ? `?view=${tab.key}` : ""}`}
            className={`px-4 py-2 text-ui border-b-2 -mb-px transition-colors ${
              view === tab.key
                ? "border-[var(--color-near-black)] text-[var(--color-near-black)]"
                : "border-transparent text-[var(--color-near-black)]/45 hover:text-[var(--color-near-black)]/70"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {view === "log" ? (
        <CompetitorLogView runId={sp.run_id} />
      ) : (
        <CompetitorsView
          competitors={competitors}
          runs={runs}
          sectors={ISP_CATALOG.sectors}
        />
      )}
    </>
  );
}
