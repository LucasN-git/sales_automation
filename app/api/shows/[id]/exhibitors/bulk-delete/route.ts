import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  exhibitor_ids: z.array(z.string().uuid()).min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: showId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Show ownership via RLS
  const { data: show } = await supabase
    .from("trade_shows")
    .select("id")
    .eq("id", showId)
    .single();
  if (!show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Validate all IDs belong to this show — prevents cross-show deletion
  const { data: valid } = await supabase
    .from("exhibitors")
    .select("id")
    .in("id", body.exhibitor_ids)
    .eq("trade_show_id", showId);

  const validIds = valid?.map((r) => r.id) ?? [];
  if (validIds.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  // ON DELETE CASCADE covers exhibitor_short + exhibitor_deep
  const { error } = await supabase
    .from("exhibitors")
    .delete()
    .in("id", validIds)
    .eq("trade_show_id", showId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: validIds.length });
}
