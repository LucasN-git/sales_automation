import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChatScopeBinding } from "@/components/chat/ChatScopeProvider";
import { HelpRequestButton } from "@/components/HelpRequestButton";
import { ArrowRight } from "@/components/brand/Icons";
import { GoldDot } from "@/components/brand/GoldDot";
import { NewDiscoveryForm } from "./NewDiscoveryForm";
import { RunRowActions } from "./RunRowActions";

export const dynamic = "force-dynamic";

type RunRow = {
  id: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  current_phase: string | null;
  user_prompt: string | null;
  candidates_total: number | null;
  candidates_validated: number | null;
  candidates_added: number | null;
  web_search_uses: number | null;
  firecrawl_calls: number | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
};

const STATUS_LABELS: Record<RunRow["status"], string> = {
  pending: "wartet",
  running: "laeuft",
  done: "fertig",
  failed: "fehler",
  cancelled: "gestoppt",
};

export default async function ShowSearchPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("show_discovery_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, web_search_uses, firecrawl_calls, error_message, created_at, finished_at",
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <div className="text-body text-[var(--color-near-black)]/70">
        Fehler beim Laden der Laeufe: {error.message}
      </div>
    );
  }

  const runs = (data ?? []) as RunRow[];
  const activeRuns = runs.filter((r) => r.status === "pending" || r.status === "running");
  const anyActive = activeRuns.length > 0;

  return (
    <>
      {anyActive && <AutoRefresh intervalMs={5000} />}
      <ChatScopeBinding scope={{ kind: "show_discovery", focusRunId: null, focusName: null }} />

      <header className="mb-10">
        <h1 className="text-display">
          Messen suchen<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          Claude Opus 4.7 plus Web-Search findet systematisch relevante Industriemessen.
          Firecrawl validiert jede URL. Du entscheidest, welche zur Messeliste hinzugefuegt werden.
        </p>
        <div className="mt-4">
          <HelpRequestButton
            source="show-discovery"
            label="Messen-Suche"
            context={`Laeufe gesamt: ${runs.length}\nAktiv: ${activeRuns.length}`}
          />
        </div>
      </header>

      <NewDiscoveryForm />

      <section className="mt-14">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-meta-strong">laeufe</h2>
          <span className="text-meta text-[var(--color-near-black)]/40">
            {runs.length === 0 ? "noch keine" : `${runs.length} gesamt`}
            {activeRuns.length > 0 && ` , ${activeRuns.length} laeuft`}
          </span>
        </div>

        {runs.length === 0 ? (
          <div className="py-10 text-body text-[var(--color-near-black)]/50 box-line px-5">
            noch keine messen-suche gestartet. nutze das formular oben.
          </div>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function RunRow({ run }: { run: RunRow }) {
  const isLive = run.status === "pending" || run.status === "running";
  const date = new Date(run.created_at);
  const dateStr = date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  const timeStr = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const prompt = run.user_prompt?.trim() || "(kein Prompt)";
  const promptShort = prompt.length > 100 ? prompt.slice(0, 100) + "..." : prompt;
  const canCancel = isLive;
  const canResume = run.status === "cancelled" || run.status === "failed";

  return (
    <li className="relative">
      <Link
        href={`/shows/search/runs/${run.id}`}
        className="block px-5 py-4 pr-40 box-line hover:bg-[var(--color-near-black)]/[0.02] transition-colors"
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <StatusMark status={run.status} />
            <div className="min-w-0">
              <span className="text-subtitle block leading-snug">{promptShort}</span>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                <span className="text-meta tabular-nums text-[var(--color-near-black)]/55">
                  {dateStr} {timeStr}
                </span>
                {run.current_phase && isLive && (
                  <span className="text-meta text-[var(--color-near-black)]/55">
                    {run.current_phase}
                  </span>
                )}
                {run.status === "failed" && run.error_message && (
                  <span className="text-meta text-[var(--color-near-black)]/55 truncate max-w-md">
                    {run.error_message.slice(0, 80)}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5 shrink-0 self-start pt-px">
            {run.candidates_total !== null && (
              <span className="text-meta-strong tabular-nums">
                {run.candidates_added ?? 0}/{run.candidates_total} messen
              </span>
            )}
            <span className="inline-flex items-center gap-2 text-meta-strong">
              {isLive && <GoldDot size={6} />}
              {STATUS_LABELS[run.status]}
            </span>
            <ArrowRight size={13} className="text-[var(--color-near-black)]/30" />
          </div>
        </div>
      </Link>
      <div
        className="absolute top-1/2 right-3 -translate-y-1/2"
        onClick={(e) => e.stopPropagation()}
      >
        <RunRowActions runId={run.id} canCancel={canCancel} canResume={canResume} />
      </div>
    </li>
  );
}

function StatusMark({ status }: { status: RunRow["status"] }) {
  if (status === "pending" || status === "running") {
    return (
      <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 mt-0.5">
        <GoldDot size={8} />
      </span>
    );
  }
  if (status === "done") {
    return (
      <span
        className="shrink-0 inline-block w-2 h-2 mt-1.5"
        style={{ background: "var(--color-near-black)" }}
        aria-label="fertig"
      />
    );
  }
  if (status === "cancelled") {
    return (
      <span
        className="shrink-0 inline-block w-2 h-2 mt-1.5"
        style={{ background: "rgba(10,10,10,0.3)" }}
        aria-label="gestoppt"
      />
    );
  }
  return (
    <span
      className="shrink-0 inline-block w-2 h-2 mt-1.5"
      style={{ background: "var(--color-error)" }}
      aria-label="fehler"
    />
  );
}
