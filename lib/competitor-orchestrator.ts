import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";
import { priceForWebSearch } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const COMPETITOR_ORCHESTRATOR_SYSTEM_PROMPT = `Du bist der Competitive-Intelligence-Manager fuer ISP Power Systems. Du hast zwei Rollen gleichzeitig:

1. **Intelligence-Controller:** Du steuerst den gesamten Konkurrenten-Prozess: Discovery (Claude + Web-Search findet Kandidaten), Short-Analyse (Firecrawl + Haiku analysiert Website), Kuratierung (vorgeschlagene Konkurrenten akzeptieren oder ablehnen). Du arbeitest mit Tool-Calls.

2. **Gespraechtpartner:** Du erklaerst Ergebnisse, gibst strategische Einschaetzungen und beantwortest Fragen zum Wettbewerbsumfeld von ISP Power Systems.

## ISP Power Systems Kurzprofil

ISP entwickelt anwendungsspezifische Batterie- und Antriebssysteme fuer Defense, Aeronautics, Mobile Robotics, Space, Maritime und Mobility. Kein Off-the-Shelf, sondern kundenspezifisch. Stark in European Supply Chain, In-House-Testing und Validation-First-Design. Konkurrenten sind andere Custom-Battery-System-Hersteller in diesen Nischen.

## Prozess-Ablauf

**Neue Konkurrenten finden:**
run_discovery → Inngest-Job laeuft (Web-Search, 15 min) → Kandidaten erscheinen als "suggested" → Kuratierung

**Kandidaten analysieren:**
trigger_short_analysis(ids) → Haiku scrapt jede Website → Ergebnis in competitor_versions → short_status=done

**Kuratieren:**
curate_competitors(items) → direkte Aktion, kein Widget (ausser bulk >5)

**Loeschen:**
delete_competitors(ids) → immer Bestaetungs-Widget

## Regeln

- **Vor run_discovery:** Erwaehne Kostenschaetzung (~0.15 EUR Web-Search + ~0.05 EUR Tokens).
- **Vor trigger_short_analysis bulk (>5):** Kurze Bestaetigung einholen.
- **delete_competitors:** Immer confirmation_request Widget, kein direktes Loeschen.
- **curate_competitors:** Direkte Ausfuehrung. Bei bulk >5: erst zusammenfassen was getan werden soll.
- **Keine Em-Dashes (-):** Verwende Komma, Punkt oder Klammer.
- **Ton:** Sachlich, direkt, keine Superlative. Kurze Saetze.
- **Sektor-IDs:** defense | aeronautics | mobile_robotics | space | maritime | mobility

## Competitor-Status-Bedeutungen

- **suggested:** Von Discovery vorgeschlagen, noch nicht bewertet
- **active:** Akzeptierter Konkurrent, wird beobachtet
- **archived:** Zurueckgestellt, kein aktueller Wettbewerber
- **rejected:** Kein ISP-Konkurrent

## Wenn du auf der Detail-Seite eines Konkurrenten bist

Wenn competitor_focus gesetzt ist, beziehen sich "analysiere", "aktualisiere", "was weisst du" auf diesen Konkurrenten. Nutze trigger_short_analysis fuer eine neue Website-Analyse.`;

// ---------------------------------------------------------------------------
// Tool input types
// ---------------------------------------------------------------------------

