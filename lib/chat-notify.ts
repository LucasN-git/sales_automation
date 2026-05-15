import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Inserts a synthetic assistant message into the most recent show-level chat
 * thread (no exhibitor_focus). Used by UI-button API routes so the orchestrator
 * is aware of actions the user took outside the chat (pause, resume, restart,
 * short-overview, re-listing).
 *
 * Silently no-ops if no thread exists yet for this show.
 */
export async function notifyOrchestratorThread(
  supabase: SupabaseClient,
  showId: string,
  userId: string,
  content: string,
  tool: string,
  toolInput: Record<string, unknown> = {},
): Promise<void> {
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("trade_show_id", showId)
    .is("exhibitor_focus", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) return;

  await supabase.from("chat_messages").insert({
    trade_show_id: showId,
    user_id: userId,
    thread_id: thread.id,
    role: "assistant",
    content,
    pipeline_action: [{ tool, input: toolInput, result: content }],
  });

  await supabase
    .from("chat_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", thread.id);
}
