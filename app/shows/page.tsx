import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FavoriteToggle } from "@/components/FavoriteToggle";
import { BriefcaseIcon, ArrowRight } from "@/components/brand/Icons";
import { NewShowForm } from "../NewShowForm";

export const dynamic = "force-dynamic";

type TradeShowRow = {
  id: string;
  name: string;
  source_url: string | null;
  year: number | null;
  status: string;
  created_at: string;
  is_favorite: boolean;
  exhibitor_count: number;
};

type DiscoveryRow = {
  id: string;
  run_id: string;
  name: string;
  website: string | null;
  location_city: string | null;
  location_country: string | null;
  dates_raw: string | null;
  relevance_score: number | null;
  isp_sector_match: string[] | null;
  focus_description: string | null;
  relevance_reasoning: string | null;
  added_trade_show_id: string | null;
  exhibitor_list_url: string | null;
  exhibitor_list_available: boolean | null;
};

function normalizeWebsite(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").toLowerCase();
}

function deduplicateDiscoveryRows(rows: DiscoveryRow[]): DiscoveryRow[] {
  // Keep highest-score entry per unique domain/name key.
  const sorted = [...rows].sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0));
  const seen = new Set<string>();
  return sorted.filter((r) => {
    const key = normalizeWebsite(r.website) ?? r.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function ShowsListPage() {
  const supabase = await createClient();

  const [showsResult, discoveryResult] = await Promise.all([
    supabase
      .from("trade_shows")
      .select("id, name, source_url, year, status, created_at, is_favorite, exhibitors(count)")
      .order("created_at", { ascending: false }),
    // Only shows the user explicitly chose from search results (added_trade_show_id set).
    supabase
      .from("show_discovery_results")
      .select(
        "id, run_id, name, website, location_city, location_country, dates_raw, relevance_score, isp_sector_match, focus_description, relevance_reasoning, added_trade_show_id, exhibitor_list_url, exhibitor_list_available",
      )
      .not("added_trade_show_id", "is", null)
      .order("relevance_score", { ascending: false }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows: TradeShowRow[] = ((showsResult.data ?? []) as any[]).map((s) => ({
    id: s.id,
    name: s.name,
    source_url: s.source_url,
    year: s.year,
    status: s.status,
    created_at: s.created_at,
    is_favorite: Boolean(s.is_favorite),
    exhibitor_count: s.exhibitors?.[0]?.count ?? 0,
  }));

  const discoveryRows: DiscoveryRow[] = (discoveryResult.data ?? []) as DiscoveryRow[];
  // Deduplicate by domain in case the same show was found in multiple runs.
  const discoveryResults = deduplicateDiscoveryRows(discoveryRows);

  // Build lookup for trade show status by ID (for confirmed discovery rows).
  const tradeShowById = new Map(allRows.map((r) => [r.id, r]));

  // Exclude discovery-added shows from the manual section.
  const discoveryAddedIds = new Set(discoveryRows.map((r) => r.added_trade_show_id as string));
  const manualRows = allRows.filter((r) => !discoveryAddedIds.has(r.id));

  const anyActive = allRows.some(
    (r) => r.status === "queued" || r.status === "crawling",
  );

  return (
    <>
      {anyActive && <AutoRefresh intervalMs={6000} />}
      <header className="mb-10">
        <h1 className="text-display">
          Messen<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          Erfasste Industriemessen mit Crawl-Status und Aussteller-Counts.
        </p>
      </header>

      <div className="flex items-center gap-4">
        <NewShowForm />
        <Link
          href="/shows/search"
          className="inline-flex items-center gap-2 px-5 py-3 text-body-sm font-semibold border border-[var(--color-near-black)]/35 text-[var(--color-near-black)]/65 hover:border-[var(--color-near-black)] hover:text-[var(--color-near-black)] transition-all duration-150"
        >
          messen suchen
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 shrink-0"
            style={{ background: "var(--color-gold)", opacity: 0.6 }}
          />
        </Link>
      </div>

      {/* Section 1: Manually added shows */}
      <section className="mt-14">
        <h2 className="text-meta-strong mb-4">manuell erfasst</h2>

        {manualRows.length === 0 ? (
          <div className="py-10 text-body text-[var(--color-near-black)]/50 box-line px-5">
            noch keine messen manuell erfasst
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {manualRows.map((s) => {
              const date = new Date(s.created_at).toLocaleDateString("de-DE");
              return (
                <Link
                  key={s.id}
                  href={`/shows/${s.id}`}
                  className="card-surface group flex flex-col px-5 py-5 transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <BriefcaseIcon size={16} className="text-[var(--color-near-black)]/45 mt-0.5" />
                    <ArrowRight size={13} className="text-[var(--color-near-black)]/30 group-hover:text-[var(--color-near-black)]/70 transition-colors" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-subtitle font-semibold leading-snug block">{s.name}</span>
                    {s.year && (
                      <span className="text-meta text-[var(--color-near-black)]/50 mt-0.5 block">{s.year}</span>
                    )}
                  </div>
                  <div className="mt-4 pt-3 border-t border-[var(--border-color-soft)] flex items-center justify-between gap-3">
                    <span className="text-meta tabular-nums text-[var(--color-near-black)]/45">{date}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-meta-strong">{s.exhibitor_count} aussteller</span>
                      <StatusBadge status={s.status} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Shows explicitly chosen from search results */}
      {discoveryResults.length > 0 && (
        <section className="mt-14">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-meta-strong">entdeckt</h2>
            <span className="text-meta text-[var(--color-near-black)]/40">
              {discoveryResults.length} aus suche hinzugefuegt
            </span>
          </div>

          <ul className="space-y-2">
            {discoveryResults.map((r) => {
              const score = r.relevance_score ?? 0;
              const scoreColor =
                score >= 8
                  ? "var(--color-gold)"
                  : score >= 5
                  ? "var(--color-near-black)"
                  : "rgba(10,10,10,0.4)";
              const locationParts = [r.location_city, r.location_country]
                .filter(Boolean)
                .join(", ");
              const tradeShow = tradeShowById.get(r.added_trade_show_id!);

              return (
                <li key={r.id} className="relative">
                  <Link
                    href={`/shows/${r.added_trade_show_id}`}
                    className="block px-5 py-4 pr-14 box-line hover:bg-[var(--color-near-black)]/[0.02] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex items-start gap-4 min-w-0">
                        <span
                          className="text-meta-strong shrink-0 tabular-nums pt-px"
                          style={{ color: scoreColor }}
                        >
                          {score}/10
                        </span>
                        <div className="min-w-0">
                          <span className="text-title block">{r.name}</span>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                            {locationParts && (
                              <span className="text-meta text-[var(--color-near-black)]/55">
                                {locationParts}
                              </span>
                            )}
                            {r.dates_raw && (
                              <span className="text-meta text-[var(--color-near-black)]/55">
                                {r.dates_raw}
                              </span>
                            )}
                            {r.isp_sector_match && r.isp_sector_match.length > 0 && (
                              <span className="text-meta text-[var(--color-near-black)]/40">
                                {r.isp_sector_match.join(" · ")}
                              </span>
                            )}
                          </div>
                          {r.focus_description && (
                            <p className="text-body-sm text-[var(--color-near-black)]/65 mt-1.5 leading-snug">
                              {r.focus_description}
                            </p>
                          )}
                        </div>
                      </div>
                      {tradeShow && (
                        <div className="flex items-center gap-6 shrink-0 self-start pt-px">
                          <span className="text-meta-strong">
                            {tradeShow.exhibitor_count} aussteller
                          </span>
                          <StatusBadge status={tradeShow.status} />
                        </div>
                      )}
                    </div>
                  </Link>
                  {tradeShow && (
                    <div className="absolute top-1/2 right-3 -translate-y-1/2">
                      <FavoriteToggle
                        showId={tradeShow.id}
                        initialFavorite={tradeShow.is_favorite}
                        size={16}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    queued: "wartet",
    crawling: "laeuft",
    paused: "pausiert",
    ready: "fertig",
    partial: "teilweise",
    failed: "fehler",
  };
  const isActive = status === "crawling";
  return (
    <span className="inline-flex items-center gap-2 text-meta-strong">
      {isActive && <GoldDot size={6} />}
      {labels[status] ?? status}
    </span>
  );
}
