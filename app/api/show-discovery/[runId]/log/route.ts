import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { runId } = await params;

  // Verify ownership.
  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select("id")
    .eq("id", runId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("show_discovery_log")
    .select("id, phase, message, meta, level, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
