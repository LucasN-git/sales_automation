import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { type ChatTurn } from "@/lib/claude";
import { catalogAsPromptBlock } from "@/lib/isp-catalog";
import { priceForChat } from "@/lib/pricing";
import {
  DASHBOARD_ORCHESTRATOR_SYSTEM_PROMPT,
  DASHBOARD_TOOL_DEFS,
  DASHBOARD_TOOL_NAMES,
  executeDashboardTool,
} from "@/lib/dashboard-orchestrator";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

const Body = z.object({
  message: z.string().min(1).max(4000),
  thread_id: z.string().uuid().nullable().optional(),
  model: z.string().min(3).max(100).optional(),
  with_web_search: z.boolean().optional(),
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

  // Resolve / create thread
  let threadId = body.thread_id ?? null;
  if (!threadId) {
    const title = body.message.slice(0, 60).replace(/\s+/g, " ").trim();
    const { data: created, error: threadErr } = await supabase
      .from("chat_threads")
      .insert({
        user_id: user.id,
        trade_show_id: null,
        title,
        scope: "dashboard",
      })
      .select("id")
      .single();
    if (threadErr || !created) {
      return NextResponse.json(
        { error: `thread create failed: ${threadErr?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    threadId = (created as { id: string }).id;
  }

  // History
  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  const history: ChatTurn[] = (historyRows ?? []).map((r) => ({
    role: (r as { role: "user" | "assistant" }).role,
    content: (r as { content: string }).content,
  }));

  const settings = await getSettings(supabase, user.id);
  const model = body.model ?? settings.deep_model;

  // Lightweight overview for context: counts of shows + companies + competitors,
  // plus the 5 most recent shows. Cheap to compute, gives the agent enough
  // grounding to answer "wie viele X" without a tool call.
  const [
    { count: showCount },
    { count: activeShowCount },
    { count: companyCount },
    { count: competitorCount },
    { data: recentShows },
  ] = await Promise.all([
    supabase.from("trade_shows").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("trade_shows")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .in("status", ["queued", "crawling"]),
    supabase.from("companies").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase
      .from("trade_shows")
      .select("id, name, year, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const overviewBlock =
    `# Aktueller Workspace-Stand\n\n` +
    `- Messen gesamt: ${showCount ?? 0} (${activeShowCount ?? 0} laufen aktiv)\n` +
    `- Firmen (dedupliziert): ${companyCount ?? 0}\n` +
    `- Konkurrenten (active): ${competitorCount ?? 0}\n\n` +
    `## Letzte 5 Messen\n` +
    ((recentShows ?? []) as Array<{ id: string; name: string; year: number | null; status: string }>)
      .map((s) => `- ${s.name}${s.year ? ` (${s.year})` : ""} — ${s.status}`)
      .join("\n");

  // Persist user message
  await supabase.from("chat_messages").insert({
    user_id: user.id,
    trade_show_id: null,
    thread_id: threadId,
    role: "user",
    content: body.message,
    model,
    with_deep_context: false,
    with_web_search: !!body.with_web_search,
  });
  await supabase
    .from("chat_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", threadId);

  // Build system blocks (prompt + prio + catalog cached, overview un-cached)
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: DASHBOARD_ORCHESTRATOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: settings.prio_context, cache_control: { type: "ephemeral" } },
    { type: "text", text: catalogAsPromptBlock(), cache_control: { type: "ephemeral" } },
    { type: "text", text: overviewBlock },
  ];

  const tools: Anthropic.Tool[] = [...(DASHBOARD_TOOL_DEFS as unknown as Anthropic.Tool[])];
  if (body.with_web_search) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: settings.chat_web_search_max_uses ?? 5,
    } as unknown as Anthropic.Tool);
  }

  const encoder = new TextEncoder();
  let assistantBuffer = "";
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;
  const pipelineActions: Array<{ tool: string; input: unknown; result: string }> = [];

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      }

      try {
        send({ type: "thread", thread_id: threadId });

        const messagesArr: Anthropic.MessageParam[] = [
          ...history.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.content })),
          { role: "user", content: body.message },
        ];

        // Tool-use loop — max 6 round-trips
        for (let iter = 0; iter < 6; iter++) {
          const apiStream = anthropic().messages.stream({
            model,
            max_tokens: settings.chat_max_tokens ?? 2500,
            system: systemBlocks,
            tools,
            messages: messagesArr,
          });

          for await (const event of apiStream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              const text = event.delta.text;
              assistantBuffer += text;
              send({ type: "text", text });
            } else if (event.type === "content_block_start") {
              const block = event.content_block as { type?: string; name?: string; input?: { query?: string } };
              if (block?.type === "server_tool_use" && block?.name === "web_search") {
                send({ type: "search", query: block.input?.query });
              }
            }
          }

          const finalMsg = await apiStream.finalMessage();
          totalIn += finalMsg.usage.input_tokens;
          totalOut += finalMsg.usage.output_tokens;
          totalCacheCreate += (finalMsg.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
          totalCacheRead += (finalMsg.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;

          const toolUseBlocks = finalMsg.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          if (toolUseBlocks.length === 0) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUseBlocks) {
            if (!DASHBOARD_TOOL_NAMES.has(tu.name)) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: `Tool '${tu.name}' ist im Dashboard-Scope nicht verfuegbar.`,
                is_error: true,
              });
              continue;
            }
            send({ type: "pipeline_action", tool: tu.name, input: tu.input, status: "running" });
            let result: { summary: string; detail?: Record<string, unknown> };
            try {
              result = await executeDashboardTool(tu.name, tu.input, user.id, supabase);
              if (result.detail?.confirmation_request) {
                send({ type: "confirmation_request", ...(result.detail.confirmation_request as Record<string, unknown>) });
              }
              send({ type: "pipeline_action", tool: tu.name, input: tu.input, status: "done", result: result.summary });
              pipelineActions.push({ tool: tu.name, input: tu.input, result: result.summary });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              result = { summary: `Fehler: ${errMsg}` };
              send({ type: "pipeline_action", tool: tu.name, input: tu.input, status: "error", result: errMsg });
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: result.summary,
            });
          }

          if (toolResults.length === 0) break;
          messagesArr.push({ role: "assistant", content: finalMsg.content });
          messagesArr.push({ role: "user", content: toolResults });
        }

        const costUsd = priceForChat(model, {
          input_tokens: totalIn,
          output_tokens: totalOut,
          cache_creation_input_tokens: totalCacheCreate,
          cache_read_input_tokens: totalCacheRead,
        });
        send({
          type: "usage",
          tokens_in: totalIn,
          tokens_out: totalOut,
          cache_creation_tokens: totalCacheCreate,
          cache_read_tokens: totalCacheRead,
          cost_usd: costUsd,
        });
        send({ type: "done" });

        await supabase.from("chat_messages").insert({
          user_id: user.id,
          trade_show_id: null,
          thread_id: threadId,
          role: "assistant",
          content: assistantBuffer,
          tokens_in: totalIn,
          tokens_out: totalOut,
          model,
          with_deep_context: false,
          with_web_search: !!body.with_web_search,
          pipeline_action: pipelineActions.length > 0 ? pipelineActions : null,
        });
        await supabase
          .from("chat_threads")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", threadId);
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

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const url = new URL(request.url);
  const threadId = url.searchParams.get("thread");
  const listThreads = url.searchParams.get("threads");
  const allScopes = url.searchParams.get("all");

  if (listThreads) {
    if (allScopes) {
      // Cross-scope view for the History drawer: returns threads from ALL
      // scopes with their focus-name resolved, so the drawer can deep-link.
      const { data } = await supabase
        .from("chat_threads")
        .select(
          `id, title, scope, trade_show_id, exhibitor_focus, exhibitor_name, company_focus, competitor_focus, is_orchestrator, created_at, last_message_at,
           trade_show:trade_shows(name),
           company:companies(display_name),
           competitor:competitors(display_name)`,
        )
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false })
        .limit(50);
      type Row = {
        id: string;
        title: string | null;
        scope: string | null;
        trade_show_id: string | null;
        exhibitor_focus: string | null;
        exhibitor_name: string | null;
        company_focus: string | null;
        competitor_focus: string | null;
        is_orchestrator: boolean;
        last_message_at: string;
        trade_show?: { name: string } | { name: string }[] | null;
        company?: { display_name: string } | { display_name: string }[] | null;
        competitor?: { display_name: string } | { display_name: string }[] | null;
      };
      const threads = ((data ?? []) as Row[]).map((r) => {
        const ts = Array.isArray(r.trade_show) ? r.trade_show[0] : r.trade_show;
        const co = Array.isArray(r.company) ? r.company[0] : r.company;
        const cp = Array.isArray(r.competitor) ? r.competitor[0] : r.competitor;
        return {
          id: r.id,
          title: r.title,
          scope: r.scope,
          trade_show_id: r.trade_show_id,
          exhibitor_focus: r.exhibitor_focus,
          exhibitor_name: r.exhibitor_name,
          company_focus: r.company_focus,
          company_name: co?.display_name ?? null,
          competitor_focus: r.competitor_focus,
          competitor_name: cp?.display_name ?? null,
          show_name: ts?.name ?? null,
          is_orchestrator: r.is_orchestrator,
          last_message_at: r.last_message_at,
        };
      });
      return NextResponse.json({ threads });
    }

    const { data } = await supabase
      .from("chat_threads")
      .select(
        "id, title, scope, exhibitor_focus, exhibitor_name, company_focus, competitor_focus, is_orchestrator, created_at, last_message_at",
      )
      .eq("user_id", user.id)
      .eq("scope", "dashboard")
      .order("last_message_at", { ascending: false });
    return NextResponse.json({ threads: data ?? [] });
  }

  if (threadId) {
    const { data } = await supabase
      .from("chat_messages")
      .select("id, role, content, model, with_deep_context, with_web_search, pipeline_action, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    return NextResponse.json({ messages: data ?? [] });
  }

  return NextResponse.json({ error: "missing thread or threads param" }, { status: 400 });
}

export async function DELETE(request: Request) {
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
    // Only delete the user's dashboard threads.
    const { data: ids } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("user_id", user.id)
      .eq("scope", "dashboard");
    const threadIds = (ids ?? []).map((r: { id: string }) => r.id);
    if (threadIds.length > 0) {
      await supabase.from("chat_messages").delete().in("thread_id", threadIds);
      await supabase.from("chat_threads").delete().in("id", threadIds);
    }
  }

  return NextResponse.json({ ok: true });
}
