import { createClient } from "@/lib/supabase/server";
import { priceFor, priceForWebSearch } from "@/lib/pricing";
import { LogView } from "@/components/show-views/LogView";
import {
  DiscoveryPhasesView,
  type DiscoveryPhaseKey,
  type DiscoveryRunStatus,
} from "@/components/competitor-views/DiscoveryPhasesView";
import { DiscoveryCostView } from "@/components/competitor-views/DiscoveryCostView";
import type { LogEntry } from "@/components/show-views/types";
import { COMPETITOR_DISCOVERY_MODEL_DEFAULT } from "@/lib/claude";

type View = "prozess" | "log" | "kosten";

export async function CompetitorRunViewLoader({
  view,
  runId,
  runStatus,
  currentPhase,
  errorMessage,
  candidatesTotal,
  candidatesKept,
  webSearchUses,
  webSearchCostUsd,
  tokensIn,
  tokensOut,
  model,
  maxWebSearches,
}: {
  view: View;
  runId: string;
  runStatus: DiscoveryRunStatus;
  currentPhase: DiscoveryPhaseKey | null;
  errorMessage: string | null;
  candidatesTotal: number | null;
  candidatesKept: number | null;
  webSearchUses: number | null;
  webSearchCostUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  model: string | null;
  maxWebSearches: number | null;
}) {
  if (view === "prozess") {
    return (
      <DiscoveryPhasesView
        runStatus={runStatus}
        currentPhase={currentPhase}
        errorMessage={errorMessage}
        candidatesTotal={candidatesTotal}
        candidatesKept={candidatesKept}
        webSearchUses={webSearchUses}
        maxWebSearches={maxWebSearches}
      />
    );
  }

  if (view === "log") {
    const supabase = await createClient();
    const { data: logEntries } = await supabase
      .from("competitor_discovery_log")
      .select("id, level, phase, message, meta, created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: false })
      .limit(200);
    return <LogView entries={(logEntries ?? []) as LogEntry[]} />;
  }

  // view === "kosten"
  const effectiveModel = model ?? COMPETITOR_DISCOVERY_MODEL_DEFAULT;
  const tokensCost = priceFor(effectiveModel, tokensIn ?? 0, tokensOut ?? 0);
  const wsCost =
    webSearchCostUsd ?? priceForWebSearch(webSearchUses ?? 0);
  return (
    <DiscoveryCostView
      stats={{
        model: effectiveModel,
        tokens_in: tokensIn,
        tokens_out: tokensOut,
        tokens_cost_usd: tokensCost,
        web_search_uses: webSearchUses,
        web_search_cost_usd: wsCost,
      }}
    />
  );
}

export function CompetitorRunViewSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <div className="h-3 w-1/3 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
      <div className="h-3 w-full bg-[var(--color-near-black)]/[0.04] animate-pulse" />
      <div className="h-3 w-5/6 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
      <div className="h-3 w-4/6 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
    </div>
  );
}
