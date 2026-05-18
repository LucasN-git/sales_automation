"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition, useMemo } from "react";
import { ArrowRight } from "@/components/brand/Icons";

export type CompanyRow = {
  id: string;
  display_name: string;
  domain: string | null;
  show_count: number;
  shows: Array<{ id: string; name: string }>;
  best_priority: string | null;
  best_match_confidence: number | null;
  union_sectors: string[];
};

type Sector = { id: string; name: string; scope: string };

type PrioFilter = "all" | "hoch" | "mittel" | "niedrig";

const PRIO_TABS: Array<{ key: PrioFilter; label: string }> = [
  { key: "hoch", label: "hoch" },
  { key: "mittel", label: "mittel" },
  { key: "niedrig", label: "niedrig" },
  { key: "all", label: "alle" },
];

const PRIO_BADGE: Record<string, string> = {
  hoch: "border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold",
  mittel: "border-[var(--color-near-black)]/60 text-[var(--color-near-black)]/80",
  niedrig: "border-[var(--color-hairline-light)] text-[var(--color-near-black)]/40",
};

export function CompaniesList({
  companies,
  sectors,
  currentQuery,
  currentSector,
  currentSort,
  currentPrio,
}: {
  companies: CompanyRow[];
  sectors: readonly Sector[];
  currentQuery: string;
  currentSector: string;
  currentSort: string;
  currentPrio: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(currentQuery);
  const [sectorFilter, setSectorFilter] = useState(currentSector || null);
  const [prioFilter, setPrioFilter] = useState<PrioFilter>(
    (currentPrio as PrioFilter) || "all",
  );
  const [, startTransition] = useTransition();

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    });
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`);
    });
  }

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      if (prioFilter !== "all" && c.best_priority !== prioFilter) return false;
      if (sectorFilter && !c.union_sectors.includes(sectorFilter)) return false;
      if (q.trim()) {
        const needle = q.trim().toLowerCase();
        const hay = [c.display_name, c.domain ?? ""].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [companies, prioFilter, sectorFilter, q]);

  const counts = useMemo(() => {
    const c: Record<PrioFilter, number> = { hoch: 0, mittel: 0, niedrig: 0, all: 0 };
    for (const x of companies) {
      c.all++;
      if (x.best_priority === "hoch") c.hoch++;
      else if (x.best_priority === "mittel") c.mittel++;
      else if (x.best_priority === "niedrig") c.niedrig++;
    }
    return c;
  }, [companies]);

  const hasActiveFilter = prioFilter !== "all" || !!sectorFilter || !!q.trim();

  function clearAll() {
    setQ("");
    setSectorFilter(null);
    setPrioFilter("all");
    startTransition(() => router.replace(pathname));
  }

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex flex-wrap gap-1">
          {PRIO_TABS.map((tab) => {
            const active = prioFilter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setPrioFilter(tab.key)}
                className={`px-3 py-2 text-body-sm border transition-colors ${
                  active
                    ? "border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.04] text-[var(--color-near-black)] font-semibold"
                    : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/70 hover:border-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)]"
                }`}
              >
                {tab.label}
                <span className="ml-2 tabular-nums opacity-60">{counts[tab.key]}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-[180px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="firmen-name suchen"
            className="w-full bg-transparent border border-[var(--border-color-soft)] px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
          />
        </div>

        <select
          value={sectorFilter ?? ""}
          onChange={(e) => setSectorFilter(e.target.value || null)}
          className="bg-transparent border border-[var(--border-color-soft)] px-3 py-2 text-body-sm focus:outline-none focus:border-[var(--color-near-black)]"
        >
          <option value="">sektor (alle)</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          value={currentSort}
          onChange={(e) => update({ sort: e.target.value })}
          className="bg-transparent border border-[var(--border-color-soft)] px-3 py-2 text-body-sm focus:outline-none focus:border-[var(--color-near-black)]"
        >
          <option value="match">nach match</option>
          <option value="name">nach name</option>
          <option value="shows">nach messen</option>
        </select>

        {hasActiveFilter && (
          <button
            onClick={clearAll}
            className="text-ui-sm px-3 py-2 border border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] transition-colors"
          >
            filter loeschen
          </button>
        )}
      </div>

      {/* Result count */}
      {hasActiveFilter && (
        <p className="text-meta mb-4 tabular-nums">
          {filtered.length} von {companies.length} firmen
        </p>
      )}

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="py-10 text-body text-[var(--color-near-black)]/55 box-line px-5">
          keine firmen in dieser ansicht.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <CompanyCard key={c.id} company={c} />
          ))}
        </div>
      )}
    </>
  );
}

function CompanyCard({ company: c }: { company: CompanyRow }) {
  const showsLabel =
    c.shows.length === 0
      ? null
      : c.shows.length <= 2
        ? c.shows.map((s) => s.name).join(" · ")
        : `${c.shows.length} messen`;

  const scoreColor =
    c.best_match_confidence === null
      ? null
      : c.best_match_confidence >= 8
        ? "var(--color-success)"
        : c.best_match_confidence >= 5
          ? "var(--color-gold)"
          : "rgba(10,10,10,0.35)";

  return (
    <Link href={`/companies/${c.id}`} className="card-surface group flex flex-col">
      <div className="flex-1 px-5 pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <span className="text-meta tabular-nums text-[var(--color-near-black)]/40">
            {c.show_count === 1 ? "1 messe" : `${c.show_count} messen`}
          </span>
          <ArrowRight
            size={13}
            className="text-[var(--color-near-black)]/30 group-hover:text-[var(--color-near-black)]/70 transition-colors"
          />
        </div>

        <span className="text-subtitle font-semibold leading-snug block">
          {c.display_name}
        </span>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {c.domain && (
            <span className="text-meta text-[var(--color-near-black)]/55">{c.domain}</span>
          )}
          {showsLabel && (
            <span className="text-meta text-[var(--color-near-black)]/40">{showsLabel}</span>
          )}
        </div>

        {c.union_sectors.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
            {c.union_sectors.slice(0, 3).map((s) => (
              <span key={s} className="text-meta text-[var(--color-near-black)]/40">
                {s.replace("_", " ")}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 pb-4 pt-3 border-t border-[var(--border-color-soft)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {c.best_priority && (
            <span
              className={`text-meta-strong px-2 py-0.5 border ${PRIO_BADGE[c.best_priority] ?? ""}`}
            >
              {c.best_priority}
            </span>
          )}
        </div>

        {c.best_match_confidence !== null && (
          <span className="tabular-nums text-title shrink-0" style={{ color: scoreColor ?? undefined }}>
            {c.best_match_confidence}
            <span style={{ color: "var(--color-gold)" }}>.</span>
          </span>
        )}
      </div>
    </Link>
  );
}
