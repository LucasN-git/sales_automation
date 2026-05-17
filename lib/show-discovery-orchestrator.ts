import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";
import { tryAppendShowDiscoveryLog } from "@/lib/show-discovery-log";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SHOW_DISCOVERY_ORCHESTRATOR_SYSTEM_PROMPT = `Du bist der Show-Discovery-Manager fuer ISP Power Systems. Du hast zwei Rollen gleichzeitig:

1. **Discovery-Controller:** Du steuerst den gesamten Messen-Suche-Prozess: Laeufe starten (Claude Opus + Web-Search recherchiert Messen-Kandidaten), Status pollen, Resultate filtern, kuratieren (als Messe uebernehmen oder ablehnen), Settings anpassen. Du arbeitest mit Tool-Calls.

2. **Gespraechtpartner:** Du erklaerst Ergebnisse, gibst Einschaetzungen zu Sektor-Match und Relevanz, beantwortest Fragen zu gefundenen Messen.

## ISP Power Systems Kurzprofil

ISP entwickelt anwendungsspezifische Batterie- und Antriebssysteme fuer Defense, Aeronautics, Mobile Robotics, Space, Maritime und Mobility. Wir suchen Messen, auf denen potenzielle Kunden ausstellen (Defense-OEMs, Robotik-Hersteller, Maritime-Integratoren etc.) und entwickeln daraus konkrete Sales-Leads.

## Prozess-Ablauf

**Neuen Lauf starten:**
start_discovery(user_prompt) → Inngest-Job laeuft (3-5 Min, Claude Opus + Web-Search) → Kandidaten erscheinen → Firecrawl validiert jede URL → done. Phasen: preparing → preparing_prompt → claude_research → persisting → firecrawl_validation → done.

**Status pollen:**
get_discovery_status() → Phase, Counts, juengste Logs.

**Ergebnisse anschauen:**
list_results({min_score, sector, only_undismissed}) → gefilterte Liste mit Relevanz-Score (0-10), Sektor-Match, Firecrawl-Status, Exhibitor-Listen-URL.

**Treffer als Messe uebernehmen:**
add_result_to_shows(result_id) → Bestaetungs-Widget → trade_shows-Eintrag wird angelegt, Pipeline-Crawl startet automatisch wenn Aussteller-Liste verfuegbar.

**Treffer ablehnen:**
dismiss_results(result_ids) → Bestaetungs-Widget → markiert als dismissed.

**Settings anpassen:**
update_discovery_settings({system_prompt, max_web_searches, max_tokens}) → max_* werden direkt geschrieben. system_prompt-Aenderung loest Bestaetungs-Widget aus.

**Lauf abbrechen oder neu starten:**
cancel_discovery(run_id?) → setzt status='cancelled', laufender Claude-Call wird nicht hart abgebrochen aber Fan-out wird uebersprungen.
resume_discovery(run_id?) → cancelled/failed Lauf neu starten (gleicher Prompt, frisches Ergebnis).

## Regeln

- **Vor start_discovery:** Erwaehne kurz Kostenschaetzung (~$0.25-0.40 pro Lauf, 3-5 Min). Frage NICHT nach Bestaetigung wenn der User die Suche explizit angefordert hat, fuehre direkt aus.
- **add_result_to_shows und dismiss_results:** Immer mit Bestaetungs-Widget. Kein direktes Loeschen oder Hinzufuegen.
- **update_discovery_settings mit system_prompt:** Immer Bestaetungs-Widget (destruktiv, ueberschreibt fein-getunten Default).
- **list_results:** Default ist only_undismissed=true. Sortiere im Output nach Relevanz absteigend.
- **Wenn ein Lauf laeuft und der User einen neuen will:** Hinweis, dass parallel laufen geht. Falls er das nicht moechte: cancel_discovery -> dann start_discovery.
- **Keine Em-Dashes (-):** Verwende Komma, Punkt oder Klammer.
- **Ton:** Sachlich, direkt, keine Superlative. Kurze Saetze.
- **Sektor-IDs:** defense | aeronautics | mobile_robotics | space | maritime | mobility

## Run-Status

- **pending:** Inngest-Event versendet, noch nicht gestartet.
- **running:** Claude oder Firecrawl laeuft.
- **done:** Alle Phasen durch, Ergebnisse stehen.
- **failed:** Fehler in einer Phase, error_message ist gesetzt.
- **cancelled:** Vom User gestoppt.

## Wenn du auf einem fokussierten Lauf bist

Wenn show_discovery_run_focus gesetzt ist, beziehen sich "dieser Lauf", "die Ergebnisse" auf diesen konkreten Run. Default-run_id fuer alle Tools ist dann der fokussierte Run.`;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ShowDiscoveryToolResult = {
  summary: string;
  detail?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Anthropic tool definitions
// ---------------------------------------------------------------------------

export const SHOW_DISCOVERY_TOOL_DEFS = [
  {
    name: "start_discovery",
    description:
      "Startet einen neuen Messen-Discovery-Lauf: Claude Opus + Web-Search recherchiert Kandidaten, Firecrawl validiert jede URL. Dauert 3-5 Min. Kosten ~$0.25-0.40.",
    input_schema: {
      type: "object" as const,
      properties: {
        user_prompt: {
          type: "string",
          description:
            "Suchfokus, z.B. 'Maritime-Messen 2026 in Europa, militaerische und zivile Anwendungen'. Min 5 Zeichen.",
        },
        max_web_searches: {
          type: "number",
          description: "Max. Web-Search-Aufrufe (5-30). Optional, Default aus app_settings.",
        },
      },
      required: ["user_prompt"],
    },
  },
  {
    name: "cancel_discovery",
    description:
      "Stoppt einen laufenden Lauf. Setzt status='cancelled'. Laufender Claude-Call wird nicht hart abgebrochen, aber Fan-out wird uebersprungen. Ohne run_id wird der aktuelle aktive Lauf gestoppt.",
    input_schema: {
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "UUID des Laufs (optional, sonst aktiver Lauf)." },
      },
      required: [],
    },
  },
  {
    name: "resume_discovery",
    description:
      "Setzt einen cancelled oder failed Lauf neu auf: Loescht bestehende Ergebnisse und startet mit demselben user_prompt neu. Ergebnisse koennen abweichen, da Web-Suchen frisch sind.",
    input_schema: {
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "UUID des Laufs (optional, sonst letzter cancelled/failed Lauf)." },
      },
      required: [],
    },
  },
  {
    name: "get_discovery_status",
    description:
      "Liefert Status, Phase, Counts und juengste Logs zu einem Lauf. Ohne run_id der zuletzt aktive oder zuletzt erstellte Lauf.",
    input_schema: {
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "UUID des Laufs (optional)." },
      },
      required: [],
    },
  },
  {
    name: "list_runs",
    description: "Listet die letzten Discovery-Laeufe des Users mit Status und Counts.",
    input_schema: {
      type: "object" as const,
      properties: {
        limit: { type: "number", description: "Max Anzahl Laeufe (1-30). Default 10." },
      },
      required: [],
    },
  },
  {
    name: "list_results",
    description:
      "Listet Ergebnisse eines Laufs mit optionalen Filtern. Default: aktiver oder letzter Lauf, nur nicht-dismissed, sortiert nach Relevanz absteigend.",
    input_schema: {
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "UUID des Laufs (optional)." },
        min_score: { type: "number", description: "Minimum relevance_score (0-10)." },
        sector: {
          type: "array",
          items: { type: "string" },
          description: "Sektoren-Filter (z.B. ['defense','maritime']).",
        },
        firecrawl_status: {
          type: "string",
          description: "Firecrawl-Status-Filter (pending|running|done|failed|skipped).",
        },
        only_undismissed: {
          type: "boolean",
          description: "Default true. False zeigt auch dismissed Resultate.",
        },
        limit: { type: "number", description: "Max Anzahl (1-50). Default 20." },
      },
      required: [],
    },
  },
  {
    name: "add_result_to_shows",
    description:
      "Uebernimmt ein Discovery-Ergebnis als neue trade_shows-Zeile. Loest immer Bestaetungs-Widget aus. Wenn Aussteller-Liste verfuegbar, startet danach automatisch der Crawl.",
    input_schema: {
      type: "object" as const,
      properties: {
        result_id: { type: "string", description: "UUID des Ergebnisses." },
      },
      required: ["result_id"],
    },
  },
  {
    name: "dismiss_results",
    description:
      "Markiert ein oder mehrere Discovery-Ergebnisse als dismissed. Loest immer Bestaetungs-Widget aus.",
    input_schema: {
      type: "object" as const,
      properties: {
        result_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs der zu dismissed Resultate.",
        },
        reason: { type: "string", description: "Begruendung (sichtbar im Widget)." },
      },
      required: ["result_ids"],
    },
  },
  {
    name: "update_discovery_settings",
    description:
      "Aendert show_discovery-Settings in app_settings. system_prompt-Aenderung loest Bestaetungs-Widget aus (destruktiv). max_web_searches und max_tokens werden direkt geschrieben.",
    input_schema: {
      type: "object" as const,
      properties: {
        system_prompt: {
          type: "string",
          description: "Neuer System-Prompt fuer Show-Discovery. Mit Bestaetungs-Widget.",
        },
        max_web_searches: {
          type: "number",
          description: "Max. Web-Search-Aufrufe pro Lauf (5-30).",
        },
        max_tokens: { type: "number", description: "Max. Tokens pro Claude-Call (2000-16000)." },
      },
      required: [],
    },
  },
] as const;

