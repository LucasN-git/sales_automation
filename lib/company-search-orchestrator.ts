import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";
import { tryAppendCompanySearchLog } from "@/lib/company-search-log";
import { getSettings, effectiveHandbook } from "@/lib/settings";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const COMPANY_SEARCH_ORCHESTRATOR_SYSTEM_PROMPT = `Du bist der Kunden-Discovery-Manager fuer ISP Power Systems. Du hast zwei Rollen gleichzeitig:

1. **Discovery-Controller:** Du steuerst den gesamten Kunden-Suche-Prozess: Laeufe starten (Claude Opus + Web-Search recherchiert potenzielle Kunden), Status pollen, Resultate filtern, kuratieren (zur Unternehmensliste uebernehmen oder ablehnen), Settings anpassen. Du arbeitest mit Tool-Calls.

2. **Gespraechtpartner:** Du erklaerst Ergebnisse, gibst Einschaetzungen zu Sektor-Match und Relevanz, beantwortest Fragen zu gefundenen Unternehmen.

## ISP Power Systems Kurzprofil

ISP entwickelt anwendungsspezifische Batterie- und Antriebssysteme fuer Defense, Aeronautics, Mobile Robotics, Space, Maritime und Mobility. Zielkunden sind Hardware-Hersteller, die fuer ihr Geraet eine massgeschneiderte Energieversorgungs- oder Antriebsloesung brauchen.

## Prozess-Ablauf

**Neuen Lauf starten:**
start_search(user_prompt) -> Inngest-Job laeuft (3-5 Min, Claude Opus + Web-Search) -> Kandidaten erscheinen -> Firecrawl + Haiku erstellt Short-Overview pro Kandidat -> done. Phasen: preparing -> claude_research -> persisting -> enrich_validation -> done.

**Status pollen:**
get_search_status() -> Phase, Counts, juengste Logs.

**Ergebnisse anschauen:**
list_results({min_score, sector, only_undismissed}) -> gefilterte Liste mit Relevanz-Score (0-10), Sektor-Match, Short-Overview (falls fertig).

**Treffer zur Unternehmensliste uebernehmen:**
add_result_to_companies(result_id) -> Bestaetungs-Widget -> company-Eintrag wird angelegt, Deep-Dive startet automatisch.

**Treffer ablehnen:**
dismiss_results(result_ids) -> Bestaetungs-Widget -> markiert als dismissed.

**Settings anpassen:**
update_search_settings({system_prompt, max_web_searches, max_tokens}) -> max_* werden direkt geschrieben. system_prompt-Aenderung loest Bestaetungs-Widget aus.

**Lauf abbrechen oder neu starten:**
cancel_search(run_id?) -> setzt status='cancelled'.
resume_search(run_id?) -> cancelled/failed Lauf neu starten.

## Regeln

- **Vor start_search:** Erwaehne kurz Kostenschaetzung (~$0.25-0.40 pro Lauf, 3-5 Min). Frage NICHT nach Bestaetigung wenn der User die Suche explizit angefordert hat.
- **add_result_to_companies und dismiss_results:** Immer mit Bestaetungs-Widget. Kein direktes Hinzufuegen oder Loeschen.
- **update_search_settings mit system_prompt:** Immer Bestaetungs-Widget.
- **list_results:** Default ist only_undismissed=true. Sortiere im Output nach Relevanz absteigend.
- **Keine Em-Dashes (-):** Verwende Komma, Punkt oder Klammer.
- **Ton:** Sachlich, direkt, keine Superlative. Kurze Saetze.
- **Sektor-IDs:** defense | aeronautics | mobile_robotics | space | maritime | mobility

## Run-Status

- **pending:** Inngest-Event versendet, noch nicht gestartet.
- **running:** Claude oder Firecrawl laeuft.
- **done:** Alle Phasen durch, Ergebnisse stehen.
- **failed:** Fehler in einer Phase.
- **cancelled:** Vom User gestoppt.

## Wenn du auf einem fokussierten Lauf bist

Wenn company_search_run_focus gesetzt ist, beziehen sich "dieser Lauf", "die Ergebnisse" auf diesen konkreten Run. Default-run_id fuer alle Tools ist dann der fokussierte Run.

## Funktionsweise des Tools — read_handbook

Wenn der User Fragen zur Funktionsweise des gesamten Sales-Tools stellt, rufe **read_handbook** auf.`;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type CompanySearchToolResult = {
  summary: string;
  detail?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Anthropic tool definitions
// ---------------------------------------------------------------------------

export const COMPANY_SEARCH_TOOL_DEFS = [
  {
    name: "start_search",
    description:
      "Startet einen neuen Kunden-Discovery-Lauf: Claude Opus + Web-Search recherchiert Kandidaten, Firecrawl + Haiku erstellt Short-Overview pro Firma. Dauert 3-5 Min. Kosten ~$0.25-0.40.",
    input_schema: {
      type: "object" as const,
      properties: {
        user_prompt: {
          type: "string",
          description:
            "Suchfokus, z.B. 'Drohnen-Hersteller in Deutschland und Frankreich, militaerisch und kommerziell'. Min 5 Zeichen.",
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
    name: "cancel_search",
    description:
      "Stoppt einen laufenden Lauf. Setzt status='cancelled'. Ohne run_id wird der aktuelle aktive Lauf gestoppt.",
    input_schema: {
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "UUID des Laufs (optional, sonst aktiver Lauf)." },
      },
      required: [],
    },
  },
  {
    name: "resume_search",
    description:
      "Setzt einen cancelled oder failed Lauf neu auf: Loescht bestehende Ergebnisse und startet mit demselben user_prompt neu.",
    input_schema: {
      type: "object" as const,
      properties: {
        run_id: { type: "string", description: "UUID des Laufs (optional, sonst letzter cancelled/failed Lauf)." },
      },
      required: [],
    },
  },
  {
    name: "get_search_status",
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
    description: "Listet die letzten Kunden-Suche-Laeufe des Users mit Status und Counts.",
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
    name: "add_result_to_companies",
    description:
      "Uebernimmt ein Discovery-Ergebnis als neuen Unternehmenslisten-Eintrag. Loest immer Bestaetungs-Widget aus. Deep-Dive startet automatisch danach.",
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
    name: "update_search_settings",
    description:
      "Aendert company_search-Settings in app_settings. system_prompt-Aenderung loest Bestaetungs-Widget aus. max_web_searches und max_tokens werden direkt geschrieben.",
    input_schema: {
      type: "object" as const,
      properties: {
        system_prompt: {
          type: "string",
          description: "Neuer System-Prompt fuer Company-Search. Mit Bestaetungs-Widget.",
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
  {
    name: "read_handbook",
    description:
      "Liest die Bedienungs-Anleitung fuer das ISP Sales-Intelligence-Tool. Rufe dieses Tool auf wenn der User Fragen zur Funktionsweise stellt.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
] as const;

export const COMPANY_SEARCH_TOOL_NAMES = new Set(COMPANY_SEARCH_TOOL_DEFS.map((t) => t.name));

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

export async function executeCompanySearchTool(
  toolName: string,
  input: unknown,
  userId: string,
  supabase: SupabaseClient,
  runFocus: string | null,
): Promise<CompanySearchToolResult> {
  switch (toolName) {
    case "start_search":
      return startSearch(input as StartInput, userId, supabase);
    case "cancel_search":
      return cancelSearch((input as CancelInput).run_id ?? runFocus ?? null, userId, supabase);
    case "resume_search":
      return resumeSearch((input as ResumeInput).run_id ?? runFocus ?? null, userId, supabase);
    case "get_search_status":
      return getSearchStatus(
        (input as StatusInput).run_id ?? runFocus ?? null,
        userId,
        supabase,
      );
    case "list_runs":
      return listRuns((input as ListRunsInput).limit, userId, supabase);
    case "list_results":
      return listResults(input as ListResultsInput, userId, supabase, runFocus);
    case "add_result_to_companies":
      return addResultToCompanies((input as AddResultInput).result_id ?? null, userId, supabase);
    case "dismiss_results":
      return dismissResults(
        (input as DismissInput).result_ids ?? [],
        (input as DismissInput).reason ?? null,
        userId,
        supabase,
      );
    case "update_search_settings":
      return updateSearchSettings(input as UpdateSettingsInput, userId, supabase);
    case "read_handbook": {
      const settings = await getSettings(supabase, userId);
      const handbook = effectiveHandbook(settings);
      return {
        summary: `Anleitung geladen (${handbook.length} Zeichen).`,
        detail: { handbook },
      };
    }
    default:
      return { summary: `Unbekanntes Tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function startSearch(
  input: StartInput,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompanySearchToolResult> {
  const prompt = (input.user_prompt ?? "").trim();
  if (prompt.length < 5) {
    return { summary: "start_search: user_prompt fehlt oder ist zu kurz (min 5 Zeichen)." };
  }

  if (input.max_web_searches !== undefined) {
    const v = input.max_web_searches;
    if (typeof v !== "number" || v < 5 || v > 30) {
      return { summary: "start_search: max_web_searches muss zwischen 5 und 30 liegen." };
    }
    await supabase
      .from("app_settings")
      .update({ company_search_max_web_searches: v })
      .eq("user_id", userId);
  }

  const { data: active } = await supabase
    .from("company_search_runs")
    .select("id, status")
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: run, error } = await supabase
    .from("company_search_runs")
    .insert({ user_id: userId, status: "pending", user_prompt: prompt })
    .select("id")
    .single();

  if (error || !run) {
    return { summary: `Fehler beim Erstellen des Laufs: ${error?.message ?? "unknown"}` };
  }

  const runId = (run as { id: string }).id;
  await inngest.send({
    name: "company.search.requested",
    data: { userId, runId, userPrompt: prompt },
  });

  const parallelHint = active
    ? ` Hinweis: Ein anderer Lauf (${(active as { id: string }).id}) laeuft bereits parallel.`
    : "";

  return {
    summary: `Kunden-Suche gestartet: "${prompt.slice(0, 80)}". Laeuft 3-5 Min im Hintergrund. Run-ID: ${runId}.${parallelHint}`,
    detail: { runId },
  };
}

async function cancelSearch(
  runIdHint: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompanySearchToolResult> {
  let runId = runIdHint;
  if (!runId) {
    const { data } = await supabase
      .from("company_search_runs")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (data as { id: string } | null)?.id ?? null;
  }
  if (!runId) return { summary: "cancel_search: kein aktiver Lauf gefunden." };

  const { data: run } = await supabase
    .from("company_search_runs")
    .select("id, status, user_id")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { summary: `cancel_search: Lauf ${runId} nicht gefunden.` };
  const runRow = run as { id: string; status: string; user_id: string };
  if (!["pending", "running"].includes(runRow.status)) {
    return {
      summary: `cancel_search: Lauf ${runId} ist bereits ${runRow.status}.`,
    };
  }

  const { error } = await supabase
    .from("company_search_runs")
    .update({
      status: "cancelled",
      current_phase: "cancelled",
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) return { summary: `cancel_search: ${error.message}` };

  await tryAppendCompanySearchLog(supabase, runId, runRow.user_id, {
    level: "warn",
    phase: "cancelled",
    message: "Lauf vom Orchestrator gestoppt.",
  });

  return { summary: `Lauf ${runId} gestoppt.`, detail: { runId } };
}

async function resumeSearch(
  runIdHint: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompanySearchToolResult> {
  let runId = runIdHint;
  if (!runId) {
    const { data } = await supabase
      .from("company_search_runs")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["cancelled", "failed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (data as { id: string } | null)?.id ?? null;
  }
  if (!runId) return { summary: "resume_search: kein cancelled/failed Lauf gefunden." };

  const { data: run } = await supabase
    .from("company_search_runs")
    .select("id, status, user_id, user_prompt")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { summary: `resume_search: Lauf ${runId} nicht gefunden.` };
  const runRow = run as { id: string; status: string; user_id: string; user_prompt: string | null };
  if (!["cancelled", "failed"].includes(runRow.status)) {
    return { summary: `resume_search: Lauf ${runId} ist ${runRow.status}, nicht resumeable.` };
  }
  if (!runRow.user_prompt) {
    return { summary: `resume_search: Lauf ${runId} hat keinen user_prompt.` };
  }

  await supabase.from("company_search_results").delete().eq("run_id", runId);
  await supabase.from("company_search_log").delete().eq("run_id", runId);

  const { error } = await supabase
    .from("company_search_runs")
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
      firecrawl_credits: null,
      error_message: null,
      finished_at: null,
    })
    .eq("id", runId);
  if (error) return { summary: `resume_search: ${error.message}` };

  await tryAppendCompanySearchLog(supabase, runId, runRow.user_id, {
    phase: "preparing",
    message: "Lauf neu gestartet (Resume vom Orchestrator).",
  });

  await inngest.send({
    name: "company.search.requested",
    data: { userId: runRow.user_id, runId, userPrompt: runRow.user_prompt },
  });

  return { summary: `Lauf ${runId} neu gestartet.`, detail: { runId } };
}

async function getSearchStatus(
  runIdHint: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompanySearchToolResult> {
  let runId = runIdHint;
  if (!runId) {
    const { data } = await supabase
      .from("company_search_runs")
      .select("id")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    runId = (data as { id: string } | null)?.id ?? null;
  }
  if (!runId) return { summary: "get_search_status: kein Lauf gefunden." };

  const { data: run } = await supabase
    .from("company_search_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, tokens_in, tokens_out, web_search_uses, firecrawl_credits, error_message, created_at, finished_at",
    )
    .eq("id", runId)
    .maybeSingle();
  if (!run) return { summary: `get_search_status: Lauf ${runId} nicht gefunden.` };

  const { data: logs } = await supabase
    .from("company_search_log")
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
): Promise<CompanySearchToolResult> {
  const lim = Math.min(Math.max(limit ?? 10, 1), 30);
  const { data, error } = await supabase
    .from("company_search_runs")
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
): Promise<CompanySearchToolResult> {
  let runId = input.run_id ?? runFocus ?? null;
  if (!runId) {
    const { data } = await supabase
      .from("company_search_runs")
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
    .from("company_search_results")
    .select(
      "id, name, website, firecrawl_confirmed_url, location_city, location_country, isp_sector_match, relevance_score, relevance_reasoning, one_liner, priority_label, match_confidence, firecrawl_status, dismissed, added_company_id",
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
    one_liner: string | null;
    priority_label: string | null;
    firecrawl_status: string | null;
    added_company_id: string | null;
    dismissed: boolean;
  }>;

  const lines = rows.map((r) => {
    const sectors = (r.isp_sector_match ?? []).join(",") || "-";
    const loc = [r.location_city, r.location_country].filter(Boolean).join(", ") || "-";
    const status = r.added_company_id ? "added" : r.dismissed ? "dismissed" : (r.firecrawl_status ?? "-");
    const prio = r.priority_label ?? "-";
    return `- ${r.id} [score=${r.relevance_score ?? "?"}] ${r.name} (${sectors}) — ${loc} — prio:${prio} — ${status}`;
  });

  return {
    summary: `${rows.length} Treffer in Lauf ${runId}:\n${lines.join("\n") || "(keine)"}`,
    detail: { run_id: runId, results: data ?? [] },
  };
}

async function addResultToCompanies(
  resultId: string | null,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompanySearchToolResult> {
  if (!resultId) return { summary: "add_result_to_companies: result_id fehlt." };

  const { data: result } = await supabase
    .from("company_search_results")
    .select(
      "id, run_id, name, website, firecrawl_confirmed_url, location_city, location_country, one_liner, priority_label, match_confidence, relevance_score, added_company_id",
    )
    .eq("id", resultId)
    .maybeSingle();
  if (!result) return { summary: `add_result_to_companies: Result ${resultId} nicht gefunden.` };

  const r = result as {
    id: string;
    run_id: string;
    name: string;
    added_company_id: string | null;
    website: string | null;
    firecrawl_confirmed_url: string | null;
    location_city: string | null;
    location_country: string | null;
    one_liner: string | null;
    priority_label: string | null;
    match_confidence: number | null;
    relevance_score: number | null;
  };

  if (r.added_company_id) {
    return {
      summary: `add_result_to_companies: "${r.name}" ist bereits als Unternehmen ${r.added_company_id} angelegt.`,
    };
  }

  const website = r.firecrawl_confirmed_url || r.website || null;

  return {
    summary: `Bestaetigung ausstehend: "${r.name}" zur Unternehmensliste hinzufuegen. Weise den User auf das Bestaetungs-Widget hin.`,
    detail: {
      confirmation_request: {
        action_type: "add_result_to_companies",
        description: `Kunden-Discovery-Treffer "${r.name}" als Unternehmen anlegen und Deep-Dive starten.`,
        preview_items: [
          `${r.name}${r.relevance_score != null ? ` (Score ${r.relevance_score})` : ""}`,
          `Website: ${website ?? "keine URL"}`,
          `Ort: ${[r.location_city, r.location_country].filter(Boolean).join(", ") || "-"}`,
          r.one_liner ? `One-Liner: ${r.one_liner.slice(0, 100)}` : "(kein Short-Overview noch)",
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
): Promise<CompanySearchToolResult> {
  if (!resultIds.length) return { summary: "dismiss_results: result_ids fehlen." };

  const { data } = await supabase
    .from("company_search_results")
    .select("id, name, dismissed, run_id")
    .in("id", resultIds);
  const rows = (data ?? []) as Array<{ id: string; name: string; dismissed: boolean; run_id: string }>;
  const eligible = rows.filter((r) => !r.dismissed);
  if (eligible.length === 0) {
    return { summary: "dismiss_results: keine eligible Resultate (alle bereits dismissed)." };
  }

  const previewNames = eligible.slice(0, 7).map((r) => r.name);
  return {
    summary: `Bestaetigung ausstehend: ${eligible.length} Resultat(e) ablehnen. Weise den User auf das Bestaetungs-Widget hin.`,
    detail: {
      confirmation_request: {
        action_type: "dismiss_company_results",
        description: `${eligible.length} Resultat(e) ablehnen${reason ? `: ${reason}` : ""}.`,
        preview_items: previewNames,
        count: eligible.length,
        payload: { items: eligible.map((r) => ({ result_id: r.id, run_id: r.run_id })) },
      },
    },
  };
}

async function updateSearchSettings(
  input: UpdateSettingsInput,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompanySearchToolResult> {
  const patch: Record<string, unknown> = {};
  const changes: string[] = [];

  if (typeof input.max_web_searches === "number") {
    if (input.max_web_searches < 5 || input.max_web_searches > 30) {
      return { summary: "update_search_settings: max_web_searches muss 5-30 sein." };
    }
    patch.company_search_max_web_searches = input.max_web_searches;
    changes.push(`max_web_searches=${input.max_web_searches}`);
  }
  if (typeof input.max_tokens === "number") {
    if (input.max_tokens < 2000 || input.max_tokens > 16000) {
      return { summary: "update_search_settings: max_tokens muss 2000-16000 sein." };
    }
    patch.company_search_max_tokens = input.max_tokens;
    changes.push(`max_tokens=${input.max_tokens}`);
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("app_settings").update(patch).eq("user_id", userId);
    if (error) return { summary: `update_search_settings: ${error.message}` };
  }

  if (typeof input.system_prompt === "string" && input.system_prompt.trim().length > 0) {
    const directSummary = changes.length > 0 ? ` Direkt uebernommen: ${changes.join(", ")}.` : "";
    return {
      summary: `Bestaetigung ausstehend: System-Prompt aendern. Weise den User auf das Bestaetungs-Widget hin.${directSummary}`,
      detail: {
        confirmation_request: {
          action_type: "update_company_search_settings_prompt",
          description: "System-Prompt fuer Company-Search ueberschreiben (destruktiv).",
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
    return { summary: "update_search_settings: keine Aenderungen angegeben." };
  }

  return { summary: `Settings aktualisiert: ${changes.join(", ")}.` };
}

// ---------------------------------------------------------------------------
// State loader
// ---------------------------------------------------------------------------

export type CompanySearchState = {
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

export async function loadCompanySearchState(
  supabase: SupabaseClient,
  userId: string,
): Promise<CompanySearchState> {
  const { data: active } = await supabase
    .from("company_search_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, error_message, created_at",
    )
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latest } = await supabase
    .from("company_search_runs")
    .select(
      "id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, finished_at, created_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ref = (active ?? latest) as { id: string } | null;
  let counts = { total: 0, validated: 0, dismissed: 0, added: 0 };
  let logs: Array<{ level: string; phase: string | null; message: string; created_at: string }> = [];

  if (ref?.id) {
    const { data: resultRows } = await supabase
      .from("company_search_results")
      .select("dismissed, added_company_id, firecrawl_status")
      .eq("run_id", ref.id);
    const rows = (resultRows ?? []) as Array<{
      dismissed: boolean;
      added_company_id: string | null;
      firecrawl_status: string | null;
    }>;
    counts = {
      total: rows.length,
      validated: rows.filter((r) => r.firecrawl_status === "done").length,
      dismissed: rows.filter((r) => r.dismissed).length,
      added: rows.filter((r) => r.added_company_id).length,
    };

    const { data: logRows } = await supabase
      .from("company_search_log")
      .select("level, phase, message, created_at")
      .eq("run_id", ref.id)
      .order("created_at", { ascending: false })
      .limit(8);
    logs = (logRows ?? []) as typeof logs;
  }

  const { data: settings } = await supabase
    .from("app_settings")
    .select("company_search_max_web_searches, company_search_max_tokens, company_search_system_prompt")
    .eq("user_id", userId)
    .maybeSingle();
  const s = (settings ?? {}) as {
    company_search_max_web_searches?: number | null;
    company_search_max_tokens?: number | null;
    company_search_system_prompt?: string | null;
  };

  return {
    active_run: active as Record<string, unknown> | null,
    latest_run: latest as Record<string, unknown> | null,
    result_counts: counts,
    recent_logs: logs,
    settings: {
      max_web_searches: s.company_search_max_web_searches ?? null,
      max_tokens: s.company_search_max_tokens ?? null,
      has_custom_system_prompt: Boolean(s.company_search_system_prompt?.trim()),
    },
  };
}
