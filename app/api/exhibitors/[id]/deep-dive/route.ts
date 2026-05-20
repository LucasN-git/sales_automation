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
    .select("id, trade_show_id, company_name")
    .eq("id", id)
    .single();
  if (error || !exhibitor) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const admin = createServiceRoleClient();

  // exhibitor + company beide auf pending setzen.
  await admin.from("exhibitors").update({ deep_status: "pending" }).eq("id", id);
  const { data: ex } = await admin
    .from("exhibitors")
    .select("company_id")
    .eq("id", id)
    .maybeSingle();
  if (ex?.company_id) {
    await admin.from("companies").update({ deep_status: "pending" }).eq("id", ex.company_id);
  }

  await inngest.send({
    name: "exhibitor.deep.requested",
    data: { exhibitorId: id, tradeShowId: exhibitor.trade_show_id },
  });

  // Insert synthetic orchestrator message into the latest open chat thread for this exhibitor
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id, trade_show_id")
    .eq("exhibitor_focus", id)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (thread) {
    const msgText = `Deep-Dive fuer ${exhibitor.company_name} gestartet. Laeuft im Hintergrund (~1-2 Min).`;
    await supabase.from("chat_messages").insert({
      trade_show_id: thread.trade_show_id,
      user_id: user.id,
      thread_id: thread.id,
      role: "assistant",
      content: msgText,
      pipeline_action: [
        {
          tool: "trigger_deep_dive",
          input: { exhibitor_id: id },
          result: msgText,
        },
      ],
    });
  }

  return NextResponse.json({ ok: true, threadId: thread?.id ?? null });
}
