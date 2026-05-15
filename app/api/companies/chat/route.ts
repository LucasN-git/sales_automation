import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import {
  chatStream,
  type ChatTurn,
  type ClientTool,
  type CompanyChatContext,
} from "@/lib/claude";
import { loadCompanyDirectory } from "@/lib/companies";
import { SECTOR_IDS } from "@/lib/isp-catalog";

const Body = z.object({
  message: z.string().min(1).max(4000),
  thread_id: z.string().uuid().nullable().optional(),
  model: z.string().min(3).max(100).optional(),
  company_focus: z.string().uuid().nullable().optional(),
  with_web_search: z.boolean().optional(),
});

const SearchArgs = z.object({
  query: z.string().min(1).max(120).optional(),
  sector: z.enum(SECTOR_IDS as unknown as [string, ...string[]]).optional(),
  priority: z.enum(["hoch", "mittel", "niedrig"]).optional(),
  match_min: z.number().int().min(0).max(100).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const SEARCH_COMPANIES_TOOL: ClientTool = {
  name: "search_companies",
  description:
    "FALLBACK fuer Substring-Suche im Firmen-Namen (z.B. Tippfehler, Subsidiary, " +
    "wenn der gesuchte Name nicht im Firmen-Directory-Block steht). NICHT fuer " +
    "Aggregate wie Hot-Leads-Counts oder Top-X — die ALLE aus dem Directory " +
    "beantworten. Tool deckelt bei 50 und liefert falsche Totals fuer Counts. " +
    "Rueckgabe pro Firma: Name, Domain, alle Quell-Messen, plus beste Short-" +
    "Tier-Einschaetzung (one_liner, priority, match_confidence, sektoren).",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Substring im Firmen-Namen (case-insensitive). Optional.",
      },
      sector: {
        type: "string",
        enum: SECTOR_IDS,
        description: "Nur Firmen, deren beste Short-Einschaetzung diesen Sektor enthaelt.",
      },
      priority: {
        type: "string",
        enum: ["hoch", "mittel", "niedrig"],
        description: "Nur Firmen mit dieser besten Prio-Einstufung.",
      },
      match_min: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Mindest-match_confidence (best of all shows).",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 20,
        description: "Anzahl Rueckgaben (default 20, max 50).",
      },
    },
  },
};

const COMPANIES_CHAT_GUIDANCE = `# Datenquellen

Du hast den vollstaendigen **Firmen-Directory-Block** im System-Prompt. Er
enthaelt ALLE Firmen dieses Users ueber alle Messen, mit Name, Domain, Website,
beste Prio, beste match_confidence, Sektor-Union, einem one_liner und den
Quell-Messen-Namen. Sortiert nach match_confidence absteigend.

**Antworte primaer aus diesem Directory.** Beispiele:
- "Wie viele Prio-Hoch-Leads habe ich?" -> direkt zaehlen, alle mit best_priority="hoch".
  NICHT search_companies aufrufen — das deckelt bei 50 und liefert falsche Totals.
- "Top 10 in Sektor X" -> Directory filtern (union_sectors enthaelt X), top 10
  nach best_match_confidence.
- "Welche Firma hat Domain Y?" -> direkt nachschlagen.

Das Tool **search_companies** ist Fallback fuer Substring-Suche im Namen, wenn
der User einen Namen nennt, den du im Directory nicht direkt findest (Tippfehler,
Subsidiary). Bei Aggregaten ueber Prio/Sektor/Confidence IMMER das Directory.

Bei Empfehlungen kurz ISP-Sektor/Lifecycle begruenden. Bullets oder kurze Tabelle.`;

// Supabase types nested relations as arrays even when the FK is 1:1, so we
// allow both shapes here and pickSingle them later.
type ShortShape = {
  one_liner: string | null;
  priority_label: string | null;
  match_confidence: number | null;
  isp_sector_match: string[] | null;
};
type ShowShape = { id: string; name: string };
type CompanyJoinRow = {
  id: string;
  display_name: string;
  domain: string | null;
  exhibitors:
    | Array<{
        id: string;
        trade_show_id: string;
        trade_shows: ShowShape | ShowShape[] | null;
        exhibitor_short: ShortShape | ShortShape[] | null;
      }>
    | null;
};

