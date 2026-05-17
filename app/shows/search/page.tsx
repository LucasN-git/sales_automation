"use client";

import { useState, useEffect, useTransition, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { ShowDiscoveryFlowChart } from "@/components/show-discovery/ShowDiscoveryFlowChart";
import {
  ShowDiscoveryResultCard,
  type ShowDiscoveryResult,
} from "@/components/show-discovery/ShowDiscoveryResultCard";
import { priceFor, priceForWebSearch, formatCost } from "@/lib/pricing";
import { apiFetch } from "@/lib/api-fetch";
import { useReportErrorSafe } from "@/components/ErrorReportProvider";

type Run = {
  id: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  current_phase: string | null;
  user_prompt: string | null;
  candidates_total: number | null;
  candidates_validated: number | null;
  candidates_added: number | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  web_search_uses: number | null;
  firecrawl_calls: number | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

type LogEntry = {
  id: number;
  phase: string | null;
  message: string;
  meta: Record<string, unknown> | null;
  level: "info" | "warn" | "error";
  created_at: string;
};

const POLL_INTERVAL_MS = 4000;

export default function ShowSearchPage() {
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "prozess";
  const reportError = useReportErrorSafe();

  const [prompt, setPrompt] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [results, setResults] = useState<ShowDiscoveryResult[]>([]);

  const [pastRuns, setPastRuns] = useState<Run[]>([]);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load past runs on mount.
  useEffect(() => {
    loadPastRuns();
  }, []);

  async function loadPastRuns() {
    const r = await apiFetch<{ runs: Run[] }>("/api/show-discovery", { reporter: reportError });
    if (r.ok) setPastRuns(r.data.runs ?? []);
  }

  // Polling while a run is active.
  useEffect(() => {
    if (!activeRunId) return;
    if (
      activeRun?.status === "done" ||
      activeRun?.status === "failed" ||
      activeRun?.status === "cancelled"
    )
      return;

    const poll = async () => {
      await Promise.all([
        pollRun(activeRunId),
        pollLog(activeRunId),
        pollResults(activeRunId),
      ]);
    };

    poll();
    pollingRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeRunId, activeRun?.status]);

  async function pollRun(runId: string) {
    const r = await apiFetch<{ run: Run }>(`/api/show-discovery/${runId}`, { reporter: reportError });
    if (r.ok && r.data.run) setActiveRun(r.data.run);
  }

  async function pollLog(runId: string) {
    const r = await apiFetch<{ entries: LogEntry[] }>(`/api/show-discovery/${runId}/log`, { reporter: reportError });
    if (r.ok) setLogEntries(r.data.entries ?? []);
  }

  async function pollResults(runId: string) {
    const r = await apiFetch<{ results: ShowDiscoveryResult[] }>(`/api/show-discovery/${runId}/results`, { reporter: reportError });
    if (r.ok) setResults(r.data.results ?? []);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setError(null);
    setActiveRun(null);
    setLogEntries([]);
    setResults([]);

    startTransition(async () => {
      const r = await apiFetch<{ runId: string }>("/api/show-discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_prompt: prompt.trim() }),
        reporter: reportError,
        meta: { promptLength: prompt.trim().length },
      });
      if (!r.ok) {
        setError(`${r.error} (Bug-Report unten rechts).`);
        return;
      }
      const runId = r.data.runId;
      if (!runId) {
        setError("Server-Antwort enthielt keine runId.");
        return;
      }
      setActiveRunId(runId);
      setActiveRun({ id: runId, status: "pending", current_phase: null, user_prompt: prompt.trim(), candidates_total: null, candidates_validated: null, candidates_added: null, model: null, tokens_in: null, tokens_out: null, web_search_uses: null, firecrawl_calls: null, error_message: null, created_at: new Date().toISOString(), finished_at: null });
      loadPastRuns();
    });
  }

  async function handleLoadRun(run: Run) {
    setActiveRunId(run.id);
    setActiveRun(run);
    setLogEntries([]);
    setResults([]);
    await Promise.all([pollLog(run.id), pollResults(run.id)]);
  }

  async function handleCancelRun(runId: string) {
    const r = await apiFetch(`/api/show-discovery/${runId}/cancel`, {
      method: "POST",
      reporter: reportError,
    });
    if (r.ok) {
      await Promise.all([loadPastRuns(), runId === activeRunId ? pollRun(runId) : Promise.resolve()]);
    }
  }

  async function handleResumeRun(runId: string) {
    const r = await apiFetch(`/api/show-discovery/${runId}/resume`, {
      method: "POST",
      reporter: reportError,
    });
    if (r.ok) {
      setActiveRunId(runId);
      setLogEntries([]);
      setResults([]);
      await Promise.all([loadPastRuns(), pollRun(runId)]);
    }
  }

  async function handleDeleteRun(runId: string) {
    if (!confirm("Diesen Lauf endgueltig loeschen? Ergebnisse und Log werden mit entfernt.")) return;
    const r = await apiFetch(`/api/show-discovery/${runId}`, {
      method: "DELETE",
      reporter: reportError,
    });
    if (r.ok) {
      if (runId === activeRunId) {
        setActiveRunId(null);
        setActiveRun(null);
        setLogEntries([]);
        setResults([]);
      }
      await loadPastRuns();
    }
  }

  const isRunning = activeRun?.status === "pending" || activeRun?.status === "running";
  const isDone = activeRun?.status === "done";
  const activeResults = results.filter((r) => !r.dismissed);
  const dismissedResults = results.filter((r) => r.dismissed);

  return (
    <div className="max-w-3xl">
      <header className="mb-10">
        <h1 className="text-display">
          Messen suchen<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          Claude Opus 4.7 + Web-Search findet systematisch relevante Industriemessen.
          Firecrawl validiert jede URL. Du entscheidest, welche zur Messeliste hinzugefuegt werden.
        </p>
      </header>

      {/* Log view */}
      {view === "log" && (
        <SearchLogView logEntries={logEntries} run={activeRun} />
      )}

      {/* Kosten view */}
      {view === "kosten" && (
        <SearchKostenView run={activeRun} />
      )}

      {/* Prozess view (default) */}
      {view === "prozess" && <>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-10">
        <label className="block text-meta-strong mb-2">
          Suchfokus
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="z.B. Defense und Aerospace Shows Europa 2026-2027, kein UK. Oder: Industrieautomation und mobile Robotik DACH."
          rows={3}
          disabled={pending}
          className="w-full border border-[var(--color-near-black)]/40 bg-transparent px-4 py-3 text-body placeholder:text-[var(--color-near-black)]/35 resize-none focus:outline-none focus:border-[var(--color-near-black)] disabled:opacity-50"
        />
        <div className="mt-3 flex items-center justify-between gap-4">
          <p className="text-meta text-[var(--color-near-black)]/50">
            ca. $0.25-0.40 pro Lauf &middot; 3-5 Min &middot; Claude Opus 4.7
          </p>
          <button
            type="submit"
            disabled={pending}
            className="flex items-center gap-2 px-5 py-2.5 text-body-sm font-semibold border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {pending ? (
              <>
                <GoldDot size={6} />
                <span>startet...</span>
              </>
            ) : isRunning ? (
              "Neue Suche starten"
            ) : (
              "Suche starten"
            )}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-body-sm text-[var(--color-near-black)]/70">{error}</p>
        )}
      </form>

      {/* Active run: flowchart */}
      {activeRun && (
        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-meta-strong">prozess</h2>
            {activeRun.status === "done" && (
              <span className="text-meta text-[var(--color-near-black)]/50">
                abgeschlossen
              </span>
            )}
            {isRunning && (
              <span className="text-meta flex items-center gap-2">
                <GoldDot size={6} />
                laeuft
              </span>
            )}
          </div>
          <ShowDiscoveryFlowChart
            run={activeRun}
            logEntries={logEntries}
            results={results}
          />
        </section>
      )}

      {/* Results */}
      {isDone && results.length > 0 && (
        <section className="mb-12">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-meta-strong">
              {activeResults.length} Messen gefunden
            </h2>
            {activeRun?.candidates_validated !== null && (
              <span className="text-meta text-[var(--color-near-black)]/50">
                {activeRun.candidates_validated} URLs validiert
              </span>
            )}
          </div>
          <div className="space-y-4">
            {activeResults.map((r) => (
              <ShowDiscoveryResultCard key={r.id} result={r} runId={activeRun!.id} />
            ))}
          </div>

          {dismissedResults.length > 0 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-meta text-[var(--color-near-black)]/45 hover:text-[var(--color-near-black)] transition-colors">
                {dismissedResults.length} ignoriert
              </summary>
              <div className="mt-3 space-y-3 opacity-50">
                {dismissedResults.map((r) => (
                  <div key={r.id} className="border border-[var(--color-hairline-light)] px-4 py-2 text-body-sm">
                    {r.name}
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* Past runs */}
      {pastRuns.length > 0 && (
        <section>
          <h2 className="text-meta-strong mb-4">vergangene laeufe</h2>
          <ul className="space-y-2">
            {pastRuns.map((run) => {
              const isActive = run.id === activeRunId;
              const canCancel = run.status === "pending" || run.status === "running";
              const canResume = run.status === "cancelled" || run.status === "failed";
              return (
                <li key={run.id}>
                  <div
                    className={`flex items-center gap-2 px-4 py-3 border transition-colors ${
                      isActive
                        ? "border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.03]"
                        : "border-[var(--color-hairline-light)] hover:border-[var(--color-near-black)]/30"
                    }`}
                  >
                    <button
                      onClick={() => handleLoadRun(run)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="flex items-baseline justify-between gap-4">
                        <div className="flex items-baseline gap-3 min-w-0">
                          <RunStatusBadge status={run.status} />
                          <span className="text-body-sm truncate">
                            {run.user_prompt?.slice(0, 80) ?? "(kein Prompt)"}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-3 shrink-0">
                          {run.candidates_total !== null && (
                            <span className="text-meta text-[var(--color-near-black)]/50">
                              {run.candidates_total} Messen
                            </span>
                          )}
                          <span className="text-meta text-[var(--color-near-black)]/40">
                            {new Date(run.created_at).toLocaleDateString("de-DE")}
                          </span>
                        </div>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {canCancel && (
                        <RunActionButton
                          label="Stoppen"
                          onClick={() => handleCancelRun(run.id)}
                        />
                      )}
                      {canResume && (
                        <RunActionButton
                          label="Fortsetzen"
                          onClick={() => handleResumeRun(run.id)}
                        />
                      )}
                      <RunActionButton
                        label="Loeschen"
                        onClick={() => handleDeleteRun(run.id)}
                        danger
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      </>}
    </div>
  );
}

function SearchLogView({ logEntries, run }: { logEntries: LogEntry[]; run: Run | null }) {
  if (!run) {
    return (
      <div className="py-12 text-body text-[var(--color-near-black)]/50 box-line px-5">
        Kein aktiver Lauf. Starte eine Suche oder waehle einen vergangenen Lauf.
      </div>
    );
  }

  if (logEntries.length === 0) {
    return (
      <div className="py-12 text-body text-[var(--color-near-black)]/50 box-line px-5">
        Noch keine Log-Eintraege.
      </div>
    );
  }

  const levelColor: Record<string, string> = {
    info: "text-[var(--color-near-black)]/50",
    warn: "text-[var(--color-gold)]",
    error: "text-[var(--color-near-black)]",
  };

  return (
    <div className="space-y-0">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-meta-strong">log</h2>
        <span className="text-meta text-[var(--color-near-black)]/40">
          {logEntries.length} Eintraege
        </span>
      </div>
      <div className="border border-[var(--color-hairline-light)] divide-y divide-[var(--color-hairline-light)] max-h-[70vh] overflow-y-auto isp-list-scroll">
        {logEntries.map((e) => (
          <div key={e.id} className="px-4 py-2.5 flex items-start gap-4">
            <span className="text-meta tabular-nums text-[var(--color-near-black)]/35 shrink-0 pt-px w-14">
              {new Date(e.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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
    </div>
  );
}

function SearchKostenView({ run }: { run: Run | null }) {
  if (!run) {
    return (
      <div className="py-12 text-body text-[var(--color-near-black)]/50 box-line px-5">
        Kein aktiver Lauf. Starte eine Suche oder waehle einen vergangenen Lauf.
      </div>
    );
  }

  const isRunning = run.status === "pending" || run.status === "running";
  const tokensIn = run.tokens_in ?? 0;
  const tokensOut = run.tokens_out ?? 0;
  const model = run.model ?? "claude-opus-4-7";
  const webSearchUses = run.web_search_uses ?? 0;
  const firecrawlCalls = run.firecrawl_calls ?? 0;

  const tokenCost = tokensIn > 0 || tokensOut > 0 ? priceFor(model, tokensIn, tokensOut) : null;
  const webSearchCost = webSearchUses > 0 ? priceForWebSearch(webSearchUses) : null;
  const totalCost = (tokenCost ?? 0) + (webSearchCost ?? 0);

  const rows: { label: string; value: string; sub?: string }[] = [
    { label: "Modell", value: model },
    {
      label: "Tokens (Input)",
      value: tokensIn > 0 ? tokensIn.toLocaleString("de-DE") : isRunning ? "laeuft..." : "—",
    },
    {
      label: "Tokens (Output)",
      value: tokensOut > 0 ? tokensOut.toLocaleString("de-DE") : isRunning ? "laeuft..." : "—",
    },
    {
      label: "Token-Kosten",
      value: tokenCost !== null ? formatCost(tokenCost) : isRunning ? "laeuft..." : "—",
      sub: "Opus 4.7: $15/$75 pro 1M",
    },
    {
      label: "Web-Searches",
      value: webSearchUses > 0 ? `${webSearchUses} × $0.01` : isRunning ? "laeuft..." : "—",
      sub: webSearchCost !== null ? formatCost(webSearchCost) : undefined,
    },
    {
      label: "Firecrawl-Calls",
      value: firecrawlCalls > 0 ? String(firecrawlCalls) : "—",
      sub: "Firecrawl-Credits separat",
    },
  ];

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-meta-strong">kosten</h2>
        {run.status === "done" && run.finished_at && (
          <span className="text-meta text-[var(--color-near-black)]/40">
            abgeschlossen {new Date(run.finished_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>

      <div className="border border-[var(--color-hairline-light)] divide-y divide-[var(--color-hairline-light)]">
        {rows.map((row) => (
          <div key={row.label} className="px-5 py-3 flex items-baseline justify-between gap-6">
            <div>
              <span className="text-body-sm text-[var(--color-near-black)]/65">{row.label}</span>
              {row.sub && (
                <span className="block text-meta text-[var(--color-near-black)]/35">{row.sub}</span>
              )}
            </div>
            <span className="text-body-sm font-semibold shrink-0">{row.value}</span>
          </div>
        ))}
      </div>

      {totalCost > 0 && (
        <div className="mt-4 px-5 py-4 border border-[var(--color-near-black)] flex items-baseline justify-between">
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

function RunStatusBadge({ status }: { status: Run["status"] }) {
  if (status === "done") {
    return (
      <span
        className="shrink-0 inline-block w-2 h-2"
        style={{ background: "var(--color-near-black)" }}
      />
    );
  }
  if (status === "running" || status === "pending") {
    return <GoldDot size={6} />;
  }
  if (status === "cancelled") {
    return (
      <span
        className="shrink-0 inline-block w-2 h-2"
        style={{ background: "rgba(10,10,10,0.30)" }}
        title="gestoppt"
      />
    );
  }
  return (
    <span className="shrink-0 text-[10px] font-bold text-[var(--color-near-black)]/50">×</span>
  );
}

function RunActionButton({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`px-2 py-1 text-meta border transition-colors ${
        danger
          ? "border-[var(--color-hairline-light)] text-[var(--color-near-black)]/60 hover:border-[var(--color-near-black)] hover:text-[var(--color-near-black)]"
          : "border-[var(--color-hairline-light)] text-[var(--color-near-black)]/70 hover:border-[var(--color-near-black)] hover:text-[var(--color-near-black)]"
      }`}
    >
      {label}
    </button>
  );
}
