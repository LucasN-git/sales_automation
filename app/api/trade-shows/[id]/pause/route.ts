import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { tryAppendLog } from "@/lib/crawl-log";

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

  if (!["queued", "crawling"].includes(show.status)) {
    return NextResponse.json(
      { error: `cannot pause from status ${show.status}` },
      { status: 409 },
    );
  }

  const phase = (show.current_step ?? "").startsWith("listing")
    ? "listing"
    : show.current_step ?? "discovery";

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

  return NextResponse.json({ ok: true, paused_phase: phase });
}
