import { createClient } from "@/lib/supabase/server";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import { CompaniesList, type CompanyRow } from "@/components/CompaniesList";
import { AddCompanyForm } from "./AddCompanyForm";

export const dynamic = "force-dynamic";

type OverviewRow = {
  id: string;
  display_name: string;
  domain: string | null;
  show_count: number;
  shows: Array<{ id: string; name: string }> | null;
  best_match_confidence: number | null;
  best_priority: string | null;
  union_sectors: string[] | null;
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sector?: string; sort?: string; prio?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("companies_overview")
    .select(
      "id, display_name, domain, show_count, shows, best_match_confidence, best_priority, union_sectors",
    );

  if (sp.q) query = query.ilike("display_name", `%${sp.q}%`);
  if (sp.sector) query = query.contains("union_sectors", [sp.sector]);
  if (sp.prio) query = query.eq("best_priority", sp.prio);

  const sortKey = sp.sort ?? "match";
  query = query.order("display_name", { ascending: true });

  const { data: rows, error } = await query;
  if (error) {
    return (
      <div className="text-body text-[var(--color-near-black)]/70">
        Fehler beim Laden: {error.message}
      </div>
    );
  }

  const companies: CompanyRow[] = ((rows ?? []) as OverviewRow[]).map((r) => ({
    id: r.id,
    display_name: r.display_name,
    domain: r.domain,
    show_count: r.show_count ?? 0,
    shows: r.shows ?? [],
    best_priority: r.best_priority,
    best_match_confidence: r.best_match_confidence,
    union_sectors: r.union_sectors ?? [],
  }));

  if (sortKey === "match") {
    companies.sort(
      (a, b) => (b.best_match_confidence ?? -1) - (a.best_match_confidence ?? -1),
    );
  } else if (sortKey === "shows") {
    companies.sort((a, b) => b.show_count - a.show_count);
  }

  const totalCount = companies.length;
  const hotCount = companies.filter((c) => c.best_priority === "hoch").length;
  const multiShowCount = companies.filter((c) => c.show_count > 1).length;

  return (
    <>
      <header className="mb-10">
        <h1 className="text-display">
          Unternehmen<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          Deduplizierte Firmen-Liste uber alle Messen. Eine Firma taucht hier nur einmal auf.
        </p>
        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          <span className="tabular-nums">{totalCount} firmen</span>
          <span className="tabular-nums">{hotCount} hoch-prio</span>
          <span className="tabular-nums">{multiShowCount} auf mehreren messen</span>
        </div>
        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <AddCompanyForm />
          {totalCount > 0 && (
            <a
              href="/api/companies/export"
              className="inline-flex items-center gap-2 px-3 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] transition-all duration-150 origin-center"
            >
              excel export
            </a>
          )}
        </div>
      </header>

      <CompaniesList
        companies={companies}
        sectors={ISP_CATALOG.sectors}
        currentQuery={sp.q ?? ""}
        currentSector={sp.sector ?? ""}
        currentSort={sortKey}
        currentPrio={sp.prio ?? ""}
      />
    </>
  );
}
