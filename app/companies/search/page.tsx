import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChatScopeBinding } from "@/components/chat/ChatScopeProvider";
import { ArrowRight } from "@/components/brand/Icons";
import { GoldDot } from "@/components/brand/GoldDot";
import { OpenSettingsButton } from "@/components/OpenSettingsButton";
import { NewSearchForm } from "./NewSearchForm";
import { SearchRunRowActions } from "./SearchRunRowActions";

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
  firecrawl_credits: number | null;
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

export default async function CompanySearchPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_search_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, web_search_uses, firecrawl_credits, error_message, created_at, finished_at",
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
      <ChatScopeBinding scope={{ kind: "company_search", focusRunId: null, focusName: null }} />

      <header className="mb-10">
        <h1 className="text-display">
          Unternehmen suchen<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          KI-gestuetzte Kunden-Discovery. Claude recherchiert potenzielle Abnehmer fuer ISP Power
          Systems Batterie- und Antriebssysteme. Firecrawl und Haiku erstellen ein Short-Overview
          pro Kandidat.
        </p>
        <div className="mt-4">
          <OpenSettingsButton
            tab="unternehmen"
            className="inline-flex items-center gap-1.5 text-ui-sm px-3 py-1.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-near-black)] hover:border-[var(--color-near-black)]/40 transition-colors"
          >
            kontext anzeigen
          </OpenSettingsButton>
        </div>
      </header>

      <NewSearchForm />

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
            noch keine kunden-suche gestartet. nutze das formular oben.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {runs.map((r) => (
              <RunRow key={r.id} run={r} />
            ))}
          </div>
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
  const promptShort = prompt.length > 120 ? prompt.slice(0, 120) + "..." : prompt;
  const canCancel = isLive;
  const canResume = run.status === "cancelled" || run.status === "failed";

  return (
    <div className="card-surface group flex flex-col">
      <Link
        href={`/companies/search/runs/${run.id}`}
        className="flex-1 block px-5 pt-5 pb-4"
      >
        <div className="flex items-start justify-between mb-4">
          <StatusMark status={run.status} />
          <ArrowRight
            size={13}
            className="text-[var(--color-near-black)]/30 group-hover:text-[var(--color-near-black)]/70 transition-colors"
          />
        </div>
        <span className="text-subtitle font-semibold leading-snug block">{promptShort}</span>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {run.current_phase && isLive && (
            <span className="text-meta text-[var(--color-near-black)]/55">
              {run.current_phase}
            </span>
          )}
          {run.status === "failed" && run.error_message && (
            <span className="text-meta text-[var(--color-near-black)]/55 line-clamp-1">
              {run.error_message.slice(0, 80)}
            </span>
          )}
        </div>
      </Link>
      <div className="px-5 pb-4 pt-3 border-t border-[var(--border-color-soft)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-meta tabular-nums text-[var(--color-near-black)]/55">
            {dateStr} {timeStr}
          </span>
          {run.candidates_total !== null && (
            <span className="text-meta-strong tabular-nums">
              {run.candidates_added ?? 0}/{run.candidates_total} uebernommen
            </span>
          )}
          <span className="inline-flex items-center gap-2 text-meta-strong">
            {isLive && <GoldDot size={6} />}
            {STATUS_LABELS[run.status]}
          </span>
        </div>
        <SearchRunRowActions runId={run.id} canCancel={canCancel} canResume={canResume} />
      </div>
    </div>
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
