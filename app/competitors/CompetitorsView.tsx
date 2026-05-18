"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { ArrowRight } from "@/components/brand/Icons";
import { apiFetch } from "@/lib/api-fetch";
import { useReportErrorSafe } from "@/components/ErrorReportProvider";

export type CompetitorRow = {
  id: string;
  display_name: string;
  domain: string | null;
  website: string | null;
  hq_country: string | null;
  status: "suggested" | "active" | "archived" | "rejected";
  source_event: string | null;
  one_liner: string | null;
  isp_sector_match: string[];
  threat_level: "low" | "medium" | "high" | "critical" | null;
  version_count: number;
  created_at: string;
};

export type DiscoveryRun = {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  current_phase: string | null;
  model: string | null;
  candidates_total: number | null;
  candidates_kept: number | null;
  web_search_uses: number | null;
  web_search_cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

type Sector = { id: string; name: string; scope: string };

type FilterStatus = "all" | "suggested" | "active" | "archived" | "rejected";

const STATUS_TABS: Array<{ key: FilterStatus; label: string }> = [
  { key: "suggested", label: "vorgeschlagen" },
  { key: "active", label: "aktiv" },
  { key: "archived", label: "archiv" },
  { key: "rejected", label: "verworfen" },
  { key: "all", label: "alle" },
];

export function CompetitorsView({
  competitors,
  runs,
  sectors,
}: {
  competitors: CompetitorRow[];
  runs: DiscoveryRun[];
  sectors: readonly Sector[];
}) {
  const [filter, setFilter] = useState<FilterStatus>("suggested");
  const [sectorFilter, setSectorFilter] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkShortPending, setBulkShortPending] = useState(false);
  const [, startTransition] = useTransition();
  const reportError = useReportErrorSafe();

  const hasActiveRun = runs.some(
    (r) => r.status === "pending" || r.status === "running",
  );
  useEffect(() => {
    if (!hasActiveRun) return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [hasActiveRun, router]);

  const sectorMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of sectors) m[s.id] = s.name;
    return m;
  }, [sectors]);

  const filtered = useMemo(() => {
    return competitors.filter((c) => {
      if (filter !== "all" && c.status !== filter) return false;
      if (sectorFilter && !c.isp_sector_match.includes(sectorFilter)) return false;
      if (q.trim().length > 0) {
        const needle = q.trim().toLowerCase();
        const hay = [c.display_name, c.domain ?? "", c.one_liner ?? ""].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [competitors, filter, sectorFilter, q]);

  async function bulkShort() {
    if (bulkShortPending) return;
    setBulkShortPending(true);
    try {
      await apiFetch("/api/competitors/bulk-short", {
        method: "POST",
        reporter: reportError,
      });
      startTransition(() => router.refresh());
    } finally {
      setBulkShortPending(false);
    }
  }

  async function curate(id: string, status: CompetitorRow["status"]) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/competitors/${id}/curate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) return;
      startTransition(() => router.refresh());
    } finally {
      setPendingId(null);
    }
  }

  const counts = useMemo(() => {
    const c = { suggested: 0, active: 0, archived: 0, rejected: 0, all: 0 };
    for (const x of competitors) {
      c[x.status]++;
      c.all++;
    }
    return c;
  }, [competitors]);

  const activeRun = runs.find(
    (r) => r.status === "pending" || r.status === "running",
  );

  return (
    <div>
      {activeRun && <ActiveRunBanner run={activeRun} />}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-2 text-body-sm border transition-colors ${
                  active
                    ? "border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.04] text-[var(--color-near-black)] font-semibold"
                    : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/70 hover:border-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)]"
                }`}
              >
                {tab.label}
                <span className="ml-2 tabular-nums opacity-60">
                  {counts[tab.key]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[200px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="suche name, domain, one-liner"
            className="flex-1 min-w-[160px] bg-transparent border border-[var(--border-color-soft)] px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
          />
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
          {filter === "suggested" && counts.suggested > 0 && (
            <button
              onClick={bulkShort}
              disabled={bulkShortPending}
              className="inline-flex items-center gap-1.5 text-ui-sm px-3 py-2 border border-[var(--color-near-black)]/80 text-[var(--color-near-black)] hover:border-[var(--color-gold)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              {bulkShortPending ? (
                <><GoldDot size={5} /><span>laeuft...</span></>
              ) : (
                `alle analysieren (${counts.suggested})`
              )}
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-body text-[var(--color-near-black)]/55 box-line px-5">
          {filter === "suggested"
            ? "keine vorschlaege. starte eine neue analyse ueber den chat rechts."
            : "keine konkurrenten in dieser ansicht."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map((c) => (
            <div key={c.id} className="card-surface group flex flex-col">
              <Link
                href={`/competitors/${c.id}`}
                className="flex-1 block px-5 pt-5 pb-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <ThreatPill level={c.threat_level} />
                  <ArrowRight
                    size={13}
                    className="text-[var(--color-near-black)]/30 group-hover:text-[var(--color-near-black)]/70 transition-colors"
                  />
                </div>
                <span className="text-subtitle font-semibold leading-snug block">{c.display_name}</span>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                  {c.domain && (
                    <span className="text-meta text-[var(--color-near-black)]/55">{c.domain}</span>
                  )}
                  {c.hq_country && (
                    <span className="text-meta text-[var(--color-near-black)]/55">{c.hq_country}</span>
                  )}
                </div>
                {c.one_liner && (
                  <p className="text-body-sm text-[var(--color-near-black)]/65 mt-1.5 leading-snug line-clamp-2">
                    {c.one_liner}
                  </p>
                )}
                {c.isp_sector_match.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-2 gap-y-0.5">
                    {c.isp_sector_match.map((sid) => (
                      <span key={sid} className="text-meta text-[var(--color-near-black)]/40">
                        {sectorMap[sid] ?? sid}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
              <div className="px-5 pb-4 pt-3 border-t border-[var(--border-color-soft)] flex items-center justify-between gap-3">
                <StatusBadge status={c.status} />
                <CurateActions
                  row={c}
                  pending={pendingId === c.id}
                  onCurate={(s) => curate(c.id, s)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveRunBanner({ run }: { run: DiscoveryRun }) {
  return (
    <Link
      href={`/competitors/runs/${run.id}`}
      className="mb-6 px-5 py-3 box-line border-l-2 border-l-[var(--color-gold)] bg-[var(--color-near-black)]/[0.02] flex items-center justify-between gap-3 hover:bg-[var(--color-near-black)]/[0.04] transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <GoldDot size={6} />
        <span className="text-body-sm">
          analyse {run.status === "pending" ? "wird vorbereitet" : "laeuft"}
          {run.current_phase && (
            <span className="ml-2 text-[var(--color-near-black)]/55">
              , {run.current_phase}
            </span>
          )}
        </span>
      </div>
      <span className="text-meta text-[var(--color-near-black)]/55 inline-flex items-center gap-1.5 shrink-0">
        zum prozess
        <ArrowRight size={12} />
      </span>
    </Link>
  );
}

function ThreatPill({ level }: { level: CompetitorRow["threat_level"] }) {
  if (!level) {
    return (
      <span className="text-meta-strong shrink-0 tabular-nums pt-px text-[var(--color-near-black)]/30">
        --
      </span>
    );
  }
  const map: Record<NonNullable<CompetitorRow["threat_level"]>, { label: string; color: string }> = {
    low: { label: "low", color: "rgba(10,10,10,0.4)" },
    medium: { label: "med", color: "rgba(10,10,10,0.7)" },
    high: { label: "hi", color: "var(--color-gold)" },
    critical: { label: "crit", color: "var(--color-error)" },
  };
  const t = map[level];
  return (
    <span
      className="text-meta-strong shrink-0 pt-px"
      style={{ color: t.color }}
    >
      {t.label}
    </span>
  );
}

function StatusBadge({ status }: { status: CompetitorRow["status"] }) {
  const map: Record<CompetitorRow["status"], { label: string; cls: string }> = {
    suggested: {
      label: "vorgeschlagen",
      cls: "border-[var(--color-near-black)]/30 text-[var(--color-near-black)]/70",
    },
    active: {
      label: "aktiv",
      cls: "border-[var(--color-near-black)] text-[var(--color-near-black)]",
    },
    archived: {
      label: "archiv",
      cls: "border-[var(--border-color-soft)] text-[var(--color-near-black)]/45",
    },
    rejected: {
      label: "verworfen",
      cls: "border-[var(--border-color-soft)] text-[var(--color-near-black)]/40 line-through",
    },
  };
  const s = map[status];
  return (
    <span className={`px-2 py-0.5 text-meta border ${s.cls}`}>{s.label}</span>
  );
}

function CurateActions({
  row,
  pending,
  onCurate,
}: {
  row: CompetitorRow;
  pending: boolean;
  onCurate: (status: CompetitorRow["status"]) => void;
}) {
  if (pending) {
    return (
      <span className="text-body-sm text-[var(--color-near-black)]/55">
        speichere
      </span>
    );
  }

  if (row.status === "suggested") {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => onCurate("active")}
          className="px-3 py-1.5 text-body-sm border border-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-colors"
        >
          akzeptieren
        </button>
        <button
          onClick={() => onCurate("rejected")}
          className="text-body-sm text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
        >
          verwerfen
        </button>
      </div>
    );
  }
  if (row.status === "active") {
    return (
      <button
        onClick={() => onCurate("archived")}
        className="text-body-sm text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
      >
        archivieren
      </button>
    );
  }
  if (row.status === "archived" || row.status === "rejected") {
    return (
      <button
        onClick={() => onCurate("active")}
        className="text-body-sm text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
      >
        reaktivieren
      </button>
    );
  }
  return null;
}
