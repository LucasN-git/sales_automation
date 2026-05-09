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
  enrichment_status: string;
  business_field: string | null;
  isp_sector_match: string[];
  match_confidence: number | null;
  pitch_hook: string | null;
};

type Sector = { id: string; name: string; scope: string };

export function ExhibitorList({
  exhibitors,
  showId,
  sectors,
  currentQuery,
  currentSector,
  currentSort,
}: {
  exhibitors: Exhibitor[];
  showId: string;
  sectors: readonly Sector[];
  currentQuery: string;
  currentSector: string;
  currentSort: string;
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
      <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6 mb-6">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") update({ q });
          }}
          onBlur={() => update({ q })}
          placeholder="Firmen-Name suchen"
          className="flex-1 bg-transparent border-0 border-b border-[var(--color-hairline-light)] py-2 text-[18px] focus:outline-none focus:border-[var(--color-near-black)]"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <SectorChip
            label="Alle"
            active={!currentSector}
            onClick={() => update({ sector: null })}
          />
          {sectors.map((s) => (
            <SectorChip
              key={s.id}
              label={s.name}
              active={currentSector === s.id}
              onClick={() => update({ sector: s.id })}
            />
          ))}
        </div>
        <select
          value={currentSort}
          onChange={(e) => update({ sort: e.target.value })}
          className="bg-transparent border-0 border-b border-[var(--color-hairline-light)] py-2 text-[15px] focus:outline-none"
        >
          <option value="match">Nach Match</option>
          <option value="name">Nach Name</option>
        </select>
      </div>

      <Hairline />
      {exhibitors.length === 0 ? (
        <div className="py-12 text-[17px] text-[var(--color-near-black)]/50">
          Keine Aussteller gefunden.
        </div>
      ) : (
        <ul>
          {exhibitors.map((e) => (
            <li key={e.id}>
              <Link
                href={`/shows/${showId}/exhibitors/${e.id}`}
                className="block py-5 hover:bg-[var(--color-near-black)]/[0.02]"
              >
                <div className="grid grid-cols-12 gap-4 items-baseline">
                  <div className="col-span-12 md:col-span-5">
                    <div className="text-[20px] font-bold truncate">{e.company_name}</div>
                    {e.business_field && (
                      <div className="text-[15px] text-[var(--color-near-black)]/60 truncate">
                        {e.business_field}
                      </div>
                    )}
                  </div>
                  <div className="col-span-12 md:col-span-4 flex flex-wrap gap-2">
                    {e.isp_sector_match.map((s) => (
                      <span
                        key={s}
                        className="text-[12px] uppercase tracking-[0.06em] px-2 py-1 border border-[var(--color-hairline-light)]"
                      >
                        {s.replace("_", " ")}
                      </span>
                    ))}
                  </div>
                  <div className="col-span-6 md:col-span-2 text-right">
                    {e.match_confidence !== null ? (
                      <span className="tabular-nums text-[24px] font-bold">
                        {e.match_confidence}
                        <span style={{ color: "var(--color-gold)" }}>.</span>
                      </span>
                    ) : (
                      <span className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/40">
                        {e.enrichment_status}
                      </span>
                    )}
                  </div>
                  <div className="col-span-6 md:col-span-1 text-right text-[13px] text-[var(--color-near-black)]/40">
                    {e.booth ?? ""}
                  </div>
                </div>
              </Link>
              <Hairline />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SectorChip({
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
      className={`text-[12px] uppercase tracking-[0.06em] px-3 py-1 border transition-colors ${
        active
          ? "bg-[var(--color-near-black)] text-[var(--color-cream)] border-[var(--color-near-black)]"
          : "border-[var(--color-hairline-light)] text-[var(--color-near-black)]/70 hover:text-[var(--color-near-black)]"
      }`}
    >
      {label}
    </button>
  );
}
