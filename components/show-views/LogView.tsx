"use client";

import { useEffect, useState } from "react";
import type { LogEntry } from "./types";

export function LogView({ entries }: { entries: LogEntry[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Group keys, day labels, and times all depend on the local timezone.
  // Server (UTC) and client (Europe/Berlin) produce different output, which
  // breaks hydration during scraping when router.refresh() re-renders the
  // server tree every 5s. Defer rendering until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <p className="text-meta">lade...</p>;
  }

  if (entries.length === 0) {
    return <p className="text-meta">noch keine eintraege</p>;
  }

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
              const expandable =
                !!e.meta &&
                (Object.keys(e.meta).includes("prompt") ||
                  Object.keys(e.meta).includes("response") ||
                  Object.keys(e.meta).includes("plan"));
              return (
                <div
                  key={e.id}
                  className={`text-body-sm pl-3 border-l ${
                    e.level === "error"
                      ? "border-[var(--color-near-black)]"
                      : e.level === "warn"
                      ? "border-[var(--color-gold)]"
                      : "border-[var(--color-hairline-light)]"
                  }`}
                >
                  <div className="flex items-baseline gap-2 text-meta">
                    <span className="tabular-nums text-[var(--color-near-black)]/85">
                      {formatTime(e.created_at)}
                    </span>
                    {e.phase && <span>{e.phase}</span>}
                    {expandable && (
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
                    <pre className="mt-2 p-2 bg-[var(--color-near-black)]/[0.03] border border-[var(--color-hairline-light)] text-[10px] leading-[1.5] overflow-auto max-h-[30vh] whitespace-pre-wrap break-words font-mono">
                      {formatMeta(e.meta)}
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

function formatMeta(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (typeof meta.prompt === "string") {
    parts.push(`# Prompt\n\n${truncate(meta.prompt, 6000)}`);
  }
  if (meta.plan) {
    parts.push(`# Plan\n\n${JSON.stringify(meta.plan, null, 2)}`);
  }
  if (meta.response) {
    parts.push(
      `# Response\n\n${
        typeof meta.response === "string"
          ? truncate(meta.response, 6000)
          : JSON.stringify(meta.response, null, 2).slice(0, 6000)
      }`,
    );
  }
  if (parts.length === 0) {
    return JSON.stringify(meta, null, 2).slice(0, 6000);
  }
  return parts.join("\n\n---\n\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n\n…[gekuerzt]`;
}
