"use client";

import { GoldDot } from "@/components/brand/GoldDot";

type RunStatus = "pending" | "running" | "done" | "failed";

type LogEntry = {
  id: number;
  phase: string | null;
  message: string;
  meta: Record<string, unknown> | null;
  level: "info" | "warn" | "error";
  created_at: string;
};

type DiscoveryResult = {
  id: string;
  name: string;
  website: string | null;
  firecrawl_status: "pending" | "running" | "done" | "failed" | "skipped";
  firecrawl_extracted: Record<string, unknown> | null;
  added_trade_show_id: string | null;
};

type Run = {
  status: RunStatus;
  current_phase: string | null;
  candidates_total: number | null;
  candidates_validated: number | null;
  web_search_uses: number | null;
  error_message: string | null;
};

export function ShowDiscoveryFlowChart({
  run,
  logEntries,
  results,
}: {
  run: Run;
  logEntries: LogEntry[];
  results: DiscoveryResult[];
}) {
  const webSearchLogs = logEntries.filter((e) => e.phase === "web_search");
  const claudeSubmitLog = logEntries.find((e) => e.phase === "claude_submit");
  const isClaudeDone = !!claudeSubmitLog || run.current_phase === "firecrawl_validation" || run.current_phase === "done" || run.status === "done";
  const isClaudeRunning = run.current_phase === "claude_research" && run.status === "running";
  const isPreparingDone = ["preparing_prompt", "claude_research", "persisting", "firecrawl_validation", "done", "failed"].includes(run.current_phase ?? "");
  const isPrepPromptDone = ["claude_research", "persisting", "firecrawl_validation", "done", "failed"].includes(run.current_phase ?? "") || isClaudeDone;

  const toValidate = results.filter((r) => r.firecrawl_status !== "skipped");
  const validatedCount = results.filter((r) => r.firecrawl_status === "done").length;
  const failedCount = results.filter((r) => r.firecrawl_status === "failed").length;

  return (
    <div className="space-y-0">

      {/* Node 0: Lauf gestartet */}
      <FlowNode
        status="done"
        label="Lauf gestartet"
        detail={`Modell: Claude Opus 4.7`}
      />
      <FlowConnector />

      {/* Node 1: Prompt */}
      <FlowNode
        status={isPreparingDone ? "done" : run.current_phase === "preparing" ? "running" : "pending"}
        label="Lauf vorbereiten"
        detail="Settings, Prio-Kontext und Katalog laden"
      />
      <FlowConnector />

      <FlowNode
        status={isPrepPromptDone ? "done" : run.current_phase === "preparing_prompt" ? "running" : "pending"}
        label="Prompt zusammenstellen"
        detail="System-Prompt + ISP-Katalog als gecachte Blocks"
      />
      <FlowConnector />

      {/* Node 2: Claude recherchiert */}
      <FlowNode
        status={isClaudeDone ? "done" : isClaudeRunning ? "running" : "pending"}
        label="Claude Opus 4.7 recherchiert"
        detail={
          isClaudeRunning
            ? "Durchsucht Defense, Aerospace, Robotics, Maritime... (dauert 3-5 Min)"
            : isClaudeDone && run.web_search_uses !== null
            ? `${run.web_search_uses} Web-Searches durchgefuehrt`
            : "Anthropic Web-Search aktiv (bis zu 15 Suchen)"
        }
        running={isClaudeRunning}
      />

      {/* Web Search Queries block — appears after Claude is done */}
      {webSearchLogs.length > 0 && (
        <>
          <FlowConnector dashed />
          <WebSearchBlock queries={webSearchLogs} />
        </>
      )}

      {claudeSubmitLog && (
        <>
          <FlowConnector />
          <FlowNode
            status="done"
            label={`${(claudeSubmitLog.meta?.candidates_count as number | null) ?? 0} Messen eingereicht`}
            detail={
              claudeSubmitLog.meta?.reasoning
                ? `Reflexion: ${String(claudeSubmitLog.meta.reasoning).slice(0, 120)}...`
                : undefined
            }
            gold
          />
        </>
      )}

      {/* Firecrawl validation block */}
      {results.length > 0 && (
        <>
          <FlowConnector />
          <FlowNode
            status={
              run.status === "done" ? "done" :
              run.current_phase === "firecrawl_validation" ? "running" : "pending"
            }
            label={
              run.status === "done"
                ? `Firecrawl abgeschlossen: ${validatedCount} validiert${failedCount > 0 ? `, ${failedCount} fehlgeschlagen` : ""}`
                : `Firecrawl-Validierung (${validatedCount}/${toValidate.length} URLs validiert)`
            }
            detail="4 parallele Firecrawl-Sessions"
          />
          <FlowConnector dashed />
          <FirecrawlResultList results={results} />
        </>
      )}

      {run.status === "failed" && (
        <>
          <FlowConnector />
          <FlowNode
            status="failed"
            label="Lauf fehlgeschlagen"
            detail={run.error_message ?? "Unbekannter Fehler"}
          />
        </>
      )}
    </div>
  );
}

