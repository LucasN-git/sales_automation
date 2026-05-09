import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  const { data: show } = await supabase
    .from("trade_shows")
    .select("id")
    .eq("id", id)
    .single();
  if (!show) return NextResponse.json({ error: "not found" }, { status: 404 });

  await inngest.send({
    name: "short-overview.bulk-requested",
    data: { tradeShowId: id },
  });

  return NextResponse.json({ ok: true });
}
