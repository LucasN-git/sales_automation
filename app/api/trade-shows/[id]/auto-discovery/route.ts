import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { notifyOrchestratorThread } from "@/lib/chat-notify";

const Body = z.object({
  url: z.string().url(),
});

/**
 * Wird vom URL-Banner aufgerufen, wenn der User die vom Orchestrator
 * gefundene Aussteller-URL bestaetigt. Setzt source_url auf der Messe,
 * markiert url_search_status=done und startet trade-show.requested
 * (Discovery + Listing) in einem Schritt.
 */
export async function POST(
  request: Request,
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

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data: show, error: showError } = await supabase
    .from("trade_shows")
    .select("id, status")
    .eq("id", id)
    .single();
  if (showError || !show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("trade_shows")
    .update({
      source_url: body.url,
      url_search_status: "done",
      status: "queued",
      error_message: null,
    })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await inngest.send({
    name: "trade-show.requested",
    data: { tradeShowId: id },
  });

  await notifyOrchestratorThread(
    supabase,
    id,
    user.id,
    `URL übernommen: ${body.url}. Discovery und Listing laufen jetzt.`,
    "run_discovery",
    { confirmed: true, url: body.url },
  );

  return NextResponse.json({ ok: true });
}

/**
 * DELETE: User lehnt den URL-Vorschlag ab. Setzt Status auf 'url_not_found',
 * sodass das Banner verschwindet und stattdessen der Settings-Hinweis kommt.
 */
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

  const { data: show, error: showError } = await supabase
    .from("trade_shows")
    .select("id")
    .eq("id", id)
    .single();
  if (showError || !show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("trade_shows")
    .update({ url_search_status: "url_not_found" })
    .eq("id", id);
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  await notifyOrchestratorThread(
    supabase,
    id,
    user.id,
    "URL-Vorschlag abgelehnt. Bitte trage eine URL manuell in den Einstellungen ein.",
    "run_discovery",
    { confirmed: false },
  );

  return NextResponse.json({ ok: true });
}
