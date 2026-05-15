import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { CompetitorDiscoveryRequestSchema } from "@/lib/competitors/schemas";

/**
 * Triggert einen Auto-Discovery-Lauf. Erzeugt eine Audit-Row in
 * competitor_discovery_runs (status='pending'), feuert das Inngest-Event
 * und gibt runId zurueck. Das Frontend kann dann auf Status-Updates pollen.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = CompetitorDiscoveryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  const { data: run, error: runErr } = await admin
    .from("competitor_discovery_runs")
    .insert({
      user_id: user.id,
      status: "pending",
    })
    .select("id")
    .single();
  if (runErr || !run) {
    return NextResponse.json(
      { error: runErr?.message ?? "discovery run create failed" },
      { status: 500 },
    );
  }

  await inngest.send({
    name: "competitor.discovery.requested",
    data: {
      userId: user.id,
      runId: (run as { id: string }).id,
      request: parsed.data,
    },
  });

  return NextResponse.json({ runId: (run as { id: string }).id });
}

/**
 * Letzte Discovery-Runs des Users. Frontend pollt diesen Endpoint waehrend
 * eines Laufs, um Status-Wechsel und Counts zu zeigen.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("competitor_discovery_runs")
    .select(
      "id, status, candidates_total, candidates_kept, tokens_in, tokens_out, web_search_uses, web_search_cost_usd, error_message, created_at, finished_at",
    )
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ runs: data ?? [] });
}
