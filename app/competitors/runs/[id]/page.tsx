import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { AutoRefresh } from "@/components/AutoRefresh";
import { getSettings, effectiveCompetitorDiscovery } from "@/lib/settings";
import {
  CompetitorRunViewLoader,
  CompetitorRunViewSkeleton,
} from "./CompetitorRunViewLoader";
import type {
  DiscoveryPhaseKey,
  DiscoveryRunStatus,
} from "@/components/competitor-views/DiscoveryPhasesView";

export const dynamic = "force-dynamic";

type ViewParam = "prozess" | "log" | "kosten";
const VIEWS: ViewParam[] = ["prozess", "log", "kosten"];

function parseView(v: string | undefined): ViewParam {
  return v && (VIEWS as string[]).includes(v) ? (v as ViewParam) : "prozess";
}

const STATUS_LABELS: Record<DiscoveryRunStatus, string> = {
  pending: "wartet",
  running: "laeuft",
  done: "fertig",
  failed: "fehlgeschlagen",
};

const PHASE_LABELS: Record<DiscoveryPhaseKey, string> = {
  preparing: "Vorbereitung",
  preparing_prompt: "Prompt wird zusammengestellt",
  claude_research: "Claude recherchiert",
  persisting: "Vorschlaege werden gespeichert",
  done: "abgeschlossen",
  failed: "abgebrochen",
};

export default async function CompetitorRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view = parseView(sp.view);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: run } = await supabase
    .from("competitor_discovery_runs")
    .select(
      "id, user_id, status, current_phase, model, candidates_total, candidates_kept, tokens_in, tokens_out, web_search_uses, web_search_cost_usd, error_message, created_at, finished_at",
    )
    .eq("id", id)
    .single();

  if (!run) notFound();

  const settings = await getSettings(supabase, user.id);
  const eff = settings ? effectiveCompetitorDiscovery(settings) : null;

  const status = run.status as DiscoveryRunStatus;
  const currentPhase = (run.current_phase as DiscoveryPhaseKey | null) ?? null;
  const isLive = status === "pending" || status === "running";

  return (
    <>
      {isLive && <AutoRefresh intervalMs={4000} />}

      <header className="mb-10">
        <h1 className="text-display">
          discovery-lauf
          {isLive && <span style={{ color: "var(--color-gold)" }}>.</span>}
        </h1>
        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          <span className="inline-flex items-center gap-2">
            {isLive && <GoldDot size={6} />}
            {STATUS_LABELS[status]}
          </span>
          {currentPhase && status !== "done" && (
            <span>{PHASE_LABELS[currentPhase] ?? currentPhase}</span>
          )}
          <span className="tabular-nums">
            {formatRelative(run.created_at as string)} gestartet
          </span>
          {run.finished_at && (
            <span className="tabular-nums">
              · dauer {formatDuration(
                run.created_at as string,
                run.finished_at as string,
              )}
            </span>
          )}
          {run.candidates_total !== null && (
            <span className="tabular-nums">
              {run.candidates_kept ?? 0}/{run.candidates_total} gespeichert
            </span>
          )}
        </div>
        {status === "failed" && run.error_message && (
          <div className="mt-4 px-4 py-3 border-l-2 border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.03]">
            <div className="text-meta-strong mb-1">Fehler</div>
            <div className="text-body-sm text-[var(--color-near-black)]/85 break-words">
              {run.error_message}
            </div>
          </div>
        )}
      </header>

      <Suspense fallback={<CompetitorRunViewSkeleton />}>
        <CompetitorRunViewLoader
          view={view}
          runId={id}
          runStatus={status}
          currentPhase={currentPhase}
          errorMessage={(run.error_message as string | null) ?? null}
          candidatesTotal={(run.candidates_total as number | null) ?? null}
          candidatesKept={(run.candidates_kept as number | null) ?? null}
          webSearchUses={(run.web_search_uses as number | null) ?? null}
          webSearchCostUsd={
            run.web_search_cost_usd !== null
              ? Number(run.web_search_cost_usd)
              : null
          }
          tokensIn={(run.tokens_in as number | null) ?? null}
          tokensOut={(run.tokens_out as number | null) ?? null}
          model={(run.model as string | null) ?? eff?.model ?? null}
          maxWebSearches={eff?.max_web_searches ?? null}
        />
      </Suspense>
    </>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "gerade";
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} h`;
  const day = Math.floor(h / 24);
  return `vor ${day} t`;
}

function formatDuration(startIso: string, endIso: string): string {
  const sec = Math.max(
    0,
    Math.floor((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000),
  );
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  const restSec = sec % 60;
  return restSec > 0 ? `${min} min ${restSec} s` : `${min} min`;
}
