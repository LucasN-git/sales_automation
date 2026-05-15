import type { SupabaseClient } from "@supabase/supabase-js";

type Level = "info" | "warn" | "error";
type Phase =
  | "preparing"
  | "preparing_prompt"
  | "claude_research"
  | "persisting"
  | "firecrawl_validation"
  | "done"
  | "failed"
  | "web_search"
  | "claude_submit"
  | "firecrawl_start"
  | "firecrawl_done"
  | string;

export async function appendShowDiscoveryLog(
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
  await supabase.from("show_discovery_log").insert({
    run_id: runId,
    user_id: userId,
    level: args.level ?? "info",
    phase: args.phase ?? null,
    message: args.message,
    meta: args.meta ?? null,
  });
}

export async function tryAppendShowDiscoveryLog(
  supabase: SupabaseClient,
  runId: string,
  userId: string,
  args: Parameters<typeof appendShowDiscoveryLog>[3],
): Promise<void> {
  try {
    await appendShowDiscoveryLog(supabase, runId, userId, args);
  } catch {
    // ignore — logging must never abort a step
  }
}