export type CompetitorToolResult = { summary: string; detail?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Anthropic tool definitions
// ---------------------------------------------------------------------------

export const COMPETITOR_TOOL_DEFS = [
  {
    name: "run_discovery",
    description:
      "Startet einen neuen Konkurrenten-Discovery-Lauf: Claude + Web-Search recherchiert den Markt und findet Kandidaten. Dauert 5-15 Min. Kosten ~0.15-0.30 EUR. Ergebnis: neue 'suggested'-Konkurrenten in der Liste.",
    input_schema: {
      type: "object" as const,
      properties: {
        sector_focus: {
          type: "array",
          items: { type: "string" },
          description: "Sektoren einschraenken (optional, z.B. ['defense', 'aeronautics']). Leer = alle ISP-Sektoren.",
        },
        region_focus: {
          type: "string",
          description: "Geographische Einschraenkung, z.B. 'Europe', 'Germany' (optional).",
        },
        target_count: {
          type: "number",
          description: "Zielanzahl Kandidaten (5-50). Default: 20.",
        },
        notes: {
          type: "string",
          description: "Zusaetzliche Hinweise fuer die Recherche (optional).",
        },
      },
      required: [],
    },
  },
  {
    name: "get_discovery_status",
    description: "Gibt den Status des letzten Konkurrenten-Discovery-Laufs zurueck.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "trigger_short_analysis",
    description:
      "Startet die Short-Analyse fuer einen oder mehrere Konkurrenten: Haiku scrapt die Website und analysiert Positioning, Portfolio, Threat-Level. Ergebnis wird in competitor_versions gespeichert.",
    input_schema: {
      type: "object" as const,
      properties: {
        competitor_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs der Konkurrenten die analysiert werden sollen.",
        },
      },
      required: ["competitor_ids"],
    },
  },
  {
    name: "curate_competitors",
    description:
      "Aendert den Status eines oder mehrerer Konkurrenten. Aktionen: accept (suggested -> active), reject (suggested -> rejected), archive (active -> archived), reactivate (archived/rejected -> active). Direkte Ausfuehrung, kein Widget.",
    input_schema: {
      type: "object" as const,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "UUID des Konkurrenten" },
              action: {
                type: "string",
                enum: ["accept", "reject", "archive", "reactivate"],
                description: "Auszufuehrende Aktion",
              },
            },
            required: ["id", "action"],
          },
          description: "Liste der Kurationsaktionen.",
        },
      },
      required: ["items"],
    },
  },
  {
    name: "delete_competitors",
    description:
      "Loescht einen oder mehrere Konkurrenten dauerhaft. IMMER ein Bestaetungs-Widget zeigen. Nicht fuer Archivieren verwenden - nutze curate_competitors fuer Status-Aenderungen.",
    input_schema: {
      type: "object" as const,
      properties: {
        competitor_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs der zu loeschenden Konkurrenten.",
        },
        reason: {
          type: "string",
          description: "Begruendung fuer das Loeschen (sichtbar im Widget).",
        },
      },
      required: ["competitor_ids", "reason"],
    },
  },
  {
    name: "update_competitor_intel",
    description:
      "Schreibt einen einzelnen Feldwert in den aktuellen competitor_versions-Eintrag des Konkurrenten. Nur aufrufen wenn User explizit bestaetigt hat. Setzt voraus dass competitor_focus gesetzt ist.",
    input_schema: {
      type: "object" as const,
      properties: {
        competitor_id: { type: "string", description: "UUID des Konkurrenten." },
        field: {
          type: "string",
          enum: ["one_liner", "positioning", "threat_level", "isp_sector_match", "growth_signals", "portfolio"],
          description: "Feld das aktualisiert werden soll.",
        },
        value: { description: "Neuer Wert fuer das Feld." },
      },
      required: ["competitor_id", "field", "value"],
    },
  },
] as const;

