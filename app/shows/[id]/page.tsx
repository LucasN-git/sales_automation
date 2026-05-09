import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import { ExhibitorList } from "./ExhibitorList";

export const dynamic = "force-dynamic";

export default async function ShowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; sector?: string; sort?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: show } = await supabase
    .from("trade_shows")
    .select("id, name, source_url, year, status, created_at")
    .eq("id", id)
    .single();

  if (!show) notFound();

  let query = supabase
    .from("exhibitors")
    .select(
      "id, company_name, website, booth, enrichment_status, exhibitor_intel(business_field, isp_sector_match, match_confidence, pitch_hook)",
    )
    .eq("trade_show_id", id);

  if (sp.q) {
    query = query.ilike("company_name", `%${sp.q}%`);
  }
  if (sp.sector) {
    query = query.contains("exhibitor_intel.isp_sector_match", [sp.sector]);
  }

  const sortKey = sp.sort ?? "match";
  if (sortKey === "name") {
    query = query.order("company_name", { ascending: true });
  } else {
    query = query.order("company_name", { ascending: true });
  }

  const { data: exhibitors } = await query;

  const enriched = (exhibitors ?? []).map((e: any) => ({
    id: e.id,
    company_name: e.company_name,
    website: e.website,
    booth: e.booth,
    enrichment_status: e.enrichment_status,
    business_field: e.exhibitor_intel?.business_field ?? null,
    isp_sector_match: (e.exhibitor_intel?.isp_sector_match ?? []) as string[],
    match_confidence: e.exhibitor_intel?.match_confidence ?? null,
    pitch_hook: e.exhibitor_intel?.pitch_hook ?? null,
  }));

  if (sortKey === "match") {
    enriched.sort(
      (a, b) => (b.match_confidence ?? -1) - (a.match_confidence ?? -1),
    );
  }

  const totalCount = enriched.length;
  const doneCount = enriched.filter((e) => e.enrichment_status === "done").length;
  const stillRunning =
    show.status === "queued" ||
    show.status === "crawling" ||
    enriched.some(
      (e) => e.enrichment_status === "pending" || e.enrichment_status === "running",
    );

  return (
    <main className="min-h-screen px-8 py-12 max-w-6xl mx-auto">
      {stillRunning && <AutoRefresh intervalMs={5000} />}
      <div className="mb-8 text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/50">
        <Link href="/" className="hover:text-[var(--color-near-black)]">
          ← Sales Intelligence
        </Link>
      </div>

      <header className="mb-12">
        <h1 className="text-[48px] leading-[1.05] font-extrabold tracking-[-0.02em]">
          {show.name}
          {show.status === "crawling" && (
            <span style={{ color: "var(--color-gold)" }}>.</span>
          )}
        </h1>
        <div className="mt-3 flex items-center gap-4 text-[15px] text-[var(--color-near-black)]/70">
          {show.year && <span>{show.year}</span>}
          {show.source_url && (
            <a
              href={show.source_url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-[var(--color-near-black)]"
            >
              Quelle
            </a>
          )}
          <span className="tabular-nums">
            {doneCount}/{totalCount} angereichert
          </span>
          <span className="inline-flex items-center gap-2 uppercase tracking-[0.06em] text-[13px]">
            {show.status === "crawling" && <GoldDot size={6} />}
            {show.status}
          </span>
        </div>
      </header>

      <ExhibitorList
        exhibitors={enriched}
        showId={id}
        sectors={ISP_CATALOG.sectors}
        currentQuery={sp.q ?? ""}
        currentSector={sp.sector ?? ""}
        currentSort={sortKey}
      />
    </main>
  );
}
