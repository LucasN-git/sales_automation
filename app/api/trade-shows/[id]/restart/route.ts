import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

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

  // RLS-protected ownership check
  const { data: show, error: showError } = await supabase
    .from("trade_shows")
    .select("id, status")
    .eq("id", id)
    .single();
  if (showError || !show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Service role for the cleanup (bypasses RLS for cascade-delete + reset)
  const admin = createServiceRoleClient();

  // Pause any in-flight Inngest function so it exits at the next step
  // boundary before we wipe state — avoids a race where a dying run still
  // writes exhibitor rows after we've deleted them.
  if (show.status === "crawling" || show.status === "queued") {
    await admin
      .from("trade_shows")
      .update({ status: "paused", paused_phase: "listing" })
      .eq("id", id);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const { error: delError } = await admin
    .from("exhibitors")
    .delete()
    .eq("trade_show_id", id);
  if (delError) {
    return NextResponse.json(
      { error: `cleanup failed: ${delError.message}` },
      { status: 500 },
    );
  }

  const { error: resetError } = await admin
    .from("trade_shows")
    .update({
      status: "queued",
      current_step: null,
      error_message: null,
      crawl_plan: null,
      discovery_log: null,
      browserbase_session_seconds: 0,
    })
    .eq("id", id);
  if (resetError) {
    return NextResponse.json(
      { error: `reset failed: ${resetError.message}` },
      { status: 500 },
    );
  }

  await inngest.send({
    name: "trade-show.requested",
    data: { tradeShowId: id },
  });

  return NextResponse.json({ ok: true });
}
