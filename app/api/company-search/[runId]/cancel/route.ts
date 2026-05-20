import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { tryAppendCompanySearchLog } from "@/lib/company-search-log";

export async function POST(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { runId } = await params;

  const { data: run, error: loadErr } = await supabase
    .from("company_search_runs")
    .select("id, user_id, status")
    .eq("id", runId)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!["pending", "running"].includes(run.status)) {
    return NextResponse.json(
      { error: `cannot cancel from status ${run.status}` },
      { status: 409 },
    );
  }

  const admin = createServiceRoleClient();
  const { error } = await admin
    .from("company_search_runs")
    .update({
      status: "cancelled",
      current_phase: "cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await tryAppendCompanySearchLog(admin, runId, run.user_id, {
    level: "warn",
    phase: "cancelled",
    message: "Lauf vom User gestoppt.",
  });

  return NextResponse.json({ ok: true });
}
