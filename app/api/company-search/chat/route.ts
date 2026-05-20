import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { type ChatTurn } from "@/lib/claude";
import { catalogAsPromptBlock } from "@/lib/isp-catalog";
import { priceForChat } from "@/lib/pricing";
import {
  COMPANY_SEARCH_ORCHESTRATOR_SYSTEM_PROMPT,
  COMPANY_SEARCH_TOOL_DEFS,
  COMPANY_SEARCH_TOOL_NAMES,
  executeCompanySearchTool,
  loadCompanySearchState,
} from "@/lib/company-search-orchestrator";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

const Body = z.object({
  message: z.string().min(1).max(4000),
  thread_id: z.string().uuid().nullable().optional(),
  model: z.string().min(3).max(100).optional(),
  company_search_run_focus: z.string().uuid().nullable().optional(),
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

  let threadId = body.thread_id ?? null;
  let runFocus = body.company_search_run_focus ?? null;

  if (!threadId) {
    const title = body.message.slice(0, 60).replace(/\s+/g, " ").trim();

    let runHint: string | null = null;
    if (runFocus) {
      const { data: runRow } = await supabase
        .from("company_search_runs")
        .select("user_prompt")
        .eq("id", runFocus)
        .maybeSingle();
      runHint = (runRow as { user_prompt: string | null } | null)?.user_prompt ?? null;
    }

    const { data: created, error: threadErr } = await supabase
      .from("chat_threads")
      .insert({
        user_id: user.id,
        title: runHint ? `${runHint.slice(0, 30)}: ${title}` : title,
        scope: "company_search",
        company_search_run_focus: runFocus,
      })
      .select("id, company_search_run_focus")
      .single();

    if (threadErr || !created) {
      return NextResponse.json(
        { error: `thread create failed: ${threadErr?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    threadId = (created as { id: string }).id;
    runFocus =
      (created as { company_search_run_focus: string | null }).company_search_run_focus ?? null;
  } else {
    const { data: existing } = await supabase
      .from("chat_threads")
      .select("company_search_run_focus")
      .eq("id", threadId)
      .maybeSingle();
    runFocus =
      (existing as { company_search_run_focus: string | null } | null)
        ?.company_search_run_focus ?? null;
  }

  // Load focused run detail if set
  let focusedDetail: Record<string, unknown> | null = null;
  if (runFocus) {
    const { data: runRow } = await supabase
      .from("company_search_runs")
      .select(
        "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, tokens_in, tokens_out, web_search_uses, firecrawl_credits, error_message, created_at, finished_at",
      )
      .eq("id", runFocus)
      .maybeSingle();
    if (runRow) {
      const { data: resultRows } = await supabase
        .from("company_search_results")
        .select(
          "id, name, website, firecrawl_confirmed_url, location_city, location_country, isp_sector_match, relevance_score, one_liner, priority_label, match_confidence, firecrawl_status, dismissed, added_company_id",
        )
        .eq("run_id", runFocus)
        .order("relevance_score", { ascending: false, nullsFirst: false })
        .limit(30);
      focusedDetail = { run: runRow, results: resultRows ?? [] };
    }
  }

  const state = await loadCompanySearchState(supabase, user.id);

  const { data: historyRows } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  const history: ChatTurn[] = ((historyRows ?? []) as Array<{ role: string; content: string }>).map(
    (r) => ({ role: r.role as "user" | "assistant", content: r.content }),
  );

  const settings = await getSettings(supabase, user.id);
  const model = body.model ?? settings.deep_model;

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

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: COMPANY_SEARCH_ORCHESTRATOR_SYSTEM_PROMPT,
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

  if (runFocus && focusedDetail) {
    systemBlocks.push({
      type: "text",
      text: `# Aktuell fokussierter Kunden-Suche-Lauf\n\nDer User befindet sich auf einem konkreten Lauf (ID: \`${runFocus}\`). Beziehe "dieser Lauf", "die Ergebnisse" auf diesen Lauf sofern nicht explizit anders genannt.\n\n${JSON.stringify(focusedDetail, null, 2)}`,
    });
  }

  {
    const lines: string[] = ["# Aktueller Company-Search-Status"];

    if (state.active_run) {
      const r = state.active_run as Record<string, unknown>;
      lines.push(
        `\n## Laufender Kunden-Suche-Lauf`,
        `ID: ${r.id}`,
        `Status: ${r.status} | Phase: ${r.current_phase ?? "?"} | Kandidaten: ${r.candidates_added ?? 0} added / ${r.candidates_validated ?? 0} validated / ${r.candidates_total ?? "?"} total`,
        `Prompt: ${(r.user_prompt as string | null) ?? "-"}`,
      );
      if (r.error_message) lines.push(`Fehler: ${r.error_message}`);
    } else {
      lines.push(`\n## Kunden-Suche: kein aktiver Lauf.`);
      if (state.latest_run) {
        const r = state.latest_run as Record<string, unknown>;
        lines.push(
          `\n## Letzter Lauf`,
          `ID: ${r.id} | Status: ${r.status} | Phase: ${r.current_phase ?? "?"} | Prompt: ${(r.user_prompt as string | null) ?? "-"}`,
        );
      }
    }

    lines.push(
      `\n## Ergebnis-Counts`,
      `total=${state.result_counts.total} validated=${state.result_counts.validated} dismissed=${state.result_counts.dismissed} added=${state.result_counts.added}`,
    );
    lines.push(
      `\n## Settings`,
      `max_web_searches=${state.settings.max_web_searches ?? "(default)"} max_tokens=${state.settings.max_tokens ?? "(default)"} custom_system_prompt=${state.settings.has_custom_system_prompt}`,
    );

    if (state.recent_logs.length > 0) {
      lines.push(`\n## Letzte Log-Eintraege (${state.recent_logs.length})`);
      for (const l of state.recent_logs) {
        lines.push(`[${l.created_at}] [${l.level}] ${l.phase ? `[${l.phase}] ` : ""}${l.message}`);
      }
    }

    systemBlocks.push({ type: "text", text: lines.join("\n") });
  }

  const tools: any[] = [...COMPANY_SEARCH_TOOL_DEFS];
  if (body.with_web_search) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: settings.chat_web_search_max_uses ?? 5,
    });
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

        for (let iter = 0; iter < 8; iter++) {
          const apiStream = anthropic().messages.stream({
            model,
            max_tokens: settings.chat_max_tokens ?? 2500,
            system: systemBlocks as any,
            tools,
            messages: messagesArr,
          });

          let currentToolUse: { id: string; name: string; inputJson: string } | null = null;
          let currentTextBlock = "";

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
              currentTextBlock = "";
              currentToolUse = null;
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
            if (ws.input?.query) send({ type: "search", query: ws.input.query });
          }

          if (toolUseBlocks.length === 0 && webSearchBlocks.length === 0) break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const tu of toolUseBlocks) {
            if (COMPANY_SEARCH_TOOL_NAMES.has(tu.name as any)) {
              send({ type: "pipeline_action", tool: tu.name, input: tu.input, status: "running" });

              let result: { summary: string; detail?: Record<string, unknown> };
              try {
                result = await executeCompanySearchTool(
                  tu.name,
                  tu.input,
                  user.id,
                  supabase as any,
                  runFocus,
                );
                if (result.detail?.confirmation_request) {
                  send({
                    type: "confirmation_request",
                    ...(result.detail.confirmation_request as Record<string, unknown>),
                  });
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
  const runFilter = url.searchParams.get("run");

  if (listThreads) {
    let query = supabase
      .from("chat_threads")
      .select("id, title, scope, company_search_run_focus, created_at, last_message_at")
      .eq("user_id", user.id)
      .eq("scope", "company_search")
      .order("last_message_at", { ascending: false });

    if (runFilter) query = query.eq("company_search_run_focus", runFilter);

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
    const { data: ids } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("user_id", user.id)
      .eq("scope", "company_search");
    const threadIds = ((ids ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (threadIds.length > 0) {
      await supabase.from("chat_messages").delete().in("thread_id", threadIds);
      await supabase.from("chat_threads").delete().in("id", threadIds);
    }
  }

  return NextResponse.json({ ok: true });
}