type SearchResult = {
  id: string;
  display_name: string;
  domain: string | null;
  shows: Array<{ id: string; name: string }>;
  best_short: {
    one_liner: string | null;
    priority_label: string | null;
    match_confidence: number | null;
    isp_sector_match: string[];
  } | null;
};

function aggregateBestOfShows(
  rows: CompanyJoinRow[],
  filter: z.infer<typeof SearchArgs>,
): SearchResult[] {
  const out: SearchResult[] = [];
  for (const row of rows) {
    const exs = row.exhibitors ?? [];
    const shows = new Map<string, { id: string; name: string }>();
    let best: SearchResult["best_short"] | null = null;
    for (const e of exs) {
      const ts = Array.isArray(e.trade_shows) ? e.trade_shows[0] : e.trade_shows;
      if (ts) shows.set(ts.id, ts);
      // exhibitor_short may come back as an object (1:1) or single-entry array
      const s = Array.isArray(e.exhibitor_short)
        ? e.exhibitor_short[0]
        : e.exhibitor_short;
      if (!s) continue;
      const conf = s.match_confidence ?? -1;
      const bestConf = best?.match_confidence ?? -1;
      if (best === null || conf > bestConf) {
        best = {
          one_liner: s.one_liner,
          priority_label: s.priority_label,
          match_confidence: s.match_confidence,
          isp_sector_match: s.isp_sector_match ?? [],
        };
      }
    }

    // Apply filters that we couldn't push to SQL.
    if (filter.sector && !best?.isp_sector_match.includes(filter.sector)) continue;
    if (filter.priority && best?.priority_label !== filter.priority) continue;
    if (
      filter.match_min !== undefined &&
      (best?.match_confidence ?? -1) < filter.match_min
    ) continue;

    out.push({
      id: row.id,
      display_name: row.display_name,
      domain: row.domain,
      shows: Array.from(shows.values()).sort((a, b) => a.name.localeCompare(b.name)),
      best_short: best,
    });
  }
  // Best-match-first sort.
  out.sort(
    (a, b) =>
      (b.best_short?.match_confidence ?? -1) -
      (a.best_short?.match_confidence ?? -1),
  );
  return out;
}

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

  // Resolve / create thread.
  let threadId = body.thread_id ?? null;
  let threadFocus = body.company_focus ?? null;
  if (!threadId) {
    const title = body.message.slice(0, 60).replace(/\s+/g, " ").trim();
    const { data: created, error: threadErr } = await supabase
      .from("chat_threads")
      .insert({
        trade_show_id: null,
        user_id: user.id,
        title,
        scope: "companies",
        company_focus: threadFocus,
      })
      .select("id, company_focus")
      .single();
    if (threadErr || !created) {
      return NextResponse.json(
        { error: `thread create failed: ${threadErr?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    threadId = created.id;
    threadFocus = (created as { company_focus: string | null }).company_focus ?? null;
  } else {
    const { data: existing } = await supabase
      .from("chat_threads")
      .select("company_focus")
      .eq("id", threadId)
      .maybeSingle();
    threadFocus = (existing as { company_focus: string | null } | null)?.company_focus ?? null;
  }

  // Optional company-focus context: prefetch a small block about the focused
  // company so Claude has something concrete without needing a tool round-trip
  // for trivial focus-questions.
  let companyFocusBlock: string | null = null;
  if (threadFocus) {
    const { data: focusRow } = await supabase
      .from("companies")
      .select(
        `id, display_name, domain, website,
         exhibitors(
           id, booth, trade_show_id,
           trade_shows(id, name),
           exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match)
         )`,
      )
      .eq("id", threadFocus)
      .maybeSingle();
    if (focusRow) {
      companyFocusBlock = `# Aktuell fokussierte Firma\n\n${JSON.stringify(focusRow, null, 2)}`;
    }
  }

  // History — only this thread.
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

  // Vollstaendige Firmen-Liste (Listing-Tier) als gecachter Slot-4-Block.
  // RLS scoped via security_invoker auf companies_overview.
  const companyDirectory: CompanyChatContext[] = await loadCompanyDirectory(supabase);

  // Persist user message.
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

  // Tool-execution closure: runs server-side with the user's auth client,
  // so RLS automatically scopes results to this user's companies.
  async function executeClientTool(name: string, args: Record<string, unknown>) {
    if (name !== "search_companies") {
      return { error: `unknown tool: ${name}` };
    }
    let parsed: z.infer<typeof SearchArgs>;
    try {
      parsed = SearchArgs.parse(args);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "invalid args" };
    }
    const limit = parsed.limit ?? 20;

    let q = supabase
      .from("companies")
      .select(
        `id, display_name, domain,
         exhibitors(
           id, trade_show_id,
           trade_shows(id, name),
           exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match)
         )`,
      )
      .order("display_name", { ascending: true });
    if (parsed.query) q = q.ilike("display_name", `%${parsed.query}%`);
    // We oversample to 4x the limit so post-filters (sector/priority/match_min)
    // still leave enough rows to fill the requested limit.
    const { data, error } = await q.limit(Math.min(limit * 4, 200));
    if (error) return { error: error.message };
    const aggregated = aggregateBestOfShows(
      (data ?? []) as unknown as CompanyJoinRow[],
      parsed,
    );
    return aggregated.slice(0, limit);
  }

  const encoder = new TextEncoder();
  let assistantBuffer = "";
  let usageIn = 0;
  let usageOut = 0;
  const searchQueries: string[] = [];
  const toolTrace: Array<{ tool: string; input: Record<string, unknown> }> = [];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "thread", thread_id: threadId })}\n\n`,
          ),
        );

        const gen = chatStream({
          prioContext: settings.prio_context,
          companyDirectory,
          history,
          userMessage: body.message,
          model,
          withWebSearch: !!body.with_web_search,
          showContext: companyFocusBlock,
          extraSystem: COMPANIES_CHAT_GUIDANCE,
          systemPrompt: settings.chat_system_prompt,
          maxTokens: settings.chat_max_tokens,
          webSearchMaxUses: settings.chat_web_search_max_uses,
          clientTools: [SEARCH_COMPANIES_TOOL],
          executeClientTool,
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
          } else if (ev.type === "tool_use") {
            toolTrace.push({ tool: ev.tool, input: ev.input });
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "tool_use", tool: ev.tool, input: ev.input })}\n\n`,
              ),
            );
          } else if (ev.type === "usage" && ev.usage) {
            usageIn = ev.usage.tokens_in;
            usageOut = ev.usage.tokens_out;
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: "usage",
                  tokens_in: ev.usage.tokens_in,
                  tokens_out: ev.usage.tokens_out,
                  cache_creation_tokens: ev.usage.cache_creation_tokens,
                  cache_read_tokens: ev.usage.cache_read_tokens,
                  cost_usd: ev.usage.cost_usd,
                })}\n\n`,
              ),
            );
          } else if (ev.type === "done") {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
          }
        }

        await supabase.from("chat_messages").insert({
          user_id: user!.id,
          trade_show_id: null,
          thread_id: threadId,
          role: "assistant",
          content: assistantBuffer,
          tokens_in: usageIn,
          tokens_out: usageOut,
          model,
          with_deep_context: false,
          with_web_search: !!body.with_web_search,
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
  const companyFilter = url.searchParams.get("company");

  if (listThreads) {
    let query = supabase
      .from("chat_threads")
      .select("id, title, scope, exhibitor_focus, company_focus, created_at, last_message_at")
      .eq("user_id", user.id)
      .eq("scope", "companies")
      .order("last_message_at", { ascending: false });
    if (companyFilter) {
      query = query.eq("company_focus", companyFilter);
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
    // Only delete the user's COMPANIES-scope threads (not dashboard, not show).
    const { data: ids } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("user_id", user.id)
      .eq("scope", "companies");
    const threadIds = (ids ?? []).map((r: { id: string }) => r.id);
    if (threadIds.length > 0) {
      await supabase.from("chat_messages").delete().in("thread_id", threadIds);
      await supabase.from("chat_threads").delete().in("id", threadIds);
    }
  }

  return NextResponse.json({ ok: true });
}
