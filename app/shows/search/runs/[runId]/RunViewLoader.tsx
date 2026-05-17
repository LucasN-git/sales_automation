import { createClient } from "@/lib/supabase/server";
import { priceFor, priceForWebSearch, formatCost } from "@/lib/pricing";
import {
  ShowDiscoveryResultCard,
  type ShowDiscoveryResult,
} from "@/components/show-discovery/ShowDiscoveryResultCard";
import { ShowDiscoveryFlowChart } from "@/components/show-discovery/ShowDiscoveryFlowChart";

type View = "ergebnisse" | "prozess" | "log" | "kosten";
type RunStatus = "pending" | "running" | "done" | "failed" | "cancelled";

type LogEntry = {
  id: number;
  phase: string | null;
  message: string;
  meta: Record<string, unknown> | null;
  level: "info" | "warn" | "error";
  created_at: string;
};

export async function RunViewLoader({
  view,
  runId,
  runStatus,
  currentPhase,
  errorMessage,
  candidatesTotal,
  candidatesValidated,
  candidatesAdded,
  webSearchUses,
  firecrawlCalls,
  tokensIn,
  tokensOut,
  model,
  finishedAt,
}: {
  view: View;
  runId: string;
  runStatus: RunStatus;
  currentPhase: string | null;
  errorMessage: string | null;
  candidatesTotal: number | null;
  candidatesValidated: number | null;
  candidatesAdded: number | null;
  webSearchUses: number | null;
  firecrawlCalls: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string | null;
  finishedAt: string | null;
}) {
  const supabase = await createClient();

  if (view === "ergebnisse") {
    const { data } = await supabase
      .from("show_discovery_results")
      .select("*")
      .eq("run_id", runId)
      .order("relevance_score", { ascending: false });
    const results = (data ?? []) as ShowDiscoveryResult[];
    return (
      <ErgebnisseView
        results={results}
        runId={runId}
        runStatus={runStatus}
        candidatesValidated={candidatesValidated}
      />
    );
  }

  if (view === "prozess") {
    const [{ data: logData }, { data: resultData }] = await Promise.all([
      supabase
        .from("show_discovery_log")
        .select("id, level, phase, message, meta, created_at")
        .eq("run_id", runId)
        .order("created_at", { ascending: true })
        .limit(500),
      supabase
        .from("show_discovery_results")
        .select(
          "id, name, website, firecrawl_status, firecrawl_extracted, added_trade_show_id",
        )
        .eq("run_id", runId),
    ]);
    return (
      <ShowDiscoveryFlowChart
        run={{
          status: runStatus,
          current_phase: currentPhase,
          candidates_total: candidatesTotal,
          candidates_validated: candidatesValidated,
          web_search_uses: webSearchUses,
          error_message: errorMessage,
        }}
        logEntries={(logData ?? []) as LogEntry[]}
        results={(resultData ?? []) as Parameters<typeof ShowDiscoveryFlowChart>[0]["results"]}
      />
    );
  }

  if (view === "log") {
    const { data } = await supabase
      .from("show_discovery_log")
      .select("id, level, phase, message, meta, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(300);
    return <LogList entries={(data ?? []) as LogEntry[]} />;
  }

  // view === "kosten"
  return (
    <KostenView
      runStatus={runStatus}
      tokensIn={tokensIn}
      tokensOut={tokensOut}
      webSearchUses={webSearchUses}
      firecrawlCalls={firecrawlCalls}
      model={model}
      finishedAt={finishedAt}
    />
  );
}

export function RunViewSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <div className="h-3 w-1/3 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
      <div className="h-3 w-full bg-[var(--color-near-black)]/[0.04] animate-pulse" />
      <div className="h-3 w-5/6 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
      <div className="h-3 w-4/6 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
    </div>
  );
}

