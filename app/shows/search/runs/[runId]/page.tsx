import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChatScopeBinding } from "@/components/chat/ChatScopeProvider";
import { HelpRequestButton } from "@/components/HelpRequestButton";
import { RunRowActions } from "../../RunRowActions";
import { RunViewLoader, RunViewSkeleton } from "./RunViewLoader";

export const dynamic = "force-dynamic";

type ViewParam = "ergebnisse" | "prozess" | "log" | "kosten";
const VIEWS: ViewParam[] = ["ergebnisse", "prozess", "log", "kosten"];

const VIEW_LABELS: Record<ViewParam, string> = {
  ergebnisse: "Ergebnisse",
  prozess: "Prozess",
  log: "Log",
  kosten: "Kosten",
};

type RunStatus = "pending" | "running" | "done" | "failed" | "cancelled";

const STATUS_LABELS: Record<RunStatus, string> = {
  pending: "wartet",
  running: "laeuft",
  done: "fertig",
  failed: "fehlgeschlagen",
  cancelled: "gestoppt",
};

function parseView(v: string | undefined): ViewParam {
  return v && (VIEWS as string[]).includes(v) ? (v as ViewParam) : "ergebnisse";
}

export default async function ShowDiscoveryRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { runId } = await params;
  const sp = await searchParams;
  const view = parseView(sp.view);
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, model, tokens_in, tokens_out, web_search_uses, firecrawl_calls, error_message, created_at, finished_at",
    )
    .eq("id", runId)
    .maybeSingle();

  if (!run) notFound();

  const status = run.status as RunStatus;
  const isLive = status === "pending" || status === "running";
  const canCancel = isLive;
  const canResume = status === "cancelled" || status === "failed";
  const prompt = (run.user_prompt as string | null)?.trim() || "(kein Prompt)";
  const promptShort = prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt;

  return (
    <>
      {isLive && <AutoRefresh intervalMs={4000} />}
      <ChatScopeBinding
        scope={{ kind: "show_discovery", focusRunId: runId, focusName: promptShort }}
      />

      <div className="mb-6 text-meta">
        <Link
          href="/shows/search"
          className="hover:text-[var(--color-near-black)] transition-colors"
        >
          &larr; zur Lauf-Liste
        </Link>
      </div>

      <header className="mb-10">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-display">
            Lauf
            {isLive && <span style={{ color: "var(--color-gold)" }}>.</span>}
          </h1>
        </div>
        <p className="mt-3 text-body text-[var(--color-near-black)]/80 max-w-2xl">
          {prompt}
        </p>
        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          <span className="inline-flex items-center gap-2">
            {isLive && <GoldDot size={6} />}
            {STATUS_LABELS[status]}
          </span>
          {run.current_phase && status !== "done" && status !== "failed" && (
            <span>{run.current_phase as string}</span>
          )}
          <span className="tabular-nums">
            {formatDate(run.created_at as string)} gestartet
          </span>
          {run.finished_at && (
            <span className="tabular-nums">
              dauer {formatDuration(run.created_at as string, run.finished_at as string)}
            </span>
          )}
          {run.candidates_total !== null && (
            <span className="tabular-nums">
              {run.candidates_added ?? 0}/{run.candidates_total} messen
            </span>
          )}
        </div>
        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <RunRowActions runId={runId} canCancel={canCancel} canResume={canResume} />
          <HelpRequestButton
            source="show-discovery"
            label={`Lauf ${runId.slice(0, 8)}`}
            context={`Run ID: ${runId}\nStatus: ${status}${run.current_phase ? `\nPhase: ${run.current_phase}` : ""}${run.error_message ? `\nFehler: ${run.error_message}` : ""}`}
          />
        </div>
        {status === "failed" && run.error_message && (
          <div className="mt-4 px-4 py-3 border-l-2 border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.03]">
            <div className="text-meta-strong mb-1">Fehler</div>
            <div className="text-body-sm text-[var(--color-near-black)]/85 break-words">
              {run.error_message as string}
            </div>
          </div>
        )}
      </header>

      {view !== "ergebnisse" && (
        <h2 className="text-title mb-6">
          {VIEW_LABELS[view]}
          {!isLive && <span style={{ color: "var(--color-gold)" }}>.</span>}
        </h2>
      )}

      <Suspense fallback={<RunViewSkeleton />}>
        <RunViewLoader
          view={view}
          runId={runId}
          runStatus={status}
          currentPhase={(run.current_phase as string | null) ?? null}
          errorMessage={(run.error_message as string | null) ?? null}
          candidatesTotal={(run.candidates_total as number | null) ?? null}
          candidatesValidated={(run.candidates_validated as number | null) ?? null}
          candidatesAdded={(run.candidates_added as number | null) ?? null}
          webSearchUses={(run.web_search_uses as number | null) ?? null}
          firecrawlCalls={(run.firecrawl_calls as number | null) ?? null}
          tokensIn={(run.tokens_in as number | null) ?? null}
          tokensOut={(run.tokens_out as number | null) ?? null}
          model={(run.model as string | null) ?? null}
          finishedAt={(run.finished_at as string | null) ?? null}
        />
      </Suspense>
    </>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startIso: string, endIso: string): string {
  const sec = Math.max(
    0,
    Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000),
  );
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return rest > 0 ? `${min}m ${rest}s` : `${min}m`;
}
