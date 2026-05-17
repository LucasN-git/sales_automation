import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

/**
 * Triggert eine erneute Short-Analyse fuer einen einzelnen Konkurrenten.
 * Setzt short_status=pending und feuert das Inngest-Event. RLS scoped via auth.uid().
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { id } = await context.params;

  const { data: competitor, error: cErr } = await supabase
    .from("competitors")
    .select("id, user_id")
    .eq("id", id)
    .maybeSingle();
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if (!competitor) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const admin = createServiceRoleClient();
  const { error: updErr } = await admin
    .from("competitors")
    .update({ short_status: "pending" })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await inngest.send({
    name: "competitor.short.requested",
    data: {
      userId: user.id,
      competitorId: id,
    },
  });

  return NextResponse.json({ ok: true });
}
