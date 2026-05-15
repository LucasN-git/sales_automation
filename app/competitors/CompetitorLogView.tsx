"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type LogEntry = {
  id: string;
  run_id: string | null;
  competitor_id: string | null;
  level: string;
  phase: string | null;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
};

type LatestRun = {
  id: string;
  status: string;
  current_phase: string | null;
  candidates_total: number | null;
  candidates_kept: number | null;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
} | null;

type ApiResponse = {
  entries: LogEntry[];
  latest_run: LatestRun;
};

export function CompetitorLogView({ runId }: { runId?: string }) {
  const [data, setData] = useState<ApiResponse>({ entries: [], latest_run: null });
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const router = useRouter();

  async function load() {
    const url = new URL("/api/competitors/log", location.origin);
    if (runId) url.searchParams.set("run_id", runId);
    url.searchParams.set("limit", "100");
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      setData(json);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [runId]);

  // Auto-refresh when a run is active
  const isActive =
    data.latest_run?.status === "pending" ||
    data.latest_run?.status === "running";

  useEffect(() => {
    if (!isActive) return;
    const t = setInterval(() => {
      load();
      router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [isActive]);

  if (loading) {
    return (
      <div className="space-y-2 mt-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-10 bg-[var(--color-near-black)]/[0.04] animate-pulse"
          />
        ))}
      </div>
    );
  }

  const { entries, latest_run } = data;

  return (
    <div className="space-y-8">
      {latest_run && (
        <RunStatusHeader run={latest_run} />
      )}

      {entries.length === 0 ? (
        <p className="text-meta">noch keine log-eintraege vorhanden.</p>
      ) : (
        <LogList entries={entries} expanded={expanded} setExpanded={setExpanded} />
      )}
    </div>
  );
}

function RunStatusHeader({ run }: { run: NonNullable<LatestRun> }) {
  const isActive = run.status === "pending" || run.status === "running";
  const isFailed = run.status === "failed";

  return (
    <div className="border border-[var(--border-color)] p-4 space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-ui font-medium">Discovery-Lauf</span>
        <span
          className={`text-meta-strong px-2 py-0.5 border ${
            isActive
              ? "border-[var(--color-gold)]/40 text-[var(--color-gold)]"
              : isFailed
              ? "border-[var(--color-error)]/40 text-[var(--color-error)]"
              : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60"
          }`}
        >
          {run.status}
        </span>
        {run.current_phase && (
          <span className="text-meta text-[var(--color-near-black)]/55">
            {run.current_phase}
          </span>
        )}
      </div>

      {(run.candidates_total != null || run.candidates_kept != null) && (
        <div className="flex items-center gap-4 text-meta text-[var(--color-near-black)]/60">
          {run.candidates_total != null && (
            <span>{run.candidates_total} kandidaten gefunden</span>
          )}
          {run.candidates_kept != null && (
            <span>{run.candidates_kept} behalten</span>
          )}
        </div>
      )}

      {run.error_message && (
        <p className="text-meta text-[var(--color-error)] break-words">
          {run.error_message}
        </p>
      )}

      <div className="flex gap-4 text-meta text-[var(--color-near-black)]/40">
        <span>gestartet {formatTime(run.started_at)}</span>
        {run.finished_at && (
          <span>beendet {formatTime(run.finished_at)}</span>
        )}
      </div>
    </div>
  );
}

function LogList({
  entries,
  expanded,
  setExpanded,
}: {
  entries: LogEntry[];
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const groups = groupByDay(entries);

  return (
    <div className="max-h-[70vh] overflow-y-auto pr-2 -mr-2">
      {groups.map((group) => (
        <section key={group.dayKey} className="mb-6 last:mb-0">
          <h3 className="sticky top-0 z-10 bg-[var(--color-cream)] py-2 mb-2 text-meta-strong tracking-wide border-b border-[var(--border-color-soft)]">
            {group.label}
          </h3>
          <div className="space-y-2">
            {group.entries.map((e) => {
              const isExpanded = expanded.has(e.id);
              const hasMeta = !!e.meta && Object.keys(e.meta).length > 0;
              return (
                <div
                  key={e.id}
                  className={`text-body-sm pl-3 border-l ${
                    e.level === "error"
                      ? "border-[var(--color-near-black)]"
                      : e.level === "warn"
                      ? "border-[var(--color-gold)]"
                      : "border-[var(--border-color-soft)]"
                  }`}
                >
                  <div className="flex items-baseline gap-2 text-meta">
                    <span className="tabular-nums text-[var(--color-near-black)]/85">
                      {formatTime(e.created_at)}
                    </span>
                    {e.phase && (
                      <span className="text-[var(--color-near-black)]/50">
                        {e.phase}
                      </span>
                    )}
                    {hasMeta && (
                      <button
                        onClick={() => {
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(e.id)) next.delete(e.id);
                            else next.add(e.id);
                            return next;
                          });
                        }}
                        className="ml-auto hover:text-[var(--color-near-black)] transition-colors"
                      >
                        {isExpanded ? "verbergen" : "details"}
                      </button>
                    )}
                  </div>
                  <div className="text-[var(--color-near-black)]/80 break-words">
                    {e.message}
                  </div>
                  {isExpanded && e.meta && (
                    <pre className="mt-2 p-2 bg-[var(--color-near-black)]/[0.03] border border-[var(--border-color-soft)] text-[10px] leading-[1.5] overflow-auto max-h-[30vh] whitespace-pre-wrap break-words font-mono">
                      {JSON.stringify(e.meta, null, 2).slice(0, 8000)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

type DayGroup = { dayKey: string; label: string; entries: LogEntry[] };

function groupByDay(entries: LogEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const e of entries) {
    const d = new Date(e.created_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!current || current.dayKey !== key) {
      current = { dayKey: key, label: formatDayLabel(d), entries: [] };
      groups.push(current);
    }
    current.entries.push(e);
  }
  return groups;
}

function formatDayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return "heute";
  if (sameDay(d, yesterday)) return "gestern";
  return d.toLocaleDateString("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
