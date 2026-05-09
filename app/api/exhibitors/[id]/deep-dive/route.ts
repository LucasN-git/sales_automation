import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

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

  // Mark as pending so the UI shows it's queued.
  const admin = createServiceRoleClient();
  await admin
    .from("exhibitors")
    .update({ deep_status: "pending" })
    .eq("id", id);

  await inngest.send({
    name: "exhibitor.deep.requested",
    data: { exhibitorId: id, tradeShowId: exhibitor.trade_show_id },
  });

  return NextResponse.json({ ok: true });
}
