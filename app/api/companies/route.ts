import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { ensureCompany } from "@/lib/companies";

const Body = z.object({
  name: z.string().min(2).max(200),
  website: z.string().url().nullable().optional(),
});

const MANUAL_SHOW_NAME = "Manuelle Eintraege";

/**
 * Hand-add a company. Creates a per-user "Manuelle Eintraege" trade_show on
 * first use, deduplicates the company via ensureCompany, inserts an exhibitor
 * row tied to that synthetic show, and queues the manual-enrich chain
 * (short -> deep) so all the company fields (one_liner, decision_makers,
 * pain_points, opening_questions, isp_lifecycle_match, etc.) get filled
 * automatically.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // Find-or-create the synthetic trade_show that anchors hand-added rows.
  // Status 'ready' so the dashboard doesn't show it as "crawling".
  let manualShowId: string;
  {
    const { data: existing } = await admin
      .from("trade_shows")
      .select("id")
      .eq("name", MANUAL_SHOW_NAME)
      .maybeSingle();
    if (existing) {
      manualShowId = (existing as { id: string }).id;
    } else {
      const { data: created, error: showErr } = await admin
        .from("trade_shows")
        .insert({
          user_id: user.id,
          name: MANUAL_SHOW_NAME,
          source_url: null,
          year: new Date().getFullYear(),
          status: "ready",
        })
        .select("id")
        .single();
      if (showErr || !created) {
        return NextResponse.json(
          { error: showErr?.message ?? "manual show create failed" },
          { status: 500 },
        );
      }
      manualShowId = (created as { id: string }).id;
    }
  }

  const companyId = await ensureCompany(admin, user.id, body.name, body.website ?? null);

  // Idempotency: same company on the manual show should not double-insert.
  // Returns existing exhibitor row when (trade_show_id, company_name) already exists.
  const { data: exhibitor, error: exErr } = await admin
    .from("exhibitors")
    .upsert(
      {
        trade_show_id: manualShowId,
        company_id: companyId,
        company_name: body.name,
        website: body.website ?? null,
        booth: null,
        listing_raw: { source: "manual" },
        profile_url: null,
        profile_data: null,
        profile_enrich_status: "idle",
      },
      { onConflict: "trade_show_id,company_name", ignoreDuplicates: false },
    )
    .select("id")
    .single();
  if (exErr || !exhibitor) {
    return NextResponse.json(
      { error: exErr?.message ?? "exhibitor insert failed" },
      { status: 500 },
    );
  }

  await inngest.send({
    name: "exhibitor.manual.enrich.requested",
    data: { exhibitorId: (exhibitor as { id: string }).id, tradeShowId: manualShowId },
  });

  return NextResponse.json({ id: companyId, exhibitor_id: (exhibitor as { id: string }).id });
}
