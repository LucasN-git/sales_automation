import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getShowExhibitorStatus } from "@/lib/show-status";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ShowChatScopeBinder } from "./ShowChatScopeBinder";

export async function ShowLayoutData({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: show }, statusRows, { data: deepRowsRaw }] = await Promise.all([
    supabase.from("trade_shows").select("id, status").eq("id", id).single(),
    getShowExhibitorStatus(id),
    supabase
      .from("exhibitor_deep")
      .select("exhibitor_id, exhibitors!inner(trade_show_id)")
      .eq("exhibitors.trade_show_id", id),
  ]);
  if (!show) notFound();

  const deepIds = new Set(
    (deepRowsRaw ?? []).map((r: { exhibitor_id: string }) => r.exhibitor_id),
  );
  const exhibitorMap: Record<string, { name: string; hasDeep: boolean; deepStatus: string; currentStep: string | null }> = {};
  for (const e of statusRows) {
    exhibitorMap[e.id] = {
      name: e.company_name,
      hasDeep: deepIds.has(e.id),
      deepStatus: e.deep_status,
      currentStep: e.current_step ?? null,
    };
  }

  const isActivelyCrawling = show.status === "queued" || show.status === "crawling";
  const hasRunningExhibitors = statusRows.some(
    (e) =>
      e.short_status === "running" ||
      e.short_status === "pending" ||
      e.deep_status === "running" ||
      e.deep_status === "pending",
  );
  const pollIntervalMs = isActivelyCrawling || hasRunningExhibitors ? 5000 : 0;

  return (
    <>
      {pollIntervalMs > 0 && <AutoRefresh intervalMs={pollIntervalMs} />}
      <ShowChatScopeBinder showId={id} exhibitorMap={exhibitorMap} showStatus={show.status} />
    </>
  );
}
