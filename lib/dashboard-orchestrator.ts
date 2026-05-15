import type { SupabaseClient } from "@supabase/supabase-js";
import { inngest } from "@/lib/inngest/client";
import { CompetitorDiscoveryRequestSchema } from "@/lib/competitors/schemas";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const DASHBOARD_ORCHESTRATOR_SYSTEM_PROMPT = `Du bist der Lifecycle-Orchestrator fuer das ISP Power Systems Sales-Intelligence-Tool. Du wirst aus dem Dashboard heraus benutzt — also bevor irgendeine konkrete Messe oder Firma im Fokus ist. Deine Rollen:

1. **Lifecycle-Controller:** Du legst neue Messen an (create_trade_show), startest Messen-Discovery (start_show_discovery, sucht Messen via Web-Search) oder Konkurrenten-Discovery (start_competitor_discovery). Du arbeitest mit Tool-Calls.

2. **Gespraechtpartner:** Du beantwortest uebergreifende Fragen (wie viele Messen, wie viele Firmen, wo gibt es Engpaesse), erklaerst was die Tools machen, schlaegst die naechsten sinnvollen Schritte vor.

## Was du NICHT kannst (und stattdessen weiterleitest)

- **Pipeline-Steuerung einer einzelnen Messe** (Discovery-Run, Listing, Short-Overview, Deep-Dive, Pause, Restart, Aussteller-CRUD): Das passiert im Show-Chat. Wechsle den Bereich, indem du dem User vorschlaegst die Messe zu oeffnen.
- **Aussteller- oder Firmen-Detailfragen:** Verweise auf den Companies-Bereich oder die jeweilige Messen-Detail-Seite.
- **Konkurrenten-Kuratierung:** Verweise auf den Konkurrenten-Bereich.

## create_trade_show

Ruft das Bestaetigungs-Widget auf. Erforderlich: name. Optional: source_url (Aussteller-Listing-URL), year. Wenn der User eine URL gibt, packe sie in source_url. Wenn nicht, ist das OK (User kann sie spaeter setzen). Vor dem Tool-Call IMMER eine kurze Zusammenfassung anzeigen ("Ich lege an: Enforce Tac 2026, Quelle: ...") und dann auf das Widget verweisen.

## start_show_discovery

Triggert eine Web-Search-basierte Suche nach passenden Messen. User-Prompt geht 1:1 weiter ("relevante Defense-Messen 2026 in Europa"). Kostenschaetzung: ~0.20 EUR pro Lauf. Vor dem Tool-Call die Kosten einmal nennen. Ergebnis: Kandidaten erscheinen unter /shows/search.

## start_competitor_discovery

Triggert einen Konkurrenten-Discovery-Lauf (Web-Search). Optionale Filter: sector_focus, region_focus, target_count (5-50, default 20), notes. Kostenschaetzung: ~0.15-0.30 EUR. Vor dem Tool-Call die Kosten einmal nennen. Ergebnis: neue 'suggested'-Konkurrenten unter /competitors.

## Stil-Regeln

- Sprache: Deutsch
- **Keine Em-Dashes (—):** Verwende Komma, Punkt oder Klammer.
- **Ton:** Sachlich, direkt, keine Superlative. Kurze Saetze.
- Wenn der User vage bleibt ("starte was"), frag nach was er konkret will.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const DASHBOARD_TOOL_DEFS = [
  {
    name: "create_trade_show",
    description:
      "Legt eine neue Messe an. Loest ein Bestaetigungs-Widget aus, der User muss explizit bestaetigen. Nach Bestaetigung wird die Messe in trade_shows angelegt und das UI navigiert zur neuen Messen-Seite (wo der Show-Chat uebernimmt).",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Messe-Name (z.B. 'Enforce Tac 2026')." },
        source_url: {
          type: "string",
          description: "Optional: URL der Aussteller-Listing-Seite. Kann spaeter gesetzt werden.",
        },
        year: { type: "integer", description: "Optional: Jahr der Messe (z.B. 2026)." },
        reason: { type: "string", description: "Kurze Begruendung fuer das Widget (warum diese Messe)." },
      },
      required: ["name", "reason"],
    },
  },
  {
    name: "start_show_discovery",
    description:
      "Startet eine Web-Search-Recherche nach passenden Messen. Nimmt den User-Prompt 1:1. Kosten ~0.20 EUR. Die Kandidaten erscheinen anschliessend unter /shows/search und koennen dort akzeptiert werden.",
    input_schema: {
      type: "object" as const,
      properties: {
        user_prompt: {
          type: "string",
          description: "Was gesucht werden soll (z.B. 'Defense-Messen 2026 in Europa').",
        },
      },
      required: ["user_prompt"],
    },
  },
  {
    name: "start_competitor_discovery",
    description:
      "Startet eine Web-Search-Recherche nach Konkurrenten. Kosten ~0.15-0.30 EUR. Die Kandidaten erscheinen anschliessend unter /competitors als 'suggested'.",
    input_schema: {
      type: "object" as const,
      properties: {
        sector_focus: {
          type: "array",
          items: { type: "string" },
          description: "Optional: Sektor-IDs (defense | aeronautics | mobile_robotics | space | maritime | mobility).",
        },
        region_focus: {
          type: "string",
          description: "Optional: Region (z.B. 'Europa', 'DACH').",
        },
        target_count: {
          type: "integer",
          description: "Wie viele Kandidaten (5-50). Default 20.",
        },
        notes: { type: "string", description: "Optional: zusaetzliche Hinweise." },
      },
      required: [],
    },
  },
] as const;

export const DASHBOARD_TOOL_NAMES: Set<string> = new Set(
  DASHBOARD_TOOL_DEFS.map((t) => t.name),
);

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export type DashboardToolResult = { summary: string; detail?: Record<string, unknown> };

export type DashboardToolName =
  | "create_trade_show"
  | "start_show_discovery"
  | "start_competitor_discovery";

export async function executeDashboardTool(
  toolName: string,
  input: unknown,
  userId: string,
  supabase: SupabaseClient,
): Promise<DashboardToolResult> {
  switch (toolName as DashboardToolName | string) {
    case "create_trade_show": {
      const { name, source_url, year, reason } = (input ?? {}) as {
        name?: string;
        source_url?: string;
        year?: number;
        reason?: string;
      };
      if (!name || name.trim().length < 2) {
        return { summary: "create_trade_show: name fehlt oder zu kurz." };
      }
      const previewItems = [name.trim()];
      if (source_url) previewItems.push(`Quelle: ${source_url}`);
      if (year) previewItems.push(`Jahr: ${year}`);
      return {
        summary: `Bestaetigung ausstehend: Messe "${name.trim()}" anlegen. Weise den User auf das Bestaetigungs-Widget hin.`,
        detail: {
          confirmation_request: {
            action_type: "create_trade_show",
            description: `Messe anlegen — ${reason ?? "kein Grund angegeben"}`,
            preview_items: previewItems,
            count: 1,
            payload: {
              name: name.trim(),
              source_url: source_url ?? null,
              year: year ?? null,
            },
          },
        },
      };
    }

    case "start_show_discovery": {
      const { user_prompt } = (input ?? {}) as { user_prompt?: string };
      if (!user_prompt || user_prompt.trim().length < 3) {
        return { summary: "start_show_discovery: user_prompt fehlt." };
      }
      const { data: run, error } = await supabase
        .from("show_discovery_runs")
        .insert({
          user_id: userId,
          status: "pending",
          user_prompt: user_prompt.trim(),
        })
        .select("id")
        .single();
      if (error || !run) {
        return { summary: `Show-Discovery konnte nicht gestartet werden: ${error?.message ?? "unbekannt"}.` };
      }
      await inngest.send({
        name: "show.discovery.requested",
        data: {
          userId,
          runId: (run as { id: string }).id,
          userPrompt: user_prompt.trim(),
        },
      });
      return {
        summary: `Show-Discovery gestartet (run ${(run as { id: string }).id.slice(0, 8)}). Laeuft im Hintergrund (~5-10 Min). Ergebnisse erscheinen unter /shows/search.`,
        detail: { run_id: (run as { id: string }).id },
      };
    }

    case "start_competitor_discovery": {
      const parsed = CompetitorDiscoveryRequestSchema.safeParse(input ?? {});
      if (!parsed.success) {
        return {
          summary: `start_competitor_discovery: ungueltige Argumente (${parsed.error.issues
            .map((i) => i.message)
            .join("; ")}).`,
        };
      }
      const { data: run, error } = await supabase
        .from("competitor_discovery_runs")
        .insert({
          user_id: userId,
          status: "pending",
        })
        .select("id")
        .single();
      if (error || !run) {
        return { summary: `Konkurrenten-Discovery konnte nicht gestartet werden: ${error?.message ?? "unbekannt"}.` };
      }
      await inngest.send({
        name: "competitor.discovery.requested",
        data: {
          userId,
          runId: (run as { id: string }).id,
          request: parsed.data,
        },
      });
      const filterNote = [
        parsed.data.sector_focus?.length ? `Sektoren: ${parsed.data.sector_focus.join(", ")}` : null,
        parsed.data.region_focus ? `Region: ${parsed.data.region_focus}` : null,
        parsed.data.target_count ? `Ziel: ${parsed.data.target_count} Kandidaten` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        summary: `Konkurrenten-Discovery gestartet${filterNote ? ` (${filterNote})` : ""}. Laeuft im Hintergrund (~10-15 Min). Kandidaten erscheinen unter /competitors als suggested.`,
        detail: { run_id: (run as { id: string }).id },
      };
    }

    default:
      return { summary: `Unbekanntes Tool: ${toolName}` };
  }
}
