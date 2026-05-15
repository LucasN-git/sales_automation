import { createClient } from "@/lib/supabase/server";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CompetitorChatScopeBinder } from "./CompetitorChatScopeBinder";

export async function CompetitorLayoutData() {
  const supabase = await createClient();

  const { data: competitorRows } = await supabase
    .from("competitors")
    .select("id, display_name, short_status, status");

  const competitorMap: Record<string, { name: string; shortStatus: string }> = {};
  for (const c of competitorRows ?? []) {
    competitorMap[c.id] = {
      name: c.display_name,
      shortStatus: c.short_status ?? "pending",
    };
  }

  // Auto-refresh when any competitor has short_status running/pending
  const hasRunning = (competitorRows ?? []).some(
    (c) => c.short_status === "running" || c.short_status === "pending",
  );

  return (
    <>
      {hasRunning && <AutoRefresh intervalMs={5000} />}
      <CompetitorChatScopeBinder competitorMap={competitorMap} />
    </>
  );
}
