"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { List, type RowComponentProps } from "react-window";
import { Hairline } from "@/components/brand/Hairline";
import { GoldDot } from "@/components/brand/GoldDot";
import { useIsDesktop } from "@/lib/use-is-desktop";

type Exhibitor = {
  id: string;
  company_name: string;
  website: string | null;
  booth: string | null;
  short_status: string;
  deep_status: string;
  current_step: string | null;
  pre_filter_status: string | null;
  pre_filter_reason: string | null;
  one_liner: string | null;
  priority_label: string | null;
  isp_sector_match: string[];
  match_confidence: number | null;
  user_group: string | null;
  battery_need: string | null;
};

const BATTERY_NEED_LABELS: Record<string, string> = {
  sehr_hoch: "sehr hoch",
  hoch: "hoch",
  mittel: "mittel",
  gering: "gering",
  keiner: "keiner",
};

type Sector = { id: string; name: string; scope: string };

const PRIO_COLORS: Record<string, string> = {
  hoch: "border-[var(--color-gold)]/60 bg-[var(--color-gold)]/10 text-[var(--color-near-black)] font-semibold rounded-sm",
  mittel: "border-[var(--color-blue)]/40 bg-[var(--color-blue)]/5 text-[var(--color-near-black)]/80 rounded-sm",
  niedrig: "border-[var(--border-color-soft)] text-[var(--color-near-black)]/40 rounded-sm",
};

function scoreColor(score: number): string {
  if (score >= 8) return "var(--color-success)";
  if (score >= 5) return "var(--color-gold)";
  return "rgba(10,10,10,0.35)";
}

const ROW_HEIGHT_DESKTOP = 80;
const ROW_HEIGHT_MOBILE = 120;

