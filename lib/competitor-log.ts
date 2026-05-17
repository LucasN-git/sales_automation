import type { SupabaseClient } from "@supabase/supabase-js";

type Level = "info" | "warn" | "error";
type Phase =
  | "preparing"
  | "preparing_prompt"
  | "claude_research"
  | "persisting"
  | "done"
  | "failed"
  | "short_analysis"
  | string;

export async function appendDiscoveryLog(
  supabase: SupabaseClient,
  runId: string,
  userId: string,
  args: {
    level?: Level;
    phase?: Phase;
    message: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from("competitor_discovery_log").insert({
    run_id: runId,
    user_id: userId,
    level: args.level ?? "info",
    phase: args.phase ?? null,
    message: args.message,
    meta: args.meta ?? null,
  });
}

/**
 * Best-effort logger that swallows errors. Use inside Inngest steps where
 * a logging failure must not abort a step. Pendant zu tryAppendLog in
 * lib/crawl-log.ts.
 */
export async function tryAppendDiscoveryLog(
  supabase: SupabaseClient,
  runId: string,
  userId: string,
  args: Parameters<typeof appendDiscoveryLog>[3],
): Promise<void> {
  try {
    await appendDiscoveryLog(supabase, runId, userId, args);
  } catch {
    // ignore
  }
}

/**
 * Log a per-competitor event (no run required — e.g. short analysis steps).
 */
export async function appendCompetitorLog(
  supabase: SupabaseClient,
  competitorId: string,
  userId: string,
  args: {
    level?: Level;
    phase?: Phase;
    message: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from("competitor_discovery_log").insert({
    competitor_id: competitorId,
    user_id: userId,
    level: args.level ?? "info",
    phase: args.phase ?? null,
    message: args.message,
    meta: args.meta ?? null,
  });
}

export async function tryAppendCompetitorLog(
  supabase: SupabaseClient,
  competitorId: string,
  userId: string,
  args: Parameters<typeof appendCompetitorLog>[3],
): Promise<void> {
  try {
    await appendCompetitorLog(supabase, competitorId, userId, args);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// State snapshot for chat context (analog zu loadCrawlState in crawl-log.ts)
// ---------------------------------------------------------------------------

export type CompetitorStateBlock = {
  active_run: {
    id: string;
    status: string;
    current_phase: string | null;
    candidates_total: number | null;
    candidates_kept: number | null;
    error_message: string | null;
    started_at: string;
  } | null;
  short_counts: Record<string, number>;
  total_competitors: number;
  recent_logs: Array<{
    created_at: string;
    level: string;
    phase: string | null;
    message: string;
  }>;
};

export async function loadCompetitorState(
  supabase: SupabaseClient,
  userId: string,
): Promise<CompetitorStateBlock> {
  const { data: runRow } = await supabase
    .from("competitor_discovery_runs")
    .select("id, status, current_phase, candidates_total, candidates_kept, error_message, started_at")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const active_run =
    runRow &&
    (runRow.status === "pending" || runRow.status === "running")
      ? (runRow as CompetitorStateBlock["active_run"])
      : null;

  const { data: compRows } = await supabase
    .from("competitors")
    .select("short_status");

  const short_counts: Record<string, number> = {};
  for (const r of (compRows ?? []) as Array<{ short_status: string | null }>) {
    const s = r.short_status ?? "pending";
    short_counts[s] = (short_counts[s] ?? 0) + 1;
  }

  // Fetch recent log entries: prefer active run logs, else global user logs
  const { data: logRows } = active_run
    ? await supabase
        .from("competitor_discovery_log")
        .select("created_at, level, phase, message")
        .eq("run_id", active_run.id)
        .order("created_at", { ascending: false })
        .limit(20)
    : await supabase
        .from("competitor_discovery_log")
        .select("created_at, level, phase, message")
        .order("created_at", { ascending: false })
        .limit(20);

  return {
    active_run,
    short_counts,
    total_competitors: compRows?.length ?? 0,
    recent_logs: ((logRows ?? []) as Array<{
      created_at: string;
      level: string;
      phase: string | null;
      message: string;
    }>)
      .slice()
      .reverse(),
  };
}
