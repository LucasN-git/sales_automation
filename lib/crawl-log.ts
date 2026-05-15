import type { SupabaseClient } from "@supabase/supabase-js";

type Level = "info" | "warn" | "error";
type Phase = "discovery" | "listing" | "short" | "deep" | "chat" | string;

export async function appendLog(
  supabase: SupabaseClient,
  tradeShowId: string,
  args: {
    level?: Level;
    phase?: Phase;
    message: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from("crawl_log").insert({
    trade_show_id: tradeShowId,
    level: args.level ?? "info",
    phase: args.phase ?? null,
    message: args.message,
    meta: args.meta ?? null,
  });
}

/**
 * Best-effort logger that swallows errors. Use inside Inngest steps where
 * a logging failure must not abort a step.
 */
export async function tryAppendLog(
  supabase: SupabaseClient,
  tradeShowId: string,
  args: Parameters<typeof appendLog>[2],
): Promise<void> {
  try {
    await appendLog(supabase, tradeShowId, args);
  } catch {
    // ignore
  }
}

// Live-Crawl-Stand fuer den Show-Chat. Wird bei jedem Chat-Request frisch
// gezogen und un-cached an Claude weitergereicht. Damit kann Claude
// Fragen wie "was passiert grade?" oder "warum dauert das?" beantworten,
// ohne dass der User auf die Sidebar-LogView wechseln muss.
export type CrawlStateBlock = {
  status: string | null;
  paused_phase: string | null;
  current_step: string | null;
  expected_exhibitor_count: number | null;
  actual_exhibitor_count: number;
  short_counts: Record<string, number>;
  deep_counts: Record<string, number>;
  browserbase_session_seconds: number | null;
  recent_logs: Array<{
    created_at: string;
    level: string;
    phase: string | null;
    message: string;
  }>;
};

export async function loadCrawlState(
  supabase: SupabaseClient,
  showId: string,
): Promise<CrawlStateBlock | null> {
  const { data: show } = await supabase
    .from("trade_shows")
    .select(
      "status, paused_phase, current_step, expected_exhibitor_count, browserbase_session_seconds",
    )
    .eq("id", showId)
    .maybeSingle();
  if (!show) return null;

  const { data: exRows } = await supabase
    .from("exhibitors")
    .select("short_status, deep_status")
    .eq("trade_show_id", showId)
    .range(0, 4999);

  const short_counts: Record<string, number> = {};
  const deep_counts: Record<string, number> = {};
  for (const r of (exRows ?? []) as Array<{
    short_status: string | null;
    deep_status: string | null;
  }>) {
    if (r.short_status) {
      short_counts[r.short_status] = (short_counts[r.short_status] ?? 0) + 1;
    }
    if (r.deep_status) {
      deep_counts[r.deep_status] = (deep_counts[r.deep_status] ?? 0) + 1;
    }
  }

  const { data: logs } = await supabase
    .from("crawl_log")
    .select("created_at, level, phase, message")
    .eq("trade_show_id", showId)
    .order("created_at", { ascending: false })
    .limit(20);

  const s = show as {
    status: string | null;
    paused_phase: string | null;
    current_step: string | null;
    expected_exhibitor_count: number | null;
    browserbase_session_seconds: number | null;
  };

  return {
    status: s.status,
    paused_phase: s.paused_phase,
    current_step: s.current_step,
    expected_exhibitor_count: s.expected_exhibitor_count,
    actual_exhibitor_count: exRows?.length ?? 0,
    short_counts,
    deep_counts,
    browserbase_session_seconds: s.browserbase_session_seconds,
    recent_logs: ((logs ?? []) as Array<{
      created_at: string;
      level: string;
      phase: string | null;
      message: string;
    }>)
      .slice()
      .reverse(),
  };
}
