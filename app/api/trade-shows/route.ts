import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

const Body = z.object({
  name: z.string().min(2).max(200),
  source_url: z.string().url().nullable().optional(),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const hasUrl = !!body.source_url;
  const { data, error } = await supabase
    .from("trade_shows")
    .insert({
      user_id: user.id,
      name: body.name,
      source_url: body.source_url ?? null,
      year: body.year ?? null,
      status: "queued",
      url_search_status: hasUrl ? "done" : "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  // Create initial orchestrator chat thread so the agent's greeting is ready on first load.
  const { data: thread } = await supabase
    .from("chat_threads")
    .insert({
      user_id: user.id,
      trade_show_id: data.id,
      scope: "show",
      is_orchestrator: true,
      title: `${body.name} Scraper`,
    })
    .select("id")
    .single();

  if (thread) {
    const greeting = hasUrl
      ? `Neue Messe erkannt: **${body.name}**\nQuelle: ${body.source_url}\n\nIch bin bereit. Tippe **"starte"** oder **"ja"** um Discovery und Listing zu beginnen, oder stelle mir Fragen zum Ablauf.`
      : `Neue Messe angelegt: **${body.name}**\n\nIch suche jetzt automatisch die Aussteller-URL per Web-Search. Das dauert ungefähr 30 Sekunden. Sobald ich fertig bin, siehst du im Show-Header einen Banner mit der gefundenen URL zur Bestätigung.`;

    await supabase.from("chat_messages").insert({
      thread_id: thread.id,
      trade_show_id: data.id,
      user_id: user.id,
      role: "assistant",
      content: greeting,
    });
  }

  if (!hasUrl) {
    await inngest.send({
      name: "trade-show.url-search.requested",
      data: {
        tradeShowId: data.id,
        userId: user.id,
        showName: body.name,
        year: body.year ?? null,
      },
    });
  }

  return NextResponse.json({ id: data.id, thread_id: thread?.id ?? null });
}
