import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
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

  // Ownership check: exhibitor must belong to a show owned by this user
  const { data: ex } = await supabase
    .from("exhibitors")
    .select("id, trade_shows!inner(user_id)")
    .eq("id", id)
    .maybeSingle();

  if (!ex) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if ((ex.trade_shows as any).user_id !== user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // ON DELETE CASCADE covers exhibitor_short + exhibitor_deep
  const { error } = await supabase.from("exhibitors").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: 1 });
}