function FlowNode({
  status,
  label,
  detail,
  gold = false,
  running = false,
}: {
  status: "pending" | "running" | "done" | "failed";
  label: string;
  detail?: string;
  gold?: boolean;
  running?: boolean;
}) {
  const borderColor =
    status === "done" && gold
      ? "border-[var(--color-gold)]"
      : status === "done"
      ? "border-[var(--color-near-black)]"
      : status === "running"
      ? "border-[var(--color-gold)]"
      : status === "failed"
      ? "border-[var(--color-near-black)]"
      : "border-[var(--color-hairline-light)]";

  return (
    <div className={`border ${borderColor} px-4 py-3 bg-[var(--color-cream)] relative overflow-hidden`}>
      {running && (
        <div
          className="absolute bottom-0 left-0 right-0 h-0.5"
          style={{
            background: `linear-gradient(90deg, transparent 0%, var(--color-gold) 50%, transparent 100%)`,
            backgroundSize: "200% 100%",
            animation: "isp-loading-slide 1.8s linear infinite",
          }}
        />
      )}
      <div className="flex items-center gap-3">
        <NodeMarker status={status} />
        <span
          className={`text-body font-semibold ${status === "pending" ? "text-[var(--color-near-black)]/45" : ""}`}
        >
          {label}
        </span>
      </div>
      {detail && (
        <div className="mt-1 ml-7 text-body-sm text-[var(--color-near-black)]/65">
          {detail}
        </div>
      )}
    </div>
  );
}

function NodeMarker({ status }: { status: "pending" | "running" | "done" | "failed" }) {
  if (status === "done") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 border border-[var(--color-near-black)] text-[10px] font-bold shrink-0">
        ✓
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 shrink-0">
        <GoldDot size={8} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center justify-center w-4 h-4 border border-[var(--color-near-black)] text-[10px] font-bold shrink-0">
        ×
      </span>
    );
  }
  return <span className="inline-flex items-center justify-center w-4 h-4 border border-[var(--color-hairline-light)] shrink-0" />;
}

function FlowConnector({ dashed = false }: { dashed?: boolean }) {
  return (
    <div className="flex justify-start pl-[1.35rem]">
      <div
        className="w-px h-5 my-0"
        style={{
          background: dashed
            ? "repeating-linear-gradient(to bottom, rgba(10,10,10,0.18) 0, rgba(10,10,10,0.18) 3px, transparent 3px, transparent 6px)"
            : "rgba(10,10,10,0.18)",
        }}
      />
    </div>
  );
}

function WebSearchBlock({ queries }: { queries: LogEntry[] }) {
  return (
    <div className="border border-[var(--color-hairline-light)] bg-[var(--color-cream)]">
      <div className="px-4 py-2 border-b border-[var(--color-hairline-light)]">
        <span className="text-meta-strong">{queries.length} Web-Searches</span>
      </div>
      <ul className="divide-y divide-[var(--color-hairline-light)] max-h-72 overflow-y-auto">
        {queries.map((q) => {
          const qNum = (q.meta?.query_number as number | null) ?? 0;
          const queryText = (q.meta?.query_text as string | null) ?? q.message.replace(/^Q\d+\s+/, "");
          const resultCount = (q.meta?.result_count as number | null) ?? 0;
          return (
            <li key={q.id} className="px-4 py-2 flex items-baseline gap-3">
              <span className="text-meta tabular-nums text-[var(--color-near-black)]/45 shrink-0 w-8">
                Q{String(qNum).padStart(2, "0")}
              </span>
              <span className="text-body-sm text-[var(--color-near-black)]/80 min-w-0 flex-1 truncate">
                {queryText}
              </span>
              {resultCount > 0 && (
                <span className="text-meta text-[var(--color-near-black)]/45 shrink-0">
                  {resultCount} Treffer
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FirecrawlResultList({ results }: { results: DiscoveryResult[] }) {
  const sorted = [...results].sort((a, b) => {
    const order = { running: 0, pending: 1, done: 2, skipped: 3, failed: 4 };
    return (order[a.firecrawl_status] ?? 5) - (order[b.firecrawl_status] ?? 5);
  });

  return (
    <div className="border border-[var(--color-hairline-light)] bg-[var(--color-cream)]">
      <div className="px-4 py-2 border-b border-[var(--color-hairline-light)]">
        <span className="text-meta-strong">{results.length} Messen-Kandidaten</span>
      </div>
      <ul className="divide-y divide-[var(--color-hairline-light)] max-h-[28rem] overflow-y-auto">
        {sorted.map((r) => {
          const exhibitorCount = r.firecrawl_extracted?.exhibitor_count as number | undefined;
          return (
            <li key={r.id} className="px-4 py-2.5 flex items-center gap-3">
              <FirecrawlStatusIcon status={r.firecrawl_status} />
              <span className="text-body-sm flex-1 min-w-0">
                {r.added_trade_show_id ? (
                  <a
                    href={`/shows/${r.added_trade_show_id}`}
                    className="hover:text-[var(--color-gold)] transition-colors"
                  >
                    {r.name}
                  </a>
                ) : (
                  r.name
                )}
              </span>
              <span className="text-meta text-[var(--color-near-black)]/45 shrink-0">
                {r.firecrawl_status === "done" && exhibitorCount
                  ? `${exhibitorCount} Aussteller`
                  : r.firecrawl_status === "running"
                  ? "laeuft..."
                  : r.firecrawl_status === "skipped"
                  ? "keine URL"
                  : r.firecrawl_status === "failed"
                  ? "Fehler"
                  : "wartet"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FirecrawlStatusIcon({ status }: { status: DiscoveryResult["firecrawl_status"] }) {
  if (status === "done") {
    return (
      <span
        className="shrink-0 w-3 h-3 inline-block"
        style={{ background: "var(--color-gold)", borderRadius: 0 }}
      />
    );
  }
  if (status === "running") {
    return (
      <span className="shrink-0">
        <GoldDot size={6} />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="shrink-0 text-[10px] font-bold text-[var(--color-near-black)]/60">×</span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="shrink-0 w-3 h-3 inline-block border border-[var(--color-hairline-light)]" />
    );
  }
  // pending
  return (
    <span className="shrink-0 w-3 h-3 inline-block border border-[var(--color-hairline-light)]" />
  );
}
