import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { runId } = await params;

  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select("id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("show_discovery_results")
    .select("*")
    .eq("run_id", runId)
    .order("relevance_score", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ results: data ?? [] });
}
