import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";
import { discoverSiteStrategy } from "@/lib/discovery";
import { CrawlPlanSchema } from "@/lib/crawl-plan";
import { tryAppendLog, loadCrawlState } from "@/lib/crawl-log";
import { priceFor } from "@/lib/pricing";
import { SHORT_MODEL_DEFAULT, getSettings, effectiveHandbook } from "@/lib/settings";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_SYSTEM_PROMPT = `Du bist der Pipeline-Orchestrator für das ISP Power Systems Sales-Intelligence-Tool. Du hast zwei Rollen gleichzeitig:

1. **Orchestrator:** Du steuerst die gesamte Pipeline — Discovery, Listing, Short-Overview, Deep-Dive, Pause, Resume, Restart — über Tool-Calls. Du bist die einzige Instanz, die entscheidet wann was gestartet wird.

2. **Gesprächspartner:** Du kommunizierst klar auf Deutsch über den Fortschritt, erklärst Fehler verständlich und schlägst konkrete nächste Schritte vor.

## Pipeline-Ablauf

**Neue Messe:** Discovery → Listing → (optional) Short-Overview → (optional) Deep-Dive

- **Discovery** (run_discovery): Firecrawl analysiert die Listing-URL, Claude wählt Strategie + Engine. Dauert ~30 Sekunden. Du führst das direkt aus.
- **Listing** (trigger_listing): Inngest holt alle Aussteller gemäß Plan. Dauert 5–30 Min. Du delegierst und meldest Ergebnis beim nächsten Turn.
- **Short-Overview** (trigger_short_overview): Haiku analysiert alle pending Aussteller. ~0.03 EUR/Aussteller (Tokens + Firecrawl-Scrape + ggf. URL-Search pro Firma ohne Website). Nenne Kostenschätzung BEVOR du startest.
- **Deep-Dive** (trigger_deep_dive): Sonnet macht Tiefenanalyse für einzelnen Aussteller. Nur auf explizite Anfrage.

## Pause und Resume

**pause_pipeline** und **resume_pipeline** funktionieren in ALLEN aktiven Phasen:
- Discovery/Listing: wenn status=crawling oder status=queued
- Short-Overview: wenn status=ready und noch Aussteller mit short_status=pending oder running vorhanden

Der User kann die Pipeline über den Pause-Button in der UI pausieren. Wenn er danach im Chat schreibt "fortsetzen", "weiter", "resume" oder ähnliches, rufe **resume_pipeline** auf. Kein Bestätigungs-Widget nötig, direkt ausführen.

## Regeln

- **Vor restart_pipeline:** Immer explizit bestätigen lassen ("Alle Aussteller-Daten werden gelöscht. Sicher?")
- **Vor trigger_short_overview:** Kostenschätzung nennen (Anzahl pending × ~0.03 EUR) und warten bis User bestätigt
- **Bei Discovery-Fehler:** Nicht einfach "retry" empfehlen — Fehlerursache analysieren und konkreten Alternativvorschlag machen (z.B. andere Engine)
- **Status lesen:** Der aktuelle Pipeline-Status ist immer im System-Kontext enthalten. Nutze ihn aktiv.
- **Keine Em-Dashes (—):** Verwende Komma, Punkt oder Klammer statt Gedankenstriche.
- **Ton:** Sachlich, direkt, keine Superlative. Kurze Sätze.

## Aussteller-Verwaltung

Du kannst Aussteller **loeschen** (delete_exhibitors), **hinzufuegen** (add_exhibitor) und **Short-Overviews neu erstellen** (regenerate_short).

- **delete_exhibitors:** Sammle ALLE zu loeschenden IDs in einem einzigen Tool-Call. Nenne die Begruendung klar und buendig. Ein Bestaetungs-Widget erscheint im Chat. Warte auf Ja oder Nein des Users. **WICHTIG: Wenn der User "alle loeschen" sagt oder eine grosse Menge loeschen will, nutze IMMER delete_exhibitors mit allen IDs — NIEMALS restart_pipeline. restart_pipeline ist ausschliesslich fuer den Fall, dass der User die komplette Pipeline inklusive Listing neu starten will.**
- **add_exhibitor:** Nenne Name, Website (falls bekannt), Booth (falls bekannt) und Begruendung. Gleiches Widget.
- **regenerate_short:** Fuehrt die Short-Analyse fuer einen oder mehrere Aussteller sofort neu aus (kein Widget, kein Bestaetungs-Schritt). Sinnvoll wenn: (1) Aussteller manuell hinzugefuegt wurde und noch kein Short hat, (2) User mit der Analyse unzufrieden ist, (3) Short-Status "failed".
- Die IDs der Aussteller findest du im Aussteller-Kontext (Feld "id").
- Rufe niemals delete_exhibitors und add_exhibitor gleichzeitig auf. Warte auf Bestaetigung bevor du weitere Aenderungen vorschlaegst.
- Wenn der User "alle" loeschen moechte, nutze ALLE IDs aus dem Aussteller-Kontext in einem einzigen delete_exhibitors-Aufruf.

## restart_pipeline — nur fuer kompletten Neustart

restart_pipeline loescht ALLES und startet das Listing neu. Verwende es NUR wenn der User explizit sagt, er moechte das Listing neu einlesen / die Messe neu scrapen. Nicht fuer "alle Aussteller loeschen".

## update_show_url — Aussteller-Listen-URL aendern

Wenn der User eine neue Aussteller-Listen-URL nennt oder die bestehende korrigieren will, rufe **update_show_url** auf. Das setzt source_url auf der Messe und leert den bisherigen Crawl-Plan (da dieser auf der alten URL basiert).

Danach typischerweise:
1. **run_discovery** — neuer Plan auf der neuen URL
2. **trigger_listing** — Aussteller mit dem neuen Plan holen

Kein Bestaetungs-Widget noetig, direkt ausfuehren. Aber: wenn die Messe bereits Aussteller hat, vorher kurz anmerken dass der bisherige Plan und ggf. nicht-passende Aussteller-Daten verworfen werden sollten. Schlage delete_exhibitors vor falls die alten Aussteller zur alten URL gehoeren.

## Funktionsweise des Tools — read_handbook

Wenn der User Fragen zur Funktionsweise des Tools, zur Bedeutung von Status-Werten, zu Modulen (Companies, Konkurrenten, Show-Discovery, Kosten), zu typischen Workflows oder allgemein "wie funktioniert das hier" stellt, rufe **read_handbook** auf. Das Tool liefert die vollstaendige Anleitung als Markdown. Nutze es nur bei Funktions-Fragen, NICHT fuer Status-Abfragen zur aktuellen Messe oder zu einzelnen Ausstellern — diese Infos hast du bereits im Kontext.`;

