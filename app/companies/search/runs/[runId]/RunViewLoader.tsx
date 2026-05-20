import { createClient } from "@/lib/supabase/server";
import { priceFor, priceForWebSearch, formatCost } from "@/lib/pricing";
import {
  CompanySearchResultCard,
  type CompanySearchResult,
} from "@/components/company-search/CompanySearchResultCard";

type View = "ergebnisse" | "log" | "kosten";
type RunStatus = "pending" | "running" | "done" | "failed" | "cancelled";

type LogEntry = {
  id: string;
  phase: string | null;
  message: string;
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
  firecrawlCredits,
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
  firecrawlCredits: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string | null;
  finishedAt: string | null;
}) {
  const supabase = await createClient();

  if (view === "ergebnisse") {
    const { data } = await supabase
      .from("company_search_results")
      .select("*")
      .eq("run_id", runId)
      .order("relevance_score", { ascending: false });
    const results = (data ?? []) as CompanySearchResult[];
    return (
      <ErgebnisseView
        results={results}
        runId={runId}
        runStatus={runStatus}
        candidatesTotal={candidatesTotal}
        candidatesValidated={candidatesValidated}
        candidatesAdded={candidatesAdded}
      />
    );
  }

  if (view === "log") {
    const { data } = await supabase
      .from("company_search_log")
      .select("id, level, phase, message, created_at")
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
      firecrawlCredits={firecrawlCredits}
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
  candidatesTotal,
  candidatesValidated,
  candidatesAdded,
}: {
  results: CompanySearchResult[];
  runId: string;
  runStatus: RunStatus;
  candidatesTotal: number | null;
  candidatesValidated: number | null;
  candidatesAdded: number | null;
}) {
  const isLive = runStatus === "pending" || runStatus === "running";
  const active = results.filter((r) => !r.dismissed);
  const dismissed = results.filter((r) => r.dismissed);

  if (results.length === 0) {
    return (
      <div className="py-10 text-body text-[var(--color-near-black)]/55 box-line px-5">
        {isLive
          ? "Claude recherchiert ... Ergebnisse erscheinen hier sobald sie eintreffen."
          : "Keine Ergebnisse."}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-meta-strong">{active.length} kandidaten</span>
        <div className="flex items-center gap-4 text-meta text-[var(--color-near-black)]/50">
          {candidatesValidated !== null && (
            <span>{candidatesValidated} analysiert</span>
          )}
          {candidatesAdded !== null && candidatesAdded > 0 && (
            <span>{candidatesAdded} uebernommen</span>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {active.map((r) => (
          <CompanySearchResultCard key={r.id} result={r} runId={runId} />
        ))}
      </div>
      {dismissed.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-meta text-[var(--color-near-black)]/45 hover:text-[var(--color-near-black)] transition-colors">
            {dismissed.length} abgelehnt
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
  firecrawlCredits,
  model,
  finishedAt,
}: {
  runStatus: RunStatus;
  tokensIn: number | null;
  tokensOut: number | null;
  webSearchUses: number | null;
  firecrawlCredits: number | null;
  model: string | null;
  finishedAt: string | null;
}) {
  const isRunning = runStatus === "pending" || runStatus === "running";
  const effectiveModel = model ?? "claude-opus-4-7";
  const tIn = tokensIn ?? 0;
  const tOut = tokensOut ?? 0;
  const ws = webSearchUses ?? 0;
  const fc = firecrawlCredits ?? 0;

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
      label: "Firecrawl-Credits",
      value: fc > 0 ? String(fc) : "-",
      sub: "Firecrawl-Credits separat abgerechnet",
    },
  ];

  return (
    <div>
      {runStatus === "done" && finishedAt && (
        <div className="mb-4 text-meta text-[var(--color-near-black)]/40">
          abgeschlossen{" "}
          {new Date(finishedAt).toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )}

      <div className="box-line divide-y divide-[var(--border-color-soft)]">
        {rows.map((row) => (
          <div key={row.label} className="px-5 py-3 flex items-baseline justify-between gap-6">
            <div>
              <span className="text-body-sm text-[var(--color-near-black)]/65">{row.label}</span>
              {row.sub && (
                <span className="block text-meta text-[var(--color-near-black)]/35">
                  {row.sub}
                </span>
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
