import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: exhibitorId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let body: { table: string; field: string; value: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { table, field, value } = body;

  if (table !== "short" && table !== "deep") {
    return NextResponse.json({ error: "table must be 'short' or 'deep'" }, { status: 400 });
  }

  const allowedFields = table === "short" ? SHORT_FIELDS : DEEP_FIELDS;
  if (!allowedFields.has(field)) {
    return NextResponse.json({ error: `field '${field}' not editable` }, { status: 400 });
  }

  // Verify exhibitor belongs to this user via trade_shows.user_id
  const { data: exhibitor, error: exErr } = await supabase
    .from("exhibitors")
    .select("id, trade_shows!inner(user_id)")
    .eq("id", exhibitorId)
    .single();

  if (exErr || !exhibitor) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const dbTable = table === "short" ? "exhibitor_short" : "exhibitor_deep";
  const { error } = await supabase
    .from(dbTable)
    .update({ [field]: value })
    .eq("exhibitor_id", exhibitorId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
