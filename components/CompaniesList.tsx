"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { List, type RowComponentProps } from "react-window";
import { Hairline } from "@/components/brand/Hairline";
import { useIsDesktop } from "@/lib/use-is-desktop";

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

const PRIO_COLORS: Record<string, string> = {
  hoch: "border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold",
  mittel: "border-[var(--color-near-black)]/60 text-[var(--color-near-black)]/80",
  niedrig: "border-[var(--color-hairline-light)] text-[var(--color-near-black)]/40",
};

const ROW_HEIGHT_DESKTOP = 84;
const ROW_HEIGHT_MOBILE = 124;

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
  const [, startTransition] = useTransition();
  const isDesktop = useIsDesktop();

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

  const hasFilters =
    !!currentQuery ||
    !!currentSector ||
    !!currentPrio ||
    (currentSort && currentSort !== "match");

  function clearFilters() {
    setQ("");
    startTransition(() => {
      router.replace(pathname);
    });
  }

  return (
    <>
      <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-5 mb-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") update({ q });
          }}
          onBlur={() => update({ q })}
          placeholder="firmen-name suchen"
          className="flex-1 bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        />
        <select
          value={currentSort}
          onChange={(e) => update({ sort: e.target.value })}
          className="bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-ui focus:outline-none"
        >
          <option value="match">nach match</option>
          <option value="name">nach name</option>
          <option value="shows">nach messen</option>
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-meta mr-1">prio</span>
        <Chip label="alle" active={!currentPrio} onClick={() => update({ prio: null })} />
        <Chip label="hoch" active={currentPrio === "hoch"} onClick={() => update({ prio: "hoch" })} />
        <Chip label="mittel" active={currentPrio === "mittel"} onClick={() => update({ prio: "mittel" })} />
        <Chip label="niedrig" active={currentPrio === "niedrig"} onClick={() => update({ prio: "niedrig" })} />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-6">
        <span className="text-meta mr-1">sektor</span>
        <Chip label="alle" active={!currentSector} onClick={() => update({ sector: null })} />
        {sectors.map((s) => (
          <Chip
            key={s.id}
            label={s.name.toLowerCase()}
            active={currentSector === s.id}
            onClick={() => update({ sector: s.id })}
          />
        ))}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-ui-sm px-3 py-1 border border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] transition-colors ml-2"
            title="Suche, Sortierung, Prio- und Sektor-Filter zuruecksetzen"
          >
            filter loeschen
          </button>
        )}
      </div>

      <Hairline />
      {companies.length === 0 ? (
        <div className="py-10 text-body text-[var(--color-near-black)]/50">
          keine firmen gefunden
        </div>
      ) : (
        <div
          className="mt-4 isp-list-scroll"
          style={{
            height: isDesktop ? "calc(100vh - 220px)" : "calc(100vh - 320px)",
            minHeight: 320,
          }}
        >
          <List
            key={isDesktop ? "d" : "m"}
            rowCount={companies.length}
            rowHeight={isDesktop ? ROW_HEIGHT_DESKTOP : ROW_HEIGHT_MOBILE}
            rowComponent={CompanyRowRow}
            rowProps={{ companies }}
            defaultHeight={600}
            overscanCount={4}
            style={{ height: "100%" }}
            className="isp-list-scroll"
          />
        </div>
      )}
    </>
  );
}

type RowExtra = { companies: CompanyRow[] };

function CompanyRowRow({
  index,
  style,
  companies,
}: RowComponentProps<RowExtra>) {
  const c = companies[index];
  const showsLabel =
    c.shows.length === 0
      ? null
      : c.shows.length <= 2
        ? c.shows.map((s) => s.name).join(" · ")
        : `${c.shows.length} messen`;

  return (
    <div style={style} className="pb-2 pr-2">
      <Link
        href={`/companies/${c.id}`}
        className="block px-5 py-4 box-line hover:bg-[var(--color-near-black)]/[0.02] transition-colors"
      >
        {/* Desktop layout — unchanged 12-column grid */}
        <div className="hidden lg:grid grid-cols-12 gap-4 items-baseline">
          <div className="col-span-6">
            <div className="text-subtitle truncate">{c.display_name}</div>
            <div className="text-meta truncate">
              {c.domain ? c.domain : "(keine domain)"}
              {showsLabel && <span> · {showsLabel}</span>}
            </div>
          </div>
          <div className="col-span-3 flex flex-wrap gap-1.5">
            {c.best_priority && (
              <span
                className={`text-meta-strong px-2 py-0.5 border ${
                  PRIO_COLORS[c.best_priority] ?? ""
                }`}
              >
                {c.best_priority}
              </span>
            )}
            {c.union_sectors.slice(0, 2).map((s) => (
              <span
                key={s}
                className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55"
              >
                {s.replace("_", " ")}
              </span>
            ))}
          </div>
          <div className="col-span-2 text-right">
            {c.best_match_confidence !== null ? (
              <span className="tabular-nums text-title">
                {c.best_match_confidence}
                <span style={{ color: "var(--color-gold)" }}>.</span>
              </span>
            ) : (
              <span className="text-meta">—</span>
            )}
          </div>
          <div className="col-span-1 text-right text-meta tabular-nums">
            {c.show_count}×
          </div>
        </div>

        {/* Mobile layout — vertical stack */}
        <div className="lg:hidden flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-subtitle truncate min-w-0">{c.display_name}</div>
            <div className="shrink-0 text-right">
              {c.best_match_confidence !== null ? (
                <span className="tabular-nums text-title">
                  {c.best_match_confidence}
                  <span style={{ color: "var(--color-gold)" }}>.</span>
                </span>
              ) : (
                <span className="text-meta">—</span>
              )}
            </div>
          </div>
          <div className="text-meta truncate">
            {c.domain ? c.domain : "(keine domain)"}
            {showsLabel && <span> · {showsLabel}</span>}
          </div>
          <div className="flex flex-wrap gap-1.5 items-baseline">
            {c.best_priority && (
              <span
                className={`text-meta-strong px-2 py-0.5 border ${
                  PRIO_COLORS[c.best_priority] ?? ""
                }`}
              >
                {c.best_priority}
              </span>
            )}
            {c.union_sectors.slice(0, 2).map((s) => (
              <span
                key={s}
                className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55"
              >
                {s.replace("_", " ")}
              </span>
            ))}
            <span className="ml-auto text-meta tabular-nums">{c.show_count}×</span>
          </div>
        </div>
      </Link>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-ui-sm px-3 py-1 border transition-colors ${
        active
          ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
          : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)]"
      }`}
    >
      {label}
    </button>
  );
}