export const COMPETITOR_TOOL_NAMES = new Set(COMPETITOR_TOOL_DEFS.map((t) => t.name));

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeCompetitorTool(
  toolName: string,
  input: unknown,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompetitorToolResult> {
  switch (toolName) {
    case "run_discovery":
      return runDiscovery(input as RunDiscoveryInput, userId, supabase);
    case "get_discovery_status":
      return getDiscoveryStatus(userId, supabase);
    case "trigger_short_analysis": {
      const { competitor_ids } = (input ?? {}) as { competitor_ids?: string[] };
      if (!competitor_ids?.length) return { summary: "trigger_short_analysis: Keine competitor_ids angegeben." };
      return triggerShortAnalysis(competitor_ids, userId, supabase);
    }
    case "curate_competitors": {
      const { items } = (input ?? {}) as { items?: CurateItem[] };
      if (!items?.length) return { summary: "curate_competitors: Keine items angegeben." };
      return curateCompetitors(items, userId, supabase);
    }
    case "delete_competitors": {
      const { competitor_ids, reason } = (input ?? {}) as { competitor_ids?: string[]; reason?: string };
      if (!competitor_ids?.length) return { summary: "delete_competitors: Keine competitor_ids angegeben." };
      return deleteCompetitors(competitor_ids, reason ?? "kein Grund angegeben", userId, supabase);
    }
    case "update_competitor_intel": {
      const { competitor_id, field, value } = (input ?? {}) as {
        competitor_id?: string; field?: string; value?: unknown;
      };
      if (!competitor_id || !field) return { summary: "update_competitor_intel: competitor_id und field erforderlich." };
      return updateCompetitorIntel(competitor_id, field, value, userId, supabase);
    }
    default:
      return { summary: `Unbekanntes Tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Tool input types
// ---------------------------------------------------------------------------

type RunDiscoveryInput = {
  sector_focus?: string[];
  region_focus?: string;
  target_count?: number;
  notes?: string;
};

type CurateItem = {
  id: string;
  action: "accept" | "reject" | "archive" | "reactivate";
};

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function runDiscovery(
  input: RunDiscoveryInput,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompetitorToolResult> {
  const { data: run, error: runErr } = await supabase
    .from("competitor_discovery_runs")
    .insert({
      user_id: userId,
      status: "pending",
    })
    .select("id")
    .single();

  if (runErr || !run) {
    return { summary: `Fehler beim Erstellen des Discovery-Runs: ${runErr?.message ?? "unknown"}` };
  }

  const request = {
    ...(input.sector_focus?.length ? { sector_focus: input.sector_focus } : {}),
    ...(input.region_focus ? { region_focus: input.region_focus } : {}),
    target_count: Math.min(Math.max(input.target_count ?? 20, 5), 50),
    ...(input.notes ? { notes: input.notes } : {}),
  };

  await inngest.send({
    name: "competitor.discovery.requested" as const,
    data: { userId, runId: run.id, request: request as any },
  });

  const sectorInfo = request.sector_focus?.length
    ? ` (Fokus: ${request.sector_focus.join(", ")})`
    : "";

  return {
    summary: `Discovery-Lauf gestartet${sectorInfo}: ${request.target_count} Kandidaten angefragt. Laeuft im Hintergrund (5-15 Min). Run-ID: ${run.id}.`,
    detail: { runId: run.id },
  };
}

async function getDiscoveryStatus(
  userId: string,
  supabase: SupabaseClient,
): Promise<CompetitorToolResult> {
  const { data } = await supabase
    .from("competitor_discovery_runs")
    .select("id, status, current_phase, candidates_total, candidates_kept, error_message, created_at, finished_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return { summary: "Kein Discovery-Lauf gefunden." };

  const duration = data.finished_at
    ? `${Math.round((new Date(data.finished_at).getTime() - new Date(data.created_at).getTime()) / 1000)}s`
    : "laeuft noch";

  return {
    summary: `Letzter Lauf: ${data.status} (Phase: ${data.current_phase ?? "?"}) — ${data.candidates_kept ?? 0}/${data.candidates_total ?? "?"} Kandidaten behalten. Dauer: ${duration}${data.error_message ? ` — Fehler: ${data.error_message}` : ""}.`,
    detail: data,
  };
}

async function triggerShortAnalysis(
  competitorIds: string[],
  userId: string,
  supabase: SupabaseClient,
): Promise<CompetitorToolResult> {
  const { data: found } = await supabase
    .from("competitors")
    .select("id, display_name, website")
    .in("id", competitorIds)
    .eq("user_id", userId);

  const valid = (found ?? []).filter((c: { website: string | null }) => c.website);
  const noWebsite = (found ?? []).filter((c: { website: string | null }) => !c.website);

  if (valid.length === 0) {
    const msg = noWebsite.length > 0
      ? `Keine Konkurrenten mit Website gefunden. ${noWebsite.length} haben keine URL hinterlegt.`
      : "Keine gueltigen Konkurrenten-IDs gefunden.";
    return { summary: msg };
  }

  await supabase
    .from("competitors")
    .update({ short_status: "pending" })
    .in("id", valid.map((c: { id: string }) => c.id));

  await inngest.send(
    valid.map((c: { id: string }) => ({
      name: "competitor.short.requested" as const,
      data: { competitorId: c.id, userId },
    })) as any,
  );

  const names = valid
    .slice(0, 5)
    .map((c: { display_name: string }) => c.display_name)
    .join(", ");
  const suffix = valid.length > 5 ? ` + ${valid.length - 5} weitere` : "";
  const skipNote = noWebsite.length > 0 ? ` (${noWebsite.length} ohne Website uebersprungen)` : "";

  return {
    summary: `Short-Analyse gestartet fuer ${valid.length} Konkurrenten: ${names}${suffix}${skipNote}. Laeuft im Hintergrund.`,
    detail: { started: valid.length, skipped_no_website: noWebsite.length },
  };
}

async function curateCompetitors(
  items: CurateItem[],
  userId: string,
  supabase: SupabaseClient,
): Promise<CompetitorToolResult> {
  const ACTION_STATUS_MAP: Record<CurateItem["action"], string> = {
    accept: "active",
    reject: "rejected",
    archive: "archived",
    reactivate: "active",
  };

  const results: { name: string; action: string; ok: boolean }[] = [];

  for (const item of items) {
    const newStatus = ACTION_STATUS_MAP[item.action];
    const { data: row } = await supabase
      .from("competitors")
      .select("display_name, status")
      .eq("id", item.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (!row) {
      results.push({ name: item.id, action: item.action, ok: false });
      continue;
    }

    await supabase
      .from("competitors")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", item.id);

    results.push({ name: row.display_name, action: item.action, ok: true });
  }

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  const lines = ok
    .slice(0, 8)
    .map((r) => `${r.name} → ${r.action}`)
    .join(", ");
  const more = ok.length > 8 ? ` + ${ok.length - 8} weitere` : "";
  const failNote = failed.length > 0 ? ` (${failed.length} nicht gefunden)` : "";

  return {
    summary: `Kuratiert: ${ok.length} Konkurrenten: ${lines}${more}${failNote}.`,
    detail: { curated: ok.length, failed: failed.length },
  };
}

async function deleteCompetitors(
  competitorIds: string[],
  reason: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompetitorToolResult> {
  const { data: found } = await supabase
    .from("competitors")
    .select("id, display_name")
    .in("id", competitorIds)
    .eq("user_id", userId);

  const valid = found ?? [];
  if (valid.length === 0) {
    return { summary: "Keine gueltigen Konkurrenten-IDs gefunden." };
  }

  const previewNames = valid.map((c: { display_name: string }) => c.display_name);

  return {
    summary: `Bestaetigung ausstehend: ${valid.length} Konkurrenten loeschen. Weise den User auf das Bestaetungs-Widget hin.`,
    detail: {
      confirmation_request: {
        action_type: "delete_competitors",
        description: `${valid.length} Konkurrenten loeschen — ${reason}`,
        preview_items: previewNames.slice(0, 7),
        count: valid.length,
        payload: { competitor_ids: valid.map((c: { id: string }) => c.id) },
      },
    },
  };
}

async function updateCompetitorIntel(
  competitorId: string,
  field: string,
  value: unknown,
  userId: string,
  supabase: SupabaseClient,
): Promise<CompetitorToolResult> {
  const ALLOWED_FIELDS = new Set([
    "one_liner", "positioning", "threat_level", "isp_sector_match", "growth_signals", "portfolio",
  ]);

  if (!ALLOWED_FIELDS.has(field)) {
    return { summary: `update_competitor_intel: Feld '${field}' nicht editierbar.` };
  }

  const { data: competitor } = await supabase
    .from("competitors")
    .select("id, display_name, current_version_id")
    .eq("id", competitorId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!competitor) {
    return { summary: `Konkurrent ${competitorId} nicht gefunden.` };
  }

  if (!competitor.current_version_id) {
    return {
      summary: `${competitor.display_name} hat noch keine Version. Bitte zuerst Short-Analyse starten.`,
    };
  }

  const { error: dbErr } = await supabase
    .from("competitor_versions")
    .update({ [field]: value })
    .eq("id", competitor.current_version_id);

  if (dbErr) {
    return { summary: `Fehler beim Speichern: ${dbErr.message}` };
  }

  return {
    summary: `Gespeichert: ${competitor.display_name}.${field} aktualisiert.`,
  };
}
