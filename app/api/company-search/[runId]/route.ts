import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { runId } = await params;
  const { data, error } = await supabase
    .from("company_search_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, model, tokens_in, tokens_out, web_search_uses, firecrawl_credits, error_message, created_at, finished_at",
    )
    .eq("id", runId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ run: data });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { runId } = await params;
  const { data: run } = await supabase
    .from("company_search_runs")
    .select("id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const admin = createServiceRoleClient();
  const { error } = await admin.from("company_search_runs").delete().eq("id", runId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