export const SHOW_DISCOVERY_TOOL_NAMES = new Set(SHOW_DISCOVERY_TOOL_DEFS.map((t) => t.name));

// ---------------------------------------------------------------------------
// Tool input types
// ---------------------------------------------------------------------------

type StartInput = { user_prompt?: string; max_web_searches?: number };
type CancelInput = { run_id?: string };
type ResumeInput = { run_id?: string };
type StatusInput = { run_id?: string };
type ListRunsInput = { limit?: number };
type ListResultsInput = {
  run_id?: string;
  min_score?: number;
  sector?: string[];
  firecrawl_status?: string;
  only_undismissed?: boolean;
  limit?: number;
};
type AddResultInput = { result_id?: string };
type DismissInput = { result_ids?: string[]; reason?: string };
type UpdateSettingsInput = {
  system_prompt?: string;
  max_web_searches?: number;
  max_tokens?: number;
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeShowDiscoveryTool(
  toolName: string,
  input: unknown,
  userId: string,
  supabase: SupabaseClient,
  runFocus: string | null,
): Promise<ShowDiscoveryToolResult> {
  switch (toolName) {
    case "start_discovery":
      return startDiscovery(input as StartInput, userId, supabase);
    case "cancel_discovery":
      return cancelDiscovery((input as CancelInput).run_id ?? runFocus ?? null, userId, supabase);
    case "resume_discovery":
      return resumeDiscovery((input as ResumeInput).run_id ?? runFocus ?? null, userId, supabase);
    case "get_discovery_status":
      return getDiscoveryStatus(
        (input as StatusInput).run_id ?? runFocus ?? null,
        userId,
        supabase,
      );
    case "list_runs":
      return listRuns((input as ListRunsInput).limit, userId, supabase);
    case "list_results":
      return listResults(input as ListResultsInput, userId, supabase, runFocus);
    case "add_result_to_shows":
      return addResultToShows((input as AddResultInput).result_id ?? null, userId, supabase);
    case "dismiss_results":
      return dismissResults(
        (input as DismissInput).result_ids ?? [],
        (input as DismissInput).reason ?? null,
        userId,
        supabase,
      );
    case "update_discovery_settings":
      return updateDiscoverySettings(input as UpdateSettingsInput, userId, supabase);
    default:
      return { summary: `Unbekanntes Tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function startDiscovery(
  input: StartInput,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  const prompt = (input.user_prompt ?? "").trim();
  if (prompt.length < 5) {
    return { summary: "start_discovery: user_prompt fehlt oder ist zu kurz (min 5 Zeichen)." };
  }

  if (input.max_web_searches !== undefined) {
    const v = input.max_web_searches;
    if (typeof v !== "number" || v < 5 || v > 30) {
      return { summary: "start_discovery: max_web_searches muss zwischen 5 und 30 liegen." };
    }
    await supabase
      .from("app_settings")
      .update({ show_discovery_max_web_searches: v })
      .eq("user_id", userId);
  }

  const { data: active } = await supabase
    .from("show_discovery_runs")
    .select("id, status")
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: run, error } = await supabase
    .from("show_discovery_runs")
    .insert({ user_id: userId, status: "pending", user_prompt: prompt })
    .select("id")
    .single();

  if (error || !run) {
    return { summary: `Fehler beim Erstellen des Laufs: ${error?.message ?? "unknown"}` };
  }

  const runId = (run as { id: string }).id;
  await inngest.send({
    name: "show.discovery.requested",
    data: { userId, runId, userPrompt: prompt },
  });

  const parallelHint = active
    ? ` Hinweis: Ein anderer Lauf (${(active as { id: string }).id}) laeuft bereits parallel.`
    : "";

  return {
    summary: `Discovery-Lauf gestartet: "${prompt.slice(0, 80)}". Laeuft 3-5 Min im Hintergrund. Run-ID: ${runId}.${parallelHint}`,
    detail: { runId },
  };
}

async function cancelDiscovery(
  runIdHint: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  let runId = runIdHint;
  if (!runId) {
    const { data } = await supabase
      .from("show_discovery_runs")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (data as { id: string } | null)?.id ?? null;
  }
  if (!runId) {
    return { summary: "cancel_discovery: kein aktiver Lauf gefunden." };
  }

  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select("id, status, user_id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { summary: `cancel_discovery: Lauf ${runId} nicht gefunden.` };
  const runRow = run as { id: string; status: string; user_id: string };
  if (!["pending", "running"].includes(runRow.status)) {
    return {
      summary: `cancel_discovery: Lauf ${runId} ist bereits ${runRow.status}, kein Cancel moeglich.`,
    };
  }

  const { error } = await supabase
    .from("show_discovery_runs")
    .update({
      status: "cancelled",
      current_phase: "cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) return { summary: `cancel_discovery: ${error.message}` };

  await tryAppendShowDiscoveryLog(supabase, runId, runRow.user_id, {
    level: "warn",
    phase: "cancelled",
    message: "Lauf vom Orchestrator gestoppt.",
  });

  return { summary: `Lauf ${runId} gestoppt.`, detail: { runId } };
}

async function resumeDiscovery(
  runIdHint: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  let runId = runIdHint;
  if (!runId) {
    const { data } = await supabase
      .from("show_discovery_runs")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["cancelled", "failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (data as { id: string } | null)?.id ?? null;
  }
  if (!runId) {
    return { summary: "resume_discovery: kein cancelled/failed Lauf gefunden." };
  }

  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select("id, status, user_id, user_prompt")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { summary: `resume_discovery: Lauf ${runId} nicht gefunden.` };
  const runRow = run as { id: string; status: string; user_id: string; user_prompt: string | null };
  if (!["cancelled", "failed"].includes(runRow.status)) {
    return {
      summary: `resume_discovery: Lauf ${runId} ist ${runRow.status}, nicht resumeable.`,
    };
  }
  if (!runRow.user_prompt) {
    return { summary: `resume_discovery: Lauf ${runId} hat keinen user_prompt.` };
  }

  await supabase.from("show_discovery_results").delete().eq("run_id", runId);
  await supabase.from("show_discovery_log").delete().eq("run_id", runId);

  const { error } = await supabase
    .from("show_discovery_runs")
    .update({
      status: "pending",
      current_phase: null,
      candidates_total: null,
      candidates_validated: null,
      candidates_added: null,
      model: null,
      tokens_in: null,
      tokens_out: null,
      web_search_uses: null,
      firecrawl_calls: null,
      error_message: null,
      finished_at: null,
    })
    .eq("id", runId);
  if (error) return { summary: `resume_discovery: ${error.message}` };

  await tryAppendShowDiscoveryLog(supabase, runId, runRow.user_id, {
    phase: "preparing",
    message: "Lauf neu gestartet (Resume vom Orchestrator).",
  });

  await inngest.send({
    name: "show.discovery.requested",
    data: { userId: runRow.user_id, runId, userPrompt: runRow.user_prompt },
  });

  return { summary: `Lauf ${runId} neu gestartet.`, detail: { runId } };
}

async function getDiscoveryStatus(
  runIdHint: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  let runId = runIdHint;
  if (!runId) {
    const { data } = await supabase
      .from("show_discovery_runs")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (data as { id: string } | null)?.id ?? null;
  }
  if (!runId) return { summary: "get_discovery_status: kein Lauf gefunden." };

  const { data: run } = await supabase
    .from("show_discovery_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, tokens_in, tokens_out, web_search_uses, firecrawl_calls, error_message, created_at, finished_at",
    )
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { summary: `get_discovery_status: Lauf ${runId} nicht gefunden.` };

  const { data: logs } = await supabase
    .from("show_discovery_log")
    .select("level, phase, message, created_at")
    .eq("run_id", runId)
    .order("created_at", { ascending: false })
    .limit(8);

  const r = run as Record<string, unknown>;
  const duration = r.finished_at
    ? `${Math.round((new Date(r.finished_at as string).getTime() - new Date(r.created_at as string).getTime()) / 1000)}s`
    : "laeuft";

  return {
    summary: `Lauf ${r.id}: status=${r.status}, phase=${r.current_phase ?? "?"}, Kandidaten ${r.candidates_added ?? 0} added / ${r.candidates_validated ?? 0} validated / ${r.candidates_total ?? "?"} total. Dauer: ${duration}.${r.error_message ? ` Fehler: ${r.error_message}` : ""}`,
    detail: { run, recent_logs: logs ?? [] },
  };
}

async function listRuns(
  limit: number | undefined,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  const lim = Math.min(Math.max(limit ?? 10, 1), 30);
  const { data, error } = await supabase
    .from("show_discovery_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, created_at, finished_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(lim);
  if (error) return { summary: `list_runs: ${error.message}` };

  const rows = (data ?? []) as Array<{
    id: string;
    status: string;
    user_prompt: string | null;
    candidates_added: number | null;
    candidates_total: number | null;
    created_at: string;
  }>;

  const lines = rows.map(
    (r) =>
      `- ${r.id} [${r.status}] "${(r.user_prompt ?? "").slice(0, 60)}" — ${r.candidates_added ?? 0}/${r.candidates_total ?? "?"} added (${r.created_at})`,
  );
  return {
    summary: `${rows.length} Laeufe gefunden:\n${lines.join("\n") || "(keine)"}`,
    detail: { runs: data ?? [] },
  };
}

async function listResults(
  input: ListResultsInput,
  userId: string,
  supabase: SupabaseClient,
  runFocus: string | null,
): Promise<ShowDiscoveryToolResult> {
  let runId = input.run_id ?? runFocus ?? null;
  if (!runId) {
    const { data } = await supabase
      .from("show_discovery_runs")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (data as { id: string } | null)?.id ?? null;
  }
  if (!runId) return { summary: "list_results: kein Lauf gefunden." };

  const onlyUndismissed = input.only_undismissed ?? true;
  const lim = Math.min(Math.max(input.limit ?? 20, 1), 50);

  let query = supabase
    .from("show_discovery_results")
    .select(
      "id, name, website, firecrawl_confirmed_url, exhibitor_list_url, exhibitor_list_available, location_city, location_country, dates_raw, isp_sector_match, relevance_score, relevance_reasoning, is_recurring, firecrawl_status, dismissed, added_trade_show_id",
    )
    .eq("run_id", runId)
    .order("relevance_score", { ascending: false, nullsFirst: false })
    .limit(lim);

  if (onlyUndismissed) query = query.eq("dismissed", false);
  if (typeof input.min_score === "number") query = query.gte("relevance_score", input.min_score);
  if (input.firecrawl_status) query = query.eq("firecrawl_status", input.firecrawl_status);
  if (input.sector?.length) query = query.overlaps("isp_sector_match", input.sector);

  const { data, error } = await query;
  if (error) return { summary: `list_results: ${error.message}` };

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    relevance_score: number | null;
    isp_sector_match: string[] | null;
    location_city: string | null;
    location_country: string | null;
    dates_raw: string | null;
    firecrawl_status: string | null;
    exhibitor_list_available: boolean | null;
    added_trade_show_id: string | null;
    dismissed: boolean;
  }>;

  const lines = rows.map((r) => {
    const sectors = (r.isp_sector_match ?? []).join(",") || "-";
    const loc = [r.location_city, r.location_country].filter(Boolean).join(", ") || "-";
    const status = r.added_trade_show_id ? "added" : r.dismissed ? "dismissed" : (r.firecrawl_status ?? "-");
    return `- ${r.id} [score=${r.relevance_score ?? "?"}] ${r.name} (${sectors}) — ${loc} — ${r.dates_raw ?? "-"} — ${status}`;
  });

  return {
    summary: `${rows.length} Treffer in Lauf ${runId}:\n${lines.join("\n") || "(keine)"}`,
    detail: { run_id: runId, results: data ?? [] },
  };
}

async function addResultToShows(
  resultId: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  if (!resultId) return { summary: "add_result_to_shows: result_id fehlt." };

  const { data: result } = await supabase
    .from("show_discovery_results")
    .select(
      "id, run_id, name, website, firecrawl_confirmed_url, exhibitor_list_url, exhibitor_list_available, dates_raw, dates_start, location_city, location_country, added_trade_show_id, relevance_score",
    )
    .eq("id", resultId)
    .maybeSingle();
  if (!result) return { summary: `add_result_to_shows: Result ${resultId} nicht gefunden.` };

  const r = result as {
    id: string;
    run_id: string;
    name: string;
    added_trade_show_id: string | null;
    exhibitor_list_url: string | null;
    firecrawl_confirmed_url: string | null;
    website: string | null;
    exhibitor_list_available: boolean | null;
    dates_raw: string | null;
    location_city: string | null;
    location_country: string | null;
    relevance_score: number | null;
  };

  if (r.added_trade_show_id) {
    return {
      summary: `add_result_to_shows: "${r.name}" ist bereits als Messe ${r.added_trade_show_id} angelegt.`,
    };
  }

  const sourceUrl =
    r.exhibitor_list_url || r.firecrawl_confirmed_url || r.website || null;
  const canCrawl = r.exhibitor_list_available !== false && Boolean(sourceUrl);

  return {
    summary: `Bestaetigung ausstehend: "${r.name}" als Messe anlegen. Weise den User auf das Bestaetungs-Widget hin.`,
    detail: {
      confirmation_request: {
        action_type: "add_result_to_shows",
        description: `Discovery-Treffer "${r.name}" als Messe anlegen${canCrawl ? " und Crawl starten" : " (kein Crawl, Aussteller-Liste fehlt)"}.`,
        preview_items: [
          `${r.name}${r.relevance_score != null ? ` (Score ${r.relevance_score})` : ""}`,
          `Quelle: ${sourceUrl ?? "keine URL"}`,
          `Ort: ${[r.location_city, r.location_country].filter(Boolean).join(", ") || "-"}`,
          `Datum: ${r.dates_raw ?? "-"}`,
        ],
        count: 1,
        payload: { result_id: r.id, run_id: r.run_id },
      },
    },
  };
}

async function dismissResults(
  resultIds: string[],
  reason: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  if (!resultIds.length) return { summary: "dismiss_results: result_ids fehlen." };

  const { data } = await supabase
    .from("show_discovery_results")
    .select("id, name, dismissed, run_id")
    .in("id", resultIds);
  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    dismissed: boolean;
    run_id: string;
  }>;
  const eligible = rows.filter((r) => !r.dismissed);
  if (eligible.length === 0) {
    return { summary: "dismiss_results: keine eligible Resultate (alle bereits dismissed)." };
  }

  const previewNames = eligible.slice(0, 7).map((r) => r.name);
  return {
    summary: `Bestaetigung ausstehend: ${eligible.length} Resultat(e) als dismissed markieren. Weise den User auf das Bestaetungs-Widget hin.`,
    detail: {
      confirmation_request: {
        action_type: "dismiss_results",
        description: `${eligible.length} Resultat(e) ablehnen${reason ? ` ${reason}` : ""}.`,
        preview_items: previewNames,
        count: eligible.length,
        payload: { items: eligible.map((r) => ({ result_id: r.id, run_id: r.run_id })) },
      },
    },
  };
}

async function updateDiscoverySettings(
  input: UpdateSettingsInput,
  userId: string,
  supabase: SupabaseClient,
): Promise<ShowDiscoveryToolResult> {
  const patch: Record<string, unknown> = {};
  const changes: string[] = [];

  if (typeof input.max_web_searches === "number") {
    if (input.max_web_searches < 5 || input.max_web_searches > 30) {
      return { summary: "update_discovery_settings: max_web_searches muss 5-30 sein." };
    }
    patch.show_discovery_max_web_searches = input.max_web_searches;
    changes.push(`max_web_searches=${input.max_web_searches}`);
  }
  if (typeof input.max_tokens === "number") {
    if (input.max_tokens < 2000 || input.max_tokens > 16000) {
      return { summary: "update_discovery_settings: max_tokens muss 2000-16000 sein." };
    }
    patch.show_discovery_max_tokens = input.max_tokens;
    changes.push(`max_tokens=${input.max_tokens}`);
  }

  // max_* werden direkt geschrieben; system_prompt-Aenderung loest separat das
  // Confirmation-Widget aus, weil der Default-Prompt ein fein-getunter Block ist.
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("app_settings").update(patch).eq("user_id", userId);
    if (error) return { summary: `update_discovery_settings: ${error.message}` };
  }

  if (typeof input.system_prompt === "string" && input.system_prompt.trim().length > 0) {
    const directSummary = changes.length > 0 ? ` Direkt uebernommen: ${changes.join(", ")}.` : "";
    return {
      summary: `Bestaetigung ausstehend: System-Prompt aendern. Weise den User auf das Bestaetungs-Widget hin.${directSummary}`,
      detail: {
        confirmation_request: {
          action_type: "update_discovery_settings_prompt",
          description: "System-Prompt fuer Show-Discovery ueberschreiben (destruktiv).",
          preview_items: [
            input.system_prompt.slice(0, 200) + (input.system_prompt.length > 200 ? "..." : ""),
          ],
          count: 1,
          payload: { system_prompt: input.system_prompt },
        },
      },
    };
  }

  if (changes.length === 0) {
    return { summary: "update_discovery_settings: keine Aenderungen angegeben." };
  }

  return { summary: `Settings aktualisiert: ${changes.join(", ")}.` };
}

// ---------------------------------------------------------------------------
// State loader for the system block
// ---------------------------------------------------------------------------

export type ShowDiscoveryState = {
  active_run: Record<string, unknown> | null;
  latest_run: Record<string, unknown> | null;
  result_counts: { total: number; validated: number; dismissed: number; added: number };
  recent_logs: Array<{ level: string; phase: string | null; message: string; created_at: string }>;
  settings: {
    max_web_searches: number | null;
    max_tokens: number | null;
    has_custom_system_prompt: boolean;
  };
};

export async function loadShowDiscoveryState(
  supabase: SupabaseClient,
  userId: string,
): Promise<ShowDiscoveryState> {
  const { data: active } = await supabase
    .from("show_discovery_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, error_message, created_at",
    )
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latest } = await supabase
    .from("show_discovery_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, finished_at, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ref = (active ?? latest) as { id: string } | null;
  let counts = { total: 0, validated: 0, dismissed: 0, added: 0 };
  let logs: Array<{ level: string; phase: string | null; message: string; created_at: string }> =
    [];

  if (ref?.id) {
    const { data: resultRows } = await supabase
      .from("show_discovery_results")
      .select("dismissed, added_trade_show_id, firecrawl_status")
      .eq("run_id", ref.id);
    const rows = (resultRows ?? []) as Array<{
      dismissed: boolean;
      added_trade_show_id: string | null;
      firecrawl_status: string | null;
    }>;
    counts = {
      total: rows.length,
      validated: rows.filter((r) => r.firecrawl_status === "done").length,
      dismissed: rows.filter((r) => r.dismissed).length,
      added: rows.filter((r) => r.added_trade_show_id).length,
    };

    const { data: logRows } = await supabase
      .from("show_discovery_log")
      .select("level, phase, message, created_at")
      .eq("run_id", ref.id)
      .order("created_at", { ascending: false })
      .limit(8);
    logs = (logRows ?? []) as typeof logs;
  }

  const { data: settings } = await supabase
    .from("app_settings")
    .select("show_discovery_max_web_searches, show_discovery_max_tokens, show_discovery_system_prompt")
    .eq("user_id", userId)
    .maybeSingle();
  const s = settings as
    | {
        show_discovery_max_web_searches: number | null;
        show_discovery_max_tokens: number | null;
        show_discovery_system_prompt: string | null;
      }
    | null;

  return {
    active_run: (active as Record<string, unknown> | null) ?? null,
    latest_run: (latest as Record<string, unknown> | null) ?? null,
    result_counts: counts,
    recent_logs: logs,
    settings: {
      max_web_searches: s?.show_discovery_max_web_searches ?? null,
      max_tokens: s?.show_discovery_max_tokens ?? null,
      has_custom_system_prompt: Boolean(s?.show_discovery_system_prompt),
    },
  };
}