function ErgebnisseView({
  results,
  runId,
  runStatus,
  candidatesValidated,
}: {
  results: ShowDiscoveryResult[];
  runId: string;
  runStatus: RunStatus;
  candidatesValidated: number | null;
}) {
  const isLive = runStatus === "pending" || runStatus === "running";
  const active = results.filter((r) => !r.dismissed);
  const dismissed = results.filter((r) => r.dismissed);

  if (results.length === 0) {
    return (
      <div className="py-10 text-body text-[var(--color-near-black)]/55 box-line px-5">
        {isLive ? "Claude recherchiert ... Ergebnisse erscheinen hier sobald sie eintreffen." : "Keine Ergebnisse."}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-meta-strong">{active.length} messen gefunden</span>
        {candidatesValidated !== null && (
          <span className="text-meta text-[var(--color-near-black)]/50">
            {candidatesValidated} URLs validiert
          </span>
        )}
      </div>
      <div className="space-y-3">
        {active.map((r) => (
          <ShowDiscoveryResultCard key={r.id} result={r} runId={runId} />
        ))}
      </div>
      {dismissed.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-meta text-[var(--color-near-black)]/45 hover:text-[var(--color-near-black)] transition-colors">
            {dismissed.length} ignoriert
          </summary>
          <div className="mt-3 space-y-2 opacity-60">
            {dismissed.map((r) => (
              <div key={r.id} className="box-line px-4 py-2 text-body-sm">
                {r.name}
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function LogList({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="py-10 text-body text-[var(--color-near-black)]/55 box-line px-5">
        Noch keine Log-Eintraege.
      </div>
    );
  }

  const levelColor: Record<string, string> = {
    info: "text-[var(--color-near-black)]/65",
    warn: "text-[var(--color-gold)]",
    error: "text-[var(--color-near-black)]",
  };

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-meta-strong">{entries.length} Eintraege</span>
      </div>
      <div className="box-line divide-y divide-[var(--border-color-soft)] max-h-[70vh] overflow-y-auto isp-list-scroll">
        {entries.map((e) => (
          <div key={e.id} className="px-4 py-2.5 flex items-start gap-4">
            <span className="text-meta tabular-nums text-[var(--color-near-black)]/35 shrink-0 pt-px w-14">
              {new Date(e.created_at).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            {e.phase && (
              <span className="text-meta text-[var(--color-near-black)]/45 shrink-0 pt-px w-28 truncate">
                {e.phase}
              </span>
            )}
            <span className={`text-body-sm flex-1 min-w-0 ${levelColor[e.level] ?? ""}`}>
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function KostenView({
  runStatus,
  tokensIn,
  tokensOut,
  webSearchUses,
  firecrawlCalls,
  model,
  finishedAt,
}: {
  runStatus: RunStatus;
  tokensIn: number | null;
  tokensOut: number | null;
  webSearchUses: number | null;
  firecrawlCalls: number | null;
  model: string | null;
  finishedAt: string | null;
}) {
  const isRunning = runStatus === "pending" || runStatus === "running";
  const effectiveModel = model ?? "claude-opus-4-7";
  const tIn = tokensIn ?? 0;
  const tOut = tokensOut ?? 0;
  const ws = webSearchUses ?? 0;
  const fc = firecrawlCalls ?? 0;

  const tokenCost = tIn > 0 || tOut > 0 ? priceFor(effectiveModel, tIn, tOut) : null;
  const wsCost = ws > 0 ? priceForWebSearch(ws) : null;
  const totalCost = (tokenCost ?? 0) + (wsCost ?? 0);

  const rows: { label: string; value: string; sub?: string }[] = [
    { label: "Modell", value: effectiveModel },
    {
      label: "Tokens (Input)",
      value: tIn > 0 ? tIn.toLocaleString("de-DE") : isRunning ? "laeuft..." : "-",
    },
    {
      label: "Tokens (Output)",
      value: tOut > 0 ? tOut.toLocaleString("de-DE") : isRunning ? "laeuft..." : "-",
    },
    {
      label: "Token-Kosten",
      value: tokenCost !== null ? formatCost(tokenCost) : isRunning ? "laeuft..." : "-",
      sub: "Opus 4.7: $15 / $75 pro 1M",
    },
    {
      label: "Web-Searches",
      value: ws > 0 ? `${ws} x $0.01` : isRunning ? "laeuft..." : "-",
      sub: wsCost !== null ? formatCost(wsCost) : undefined,
    },
    {
      label: "Firecrawl-Calls",
      value: fc > 0 ? String(fc) : "-",
      sub: "Firecrawl-Credits separat",
    },
  ];

  return (
    <div>
      {runStatus === "done" && finishedAt && (
        <div className="mb-4 text-meta text-[var(--color-near-black)]/40">
          abgeschlossen {new Date(finishedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}

      <div className="box-line divide-y divide-[var(--border-color-soft)]">
        {rows.map((row) => (
          <div key={row.label} className="px-5 py-3 flex items-baseline justify-between gap-6">
            <div>
              <span className="text-body-sm text-[var(--color-near-black)]/65">{row.label}</span>
              {row.sub && (
                <span className="block text-meta text-[var(--color-near-black)]/35">{row.sub}</span>
              )}
            </div>
            <span className="text-body-sm font-semibold shrink-0 tabular-nums">{row.value}</span>
          </div>
        ))}
      </div>

      {totalCost > 0 && (
        <div className="mt-4 px-5 py-4 box-line-strong flex items-baseline justify-between">
          <span className="text-body-sm font-semibold">Gesamt (Anthropic)</span>
          <span className="text-title" style={{ color: "var(--color-gold)" }}>
            {formatCost(totalCost)}
          </span>
        </div>
      )}

      {isRunning && (
        <p className="mt-3 text-meta text-[var(--color-near-black)]/45">
          Token-Daten werden nach Abschluss des Claude-Calls gespeichert.
        </p>
      )}
    </div>
  );
}
