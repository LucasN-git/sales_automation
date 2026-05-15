"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { priceFor } from "@/lib/pricing";

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
  threat_level: "low" | "medium" | "high" | null;
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
  const [, startTransition] = useTransition();

  // Wenn ein Discovery-Run gerade laeuft, alle 6s refresh, damit neue Vorschlaege
  // aus der DB nachgeladen werden, ohne dass der User klicken muss.
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
      {activeRun && (
        <Link
          href={`/competitors/runs/${activeRun.id}`}
          className="mb-6 px-5 py-4 border-l-2 border-[var(--color-gold)] bg-[var(--color-near-black)]/[0.03] flex items-center justify-between gap-3 hover:bg-[var(--color-near-black)]/[0.05] transition-colors"
        >
          <div className="flex items-center gap-3">
            <GoldDot size={6} />
            <span className="text-body-sm">
              discovery-lauf {activeRun.status === "pending" ? "wird vorbereitet" : "laeuft"}
              {activeRun.current_phase && (
                <span className="ml-2 text-[var(--color-near-black)]/55">
                  · {activeRun.current_phase}
                </span>
              )}
            </span>
          </div>
          <span className="text-body-sm hover:text-[var(--color-gold)]">
            live ansehen &rarr;
          </span>
        </Link>
      )}

      {runs.length > 0 && <RunHistoryBlock runs={runs} />}

      <div className="flex flex-wrap items-center gap-4 mb-5">
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-2 text-body-sm border transition-colors ${
                  active
                    ? "border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.06] text-[var(--color-near-black)] font-semibold"
                    : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/70 hover:text-[var(--color-near-black)]"
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
        <div className="flex-1 min-w-[200px]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="suche name, domain, one-liner"
            className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
          />
        </div>
        <div>
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
        </div>
      </div>

      <div className="border-t border-[var(--border-color-soft)]" />

      {filtered.length === 0 ? (
        <div className="py-12 text-body text-[var(--color-near-black)]/60">
          {filter === "suggested"
            ? "keine vorschlaege. starte einen discovery-lauf oben."
            : "keine konkurrenten in dieser ansicht."}
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="px-5 py-4 border-b border-[var(--border-color-soft)] flex items-start gap-4 flex-wrap"
            >
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-body font-semibold">{c.display_name}</span>
                  {c.domain && (
                    <a
                      href={c.website ?? `https://${c.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-meta text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)]"
                    >
                      {c.domain}
                    </a>
                  )}
                  {c.hq_country && (
                    <span className="text-meta text-[var(--color-near-black)]/55">
                      {c.hq_country}
                    </span>
                  )}
                  <StatusBadge status={c.status} />
                </div>
                {c.one_liner && (
                  <p className="mt-1 text-body-sm text-[var(--color-near-black)]/75">
                    {c.one_liner}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  {c.isp_sector_match.map((sid) => (
                    <span
                      key={sid}
                      className="px-2 py-1 text-meta border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70"
                    >
                      {sectorMap[sid] ?? sid}
                    </span>
                  ))}
                  {c.threat_level && (
                    <span className="text-meta text-[var(--color-near-black)]/55">
                      threat: {c.threat_level}
                    </span>
                  )}
                </div>
              </div>

              <CurateActions
                row={c}
                pending={pendingId === c.id}
                onCurate={(s) => curate(c.id, s)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunHistoryBlock({ runs }: { runs: DiscoveryRun[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? runs : runs.slice(0, 3);
  return (
    <div className="mb-6 border-t border-b border-[var(--border-color-soft)] py-5">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-meta-strong">letzte discovery-laeufe</span>
        {runs.length > 3 && (
          <button
            onClick={() => setExpanded((x) => !x)}
            className="text-meta hover:text-[var(--color-near-black)] transition-colors"
          >
            {expanded ? "weniger" : `alle ${runs.length}`}
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id}>
            <Link
              href={`/competitors/runs/${r.id}`}
              className="flex items-center justify-between gap-3 py-1 hover:text-[var(--color-near-black)] transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <RunStatusBadge status={r.status} />
                <span className="text-body-sm tabular-nums text-[var(--color-near-black)]/70">
                  {formatDate(r.created_at)}
                </span>
                <span className="text-body-sm text-[var(--color-near-black)]/85 truncate">
                  {r.candidates_total !== null
                    ? `${r.candidates_kept ?? 0} / ${r.candidates_total} Vorschlaege`
                    : r.status === "failed"
                    ? r.error_message ?? "fehlgeschlagen"
                    : "..."}
                </span>
              </div>
              <span className="text-meta tabular-nums text-[var(--color-near-black)]/55 whitespace-nowrap">
                {formatRunCost(r)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunStatusBadge({ status }: { status: DiscoveryRun["status"] }) {
  const map: Record<DiscoveryRun["status"], { label: string; cls: string }> = {
    pending: {
      label: "wartet",
      cls: "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60",
    },
    running: {
      label: "laeuft",
      cls: "border-[var(--color-gold)] text-[var(--color-near-black)]/80",
    },
    done: {
      label: "ok",
      cls: "border-[var(--color-near-black)]/30 text-[var(--color-near-black)]/70",
    },
    failed: {
      label: "fehler",
      cls: "border-[var(--color-near-black)] text-[var(--color-near-black)]",
    },
  };
  const s = map[status];
  return (
    <span className={`px-2 py-0.5 text-meta border ${s.cls} whitespace-nowrap`}>
      {s.label}
    </span>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRunCost(r: DiscoveryRun): string {
  const tokenCost =
    r.model && (r.tokens_in !== null || r.tokens_out !== null)
      ? priceFor(r.model, r.tokens_in ?? 0, r.tokens_out ?? 0)
      : 0;
  const wsCost = r.web_search_cost_usd ?? 0;
  const total = tokenCost + wsCost;
  if (total === 0) return "";
  if (total < 0.01) return "<0.01 $";
  return `${total.toFixed(2)} $`;
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
