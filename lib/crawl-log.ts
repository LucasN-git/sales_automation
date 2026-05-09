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
