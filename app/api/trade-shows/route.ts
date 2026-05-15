import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

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

  const { data, error } = await supabase
    .from("trade_shows")
    .insert({
      user_id: user.id,
      name: body.name,
      source_url: body.source_url ?? null,
      year: body.year ?? null,
      status: "queued",
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
    const urlLine = body.source_url
      ? `\nQuelle: ${body.source_url}`
      : "\nKeine Aussteller-URL hinterlegt. Bitte zuerst eine URL in den Einstellungen setzen.";

    const greeting = body.source_url
      ? `Neue Messe erkannt: **${body.name}**${urlLine}\n\nIch bin bereit. Tippe **"starte"** oder **"ja"** um Discovery und Listing zu beginnen, oder stelle mir Fragen zum Ablauf.`
      : `Neue Messe angelegt: **${body.name}**${urlLine}\n\nSobald eine URL gesetzt ist, kann ich Discovery und Listing starten.`;

    await supabase.from("chat_messages").insert({
      thread_id: thread.id,
      trade_show_id: data.id,
      user_id: user.id,
      role: "assistant",
      content: greeting,
    });
  }

  return NextResponse.json({ id: data.id, thread_id: thread?.id ?? null });
}
