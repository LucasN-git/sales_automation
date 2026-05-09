import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { chatStream, type ExhibitorChatContext, type ChatTurn } from "@/lib/claude";
import { tryAppendLog } from "@/lib/crawl-log";

const Body = z.object({
  message: z.string().min(1).max(4000),
  thread_id: z.string().uuid().nullable().optional(),
  model: z.string().min(3).max(100).optional(),
  exhibitor_focus: z.string().uuid().nullable().optional(),
  with_deep_context: z.boolean().optional(),
  with_web_search: z.boolean().optional(),
});

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

  // Show ownership check via RLS — also load per-show chat context
  const { data: show } = await supabase
    .from("trade_shows")
    .select("id, chat_context")
    .eq("id", id)
    .single();
  if (!show) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Resolve / create thread
  let threadId = body.thread_id ?? null;
  let threadFocus = body.exhibitor_focus ?? null;
  if (!threadId) {
    const title = body.message.slice(0, 60).replace(/\s+/g, " ").trim();
    const { data: created, error: threadErr } = await supabase
      .from("chat_threads")
      .insert({
        trade_show_id: id,
        title,
        exhibitor_focus: threadFocus,
      })
      .select("id, exhibitor_focus")
      .single();
    if (threadErr || !created) {
      return NextResponse.json(
        { error: `thread create failed: ${threadErr?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    threadId = created.id;
    threadFocus = created.exhibitor_focus ?? null;
  } else {
    // Use existing thread's focus
    const { data: existing } = await supabase
      .from("chat_threads")
      .select("exhibitor_focus")
      .eq("id", threadId)
      .maybeSingle();
    threadFocus = existing?.exhibitor_focus ?? null;
  }

  // Load exhibitor list (Short-tier minimum)
  const { data: exhibitorRows } = await supabase
    .from("exhibitors")
    .select(
      "id, company_name, website, booth, exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match)",
    )
    .eq("trade_show_id", id);

  const exhibitors: ExhibitorChatContext[] = (exhibitorRows ?? []).map((e: any) => ({
    company_name: e.company_name,
    website: e.website,
    booth: e.booth,
    one_liner: e.exhibitor_short?.one_liner ?? null,
    priority_label: e.exhibitor_short?.priority_label ?? null,
    match_confidence: e.exhibitor_short?.match_confidence ?? null,
    isp_sector_match: e.exhibitor_short?.isp_sector_match ?? [],
  }));

  // Optional deep context for the focused exhibitor
  let deepContext: Record<string, unknown> | null = null;
  if (body.with_deep_context && threadFocus) {
    const { data: deep } = await supabase
      .from("exhibitor_deep")
      .select(
        "business_summary, decision_makers, recent_news, technical_pain_points, opening_questions, competition_context, isp_lifecycle_match, full_reasoning",
      )
      .eq("exhibitor_id", threadFocus)
      .maybeSingle();
    if (deep) {
      const { data: ex } = await supabase
        .from("exhibitors")
        .select("company_name, website")
        .eq("id", threadFocus)
        .maybeSingle();
      deepContext = { ...ex, ...deep };
    }
  }

  // History — only this thread
  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  const history: ChatTurn[] = (historyRows ?? []).map((r: any) => ({
    role: r.role,
    content: r.content,
  }));

  const settings = await getSettings(supabase, user.id);
  const model = body.model ?? settings.deep_model;

  // Persist user message
  await supabase.from("chat_messages").insert({
    trade_show_id: id,
    thread_id: threadId,
    role: "user",
    content: body.message,
    model,
    with_deep_context: !!body.with_deep_context,
    with_web_search: !!body.with_web_search,
  });
  await supabase
    .from("chat_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", threadId);

  const encoder = new TextEncoder();
  let assistantBuffer = "";
  let usageIn = 0;
  let usageOut = 0;
  const searchQueries: string[] = [];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial event with thread_id so client can store it
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "thread", thread_id: threadId })}\n\n`,
          ),
        );

        const gen = chatStream({
          prioContext: settings.prio_context,
          exhibitors,
          history,
          userMessage: body.message,
          model,
          withWebSearch: !!body.with_web_search,
          deepContext,
          showContext: (show as { chat_context: string | null }).chat_context ?? null,
        });
        for await (const ev of gen) {
          if (ev.type === "text" && ev.text) {
            assistantBuffer += ev.text;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "text", text: ev.text })}\n\n`),
            );
          } else if (ev.type === "search" && ev.search?.query) {
            searchQueries.push(ev.search.query);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "search", query: ev.search.query })}\n\n`,
              ),
            );
          } else if (ev.type === "usage" && ev.usage) {
            usageIn = ev.usage.tokens_in;
            usageOut = ev.usage.tokens_out;
          } else if (ev.type === "done") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          }
        }
        // Persist assistant message + chat trace
        await supabase.from("chat_messages").insert({
          trade_show_id: id,
          thread_id: threadId,
          role: "assistant",
          content: assistantBuffer,
          tokens_in: usageIn,
          tokens_out: usageOut,
          model,
          with_deep_context: !!body.with_deep_context,
          with_web_search: !!body.with_web_search,
        });
        await supabase
          .from("chat_threads")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", threadId);
        await tryAppendLog(supabase, id, {
          phase: "chat",
          message: `Chat (${model}): ${body.message.slice(0, 80)}…`,
          meta: {
            prompt: body.message,
            response: assistantBuffer.slice(0, 4000),
            model,
            web_searches: searchQueries,
            tokens_in: usageIn,
            tokens_out: usageOut,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const threadId = url.searchParams.get("thread");
  const listThreads = url.searchParams.get("threads");
  const exhibitorFilter = url.searchParams.get("exhibitor");

  if (listThreads) {
    let query = supabase
      .from("chat_threads")
      .select("id, title, exhibitor_focus, created_at, last_message_at")
      .eq("trade_show_id", id)
      .order("last_message_at", { ascending: false });
    if (exhibitorFilter) {
      query = query.eq("exhibitor_focus", exhibitorFilter);
    } else if (exhibitorFilter === "") {
      query = query.is("exhibitor_focus", null);
    }
    const { data } = await query;
    return NextResponse.json({ threads: data ?? [] });
  }

  if (threadId) {
    const { data } = await supabase
      .from("chat_messages")
      .select("id, role, content, model, with_deep_context, with_web_search, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    return NextResponse.json({ messages: data ?? [] });
  }

  return NextResponse.json({ error: "missing thread or threads param" }, { status: 400 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const threadId = url.searchParams.get("thread");

  if (threadId) {
    await supabase.from("chat_threads").delete().eq("id", threadId);
  } else {
    await supabase.from("chat_threads").delete().eq("trade_show_id", id);
    await supabase.from("chat_messages").delete().eq("trade_show_id", id);
  }

  return NextResponse.json({ ok: true });
}
