import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CrawlPlanSchema } from "@/lib/crawl-plan";
import { getSettings } from "@/lib/settings";
import { priceFor, priceForBrowserSec } from "@/lib/pricing";
import { LayoutShell } from "./LayoutShell";

export const dynamic = "force-dynamic";

export default async function ShowLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: show } = await supabase
    .from("trade_shows")
    .select(
      "id, name, status, current_step, error_message, crawl_plan, browserbase_session_seconds",
    )
    .eq("id", id)
    .single();
  if (!show) notFound();

  type TokenAgg = { tin: number; tout: number; cnt: number };
  type TokenStatsRpc = { short: TokenAgg; deep: TokenAgg; chat: TokenAgg };
  const ZERO_AGG: TokenAgg = { tin: 0, tout: 0, cnt: 0 };

  const [
    { data: exhibitorRows },
    { data: deepRows },
    { data: logEntries },
    { data: tokenStatsData },
    {
      data: { user },
    },
  ] = await Promise.all([
    supabase
      .from("exhibitors")
      .select("id, company_name, short_status, deep_status, current_step")
      .eq("trade_show_id", id),
    supabase
      .from("exhibitor_deep")
      .select("exhibitor_id, exhibitors!inner(trade_show_id)")
      .eq("exhibitors.trade_show_id", id),
    supabase
      .from("crawl_log")
      .select("id, level, phase, message, meta, created_at")
      .eq("trade_show_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.rpc("get_token_stats", { p_trade_show_id: id }),
    supabase.auth.getUser(),
  ]);

  const tokenSums = (tokenStatsData as TokenStatsRpc | null) ?? {
    short: ZERO_AGG,
    deep: ZERO_AGG,
    chat: ZERO_AGG,
  };
  const shortSum = tokenSums.short;
  const deepSum = tokenSums.deep;
  const chatSum = tokenSums.chat;

  const settings = user ? await getSettings(supabase, user.id) : null;

  const browserSec = (show as { browserbase_session_seconds?: number }).browserbase_session_seconds ?? 0;
  const tokenStats = {
    short_in: shortSum.tin,
    short_out: shortSum.tout,
    short_count: shortSum.cnt,
    deep_in: deepSum.tin,
    deep_out: deepSum.tout,
    deep_count: deepSum.cnt,
    chat_in: chatSum.tin,
    chat_out: chatSum.tout,
    chat_count: chatSum.cnt,
    browser_seconds: browserSec,
    short_cost_usd: priceFor(
      settings?.short_model ?? "claude-haiku-4-5-20251001",
      shortSum.tin,
      shortSum.tout,
    ),
    deep_cost_usd: priceFor(
      settings?.deep_model ?? "claude-sonnet-4-6",
      deepSum.tin,
      deepSum.tout,
    ),
    chat_cost_usd: priceFor(
      settings?.deep_model ?? "claude-sonnet-4-6",
      chatSum.tin,
      chatSum.tout,
    ),
    browser_cost_usd: priceForBrowserSec(browserSec),
  };

  const exhibitorsForSidebar = (exhibitorRows ?? []).map((e: any) => ({
    company_name: e.company_name,
    short_status: e.short_status,
    deep_status: e.deep_status,
    current_step: e.current_step,
  }));

  const exhibitorMap: Record<string, { name: string; hasDeep: boolean }> = {};
  const deepIds = new Set((deepRows ?? []).map((r: any) => r.exhibitor_id));
  for (const e of exhibitorRows ?? []) {
    exhibitorMap[(e as any).id] = {
      name: (e as any).company_name,
      hasDeep: deepIds.has((e as any).id),
    };
  }

  const crawlPlan =
    show.crawl_plan && CrawlPlanSchema.safeParse(show.crawl_plan).success
      ? CrawlPlanSchema.parse(show.crawl_plan)
      : null;

  const isActivelyCrawling =
    show.status === "queued" || show.status === "crawling";
  const hasRunningExhibitors = (exhibitorRows ?? []).some(
    (e: any) =>
      e.short_status === "running" ||
      e.deep_status === "running" ||
      e.deep_status === "pending",
  );
  const pollIntervalMs = isActivelyCrawling
    ? 5000
    : hasRunningExhibitors
      ? 15000
      : 0;

  return (
    <LayoutShell
      showId={id}
      showStatus={show.status}
      showCurrentStep={show.current_step ?? null}
      errorMessage={show.error_message ?? null}
      pollIntervalMs={pollIntervalMs}
      exhibitors={exhibitorsForSidebar}
      crawlPlan={crawlPlan}
      logEntries={logEntries ?? []}
      tokenStats={tokenStats}
      exhibitorMap={exhibitorMap}
    >
      {children}
    </LayoutShell>
  );
}
