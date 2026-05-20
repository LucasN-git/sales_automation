import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ensureCompany } from "@/lib/companies";
import { inngest } from "@/lib/inngest/client";

const PatchBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal("dismiss") }),
]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ runId: string; id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { runId, id } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data: result } = await supabase
    .from("company_search_results")
    .select("*")
    .eq("id", id)
    .eq("run_id", runId)
    .maybeSingle();
  if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });

  const r = result as {
    id: string;
    run_id: string;
    name: string;
    website: string | null;
    domain: string | null;
    description: string | null;
    one_liner: string | null;
    priority_label: string | null;
    match_confidence: number | null;
    isp_sector_match_detail: string[] | null;
    reasoning_bullets: string | null;
    battery_need: string | null;
    user_group: string | null;
    added_company_id: string | null;
    dismissed: boolean;
  };

  if (body.action === "dismiss") {
    await supabase.from("company_search_results").update({ dismissed: true }).eq("id", id);
    return NextResponse.json({ ok: true });
  }

  // add action — requires confirmed: true
  if (!body.confirmed) {
    return NextResponse.json({
      confirmation_required: true,
      preview: {
        name: r.name,
        website: r.website,
        one_liner: r.one_liner,
        priority_label: r.priority_label,
        match_confidence: r.match_confidence,
      },
    });
  }

  if (r.added_company_id) {
    return NextResponse.json({ company_id: r.added_company_id, already_exists: true });
  }

  const admin = createServiceRoleClient();

  // 1. Ensure company exists (dedup by domain / normalized_name)
  const companyId = await ensureCompany(admin, user.id, r.name, r.website ?? null);

  // 2. Mark source as company_search if this is a new/exhibitor company
  await admin
    .from("companies")
    .update({ source: "company_search" })
    .eq("id", companyId)
    .in("source", ["exhibitor"]);

  // 3. Upsert company_short from result data (only if no existing short)
  const { data: existingShort } = await admin
    .from("company_short")
    .select("company_id")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!existingShort && r.one_liner) {
    await admin.from("company_short").upsert({
      company_id: companyId,
      one_liner: r.one_liner,
      priority_label: r.priority_label ?? "niedrig",
      match_confidence: r.match_confidence ?? 0,
      isp_sector_match: r.isp_sector_match_detail ?? [],
      reasoning_bullets: r.reasoning_bullets ?? "",
      battery_need: r.battery_need ?? "",
      user_group: r.user_group ?? "",
    });
    await admin
      .from("companies")
      .update({ short_status: "done" })
      .eq("id", companyId);
  }

  // 4. Create synthetic exhibitor in "Manuelle Eintraege" show for deep-dive
  // Find or create the synthetic show
  let syntheticShowId: string;
  const { data: existingShow } = await admin
    .from("trade_shows")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", "Manuelle Eintraege")
    .maybeSingle();

  if (existingShow) {
    syntheticShowId = (existingShow as { id: string }).id;
  } else {
    const { data: newShow } = await admin
      .from("trade_shows")
      .insert({ user_id: user.id, name: "Manuelle Eintraege", status: "ready", source_url: "manual" })
      .select("id")
      .single();
    syntheticShowId = (newShow as { id: string }).id;
  }

  // Upsert exhibitor row
  const { data: exhibitorRow } = await admin
    .from("exhibitors")
    .upsert(
      {
        trade_show_id: syntheticShowId,
        company_id: companyId,
        company_name: r.name,
        website: r.website ?? null,
        short_status: r.one_liner ? "done" : "pending",
        deep_status: "pending",
        profile_enrich_status: "idle",
        url_search_status: "skipped",
        listing_raw: { source: "company_search", run_id: runId, result_id: id },
      },
      { onConflict: "trade_show_id,company_name", ignoreDuplicates: false },
    )
    .select("id")
    .single();

  const exhibitorId = (exhibitorRow as { id: string } | null)?.id;

  // 5. Trigger deep dive directly (skip short, we already have it)
  if (exhibitorId) {
    await inngest.send({
      name: "exhibitor.deep.requested",
      data: { exhibitorId, tradeShowId: syntheticShowId },
    });
    await admin
      .from("companies")
      .update({ deep_status: "pending" })
      .eq("id", companyId)
      .eq("deep_status", "none");
  }

  // 6. Mark result as added
  await supabase
    .from("company_search_results")
    .update({ added_company_id: companyId })
    .eq("id", id);

  // 7. Increment candidates_added on run
  const { error: rpcError } = await admin.rpc("increment_company_search_added", { p_run_id: runId });
  if (rpcError) {
    const { data: runRow } = await admin
      .from("company_search_runs")
      .select("candidates_added")
      .eq("id", runId)
      .maybeSingle();
    await admin
      .from("company_search_runs")
      .update({ candidates_added: ((runRow as any)?.candidates_added ?? 0) + 1 })
      .eq("id", runId);
  }

  return NextResponse.json({ company_id: companyId, exhibitor_id: exhibitorId ?? null });
}