// ---------------------------------------------------------------------------
// Tool input types
// ---------------------------------------------------------------------------

export type OrchestratorToolInput =
  | { tool: "run_discovery"; input: Record<string, never> }
  | { tool: "trigger_listing"; input: { reason?: string } }
  | { tool: "trigger_short_overview"; input: { confirmed?: boolean } }
  | { tool: "trigger_deep_dive"; input: { exhibitor_id: string } }
  | { tool: "pause_pipeline"; input: Record<string, never> }
  | { tool: "resume_pipeline"; input: Record<string, never> }
  | { tool: "restart_pipeline"; input: { confirmed?: boolean } }
  | { tool: "delete_exhibitors"; input: { exhibitor_ids: string[]; reason: string } }
  | { tool: "add_exhibitor"; input: { company_name: string; website?: string; booth?: string; reason: string } }
  | { tool: "regenerate_short"; input: { exhibitor_ids: string[] } }
  | { tool: "update_show_url"; input: { url: string } };

export type ToolResult = { summary: string; detail?: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Anthropic tool definitions (passed to Claude messages.create)
// ---------------------------------------------------------------------------

export const ORCHESTRATOR_TOOL_DEFS = [
  {
    name: "run_discovery",
    description:
      "Analysiert die Messe-URL mit Firecrawl + Claude und erstellt einen Crawl-Plan (Strategie + Engine). Dauert ~30 Sekunden. Speichert den Plan in der Datenbank. Benutze dieses Tool wenn noch kein Plan existiert oder der bisherige Plan falsch ist.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "trigger_listing",
    description:
      "Startet das Listing via Inngest (fire-and-forget). Benötigt einen gespeicherten Crawl-Plan. Benutze dieses Tool nachdem run_discovery erfolgreich war oder wenn ein Plan bereits gespeichert ist.",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: { type: "string", description: "Optionaler Grund (für Log)" },
      },
      required: [],
    },
  },
  {
    name: "trigger_short_overview",
    description:
      "Startet Short-Overview für alle Aussteller mit short_status pending oder failed. Nenne dem User VOR dem Tool-Call die Anzahl und Kosten (~0.03 EUR/Aussteller) und warte auf Bestätigung.",
    input_schema: {
      type: "object" as const,
      properties: {
        confirmed: {
          type: "boolean",
          description: "true wenn User explizit bestätigt hat",
        },
      },
      required: [],
    },
  },
  {
    name: "trigger_deep_dive",
    description: "Startet Deep-Dive für einen einzelnen Aussteller (Sonnet-Analyse).",
    input_schema: {
      type: "object" as const,
      properties: {
        exhibitor_id: { type: "string", description: "UUID des Ausstellers" },
      },
      required: ["exhibitor_id"],
    },
  },
  {
    name: "pause_pipeline",
    description: "Pausiert die laufende Pipeline (Discovery/Listing/Short).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "resume_pipeline",
    description: "Setzt eine pausierte Pipeline fort.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "restart_pipeline",
    description:
      "Setzt die Messe komplett zurück: löscht alle Aussteller und startet Listing neu. NUR nach expliziter Bestätigung des Users verwenden.",
    input_schema: {
      type: "object" as const,
      properties: {
        confirmed: {
          type: "boolean",
          description: "true wenn User explizit bestätigt hat dass Daten gelöscht werden dürfen",
        },
      },
      required: [],
    },
  },
  {
    name: "delete_exhibitors",
    description:
      "Loescht einen oder mehrere Aussteller aus der Messe. Sammle ALLE zu loeschenden IDs und rufe das Tool einmal auf. Ein Bestaetungs-Widget erscheint im Chat. Nicht mit confirmed-Flag aufrufen, das Widget uebernimmt die Ausfuehrung.",
    input_schema: {
      type: "object" as const,
      properties: {
        exhibitor_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs der zu loeschenden Aussteller (aus dem Aussteller-Kontext, Feld 'id')",
        },
        reason: {
          type: "string",
          description: "Kurze Begruendung, sichtbar im Bestaetungs-Widget",
        },
      },
      required: ["exhibitor_ids", "reason"],
    },
  },
  {
    name: "add_exhibitor",
    description:
      "Fuegt einen neuen Aussteller manuell zur Messe hinzu. Ein Bestaetungs-Widget erscheint im Chat.",
    input_schema: {
      type: "object" as const,
      properties: {
        company_name: { type: "string", description: "Firmenname" },
        website:      { type: "string", description: "URL (optional)" },
        booth:        { type: "string", description: "Stand-Nummer (optional)" },
        reason:       { type: "string", description: "Warum wird dieser Aussteller hinzugefuegt?" },
      },
      required: ["company_name", "reason"],
    },
  },
  {
    name: "regenerate_short",
    description:
      "Erstellt Short-Overview fuer einen oder mehrere Aussteller neu. Nuetzlich wenn ein Aussteller schlechte Daten hat, manuell hinzugefuegt wurde oder die Short-Analyse wiederholt werden soll. Fuehrt sofort aus, kein Bestaetungs-Widget.",
    input_schema: {
      type: "object" as const,
      properties: {
        exhibitor_ids: {
          type: "array",
          items: { type: "string" },
          description: "UUIDs der Aussteller (aus dem Aussteller-Kontext, Feld 'id')",
        },
      },
      required: ["exhibitor_ids"],
    },
  },
  {
    name: "update_show_url",
    description:
      "Setzt die Aussteller-Listen-URL (source_url) der Messe auf einen neuen Wert. Leert den bisherigen Crawl-Plan, da dieser auf der alten URL basiert. Verwende es wenn der User eine neue URL nennt oder eine bestehende korrigieren will. Danach typischerweise run_discovery + trigger_listing.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "Die neue Aussteller-Listen-URL (vollstaendig mit https://).",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "read_handbook",
    description:
      "Liest die Bedienungs-Anleitung fuer das ISP Sales-Intelligence-Tool. Enthaelt eine Uebersicht ueber Pipeline-Phasen, Status-Werte, Module (Messen, Aussteller, Companies, Konkurrenten, Show-Discovery), typische Workflows und FAQ. Rufe dieses Tool auf wenn der User Fragen zur Funktionsweise des Tools, zur Bedeutung von Status, oder zu typischen Workflows stellt — also alles, was du nicht aus dem aktiven Kontext (Messe, Aussteller, Pipeline-State) ableiten kannst. Keine Argumente. Gibt die komplette Anleitung als Markdown zurueck.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
] as const;

export const ORCHESTRATOR_TOOL_NAMES = new Set(ORCHESTRATOR_TOOL_DEFS.map((t) => t.name));

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executePipelineTool(
  toolName: string,
  input: unknown,
  showId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  switch (toolName) {
    case "run_discovery":
      return runDiscovery(showId, userId, supabase);
    case "trigger_listing":
      return triggerListing(showId, supabase);
    case "trigger_short_overview":
      return triggerShortOverview(showId, supabase);
    case "trigger_deep_dive": {
      const { exhibitor_id } = input as { exhibitor_id: string };
      return triggerDeepDive(exhibitor_id, showId, supabase);
    }
    case "pause_pipeline":
      return pausePipeline(showId, supabase);
    case "resume_pipeline":
      return resumePipeline(showId, supabase);
    case "restart_pipeline": {
      const { confirmed } = (input ?? {}) as { confirmed?: boolean };
      if (!confirmed) {
        return {
          summary:
            "Restart abgebrochen: Bestätigung fehlt. Antworte dem User: 'Alle Aussteller-Daten werden gelöscht. Bitte mit \"ja, restart\" bestätigen.'",
        };
      }
      return restartPipeline(showId, supabase);
    }
    case "delete_exhibitors": {
      const { exhibitor_ids, reason } = (input ?? {}) as { exhibitor_ids?: string[]; reason?: string };
      if (!exhibitor_ids?.length) {
        return { summary: "delete_exhibitors: Keine exhibitor_ids angegeben." };
      }
      const { data: found } = await supabase
        .from("exhibitors")
        .select("id, company_name")
        .in("id", exhibitor_ids)
        .eq("trade_show_id", showId);
      const validIds = found?.map((e: { id: string }) => e.id) ?? [];
      const previewNames = found?.map((e: { company_name: string }) => e.company_name) ?? [];
      if (validIds.length === 0) {
        return { summary: "Keine gueltigen Aussteller-IDs fuer diese Messe gefunden." };
      }
      return {
        summary: `Bestaetigung ausstehend: ${validIds.length} Aussteller loeschen. Weise den User auf das Bestaetungs-Widget im Chat hin.`,
        detail: {
          confirmation_request: {
            action_type:   "delete_exhibitors",
            description:   `${validIds.length} Aussteller loeschen — ${reason ?? "kein Grund angegeben"}`,
            preview_items: previewNames.slice(0, 7),
            count:         validIds.length,
            payload:       { exhibitor_ids: validIds },
          },
        },
      };
    }
    case "add_exhibitor": {
      const { company_name, website, booth, reason } = (input ?? {}) as {
        company_name?: string; website?: string; booth?: string; reason?: string;
      };
      if (!company_name) {
        return { summary: "add_exhibitor: company_name fehlt." };
      }
      return {
        summary: `Bestaetigung ausstehend: Aussteller "${company_name}" hinzufuegen. Weise den User auf das Bestaetungs-Widget hin.`,
        detail: {
          confirmation_request: {
            action_type:   "add_exhibitor",
            description:   `Aussteller hinzufuegen — ${reason ?? "kein Grund angegeben"}`,
            preview_items: [company_name, website ?? "", booth ?? ""].filter(Boolean),
            count:         1,
            payload:       { company_name, website: website ?? null, booth: booth ?? null },
          },
        },
      };
    }
    case "update_show_url": {
      const { url } = (input ?? {}) as { url?: string };
      return updateShowUrl(showId, url, supabase);
    }
    case "regenerate_short": {
      const { exhibitor_ids } = (input ?? {}) as { exhibitor_ids?: string[] };
      if (!exhibitor_ids?.length) {
        return { summary: "regenerate_short: Keine exhibitor_ids angegeben." };
      }
      const { data: found } = await supabase
        .from("exhibitors")
        .select("id, company_name")
        .in("id", exhibitor_ids)
        .eq("trade_show_id", showId);
      const valid = found ?? [];
      if (valid.length === 0) {
        return { summary: "Keine gueltigen Aussteller-IDs fuer diese Messe gefunden." };
      }
      await supabase
        .from("exhibitors")
        .update({ short_status: "pending", current_step: null })
        .in("id", valid.map((e: { id: string }) => e.id));
      await inngest.send(
        valid.map((e: { id: string }) => ({
          name: "exhibitor.short.requested" as const,
          data: { exhibitorId: e.id, tradeShowId: showId },
        })),
      );
      await tryAppendLog(supabase, showId, {
        phase: "short",
        message: `Orchestrator: Short-Overview neu gestartet fuer ${valid.length} Aussteller`,
      });
      const names = valid
        .map((e: { company_name: string }) => e.company_name)
        .slice(0, 5)
        .join(", ");
      const suffix = valid.length > 5 ? ` + ${valid.length - 5} weitere` : "";
      return {
        summary: `Short-Overview neu gestartet fuer ${valid.length} Aussteller: ${names}${suffix}. Laeuft im Hintergrund.`,
      };
    }
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

async function updateShowUrl(
  showId: string,
  url: string | undefined,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) {
    return { summary: "update_show_url: keine url uebergeben." };
  }
  // Auto-prepend https:// wenn das Schema fehlt (User-Input wie "foo.com/bar").
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    new URL(normalized);
  } catch {
    return { summary: `update_show_url: ungueltige URL "${trimmed}".` };
  }

  const { data: before } = await supabase
    .from("trade_shows")
    .select("source_url")
    .eq("id", showId)
    .single();

  const { error } = await supabase
    .from("trade_shows")
    .update({
      source_url: normalized,
      url_search_status: "done",
      crawl_plan: null,
      expected_exhibitor_count: null,
    })
    .eq("id", showId);
  if (error) {
    return { summary: `update_show_url: DB-Fehler (${error.message}).` };
  }

  await tryAppendLog(supabase, showId, {
    phase: "discovery",
    message: `Orchestrator: source_url aktualisiert (alt: ${before?.source_url ?? "leer"}, neu: ${normalized}). Crawl-Plan zurueckgesetzt.`,
  });

  return {
    summary: `URL aktualisiert auf ${normalized}. Crawl-Plan wurde zurueckgesetzt. Rufe als naechstes run_discovery auf, danach trigger_listing.`,
    detail: { url: normalized, previous_url: before?.source_url ?? null },
  };
}

async function runDiscovery(
  showId: string,
  userId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const { data: show } = await supabase
    .from("trade_shows")
    .select("source_url, name")
    .eq("id", showId)
    .single();

  if (!show?.source_url) {
    return { summary: "Fehler: Keine Aussteller-URL hinterlegt. Bitte zuerst eine URL in den Einstellungen setzen." };
  }

  await tryAppendLog(supabase, showId, {
    phase: "discovery",
    message: "Orchestrator: Discovery gestartet (Firecrawl + Claude)",
  });

  let result: Awaited<ReturnType<typeof discoverSiteStrategy>>;
  try {
    result = await discoverSiteStrategy(show.source_url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await tryAppendLog(supabase, showId, {
      phase: "discovery",
      level: "error",
      message: `Discovery fehlgeschlagen: ${msg.slice(0, 400)}`,
    });
    return {
      summary: `Discovery fehlgeschlagen: ${msg.slice(0, 400)}. Analysiere die Ursache und schlage dem User eine Alternative vor (anderer Engine, andere URL, manueller Plan).`,
      detail: { error: msg },
    };
  }

  await supabase
    .from("trade_shows")
    .update({
      crawl_plan: result.plan,
      discovery_log: result.log,
      expected_exhibitor_count: result.expectedTotalCount ?? null,
    })
    .eq("id", showId);

  await tryAppendLog(supabase, showId, {
    phase: "discovery",
    message: `Orchestrator: Plan gespeichert (${result.plan.strategy})`,
    meta: { plan: result.plan, expected_total_count: result.expectedTotalCount },
  });

  const engine = (result.plan as Record<string, unknown>).engine ?? "firecrawl";
  const letterCount =
    result.plan.strategy === "letter_loop" ? (result.plan as any).letters?.length : null;
  const summary = [
    `Discovery OK: ${result.plan.strategy} · ${engine}`,
    letterCount ? `${letterCount} Buchstaben` : null,
    result.expectedTotalCount ? `~${result.expectedTotalCount} Aussteller erwartet` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    summary,
    detail: { plan: result.plan, expectedTotalCount: result.expectedTotalCount },
  };
}

async function triggerListing(showId: string, supabase: SupabaseClient): Promise<ToolResult> {
  const { data: show } = await supabase
    .from("trade_shows")
    .select("crawl_plan")
    .eq("id", showId)
    .single();

  const parsed = CrawlPlanSchema.safeParse(show?.crawl_plan);
  if (!parsed.success) {
    return {
      summary:
        "Kein gueltiger Crawl-Plan gespeichert. Bitte zuerst run_discovery ausfuehren.",
    };
  }

  await inngest.send({
    name: "trade-show.listing-requested",
    data: { tradeShowId: showId },
  });

  await tryAppendLog(supabase, showId, {
    phase: "listing",
    message: `Orchestrator: Listing gestartet (${parsed.data.strategy})`,
  });

  const engine = (parsed.data as Record<string, unknown>).engine ?? "firecrawl";
  return {
    summary: `Listing gestartet: ${parsed.data.strategy} · ${engine}. Laeuft im Hintergrund. Beim naechsten Turn ist der Status aktuell.`,
  };
}

async function triggerShortOverview(showId: string, supabase: SupabaseClient): Promise<ToolResult> {
  const { count } = await supabase
    .from("exhibitors")
    .select("id", { count: "exact", head: true })
    .eq("trade_show_id", showId)
    .in("short_status", ["pending", "failed"]);

  const n = count ?? 0;
  if (n === 0) {
    return { summary: "Keine Aussteller mit pending/failed Short-Status gefunden." };
  }

  const estimatedEur = (n * 0.03).toFixed(2);

  await inngest.send({
    name: "short-overview.bulk-requested",
    data: { tradeShowId: showId },
  });

  await tryAppendLog(supabase, showId, {
    phase: "short",
    message: `Orchestrator: Short-Overview gestartet fuer ${n} Aussteller`,
  });

  return {
    summary: `Short-Overview gestartet: ${n} Aussteller, ~${estimatedEur} EUR geschaetzt. Laeuft im Hintergrund.`,
    detail: { count: n, estimated_eur: estimatedEur },
  };
}

async function triggerDeepDive(
  exhibitorId: string,
  showId: string,
  supabase: SupabaseClient,
): Promise<ToolResult> {
  const { data: ex } = await supabase
    .from("exhibitors")
    .select("company_name")
    .eq("id", exhibitorId)
    .single();

  if (!ex) {
    return { summary: `Aussteller ${exhibitorId} nicht gefunden.` };
  }

  await inngest.send({
    name: "exhibitor.deep.requested",
    data: { exhibitorId, tradeShowId: showId },
  });

  return {
    summary: `Deep-Dive gestartet fuer: ${ex.company_name}. Laeuft im Hintergrund (~1-2 Min).`,
  };
}

async function pausePipeline(showId: string, supabase: SupabaseClient): Promise<ToolResult> {
  const { data: show } = await supabase
    .from("trade_shows")
    .select("status, current_step")
    .eq("id", showId)
    .single();

  if (!show) {
    return { summary: "Pipeline-Status nicht gefunden." };
  }

  let phase: string;

  if (["crawling", "queued"].includes(show.status ?? "")) {
    phase = show.current_step?.startsWith("listing") ? "listing" : "discovery";
  } else if (show.status === "ready") {
    const { count } = await supabase
      .from("exhibitors")
      .select("id", { count: "exact", head: true })
      .eq("trade_show_id", showId)
      .in("short_status", ["pending", "running"]);
    if (!count || count === 0) {
      return { summary: "Keine laufenden Short-Overviews gefunden (short_status pending/running). Pause nicht moeglich." };
    }
    phase = "short";
  } else {
    return { summary: `Pipeline ist nicht aktiv (Status: ${show.status ?? "unbekannt"}). Pause nicht moeglich.` };
  }

  await supabase
    .from("trade_shows")
    .update({ status: "paused", paused_phase: phase })
    .eq("id", showId);

  await tryAppendLog(supabase, showId, {
    phase,
    message: "Orchestrator: Pipeline pausiert",
  });

  return { summary: `Pipeline pausiert (Phase: ${phase}).` };
}

async function resumePipeline(showId: string, supabase: SupabaseClient): Promise<ToolResult> {
  const { data: show } = await supabase
    .from("trade_shows")
    .select("status, paused_phase")
    .eq("id", showId)
    .single();

  if (show?.status !== "paused") {
    return { summary: `Pipeline ist nicht pausiert (Status: ${show?.status ?? "unbekannt"}).` };
  }

  const phase = show.paused_phase ?? "listing";

  if (phase === "short") {
    await supabase
      .from("trade_shows")
      .update({ status: "ready", paused_phase: null })
      .eq("id", showId);
    await inngest.send({ name: "short-overview.bulk-requested", data: { tradeShowId: showId } });
  } else {
    await supabase
      .from("trade_shows")
      .update({ status: "crawling", paused_phase: null })
      .eq("id", showId);
    await inngest.send({ name: "trade-show.listing-requested", data: { tradeShowId: showId } });
  }

  await tryAppendLog(supabase, showId, {
    phase,
    message: `Orchestrator: Pipeline fortgesetzt (Phase: ${phase})`,
  });

  return { summary: `Pipeline fortgesetzt. Phase: ${phase}.` };
}

async function restartPipeline(showId: string, supabase: SupabaseClient): Promise<ToolResult> {
  await supabase.from("exhibitor_deep").delete().in(
    "exhibitor_id",
    (
      await supabase.from("exhibitors").select("id").eq("trade_show_id", showId)
    ).data?.map((r: { id: string }) => r.id) ?? [],
  );
  await supabase.from("exhibitor_short").delete().in(
    "exhibitor_id",
    (
      await supabase.from("exhibitors").select("id").eq("trade_show_id", showId)
    ).data?.map((r: { id: string }) => r.id) ?? [],
  );
  await supabase.from("exhibitors").delete().eq("trade_show_id", showId);

  await supabase
    .from("trade_shows")
    .update({ status: "queued", current_step: null, error_message: null, paused_phase: null })
    .eq("id", showId);

  await tryAppendLog(supabase, showId, {
    phase: "listing",
    message: "Orchestrator: Pipeline-Reset durchgefuehrt, starte Listing neu",
  });

  await inngest.send({ name: "trade-show.listing-requested", data: { tradeShowId: showId } });

  return { summary: "Pipeline neu gestartet: alle Aussteller-Daten geloescht, Listing laeuft." };
}
