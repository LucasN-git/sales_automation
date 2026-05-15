import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
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
    .select("id, status, paused_phase")
    .eq("id", id)
    .single();
  if (showError || !show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (show.status !== "paused") {
    return NextResponse.json(
      { error: `cannot resume from status ${show.status}` },
      { status: 409 },
    );
  }

  const phase = show.paused_phase ?? "discovery";

  // Resume restores the show to the correct status for its phase. Short-phase
  // resumes go back to 'ready' (listing was already complete); pipeline-phase
  // resumes go back to 'queued' so the crawl-trade-show function reactivates.
  const restoreStatus = phase === "short" ? "ready" : "queued";

  const admin = createServiceRoleClient();
  await admin
    .from("trade_shows")
    .update({ status: restoreStatus, paused_phase: null, current_step: null })
    .eq("id", id);

  await tryAppendLog(admin, id, {
    phase,
    message: `Resume von ${phase}`,
  });

  // Re-trigger the appropriate pipeline depending on where we paused.
  if (phase === "discovery" || phase === "listing" || phase.startsWith("listing")) {
    await inngest.send({
      name: "trade-show.requested",
      data: { tradeShowId: id },
    });
  } else if (phase === "short") {
    await inngest.send({
      name: "short-overview.bulk-requested",
      data: { tradeShowId: id },
    });
  }
  // Deep-Dive resumes are not bulk; user re-clicks individual rows.

  await notifyOrchestratorThread(
    supabase,
    id,
    user.id,
    `Pipeline fortgesetzt (Phase: ${phase}) — per UI-Button. Laeuft im Hintergrund.`,
    "resume_pipeline",
  );

  return NextResponse.json({ ok: true, resumed_phase: phase });
}
