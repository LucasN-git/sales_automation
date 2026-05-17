import { createClient } from "@/lib/supabase/server";
import { priceFor, priceForBrowserSec } from "@/lib/pricing";
import { PhasesView } from "@/components/show-views/PhasesView";
import { LogView } from "@/components/show-views/LogView";
import { CostView } from "@/components/show-views/CostView";
import { ProgressView } from "@/components/show-views/ProgressView";
import { CrawlPlanSchema, type CrawlPlan } from "@/lib/crawl-plan";
import type {
  ExhibitorLite,
  LogEntry,
  TokenStats,
} from "@/components/show-views/types";
import { ShowSettingsForm } from "./settings/ShowSettingsForm";

type View = "prozess" | "log" | "kosten" | "progress" | "einstellungen";

type UrlSearchStatusFull =
  | "idle"
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "url_not_found";

type UrlSearchEvidenceFull = {
  url: string | null;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  searched_at?: string;
} | null;

type TokenAgg = { tin: number; tout: number; cnt: number };
type TokenStatsRpc = { short: TokenAgg; deep: TokenAgg; chat: TokenAgg };
const ZERO_AGG: TokenAgg = { tin: 0, tout: 0, cnt: 0 };

export async function ShowViewLoader({
  view,
  showId,
  showStatus,
  showCurrentStep,
  errorMessage,
  crawlPlan,
  exhibitors,
  browserSec,
  shortModel,
  deepModel,
}: {
  view: View;
  showId: string;
  showStatus: string;
  showCurrentStep: string | null;
  errorMessage: string | null;
  crawlPlan: CrawlPlan | null;
  exhibitors: ExhibitorLite[];
  browserSec: number;
  shortModel: string;
  deepModel: string;
}) {
  if (view === "einstellungen") {
    const supabase = await createClient();
    const { data: show } = await supabase
      .from("trade_shows")
      .select(
        "id, name, source_url, year, chat_context, crawl_plan, expected_exhibitor_count, status, url_search_status, url_search_evidence",
      )
      .eq("id", showId)
      .single();
    if (!show) return null;

    const crawlPlanParsed = show.crawl_plan
      ? CrawlPlanSchema.safeParse(show.crawl_plan)
      : null;
    const crawlPlanForSettings = crawlPlanParsed?.success
      ? crawlPlanParsed.data
      : null;

    return (
      <ShowSettingsForm
        showId={showId}
        initial={{
          name: show.name,
          source_url: show.source_url ?? "",
          year: show.year ?? null,
          chat_context: show.chat_context ?? "",
          expected_exhibitor_count: show.expected_exhibitor_count ?? null,
          crawl_plan: crawlPlanForSettings,
          crawl_plan_raw:
            (show.crawl_plan as Record<string, unknown> | null) ?? null,
          url_search_status: ((show as { url_search_status?: string })
            .url_search_status ?? "idle") as UrlSearchStatusFull,
          url_search_evidence:
            (show as { url_search_evidence?: UrlSearchEvidenceFull })
              .url_search_evidence ?? null,
        }}
      />
    );
  }

  if (view === "prozess") {
    return (
      <PhasesView
        showStatus={showStatus}
        showCurrentStep={showCurrentStep}
        errorMessage={errorMessage}
        exhibitors={exhibitors}
        crawlPlan={crawlPlan}
      />
    );
  }

  if (view === "progress") {
    return <ProgressView exhibitors={exhibitors} />;
  }

  // Log + Kosten brauchen extra DB-Hits.
  const supabase = await createClient();

  if (view === "log") {
    const { data: logEntries } = await supabase
      .from("crawl_log")
      .select("id, level, phase, message, meta, created_at")
      .eq("trade_show_id", showId)
      .order("created_at", { ascending: false })
      .limit(50);
    return <LogView entries={(logEntries ?? []) as LogEntry[]} />;
  }

  // view === "kosten"
  const { data: tokenStatsData } = await supabase.rpc("get_token_stats", {
    p_trade_show_id: showId,
  });
  const tokenSums = (tokenStatsData as TokenStatsRpc | null) ?? {
    short: ZERO_AGG,
    deep: ZERO_AGG,
    chat: ZERO_AGG,
  };
  const tokenStats: TokenStats = {
    short_in: tokenSums.short.tin,
    short_out: tokenSums.short.tout,
    short_count: tokenSums.short.cnt,
    deep_in: tokenSums.deep.tin,
    deep_out: tokenSums.deep.tout,
    deep_count: tokenSums.deep.cnt,
    chat_in: tokenSums.chat.tin,
    chat_out: tokenSums.chat.tout,
    chat_count: tokenSums.chat.cnt,
    browser_seconds: browserSec,
    short_cost_usd: priceFor(shortModel, tokenSums.short.tin, tokenSums.short.tout),
    deep_cost_usd: priceFor(deepModel, tokenSums.deep.tin, tokenSums.deep.tout),
    chat_cost_usd: priceFor(deepModel, tokenSums.chat.tin, tokenSums.chat.tout),
    browser_cost_usd: priceForBrowserSec(browserSec),
  };
  return <CostView stats={tokenStats} />;
}

export function ShowViewSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <div className="h-3 w-1/3 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
      <div className="h-3 w-full bg-[var(--color-near-black)]/[0.04] animate-pulse" />
      <div className="h-3 w-5/6 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
      <div className="h-3 w-4/6 bg-[var(--color-near-black)]/[0.04] animate-pulse" />
    </div>
  );
}
