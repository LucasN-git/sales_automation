import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { type ChatTurn } from "@/lib/claude";
import { catalogAsPromptBlock } from "@/lib/isp-catalog";
import { priceForChat } from "@/lib/pricing";
import {
  COMPETITOR_ORCHESTRATOR_SYSTEM_PROMPT,
  COMPETITOR_TOOL_DEFS,
  COMPETITOR_TOOL_NAMES,
  executeCompetitorTool,
} from "@/lib/competitor-orchestrator";
import { loadCompetitorState } from "@/lib/competitor-log";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

const Body = z.object({
  message: z.string().min(1).max(4000),
  thread_id: z.string().uuid().nullable().optional(),
  model: z.string().min(3).max(100).optional(),
  competitor_focus: z.string().uuid().nullable().optional(),
  with_web_search: z.boolean().optional(),
});

// Fields editable via update_competitor_intel
const INTEL_FIELDS = new Set([
  "one_liner", "positioning", "threat_level", "isp_sector_match", "growth_signals", "portfolio",
]);

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
  let competitorFocus = body.competitor_focus ?? null;

  if (!threadId) {
    const title = body.message.slice(0, 60).replace(/\s+/g, " ").trim();

    let competitorName: string | null = null;
    if (competitorFocus) {
      const { data: cRow } = await supabase
        .from("competitors")
        .select("display_name")
        .eq("id", competitorFocus)
        .maybeSingle();
      competitorName = cRow?.display_name ?? null;
    }

    const { data: created, error: threadErr } = await supabase
      .from("chat_threads")
      .insert({
        user_id: user.id,
        title: competitorName ? `${competitorName}: ${title}` : title,
        scope: "competitor",
        competitor_focus: competitorFocus,
        is_orchestrator: !competitorFocus,
      })
      .select("id, competitor_focus")
      .single();

    if (threadErr || !created) {
      return NextResponse.json(
        { error: `thread create failed: ${threadErr?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    threadId = created.id;
    competitorFocus = created.competitor_focus ?? null;
  } else {
    const { data: existing } = await supabase
      .from("chat_threads")
      .select("competitor_focus")
      .eq("id", threadId)
      .maybeSingle();
    competitorFocus = existing?.competitor_focus ?? null;
  }

  // Load all competitors with current version data (context)
  const { data: competitorRows } = await supabase
    .from("competitors_overview")
    .select(
      "id, display_name, domain, website, hq_country, status, short_status, isp_sector_match, threat_level, one_liner, positioning",
    )
    .order("status")
    .limit(100);

  // Load focused competitor detail if set
  let focusedDetail: Record<string, unknown> | null = null;
  if (competitorFocus) {
    const { data: focusRow } = await supabase
      .from("competitors")
      .select(
        "id, display_name, website, domain, hq_country, status, short_status",
      )
      .eq("id", competitorFocus)
      .maybeSingle();

    if (focusRow) {
      const { data: versionRow } = await supabase
        .from("competitor_versions")
        .select(
          "one_liner, positioning, portfolio, isp_sector_match, threat_level, growth_signals, customers, competitive_angles_vs_isp, recent_news, created_at",
        )
        .eq("competitor_id", competitorFocus)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      focusedDetail = { ...focusRow, latest_version: versionRow ?? null };
    }
  }

  // Load competitor state snapshot (active run + short counts + recent logs)
  const competitorState = await loadCompetitorState(supabase, user.id);

  // Chat history
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
    user_id: user.id,
    thread_id: threadId,
    role: "user",
    content: body.message,
    model,
    with_web_search: !!body.with_web_search,
  });
  await supabase
    .from("chat_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", threadId);

  // -----------------------------------------------------------------------
  // Build system blocks
  // -----------------------------------------------------------------------
  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: COMPETITOR_ORCHESTRATOR_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: settings.prio_context,
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: catalogAsPromptBlock(),
      cache_control: { type: "ephemeral" },
    },
  ];

  if (competitorFocus && focusedDetail) {
    systemBlocks.push({
      type: "text",
      text: `# Aktuell fokussierter Konkurrent\n\nDer User befindet sich auf der Detail-Seite von **${(focusedDetail as any).display_name}** (ID: \`${competitorFocus}\`). Beziehe "diesen", "ihn", "analysiere" auf diesen Konkurrenten sofern nicht explizit anders genannt.\n\n${JSON.stringify(focusedDetail, null, 2)}`,
    });
  }

  if ((competitorRows ?? []).length > 0) {
    systemBlocks.push({
      type: "text",
      text: `# Konkurrenten-Kontext (JSON)\n\n${JSON.stringify(competitorRows, null, 2)}`,
      cache_control: { type: "ephemeral" },
    });
  }

  // State block: always injected, not cached (changes every request)
  {
    const { active_run, short_counts, total_competitors, recent_logs } = competitorState;
    const lines: string[] = ["# Aktueller Wettbewerber-Status"];

    if (active_run) {
      lines.push(
        `\n## Laufender Discovery-Lauf`,
        `Status: ${active_run.status} | Phase: ${active_run.current_phase ?? "?"} | Kandidaten: ${active_run.candidates_kept ?? "?"}/${active_run.candidates_total ?? "?"}`,
      );
      if (active_run.error_message) lines.push(`Fehler: ${active_run.error_message}`);
    } else {
      lines.push(`\n## Discovery-Lauf: kein aktiver Lauf.`);
    }

    lines.push(
      `\n## Konkurrenten gesamt: ${total_competitors}`,
      `Short-Analyse Status: ${Object.entries(short_counts).map(([k, v]) => `${k}: ${v}`).join(", ") || "keine"}`,
    );

    if (recent_logs.length > 0) {
      lines.push(`\n## Letzte Log-Eintraege (${recent_logs.length})`);
      for (const l of recent_logs) {
        lines.push(`[${l.created_at}] [${l.level}] ${l.phase ? `[${l.phase}] ` : ""}${l.message}`);
      }
    }

    systemBlocks.push({ type: "text", text: lines.join("\n") });
  }

  // -----------------------------------------------------------------------
  // Tool list
  // -----------------------------------------------------------------------
  const tools: any[] = [...COMPETITOR_TOOL_DEFS];
  if (body.with_web_search) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: settings.chat_web_search_max_uses ?? 5,
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

          const finalMsg = await apiStream.finalMessage();
          totalIn = finalMsg.usage.input_tokens;
          totalOut = finalMsg.usage.output_tokens;
          totalCacheCreate = (finalMsg.usage as any).cache_creation_input_tokens ?? 0;
          totalCacheRead = (finalMsg.usage as any).cache_read_input_tokens ?? 0;

          const toolUseBlocks = (finalMsg.content as any[]).filter((b) => b.type === "tool_use");
          const webSearchBlocks = (finalMsg.content as any[]).filter(
            (b) => b.type === "server_tool_use" && b.name === "web_search",
          );

          for (const ws of webSearchBlocks) {
            if (ws.input?.query) {
              send({ type: "search", query: ws.input.query });
            }
          }

          if (toolUseBlocks.length === 0 && webSearchBlocks.length === 0) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tu of toolUseBlocks) {
            if (COMPETITOR_TOOL_NAMES.has(tu.name)) {
              send({ type: "pipeline_action", tool: tu.name, input: tu.input, status: "running" });

              let result: { summary: string; detail?: Record<string, unknown> };
              try {
                result = await executeCompetitorTool(tu.name, tu.input, user.id, supabase as any);
                if (result.detail?.confirmation_request) {
                  send({ type: "confirmation_request", ...result.detail.confirmation_request });
                }
                send({
                  type: "pipeline_action",
                  tool: tu.name,
                  input: tu.input,
                  status: "done",
                  result: result.summary,
                });
                pipelineActions.push({ tool: tu.name, input: tu.input, result: result.summary });
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                result = { summary: `Fehler: ${errMsg}` };
                send({
                  type: "pipeline_action",
                  tool: tu.name,
                  input: tu.input,
                  status: "error",
                  result: errMsg,
                });
              }

              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content:
                  typeof result.detail?.handbook === "string"
                    ? (result.detail.handbook as string)
                    : result.summary,
              });
            }
          }

          if (toolResults.length === 0) break;

          messagesArr.push({ role: "assistant", content: finalMsg.content as any });
          messagesArr.push({ role: "user", content: toolResults });
        }

        // Send final usage
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

        // Persist assistant message
        await supabase.from("chat_messages").insert({
          user_id: user.id,
          thread_id: threadId,
          role: "assistant",
          content: assistantBuffer,
          tokens_in: totalIn,
          tokens_out: totalOut,
          model,
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
  const competitorFilter = url.searchParams.get("competitor");

  if (listThreads) {
    let query = supabase
      .from("chat_threads")
      .select("id, title, scope, competitor_focus, is_orchestrator, created_at, last_message_at")
      .eq("user_id", user.id)
      .eq("scope", "competitor")
      .order("last_message_at", { ascending: false });

    if (competitorFilter) {
      query = query.eq("competitor_focus", competitorFilter);
    }

    const { data } = await query;
    return NextResponse.json({ threads: data ?? [] });
  }

  if (threadId) {
    const { data } = await supabase
      .from("chat_messages")
      .select("id, role, content, model, with_web_search, pipeline_action, created_at")
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
    await supabase.from("chat_threads").delete().eq("id", threadId).eq("user_id", user.id);
  } else {
    // Delete all competitor-scoped threads for this user.
    const { data: ids } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("user_id", user.id)
      .eq("scope", "competitor");
    const threadIds = (ids ?? []).map((r: { id: string }) => r.id);
    if (threadIds.length > 0) {
      await supabase.from("chat_messages").delete().in("thread_id", threadIds);
      await supabase.from("chat_threads").delete().in("id", threadIds);
    }
  }

  return NextResponse.json({ ok: true });
}
