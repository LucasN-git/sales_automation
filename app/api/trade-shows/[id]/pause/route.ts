import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { tryAppendLog } from "@/lib/crawl-log";
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

  const { data: show, error: showError } = await supabase
    .from("trade_shows")
    .select("id, status, current_step")
    .eq("id", id)
    .single();
  if (showError || !show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Pause is allowed during the discovery/listing pipeline (status crawling
  // or queued) AND during the short-overview bulk run (status='ready' but
  // there are still pending or running short-overviews).
  let phase: string;
  if (["queued", "crawling"].includes(show.status)) {
    phase = (show.current_step ?? "").startsWith("listing")
      ? "listing"
      : show.current_step ?? "discovery";
  } else if (show.status === "ready") {
    const { count: activeShorts } = await supabase
      .from("exhibitors")
      .select("id", { count: "exact", head: true })
      .eq("trade_show_id", id)
      .in("short_status", ["pending", "running"]);
    if (!activeShorts || activeShorts === 0) {
      return NextResponse.json(
        { error: `cannot pause: no active phase from status ${show.status}` },
        { status: 409 },
      );
    }
    phase = "short";
  } else {
    return NextResponse.json(
      { error: `cannot pause from status ${show.status}` },
      { status: 409 },
    );
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("trade_shows")
    .update({ status: "paused", paused_phase: phase })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await tryAppendLog(admin, id, {
    phase,
    level: "warn",
    message: "Pause vom User angefordert",
  });

  await notifyOrchestratorThread(
    supabase,
    id,
    user.id,
    `Pipeline pausiert (Phase: ${phase}) — per UI-Button. Schreib 'fortsetzen' wenn du die Pipeline wieder starten moechtest.`,
    "pause_pipeline",
  );

  return NextResponse.json({ ok: true, paused_phase: phase });
}
