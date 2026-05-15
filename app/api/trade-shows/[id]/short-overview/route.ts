import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { notifyOrchestratorThread } from "@/lib/chat-notify";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: show } = await supabase
    .from("trade_shows")
    .select("id")
    .eq("id", id)
    .single();
  if (!show) return NextResponse.json({ error: "not found" }, { status: 404 });

  await inngest.send({
    name: "short-overview.bulk-requested",
    data: { tradeShowId: id },
  });

  const { count } = await supabase
    .from("exhibitors")
    .select("id", { count: "exact", head: true })
    .eq("trade_show_id", id)
    .in("short_status", ["pending", "failed"]);
  const n = count ?? 0;
  const msg = n > 0
    ? `Short-Overview gestartet fuer ${n} Aussteller (~${(n * 0.02).toFixed(2)} EUR) — per UI-Button.`
    : "Short-Overview gestartet — per UI-Button.";

  await notifyOrchestratorThread(supabase, id, user.id, msg, "trigger_short_overview");

  return NextResponse.json({ ok: true });
}
