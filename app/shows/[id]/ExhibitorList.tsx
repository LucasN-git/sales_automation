"use client";

import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Hairline } from "@/components/brand/Hairline";
import { GoldDot } from "@/components/brand/GoldDot";

type Exhibitor = {
  id: string;
  company_name: string;
  website: string | null;
  booth: string | null;
  short_status: string;
  deep_status: string;
  current_step: string | null;
  one_liner: string | null;
  priority_label: string | null;
  isp_sector_match: string[];
  match_confidence: number | null;
};

type Sector = { id: string; name: string; scope: string };

const PRIO_COLORS: Record<string, string> = {
  hot: "border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold",
  warm: "border-[var(--color-near-black)]/60 text-[var(--color-near-black)]/80",
  cold: "border-[var(--color-hairline-light)] text-[var(--color-near-black)]/40",
};

export function ExhibitorList({
  exhibitors,
  showId,
  sectors,
  currentQuery,
  currentSector,
  currentSort,
  currentPrio,
}: {
  exhibitors: Exhibitor[];
  showId: string;
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
          className="flex-1 bg-transparent border-0 border-b border-[var(--border-color-soft)] py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        />
        <select
          value={currentSort}
          onChange={(e) => update({ sort: e.target.value })}
          className="bg-transparent border-0 border-b border-[var(--border-color-soft)] py-2 text-ui focus:outline-none"
        >
          <option value="match">nach match</option>
          <option value="name">nach name</option>
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-meta mr-1">prio</span>
        <Chip label="alle" active={!currentPrio} onClick={() => update({ prio: null })} />
        <Chip label="hot" active={currentPrio === "hot"} onClick={() => update({ prio: "hot" })} />
        <Chip label="warm" active={currentPrio === "warm"} onClick={() => update({ prio: "warm" })} />
        <Chip label="cold" active={currentPrio === "cold"} onClick={() => update({ prio: "cold" })} />
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
      </div>

      <Hairline />
      {exhibitors.length === 0 ? (
        <div className="py-10 text-body text-[var(--color-near-black)]/50">
          keine aussteller gefunden
        </div>
      ) : (
        <ul className="space-y-2 mt-4">
          {exhibitors.map((e) => (
            <li key={e.id}>
              <Link
                href={`/shows/${showId}/exhibitors/${e.id}`}
                className="block px-5 py-4 box-line hover:bg-[var(--color-near-black)]/[0.02] transition-colors"
              >
                <div className="grid grid-cols-12 gap-4 items-baseline">
                  <div className="col-span-12 md:col-span-6">
                    <div className="text-subtitle truncate">
                      {e.company_name}
                    </div>
                    {e.one_liner ? (
                      <div className="text-body-sm text-[var(--color-near-black)]/65 truncate">
                        {e.one_liner}
                      </div>
                    ) : (
                      <div className="text-meta">
                        {e.short_status === "running"
                          ? "wird analysiert"
                          : e.short_status === "failed"
                          ? "short fehlgeschlagen"
                          : "noch keine einschaetzung"}
                      </div>
                    )}
                  </div>
                  <div className="col-span-6 md:col-span-3 flex flex-wrap gap-1.5">
                    {e.priority_label && (
                      <span
                        className={`text-meta-strong px-2 py-0.5 border ${
                          PRIO_COLORS[e.priority_label] ?? ""
                        }`}
                      >
                        {e.priority_label}
                      </span>
                    )}
                    {e.deep_status === "done" && (
                      <span className="text-meta-strong px-2 py-0.5 border border-[var(--border-color)] text-[var(--color-near-black)]/70">
                        deep
                      </span>
                    )}
                    {e.isp_sector_match.slice(0, 2).map((s) => (
                      <span
                        key={s}
                        className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55"
                      >
                        {s.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                  <div className="col-span-4 md:col-span-2 text-right">
                    {e.match_confidence !== null ? (
                      <span className="tabular-nums text-title">
                        {e.match_confidence}
                        <span style={{ color: "var(--color-gold)" }}>.</span>
                      </span>
                    ) : (
                      <span className="text-meta inline-flex items-center gap-1">
                        {e.short_status === "running" && <GoldDot size={5} />}
                        {e.short_status}
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 md:col-span-1 text-right text-meta truncate">
                    {e.booth ?? ""}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
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
