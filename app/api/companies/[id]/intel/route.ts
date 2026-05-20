import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { revalidateTag } from "next/cache";
import { companyIntelTag } from "@/lib/show-cache";

const SHORT_FIELDS = new Set([
  "one_liner",
  "priority_label",
  "match_confidence",
  "isp_sector_match",
  "reasoning_bullets",
  "user_group",
  "battery_need",
  "drone_relevance",
  "service_need",
]);

const DEEP_FIELDS = new Set([
  "business_summary",
  "decision_makers",
  "recent_news",
  "technical_pain_points",
  "opening_questions",
  "competition_context",
  "isp_lifecycle_match",
  "isp_service_fit",
  "full_reasoning",
]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: company } = await supabase
    .from("companies")
    .select("id, short_status, deep_status")
    .eq("id", id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "not found" }, { status: 404 });

  const admin = createServiceRoleClient();
  const [{ data: shortIntel }, { data: deepIntel }] = await Promise.all([
    admin.from("company_short").select("*").eq("company_id", id).maybeSingle(),
    admin.from("company_deep").select("*").eq("company_id", id).maybeSingle(),
  ]);

  return NextResponse.json({
    short: shortIntel ?? null,
    deep: deepIntel ?? null,
    short_status: company.short_status,
    deep_status: company.deep_status,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!company) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await request.json() as { table: string; field: string; value: unknown };
  const { table, field, value } = body;

  if (table === "short") {
    if (!SHORT_FIELDS.has(field)) {
      return NextResponse.json({ error: `unknown short field: ${field}` }, { status: 400 });
    }
    const admin = createServiceRoleClient();
    const { error } = await admin
      .from("company_short")
      .upsert({ company_id: id, [field]: value }, { onConflict: "company_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (table === "deep") {
    if (!DEEP_FIELDS.has(field)) {
      return NextResponse.json({ error: `unknown deep field: ${field}` }, { status: 400 });
    }
    const admin = createServiceRoleClient();
    const { error } = await admin
      .from("company_deep")
      .upsert({ company_id: id, [field]: value }, { onConflict: "company_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "table must be short or deep" }, { status: 400 });
  }

  revalidateTag(companyIntelTag(id));
  return NextResponse.json({ ok: true });
}
