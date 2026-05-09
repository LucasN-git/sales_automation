"use client";

import { useEffect, useRef, useState } from "react";
import { GoldDot } from "@/components/brand/GoldDot";
import type { CrawlPlan } from "@/lib/crawl-plan";
import { planSummary } from "@/lib/crawl-plan";

type ExhibitorLite = {
  company_name: string;
  short_status: string;
  deep_status: string;
  current_step: string | null;
};

type LogEntry = {
  id: number;
  level: string;
  phase: string | null;
  message: string;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

type TokenStats = {
  short_in: number;
  short_out: number;
  short_count: number;
  deep_in: number;
  deep_out: number;
  deep_count: number;
  chat_in: number;
  chat_out: number;
  chat_count: number;
  browser_seconds?: number;
  short_cost_usd: number;
  deep_cost_usd: number;
  chat_cost_usd: number;
  browser_cost_usd?: number;
};

type Phase = {
  num: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "paused";
  detail?: string;
  sub?: string[];
};

type Tab = "phases" | "log" | "cost" | "progress";

const STEP_LABELS: Record<string, string> = {
  discovering: "Claude analysiert Site-Struktur",
  fetching_list: "Aussteller-Liste von URL holen",
  inserting_exhibitors: "Aussteller in DB schreiben",
  scraping: "Firecrawl: Website laden",
  analyzing: "Claude: Match analysieren",
  saving: "Ergebnisse speichern",
  deep_scraping: "Firecrawl: Website (Deep)",
  deep_analyzing: "Claude: Deep-Analyse",
  scraping_single_page: "Firecrawl: Einzelseite laden",
  clicking_show_more: "Firecrawl: Show-more klicken",
};

function stepLabel(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^listing:([^:]+)(?::(.+))?$/.exec(s);
  if (m) {
    const sub = m[2];
    if (!sub) return "Listing-Plan startet";
    const letter = /^letter_(.+?)(?:_.*)?$/.exec(sub);
    if (letter) {
      const tail = sub.slice(letter[0].length);
      return tail ? `Buchstabe ${letter[1]}${tail}` : `Buchstabe ${letter[1]}`;
    }
    const page = /^page_(\d+)$/.exec(sub);
    if (page) return `Seite ${page[1]}`;
    return STEP_LABELS[sub] ?? sub;
  }
  return STEP_LABELS[s] ?? s;
}

export function ProcessSidebar({
  showId,
  showStatus,
  showCurrentStep,
  errorMessage,
  exhibitors,
  crawlPlan,
  logEntries,
  tokenStats,
}: {
  showId: string;
  showStatus: string;
  showCurrentStep: string | null;
  errorMessage: string | null;
  exhibitors: ExhibitorLite[];
  crawlPlan: CrawlPlan | null;
  logEntries?: LogEntry[];
  tokenStats?: TokenStats;
}) {
  const [tab, setTab] = useState<Tab>("phases");

  return (
    <aside className="w-full">
      <div className="flex items-baseline justify-between mb-5">
        <div className="text-subtitle">Prozess</div>
        <a
          href="http://localhost:8288"
          target="_blank"
          rel="noreferrer"
          className="text-meta hover:text-[var(--color-near-black)] transition-colors"
        >
          Inngest ↗
        </a>
      </div>

      <nav className="flex gap-1.5 mb-6 -mx-1 px-1 overflow-x-auto whitespace-nowrap">
        <TabBtn active={tab === "phases"} onClick={() => setTab("phases")}>phasen</TabBtn>
        <TabBtn active={tab === "log"} onClick={() => setTab("log")}>log</TabBtn>
        <TabBtn active={tab === "cost"} onClick={() => setTab("cost")}>kosten</TabBtn>
        <TabBtn active={tab === "progress"} onClick={() => setTab("progress")}>progress</TabBtn>
      </nav>

      {tab === "phases" && (
        <PhasesView
          showStatus={showStatus}
          showCurrentStep={showCurrentStep}
          errorMessage={errorMessage}
          exhibitors={exhibitors}
          crawlPlan={crawlPlan}
        />
      )}
      {tab === "log" && <LogView entries={logEntries ?? []} />}
      {tab === "cost" && <CostView stats={tokenStats} />}
      {tab === "progress" && <ProgressView exhibitors={exhibitors} />}
    </aside>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-ui-sm px-2.5 py-1 border transition-colors origin-center ${
        active
          ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
          : "border-transparent text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)]"
      }`}
    >
      {children}
    </button>
  );
}

// ---------- Phases ----------

function PhasesView({
  showStatus,
  showCurrentStep,
  errorMessage,
  exhibitors,
  crawlPlan,
}: {
  showStatus: string;
  showCurrentStep: string | null;
  errorMessage: string | null;
  exhibitors: ExhibitorLite[];
  crawlPlan: CrawlPlan | null;
}) {
  const total = exhibitors.length;
  const shortDone = exhibitors.filter((e) => e.short_status === "done").length;
  const shortFailed = exhibitors.filter((e) => e.short_status === "failed").length;
  const shortRunning = exhibitors.filter((e) => e.short_status === "running");
  const shortPending = exhibitors.filter((e) => e.short_status === "pending").length;
  const deepDone = exhibitors.filter((e) => e.deep_status === "done").length;
  const deepRunning = exhibitors.filter(
    (e) => e.deep_status === "running" || e.deep_status === "pending",
  ).length;

  const planExists = !!crawlPlan;
  const listingDone = total > 0;
  const listingFailed = showStatus === "failed" && total === 0;

  // Phase 00
  const isPausedAtDiscovery = showStatus === "paused" && !planExists;
  const phase0Status: Phase["status"] = isPausedAtDiscovery
    ? "paused"
    : listingFailed && !planExists
    ? "failed"
    : planExists
    ? "done"
    : showCurrentStep === "discovering" || showStatus === "queued" || showStatus === "crawling"
    ? "running"
    : "pending";

  // Phase 01
  const isPausedAtListing = showStatus === "paused" && planExists && !listingDone;
  const phase1Status: Phase["status"] = listingFailed
    ? "failed"
    : isPausedAtListing
    ? "paused"
    : listingDone
    ? "done"
    : planExists
    ? "running"
    : "pending";

  // Phase 02 (Short)
  const shortFinished = total > 0 && shortDone + shortFailed === total;
  const shortTouched = shortDone + shortFailed + shortRunning.length > 0;
  const phase2Status: Phase["status"] = shortFinished
    ? "done"
    : shortTouched
    ? "running"
    : listingDone
    ? "pending"
    : "pending";

  const runningLines = shortRunning.slice(0, 4).map((e) => {
    const label = stepLabel(e.current_step);
    return label ? `${e.company_name} (${label})` : e.company_name;
  });

  const phase3Status: Phase["status"] = deepDone > 0 ? "done" : deepRunning > 0 ? "running" : "pending";

  const phases: Phase[] = [
    {
      num: "00",
      label: "Site-Discovery",
      status: phase0Status,
      detail: planExists
        ? planSummary(crawlPlan)
        : showCurrentStep === "discovering"
        ? "Claude liest die Listing-Seite"
        : "Wartet auf Crawl-Start",
    },
    {
      num: "01",
      label: "Aussteller-Liste",
      status: phase1Status,
      detail: listingFailed
        ? errorMessage ?? "Konnte nicht extrahiert werden."
        : listingDone
        ? `${total} gefunden`
        : planExists
        ? "Plan wird ausgefuehrt"
        : "Wartet auf Plan",
      sub:
        !listingDone && showCurrentStep && showCurrentStep.startsWith("listing:")
          ? ["aktuell", stepLabel(showCurrentStep) ?? showCurrentStep]
          : undefined,
    },
    {
      num: "02",
      label: "Short-Overviews",
      status: phase2Status,
      detail: listingDone
        ? `${shortDone}/${total} fertig${shortFailed > 0 ? `, ${shortFailed} fehlgeschlagen` : ""}${shortPending > 0 ? `, ${shortPending} offen` : ""}`
        : "Wartet auf Listing",
      sub:
        shortRunning.length > 0
          ? [
              "laeuft parallel (max. 5)",
              ...runningLines,
              ...(shortPending > 4 ? [`+ ${shortPending} in warteschlange`] : []),
            ]
          : undefined,
    },
    {
      num: "03",
      label: "Deep-Dives (manuell)",
      status: phase3Status,
      detail: deepDone > 0
        ? `${deepDone} erstellt${deepRunning > 0 ? `, ${deepRunning} laufen` : ""}`
        : deepRunning > 0
        ? `${deepRunning} laufen`
        : "Per Aussteller-Klick",
    },
  ];

  return (
    <ol className="space-y-0">
      {phases.map((p, i) => (
        <PhaseRow key={p.num} phase={p} isLast={i === phases.length - 1} />
      ))}
    </ol>
  );
}

function PhaseRow({ phase, isLast }: { phase: Phase; isLast: boolean }) {
  return (
    <li className="relative pl-7 pb-7 last:pb-0">
      <PhaseMarker status={phase.status} />
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[7px] top-5 bottom-0 w-px bg-[var(--color-hairline-light)]"
        />
      )}

      <div className="flex items-baseline gap-2.5 mb-1">
        <span className="tabular-nums text-meta">{phase.num}</span>
        <span
          className={
            phase.status === "pending"
              ? "text-body text-[var(--color-near-black)]/45"
              : "text-body font-semibold"
          }
        >
          {phase.label}
        </span>
      </div>

      {phase.detail && (
        <div className="text-body-sm text-[var(--color-near-black)]/65">
          {phase.detail}
        </div>
      )}

      {phase.sub && phase.sub.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {phase.sub.map((line, idx) => {
            const isLabel = idx === 0;
            return (
              <li
                key={idx}
                className={
                  isLabel
                    ? "text-meta"
                    : "text-meta-strong text-[var(--color-near-black)]/65"
                }
              >
                {line}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function PhaseMarker({ status }: { status: Phase["status"] }) {
  const base =
    "absolute left-0 top-1 inline-flex items-center justify-center w-4 h-4 text-[10px]";
  if (status === "done") {
    return (
      <span className={`${base} border border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold`}>
        ✓
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className={base}>
        <GoldDot size={8} />
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className={`${base} border border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold`}>
        ‖
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className={`${base} border border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold`}>
        ×
      </span>
    );
  }
  return <span className={`${base} border border-[var(--color-hairline-light)]`} />;
}

// ---------- Live Log ----------

function LogView({ entries }: { entries: LogEntry[] }) {
  // Server provides newest-first (limit 50). UI shows oldest-first so the
  // stream reads chronologically and auto-scroll-to-bottom feels natural.
  const ordered = [...entries].reverse();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledRef = useRef(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!scrollRef.current) return;
    if (userScrolledRef.current) return; // user is reading, don't yank
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [ordered.length]);

  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    userScrolledRef.current = !nearBottom;
  }

  if (ordered.length === 0) {
    return <p className="text-meta">noch keine eintraege</p>;
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="max-h-[65vh] overflow-y-auto pr-2 -mr-2 space-y-2"
    >
      {ordered.map((e) => {
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
              <span className="tabular-nums">
                {new Date(e.created_at).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
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
  );
}

function formatMeta(meta: Record<string, unknown>): string {
  // Pretty-print known fields; truncate huge strings.
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

// ---------- Cost ----------

function CostView({ stats }: { stats?: TokenStats }) {
  if (!stats) {
    return <p className="text-meta">noch keine token-daten</p>;
  }
  const browserCost = stats.browser_cost_usd ?? 0;
  const total =
    stats.short_cost_usd + stats.deep_cost_usd + stats.chat_cost_usd + browserCost;
  return (
    <div className="space-y-4">
      <CostRow
        label="short"
        count={stats.short_count}
        tokensIn={stats.short_in}
        tokensOut={stats.short_out}
        cost={stats.short_cost_usd}
      />
      <CostRow
        label="deep"
        count={stats.deep_count}
        tokensIn={stats.deep_in}
        tokensOut={stats.deep_out}
        cost={stats.deep_cost_usd}
      />
      <CostRow
        label="chat"
        count={stats.chat_count}
        tokensIn={stats.chat_in}
        tokensOut={stats.chat_out}
        cost={stats.chat_cost_usd}
      />
      {(stats.browser_seconds ?? 0) > 0 && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-meta-strong">browser</span>
            <span className="tabular-nums text-body-sm">{formatUsd(browserCost)}</span>
          </div>
          <div className="text-meta tabular-nums">
            {formatBrowserDuration(stats.browser_seconds ?? 0)}
          </div>
        </div>
      )}
      <div className="pt-3 border-t border-[var(--color-hairline-light)]">
        <div className="flex items-baseline justify-between">
          <span className="text-meta-strong">gesamt</span>
          <span className="tabular-nums text-title">{formatUsd(total)}</span>
        </div>
      </div>
    </div>
  );
}

function CostRow({
  label,
  count,
  tokensIn,
  tokensOut,
  cost,
}: {
  label: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-meta-strong">
          {label} ({count})
        </span>
        <span className="tabular-nums text-body-sm">{formatUsd(cost)}</span>
      </div>
      <div className="text-meta tabular-nums">
        in {fmtNum(tokensIn)} / out {fmtNum(tokensOut)}
      </div>
    </div>
  );
}

function formatUsd(usd: number): string {
  if (usd === 0) return "0.00 $";
  if (usd < 0.01) return "<0.01 $";
  return `${usd.toFixed(2)} $`;
}

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatBrowserDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

// ---------- Progress ----------

function ProgressView({ exhibitors }: { exhibitors: ExhibitorLite[] }) {
  const total = exhibitors.length;
  if (total === 0) {
    return <p className="text-meta">keine daten — listing noch nicht durch</p>;
  }
  const shortDone = exhibitors.filter((e) => e.short_status === "done").length;
  const shortFailed = exhibitors.filter((e) => e.short_status === "failed").length;
  const shortRunning = exhibitors.filter((e) => e.short_status === "running").length;
  const shortDoneOrFailed = shortDone + shortFailed;
  const shortRemaining = total - shortDoneOrFailed;

  // ETA for short: ~6s per exhibitor at concurrency=5 → ~1.2s avg per item
  const etaSec = shortRemaining > 0 ? Math.round(shortRemaining * 1.2) : 0;

  return (
    <div className="space-y-5">
      <ProgressBar
        label="short-overviews"
        done={shortDoneOrFailed}
        running={shortRunning}
        total={total}
      />
      {shortRemaining > 0 && (
        <p className="text-meta">
          verbleibend ~{formatEta(etaSec)} (concurrency 5)
        </p>
      )}
    </div>
  );
}

function ProgressBar({
  label,
  done,
  running,
  total,
}: {
  label: string;
  done: number;
  running: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-meta-strong">{label}</span>
        <span className="tabular-nums text-body-sm">
          {done}/{total} · {pct}%
        </span>
      </div>
      <div className="relative h-1 bg-[var(--color-hairline-light)] overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 bg-[var(--color-near-black)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {running > 0 && (
        <div className="mt-1 text-meta inline-flex items-center gap-1">
          <GoldDot size={4} /> {running} laeuft
        </div>
      )}
    </div>
  );
}

function formatEta(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m} min ${s} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
