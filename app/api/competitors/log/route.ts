import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/competitors/log
// Returns recent log entries for the authenticated user's competitor activity.
// ?run_id=<uuid>  — filter to a specific discovery run
// ?limit=<n>      — max entries (default 50, max 200)

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const runId = url.searchParams.get("run_id");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);

  let query = supabase
    .from("competitor_discovery_log")
    .select("id, run_id, competitor_id, level, phase, message, meta, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (runId) {
    query = query.eq("run_id", runId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also return the latest discovery run for status display
  const { data: latestRun } = await supabase
    .from("competitor_discovery_runs")
    .select("id, status, current_phase, candidates_total, candidates_kept, error_message, started_at, finished_at")
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ entries: data ?? [], latest_run: latestRun ?? null });
}
