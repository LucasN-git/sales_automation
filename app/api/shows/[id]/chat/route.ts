import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { type ExhibitorChatContext, type ChatTurn, renderCrawlStateBlock } from "@/lib/claude";
import { catalogAsPromptBlock } from "@/lib/isp-catalog";
import { loadCrawlState, tryAppendLog } from "@/lib/crawl-log";
import { priceForChat } from "@/lib/pricing";
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  ORCHESTRATOR_TOOL_DEFS,
  ORCHESTRATOR_TOOL_NAMES,
  executePipelineTool,
} from "@/lib/orchestrator";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

const Body = z.object({
  message: z.string().min(1).max(4000),
  thread_id: z.string().uuid().nullable().optional(),
  model: z.string().min(3).max(100).optional(),
  exhibitor_focus: z.string().uuid().nullable().optional(),
  with_deep_context: z.boolean().optional(),
  with_web_search: z.boolean().optional(),
});

// Fields editable via update_exhibitor_intel client tool
const SHORT_FIELDS = new Set([
  "one_liner", "priority_label", "match_confidence", "isp_sector_match",
  "reasoning_bullets", "user_group", "battery_need", "drone_relevance", "service_need",
]);
const DEEP_FIELDS = new Set([
  "business_summary", "decision_makers", "recent_news", "technical_pain_points",
  "opening_questions", "competition_context", "isp_lifecycle_match", "isp_service_fit", "full_reasoning",
]);

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

  // Show ownership check via RLS
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

    // Resolve exhibitor name for denormalized storage
    let exhibitorName: string | null = null;
    if (threadFocus) {
      const { data: exRow } = await supabase
        .from("exhibitors")
        .select("company_name")
        .eq("id", threadFocus)
        .maybeSingle();
      exhibitorName = exRow?.company_name ?? null;
    }

    // Mark as orchestrator when this is the first non-exhibitor thread for the show
    let isOrchestrator = false;
    if (!threadFocus) {
      const { count } = await supabase
        .from("chat_threads")
        .select("id", { count: "exact", head: true })
        .eq("trade_show_id", id)
        .is("exhibitor_focus", null);
      isOrchestrator = (count ?? 0) === 0;
    }

    const { data: created, error: threadErr } = await supabase
      .from("chat_threads")
      .insert({
        trade_show_id: id,
        user_id: user.id,
        title,
        scope: "show",
        exhibitor_focus: threadFocus,
        exhibitor_name: exhibitorName,
        is_orchestrator: isOrchestrator,
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
    .eq("trade_show_id", id)
    .range(0, 4999);

  const exhibitors: ExhibitorChatContext[] = (exhibitorRows ?? []).map((e: any) => ({
    id: e.id,
    company_name: e.company_name,
    website: e.website,
    booth: e.booth,
    one_liner: e.exhibitor_short?.one_liner ?? null,
    priority_label: e.exhibitor_short?.priority_label ?? null,
    match_confidence: e.exhibitor_short?.match_confidence ?? null,
    isp_sector_match: e.exhibitor_short?.isp_sector_match ?? [],
  }));

  // Optional deep context for focused exhibitor
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

  // Chat history for this thread
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
  const crawlState = await loadCrawlState(supabase, id);

  // Persist user message
  await supabase.from("chat_messages").insert({
    trade_show_id: id,
    user_id: user.id,
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

  // -----------------------------------------------------------------------
  // Build system blocks (Orchestrator prompt replaces default chat system)
  // -----------------------------------------------------------------------
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: ORCHESTRATOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    { type: "text", text: settings.prio_context, cache_control: { type: "ephemeral" } },
    { type: "text", text: catalogAsPromptBlock(), cache_control: { type: "ephemeral" } },
  ];
  if (threadFocus) {
    const focusedEx = exhibitors.find((e) => e.id === threadFocus);
    if (focusedEx) {
      systemBlocks.push({
        type: "text",
        text: `# Aktuell fokussierter Aussteller\n\nDer User befindet sich auf der Detail-Seite von **${focusedEx.company_name}** (ID: \`${focusedEx.id}\`). Wenn der User "Deep-Dive starten", "analysiere", "was weisst du ueber diesen" oder aehnliches sagt, bezieht er sich auf diesen Aussteller, sofern nicht explizit ein anderer genannt wird.`,
      });
    }
  }
  if (exhibitors.length > 0) {
    systemBlocks.push({
      type: "text",
      text: `# Aussteller-Kontext (JSON)\n\n${JSON.stringify(exhibitors, null, 2)}`,
      cache_control: { type: "ephemeral" },
    });
  }
  if ((show as any).chat_context?.trim()) {
    systemBlocks.push({ type: "text", text: `# Messe-Kontext\n\n${(show as any).chat_context.trim()}` });
  }
  if (deepContext) {
    systemBlocks.push({
      type: "text",
      text: `# Deep-Dive zum aktuellen Aussteller (JSON)\n\n${JSON.stringify(deepContext, null, 2)}`,
    });
  }
  if (crawlState) {
    systemBlocks.push({ type: "text", text: renderCrawlStateBlock(crawlState) });
  }

  // -----------------------------------------------------------------------
  // Tool list: orchestrator tools + optional client tools
  // -----------------------------------------------------------------------
  const tools: any[] = [...ORCHESTRATOR_TOOL_DEFS];
  if (body.with_web_search) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: settings.chat_web_search_max_uses ?? 5 });
  }
  if (threadFocus) {
    tools.push({
      name: "update_exhibitor_intel",
      description:
        "Speichert recherchierte Information zu diesem Aussteller in die Datenbank. Nur aufrufen wenn der User explizit bestaetigt hat, dass gespeichert werden soll.",
      input_schema: {
        type: "object",
        properties: {
          table: { type: "string", enum: ["short", "deep"] },
          field: { type: "string" },
          value: {},
        },
        required: ["table", "field", "value"],
      },
    });
  }

  // -----------------------------------------------------------------------
  // Streaming response
  // -----------------------------------------------------------------------
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

        // Build initial messages from history
        const messagesArr: Anthropic.MessageParam[] = [
          ...history.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.content })),
          { role: "user", content: body.message },
        ];

        // Tool-use loop — max 8 round-trips
        for (let iter = 0; iter < 8; iter++) {
          const apiStream = anthropic().messages.stream({
            model,
            max_tokens: settings.chat_max_tokens ?? 2500,
            system: systemBlocks as any,
            tools,
            messages: messagesArr,
          });

          const contentBlocks: any[] = [];
          let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
          let currentTextBlock = "";
          let stopReason: string | null = null;

          for await (const event of apiStream) {
            if (event.type === "content_block_start") {
              const block = event.content_block as any;
              if (block.type === "text") {
                currentTextBlock = "";
              } else if (block.type === "tool_use") {
                currentToolUse = { id: block.id, name: block.name, inputJson: "" };
              } else if (block.type === "server_tool_use" && block.name === "web_search") {
                // will be yielded via tool_result
              }
            } else if (event.type === "content_block_delta") {
              const delta = event.delta as any;
              if (delta.type === "text_delta") {
                const text = delta.text as string;
                currentTextBlock += text;
                assistantBuffer += text;
                send({ type: "text", text });
              } else if (delta.type === "input_json_delta" && currentToolUse) {
                currentToolUse.inputJson += delta.partial_json ?? "";
              }
            } else if (event.type === "content_block_stop") {
              if (currentTextBlock) {
                contentBlocks.push({ type: "text", text: currentTextBlock });
                currentTextBlock = "";
              }
              if (currentToolUse) {
                let parsedInput: unknown = {};
                try { parsedInput = JSON.parse(currentToolUse.inputJson || "{}"); } catch { /* ignore */ }
                contentBlocks.push({
                  type: "tool_use",
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  input: parsedInput,
                } as any);
                currentToolUse = null;
              }
            } else if (event.type === "message_delta") {
              stopReason = (event.delta as any).stop_reason ?? stopReason;
            } else if (event.type === "message_start") {
              const usage = (event.message as any).usage ?? {};
              totalCacheCreate += usage.cache_creation_input_tokens ?? 0;
              totalCacheRead += usage.cache_read_input_tokens ?? 0;
              totalIn += usage.input_tokens ?? 0;
            }
          }

          // Accumulate final usage from the completed message
          const finalMsg = await apiStream.finalMessage();
          totalIn = finalMsg.usage.input_tokens;
          totalOut = finalMsg.usage.output_tokens;
          totalCacheCreate = (finalMsg.usage as any).cache_creation_input_tokens ?? 0;
          totalCacheRead = (finalMsg.usage as any).cache_read_input_tokens ?? 0;

          // Collect all tool_use blocks from the final message
          const toolUseBlocks = (finalMsg.content as any[]).filter((b) => b.type === "tool_use");
          const webSearchBlocks = (finalMsg.content as any[]).filter(
            (b) => b.type === "server_tool_use" && b.name === "web_search",
          );

          // Emit web search events
          for (const ws of webSearchBlocks) {
            if (ws.input?.query) {
              send({ type: "search", query: ws.input.query });
            }
          }

          // If no tool calls, we're done
          if (toolUseBlocks.length === 0 && webSearchBlocks.length === 0) break;

          // Build tool results for next iteration
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tu of toolUseBlocks) {
            if (ORCHESTRATOR_TOOL_NAMES.has(tu.name)) {
              // Server-side execution: stream running indicator
              send({ type: "pipeline_action", tool: tu.name, input: tu.input, status: "running" });

              let result: { summary: string; detail?: Record<string, unknown> };
              try {
                result = await executePipelineTool(
                  tu.name,
                  tu.input,
                  id,
                  user.id,
                  supabase as any,
                );
                // Emit confirmation widget before the done event when tool requires user approval
                if (result.detail?.confirmation_request) {
                  send({ type: "confirmation_request", ...result.detail.confirmation_request });
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
                content:
                  typeof result.detail?.handbook === "string"
                    ? (result.detail.handbook as string)
                    : result.summary,
              });
            } else if (tu.name === "update_exhibitor_intel" && threadFocus) {
              // Client tool — execute server-side and acknowledge
              const { table, field, value } = tu.input as { table: string; field: string; value: unknown };
              send({ type: "tool_use", tool: tu.name, input: tu.input });
              let toolResultContent = "ok";
              if (table === "short" || table === "deep") {
                const allowed = table === "short" ? SHORT_FIELDS : DEEP_FIELDS;
                if (allowed.has(field)) {
                  const dbTable = table === "short" ? "exhibitor_short" : "exhibitor_deep";
                  const { error: dbErr } = await supabase
                    .from(dbTable)
                    .update({ [field]: value })
                    .eq("exhibitor_id", threadFocus);
                  toolResultContent = dbErr ? `error: ${dbErr.message}` : `gespeichert: ${field}`;
                } else {
                  toolResultContent = `error: field '${field}' not editable`;
                }
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: toolResultContent,
              });
            }
          }

          if (toolResults.length === 0) break;

          // Continue loop with assistant turn + tool results
          messagesArr.push({ role: "assistant", content: finalMsg.content as any });
          messagesArr.push({ role: "user", content: toolResults });
        }

        // Send final usage
        const costUsd = priceForChat(model, { input_tokens: totalIn, output_tokens: totalOut, cache_creation_input_tokens: totalCacheCreate, cache_read_input_tokens: totalCacheRead });
        send({
          type: "usage",
          tokens_in: totalIn,
          tokens_out: totalOut,
          cache_creation_tokens: totalCacheCreate,
          cache_read_tokens: totalCacheRead,
          cost_usd: costUsd,
        });
        send({ type: "done" });

        // Persist assistant message
        await supabase.from("chat_messages").insert({
          trade_show_id: id,
          user_id: user.id,
          thread_id: threadId,
          role: "assistant",
          content: assistantBuffer,
          tokens_in: totalIn,
          tokens_out: totalOut,
          model,
          with_deep_context: !!body.with_deep_context,
          with_web_search: !!body.with_web_search,
          pipeline_action: pipelineActions.length > 0 ? pipelineActions : null,
        });
        await supabase
          .from("chat_threads")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", threadId);

        if (body.message.trim()) {
          await tryAppendLog(supabase, id, {
            phase: "chat",
            message: `Orchestrator (${model}): ${body.message.slice(0, 80)}`,
            meta: {
              tokens_in: totalIn,
              tokens_out: totalOut,
              pipeline_actions: pipelineActions.length,
            },
          });
        }
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
      .select("id, title, scope, exhibitor_focus, exhibitor_name, company_focus, is_orchestrator, created_at, last_message_at")
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
      .select("id, role, content, model, with_deep_context, with_web_search, pipeline_action, created_at")
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
