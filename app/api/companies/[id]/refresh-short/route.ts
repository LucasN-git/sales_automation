import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { revalidateTag } from "next/cache";
import { companyIntelTag } from "@/lib/show-cache";

export async function POST(
  _request: Request,
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

  const admin = createServiceRoleClient();

  // company_short loeschen und Status zuruecksetzen.
  await admin.from("company_short").delete().eq("company_id", id);
  await admin.from("companies").update({ short_status: "pending" }).eq("id", id);

  // Besten Exhibitor finden (mit Website bevorzugt, neueste zuerst).
  const { data: rows } = await admin
    .from("exhibitors")
    .select("id, trade_show_id, website")
    .eq("company_id", id)
    .order("created_at", { ascending: false });

  const exhibitor = rows?.find((r) => r.website) ?? rows?.[0];
  if (!exhibitor) {
    return NextResponse.json({ error: "no exhibitor found for this company" }, { status: 404 });
  }

  // exhibitor_short Mirror loeschen + Status zuruecksetzen.
  await admin.from("exhibitor_short").delete().eq("exhibitor_id", exhibitor.id);
  await admin
    .from("exhibitors")
    .update({ short_status: "pending", borrowed_short_from_exhibitor_id: null, current_step: null })
    .eq("id", exhibitor.id);

  await inngest.send({
    name: "exhibitor.short.requested",
    data: { exhibitorId: exhibitor.id, tradeShowId: exhibitor.trade_show_id },
  });

  revalidateTag(companyIntelTag(id));
  return NextResponse.json({ ok: true, exhibitorId: exhibitor.id });
}
