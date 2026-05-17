import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

const PatchBody = z.union([
  z.object({ dismissed: z.literal(true) }),
  z.object({ confirm: z.literal(true) }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string; resultId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { runId, resultId } = await params;

  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select("id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  if ("dismissed" in parsed.data) {
    const { error } = await supabase
      .from("show_discovery_results")
      .update({ dismissed: true })
      .eq("id", resultId)
      .eq("run_id", runId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Confirm: create trade_shows row.
  const { data: result } = await supabase
    .from("show_discovery_results")
    .select("name, website, firecrawl_confirmed_url, exhibitor_list_url, exhibitor_list_available, dates_raw, dates_start, location_city, location_country")
    .eq("id", resultId)
    .eq("run_id", runId)
    .maybeSingle();
  if (!result) return NextResponse.json({ error: "result not found" }, { status: 404 });

  // Exhibitor list URL takes priority: it's the page the crawler actually needs.
  const r = result as any;
  const sourceUrl: string | null =
    r.exhibitor_list_url || r.firecrawl_confirmed_url || r.website || null;
  const canCrawl = r.exhibitor_list_available !== false && Boolean(sourceUrl);
  const year: number | null = r.dates_start
    ? new Date(r.dates_start).getFullYear()
    : null;

  // Duplicate check: same URL already in trade_shows.
  if (sourceUrl) {
    const { data: existing } = await supabase
      .from("trade_shows")
      .select("id, name")
      .eq("source_url", sourceUrl)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "already_exists", tradeShowId: (existing as any).id, showName: (existing as any).name },
        { status: 409 },
      );
    }
  }

  const admin = createServiceRoleClient();
  const { data: show, error: showErr } = await admin
    .from("trade_shows")
    .insert({
      user_id: user.id,
      name: r.name,
      source_url: sourceUrl,
      year,
      status: canCrawl ? "queued" : "ready",
    })
    .select("id")
    .single();
  if (showErr || !show) {
    return NextResponse.json({ error: showErr?.message ?? "trade show create failed" }, { status: 500 });
  }

  const tradeShowId = (show as { id: string }).id;

  // Link result to the created show.
  await supabase
    .from("show_discovery_results")
    .update({ added_trade_show_id: tradeShowId })
    .eq("id", resultId);

  // Increment candidates_added on the run.
  const { data: runData } = await supabase
    .from("show_discovery_runs")
    .select("candidates_added")
    .eq("id", runId)
    .maybeSingle();
  const prev = (runData as any)?.candidates_added ?? 0;
  await supabase
    .from("show_discovery_runs")
    .update({ candidates_added: prev + 1 })
    .eq("id", runId);

  // Trigger crawl only if a crawlable exhibitor URL exists.
  if (canCrawl) {
    await inngest.send({
      name: "trade-show.requested",
      data: { tradeShowId, userId: user.id },
    });
  }

  return NextResponse.json({ ok: true, tradeShowId });
}