export function ExhibitorList({
  exhibitors,
  showId,
  sectors,
  currentQuery,
  currentSector,
  currentSort,
  currentPrio,
  currentBattery,
}: {
  exhibitors: Exhibitor[];
  showId: string;
  sectors: readonly Sector[];
  currentQuery: string;
  currentSector: string;
  currentSort: string;
  currentPrio: string;
  currentBattery: string;
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
    !!currentBattery ||
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
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-meta mr-1">prio</span>
        <Chip label="alle" active={!currentPrio} onClick={() => update({ prio: null })} />
        <Chip label="hoch" active={currentPrio === "hoch"} onClick={() => update({ prio: "hoch" })} />
        <Chip label="mittel" active={currentPrio === "mittel"} onClick={() => update({ prio: "mittel" })} />
        <Chip label="niedrig" active={currentPrio === "niedrig"} onClick={() => update({ prio: "niedrig" })} />
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-meta mr-1">batterie</span>
        <Chip label="alle" active={!currentBattery} onClick={() => update({ battery: null })} />
        <Chip label="sehr hoch" active={currentBattery === "sehr_hoch"} onClick={() => update({ battery: "sehr_hoch" })} />
        <Chip label="hoch" active={currentBattery === "hoch"} onClick={() => update({ battery: "hoch" })} />
        <Chip label="mittel" active={currentBattery === "mittel"} onClick={() => update({ battery: "mittel" })} />
        <Chip label="gering" active={currentBattery === "gering"} onClick={() => update({ battery: "gering" })} />
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
            className="text-ui-sm px-3 py-1 border border-[var(--color-near-black)] rounded-sm text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] transition-colors ml-2"
            title="Suche, Sortierung, Prio- und Sektor-Filter zuruecksetzen"
          >
            filter loeschen
          </button>
        )}
      </div>

      <Hairline />
      {exhibitors.length === 0 ? (
        <div className="py-10 text-body text-[var(--color-near-black)]/50">
          keine aussteller gefunden
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
            rowCount={exhibitors.length}
            rowHeight={isDesktop ? ROW_HEIGHT_DESKTOP : ROW_HEIGHT_MOBILE}
            rowComponent={ExhibitorRow}
            rowProps={{ exhibitors, showId }}
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

type RowExtra = { exhibitors: Exhibitor[]; showId: string };

function ExhibitorRow({
  index,
  style,
  exhibitors,
  showId,
}: RowComponentProps<RowExtra>) {
  const e = exhibitors[index];
  const isFiltered = e.pre_filter_status === "filtered_out";

  const placeholder =
    e.short_status === "running"
      ? "wird analysiert"
      : e.short_status === "failed"
        ? "short fehlgeschlagen"
        : "noch keine einschaetzung";

  const subline = isFiltered
    ? (e.pre_filter_reason ?? "kein ISP-fit erkannt")
    : e.one_liner
      ? e.one_liner
      : null;

  return (
    <div style={style} className={`pb-2 pr-2 ${isFiltered ? "opacity-40" : ""}`}>
      <Link
        href={`/shows/${showId}/exhibitors/${e.id}`}
        className="block px-5 py-4 box-line rounded-lg hover:bg-[var(--color-near-black)]/[0.02] transition-colors"
      >
        {/* Desktop layout — 12-column grid */}
        <div className="hidden lg:grid grid-cols-12 gap-4 items-baseline">
          <div className="col-span-6">
            <div className="text-subtitle truncate">{e.company_name}</div>
            {subline ? (
              <div className="text-body-sm text-[var(--color-near-black)]/65 truncate">
                {subline}
              </div>
            ) : (
              <div className="text-meta">{placeholder}</div>
            )}
          </div>
          <div className="col-span-3 flex flex-wrap gap-1.5">
            {isFiltered ? (
              <span className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55">
                vor-filtert
              </span>
            ) : (
              <>
                {e.priority_label && (
                  <span
                    className={`text-meta-strong px-2 py-0.5 border ${
                      PRIO_COLORS[e.priority_label] ?? ""
                    }`}
                  >
                    {e.priority_label}
                  </span>
                )}
                {e.battery_need && e.battery_need !== "keiner" && (
                  <span
                    className="text-meta-strong px-2 py-0.5 border"
                    style={{
                      borderColor: e.battery_need === "sehr_hoch" ? "var(--color-gold)" : "var(--border-color-soft)",
                      color: e.battery_need === "sehr_hoch" ? "var(--color-gold)" : undefined,
                    }}
                  >
                    {BATTERY_NEED_LABELS[e.battery_need] ?? e.battery_need}
                  </span>
                )}
                {e.user_group && (
                  <span className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55">
                    {e.user_group}
                  </span>
                )}
                {e.deep_status === "done" && (
                  <span className="text-meta-strong px-2 py-0.5 border border-[var(--border-color)] text-[var(--color-near-black)]/70">
                    deep
                  </span>
                )}
              </>
            )}
          </div>
          <div className="col-span-2 text-right">
            {!isFiltered && e.match_confidence !== null ? (
              <span className="tabular-nums text-title">
                {e.match_confidence}
                <span style={{ color: scoreColor(e.match_confidence!) }}>.</span>
              </span>
            ) : !isFiltered ? (
              <span className="text-meta inline-flex items-center gap-1">
                {e.short_status === "running" && <GoldDot size={5} />}
                {e.short_status}
              </span>
            ) : null}
          </div>
          <div className="col-span-1 text-right text-meta truncate">
            {e.booth ?? ""}
          </div>
        </div>

        {/* Mobile layout — vertical stack */}
        <div className="lg:hidden flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-subtitle truncate min-w-0">{e.company_name}</div>
            {!isFiltered && (
              <div className="shrink-0 text-right">
                {e.match_confidence !== null ? (
                  <span className="tabular-nums text-title">
                    {e.match_confidence}
                    <span style={{ color: scoreColor(e.match_confidence!) }}>.</span>
                  </span>
                ) : (
                  <span className="text-meta inline-flex items-center gap-1">
                    {e.short_status === "running" && <GoldDot size={5} />}
                    {e.short_status}
                  </span>
                )}
              </div>
            )}
          </div>
          {subline ? (
            <div className="text-body-sm text-[var(--color-near-black)]/65 line-clamp-2">
              {subline}
            </div>
          ) : (
            <div className="text-meta">{placeholder}</div>
          )}
          <div className="flex flex-wrap gap-1.5 items-baseline">
            {isFiltered ? (
              <span className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55">
                vor-filtert
              </span>
            ) : (
              <>
                {e.priority_label && (
                  <span
                    className={`text-meta-strong px-2 py-0.5 border ${
                      PRIO_COLORS[e.priority_label] ?? ""
                    }`}
                  >
                    {e.priority_label}
                  </span>
                )}
                {e.battery_need && e.battery_need !== "keiner" && (
                  <span
                    className="text-meta-strong px-2 py-0.5 border"
                    style={{
                      borderColor: e.battery_need === "sehr_hoch" ? "var(--color-gold)" : "var(--border-color-soft)",
                      color: e.battery_need === "sehr_hoch" ? "var(--color-gold)" : undefined,
                    }}
                  >
                    {BATTERY_NEED_LABELS[e.battery_need] ?? e.battery_need}
                  </span>
                )}
                {e.user_group && (
                  <span className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55">
                    {e.user_group}
                  </span>
                )}
                {e.deep_status === "done" && (
                  <span className="text-meta-strong px-2 py-0.5 border border-[var(--border-color)] text-[var(--color-near-black)]/70">
                    deep
                  </span>
                )}
              </>
            )}
            {e.booth && (
              <span className="ml-auto text-meta truncate">{e.booth}</span>
            )}
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
      className={`text-ui-sm px-3 py-1 border rounded-sm transition-colors ${
        active
          ? "border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.06] text-[var(--color-near-black)] font-semibold"
          : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-near-black)] hover:border-[var(--border-color)]"
      }`}
    >
      {label}
    </button>
  );
}
