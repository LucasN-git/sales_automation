import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
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
    .select("id, user_id, status, user_prompt")
    .eq("id", runId)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (!["cancelled", "failed"].includes(run.status)) {
    return NextResponse.json(
      { error: `cannot resume from status ${run.status}` },
      { status: 409 },
    );
  }
  if (!run.user_prompt) {
    return NextResponse.json({ error: "run has no user_prompt to resume" }, { status: 409 });
  }

  const admin = createServiceRoleClient();

  await admin.from("company_search_results").delete().eq("run_id", runId);
  await admin.from("company_search_log").delete().eq("run_id", runId);

  const { error: resetErr } = await admin
    .from("company_search_runs")
    .update({
      status: "pending",
      current_phase: null,
      candidates_total: null,
      candidates_validated: null,
      candidates_added: null,
      model: null,
      tokens_in: null,
      tokens_out: null,
      web_search_uses: null,
      firecrawl_credits: null,
      error_message: null,
      finished_at: null,
    })
    .eq("id", runId);
  if (resetErr) return NextResponse.json({ error: resetErr.message }, { status: 500 });

  await tryAppendCompanySearchLog(admin, runId, run.user_id, {
    phase: "preparing",
    message: "Lauf neu gestartet (Resume mit gleichem Prompt).",
  });

  await inngest.send({
    name: "company.search.requested",
    data: { userId: run.user_id, runId, userPrompt: run.user_prompt },
  });

  return NextResponse.json({ ok: true });
}
