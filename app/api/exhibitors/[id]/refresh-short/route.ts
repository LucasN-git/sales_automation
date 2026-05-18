import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { revalidateTag } from "next/cache";
import { showExhibitorsTag, exhibitorIntelTag } from "@/lib/show-cache";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: exhibitor, error } = await supabase
    .from("exhibitors")
    .select("id, trade_show_id")
    .eq("id", id)
    .single();
  if (error || !exhibitor) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const admin = createServiceRoleClient();

  await admin.from("exhibitor_short").delete().eq("exhibitor_id", id);

  await admin
    .from("exhibitors")
    .update({
      borrowed_short_from_exhibitor_id: null,
      short_status: "pending",
      current_step: null,
    })
    .eq("id", id);

  await inngest.send({
    name: "exhibitor.short.requested",
    data: { exhibitorId: id, tradeShowId: exhibitor.trade_show_id },
  });

  revalidateTag(showExhibitorsTag(exhibitor.trade_show_id));
  revalidateTag(exhibitorIntelTag(id));

  return NextResponse.json({ ok: true });
}
