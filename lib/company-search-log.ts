import type { SupabaseClient } from "@supabase/supabase-js";

type Level = "info" | "warn" | "error";

export async function appendCompanySearchLog(
  supabase: SupabaseClient,
  runId: string,
  userId: string,
  args: {
    level?: Level;
    phase?: string;
    message: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from("company_search_log").insert({
    run_id: runId,
    user_id: userId,
    level: args.level ?? "info",
    phase: args.phase ?? null,
    message: args.message,
    meta: args.meta ?? null,
  });
}

export async function tryAppendCompanySearchLog(
  supabase: SupabaseClient,
  runId: string,
  userId: string,
  args: Parameters<typeof appendCompanySearchLog>[3],
): Promise<void> {
  try {
    await appendCompanySearchLog(supabase, runId, userId, args);
  } catch {
    // ignore — logging must never abort a step
  }
}
