import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

/**
 * Triggert Short-Analyse fuer alle Konkurrenten ohne laufende/ausstehende Short.
 * Setzt short_status=pending, feuert competitor.short.bulk-requested.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("id")
    .eq("user_id", user.id)
    .not("status", "in", '("archived","rejected")')
    .not("short_status", "in", '("running","pending")');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids = (competitors ?? []).map((c: { id: string }) => c.id);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  const admin = createServiceRoleClient();
  await admin.from("competitors").update({ short_status: "pending" }).in("id", ids);

  await inngest.send({
    name: "competitor.short.bulk-requested",
    data: { userId: user.id, competitorIds: ids },
  });

  return NextResponse.json({ ok: true, count: ids.length });
}
