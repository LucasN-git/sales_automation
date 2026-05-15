import { ISP_CATALOG } from "./isp-catalog";
import {
  SHORT_SYSTEM_DEFAULT,
  SHORT_USER_TEMPLATE_DEFAULT,
  DEEP_SYSTEM_DEFAULT,
  DEEP_USER_TEMPLATE_DEFAULT,
  CHAT_SYSTEM_DEFAULT,
  SHORT_MAX_TOKENS_DEFAULT,
  SHORT_MAX_INPUT_CHARS_DEFAULT,
  DEEP_MAX_TOKENS_DEFAULT,
  DEEP_MAX_INPUT_CHARS_DEFAULT,
  CHAT_MAX_TOKENS_DEFAULT,
  CHAT_WEB_SEARCH_MAX_USES_DEFAULT,
  COMPETITOR_DISCOVERY_MODEL_DEFAULT,
  COMPETITOR_DISCOVERY_SYSTEM_DEFAULT,
  COMPETITOR_DISCOVERY_USER_TEMPLATE_DEFAULT,
  COMPETITOR_DISCOVERY_MAX_TOKENS_DEFAULT,
  COMPETITOR_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT,
  SHOW_DISCOVERY_SYSTEM_DEFAULT,
  SHOW_DISCOVERY_MAX_TOKENS_DEFAULT,
  SHOW_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT,
} from "./claude";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppSettings = {
  user_id: string;
  prio_context: string;
  short_model: string;
  deep_model: string;
  /** NULL = Code-Default aus lib/claude.ts. */
  short_system_prompt: string | null;
  short_user_template: string | null;
  deep_system_prompt: string | null;
  deep_user_template: string | null;
  short_max_tokens: number | null;
  short_max_input_chars: number | null;
  deep_max_tokens: number | null;
  deep_max_input_chars: number | null;
  chat_system_prompt: string | null;
  chat_max_tokens: number | null;
  chat_web_search_max_uses: number | null;
  // Competitor-Analysis (Phase 9). NULL = Code-Default.
  competitor_short_model: string | null;
  competitor_deep_model: string | null;
  competitor_discovery_model: string | null;
  competitor_discovery_system_prompt: string | null;
  competitor_discovery_user_template: string | null;
  competitor_short_system_prompt: string | null;
  competitor_short_user_template: string | null;
  competitor_deep_system_prompt: string | null;
  competitor_deep_user_template: string | null;
  competitor_short_max_tokens: number | null;
  competitor_deep_max_tokens: number | null;
  competitor_discovery_max_tokens: number | null;
  competitor_short_web_search_max_uses: number | null;
  competitor_deep_web_search_max_uses: number | null;
  competitor_discovery_max_web_searches: number | null;
  // Show Discovery (Phase 10). NULL = Code-Default.
  show_discovery_system_prompt: string | null;
  show_discovery_max_web_searches: number | null;
  show_discovery_max_tokens: number | null;
  updated_at: string;
};

export const SHORT_MODEL_DEFAULT = "claude-haiku-4-5-20251001";
export const DEEP_MODEL_DEFAULT = "claude-sonnet-4-6";

export function defaultShortSystemPrompt(): string {
  return SHORT_SYSTEM_DEFAULT;
}
export function defaultShortUserTemplate(): string {
  return SHORT_USER_TEMPLATE_DEFAULT;
}
export function defaultDeepSystemPrompt(): string {
  return DEEP_SYSTEM_DEFAULT;
}
export function defaultDeepUserTemplate(): string {
  return DEEP_USER_TEMPLATE_DEFAULT;
}
export function defaultChatSystemPrompt(): string {
  return CHAT_SYSTEM_DEFAULT;
}

export const PARAM_DEFAULTS = {
  short_max_tokens: SHORT_MAX_TOKENS_DEFAULT,
  short_max_input_chars: SHORT_MAX_INPUT_CHARS_DEFAULT,
  deep_max_tokens: DEEP_MAX_TOKENS_DEFAULT,
  deep_max_input_chars: DEEP_MAX_INPUT_CHARS_DEFAULT,
  chat_max_tokens: CHAT_MAX_TOKENS_DEFAULT,
  chat_web_search_max_uses: CHAT_WEB_SEARCH_MAX_USES_DEFAULT,
} as const;

export const PARAM_BOUNDS = {
  short_max_tokens: { min: 100, max: 8000 },
  short_max_input_chars: { min: 500, max: 200_000 },
  deep_max_tokens: { min: 200, max: 16000 },
  deep_max_input_chars: { min: 1000, max: 500_000 },
  chat_max_tokens: { min: 200, max: 16000 },
  chat_web_search_max_uses: { min: 0, max: 20 },
} as const;

/**
 * Auto-generated default Prio-Kontext from the brand bible.
 * Editable im Account-Drawer.
 */
export function defaultPrioContext(): string {
  const sectors = ISP_CATALOG.sectors
    .map((s) => `- ${s.name} (${s.id}): ${s.scope}`)
    .join("\n");
  const lifecycle = ISP_CATALOG.lifecycle
    .map((l) => `- ${l.step} ${l.name} (${l.id})`)
    .join("\n");
  const diffs = ISP_CATALOG.differentiators.map((d) => `- ${d}`).join("\n");

  return `# ISP Power Systems — Prio-Kontext

Diese Beschreibung steuert, wie Aussteller bewertet und gematcht werden.
Bearbeite freitext, was hier steht; Sektor-/Lifecycle-IDs in den eckigen Klammern sind kanonisch und sollten so bleiben.

## Positioning
${ISP_CATALOG.positioning}

## Zielsektoren (kanonische IDs)
${sectors}

## Lifecycle-Capabilities (kanonische IDs)
${lifecycle}

## Differentiators
${diffs}

## Hoch-Signale (priority_label = "hoch")
- Aussteller baut elektrische/batteriegetriebene Hardware in einem unserer Sektoren
- Custom-Battery-Pack-Bedarf erkennbar (eigene Plattform, eigenes Form-Faktor)
- Validation/Test-Bedarf erwaehnt (Climate, Abuse, Lifetime)
- Anwendung ist Defense, Aerospace, Mobile-Robotics, Space, Maritime, alternative Mobility

## Mittel-Signale (priority_label = "mittel")
- Aussteller in benachbartem Bereich (Robotik allgemein, Industrie-IoT, Logistik) mit potenziellem Power-Bedarf
- Reseller / Integrator von Batterie-Systemen (kein direkter Customer, aber Channel)
- Forschungseinrichtung mit Cell/Pack/Test-Themen

## Niedrig-Signale (priority_label = "niedrig")
- reine Software, Services, Consulting ohne Hardware-Bezug
- reine Munitions-/Waffen-Hersteller ohne elektrifizierte Plattform
- Textil/Bekleidung, Messe-Veranstalter selbst, Verbaende

## Disqualifier (match_confidence <= 10)
- Cybersecurity, IT-Services, Versicherungen
- Endkunden-Konsumprodukte ohne Industrial-Anwendung
- Themen die offensichtlich nichts mit Energy-Storage oder elektrifizierten Antrieben zu tun haben

## Groesse-Heuristik (zweiter Score-Modulator nach Sektor-Match)

ISP verkauft an Firmen, die Power-System-Entwicklung auslagern. Die Firmen-Groesse ist der dominante Score-Modulator NACH dem Sektor-Match:

- **Grosskonzern (>5000 MA, eigene R&D-/Power-Abteilung):** typischerweise eine Stufe runter (von hot auf warm, von warm auf cold), weil interne Entwicklung statt Auslagerung. Beispiel: Airbus Defence, Rheinmetall, Lockheed bauen Power-Systeme weitgehend in-house. Ausnahme: spezifische Power-Nische, in der die Konzern-Abteilung nicht aufgestellt ist.
- **Mid-Size (50-5000 MA), insb. Defense-OEMs und Tier-1-Zulieferer:** Sweet Spot. Hoechste Outsourcing-Bereitschaft, ausreichend Budget, oft keine eigene Power-Engineering-Abteilung.
- **Startup (<50 MA, oft VC-finanzierte Defense-Tech / Robotik / UAV):** oft hot, aber Budget-Caution: pruefen ob Funding/Series-Stage erkennbar ist.

## Bekanntheits-Faktor (sekundaer, leicht)

Der Vertriebsleiter kennt die prominenten Player im deutschen/europaeischen Defense- und Industrie-Power-Markt bereits aus seinem Sales-Alltag. Sehr bekannte Firmen sind als Lead weniger wertvoll, weil sie eh schon im Sales-Radar sind.

- Sehr prominent (Helsing, Rheinmetall, Airbus, BAE Systems, KNDS, MBDA, Diehl, Saab, Lockheed Martin, BMW, Bosch, Siemens, ThyssenKrupp Marine, Hensoldt etc.): Score -5 bis -10.
- Unbekanntere Mid-Size-Firmen mit gutem Sektor-Match: leicht +5.
- Bekanntheit ueberstimmt Sektor-Match und Groesse NIE; sie verschiebt den Score nur am Rand.
- Bekanntheits-Bewertung gehoert primaer in die reasoning_bullets, nicht in den Score selbst.`;
}

export async function getSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as AppSettings;

  // Initialise with defaults on first read
  const seed = {
    user_id: userId,
    prio_context: defaultPrioContext(),
    short_model: SHORT_MODEL_DEFAULT,
    deep_model: DEEP_MODEL_DEFAULT,
  };
  const { data: created, error } = await supabase
    .from("app_settings")
    .insert(seed)
    .select("*")
    .single();
  if (error) throw new Error(`init settings failed: ${error.message}`);
  return created as AppSettings;
}

/**
 * Service-role variant: looks up the FIRST app_settings row (single-user app).
 * Used by Inngest workers that have no user-cookie.
 */
export async function getSettingsServiceRole(
  supabase: SupabaseClient,
): Promise<AppSettings | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AppSettings | null) ?? null;
}

export async function updatePrioContext(
  supabase: SupabaseClient,
  userId: string,
  prioContext: string,
): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .update({ prio_context: prioContext })
    .eq("user_id", userId);
  if (error) throw new Error(`update prio_context: ${error.message}`);
}

export async function updateModels(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<Pick<AppSettings, "short_model" | "deep_model">>,
): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .update(patch)
    .eq("user_id", userId);
  if (error) throw new Error(`update models: ${error.message}`);
}

type PromptField =
  | "short_system_prompt"
  | "short_user_template"
  | "deep_system_prompt"
  | "deep_user_template"
  | "chat_system_prompt"
  | "show_discovery_system_prompt";

export async function updatePrompts(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<Record<PromptField, string | null>>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("app_settings")
    .update(patch)
    .eq("user_id", userId);
  if (error) throw new Error(`update prompts: ${error.message}`);
}

type ParamField = keyof typeof PARAM_DEFAULTS;

export async function updateParams(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<Record<ParamField, number | null>>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase
    .from("app_settings")
    .update(patch)
    .eq("user_id", userId);
  if (error) throw new Error(`update params: ${error.message}`);
}

/**
 * Liefert den effektiven Prompt-Text fuer Short/Deep: User-Override aus
 * app_settings wenn vorhanden, sonst den Code-Default. Wird im Inngest-
 * Worker und im Account-Drawer als Initial-Wert verwendet.
 */
export function effectivePrompts(s: AppSettings) {
  return {
    short_system: s.short_system_prompt ?? SHORT_SYSTEM_DEFAULT,
    short_user_template: s.short_user_template ?? SHORT_USER_TEMPLATE_DEFAULT,
    deep_system: s.deep_system_prompt ?? DEEP_SYSTEM_DEFAULT,
    deep_user_template: s.deep_user_template ?? DEEP_USER_TEMPLATE_DEFAULT,
  };
}

/**
 * Effektive Discovery-Settings fuer den Competitor-Discovery-Inngest-Worker.
 * NULL-Werte fallen auf Code-Defaults aus lib/claude.ts zurueck.
 */
export function effectiveCompetitorDiscovery(s: AppSettings) {
  return {
    model: s.competitor_discovery_model ?? COMPETITOR_DISCOVERY_MODEL_DEFAULT,
    system_prompt:
      s.competitor_discovery_system_prompt ?? COMPETITOR_DISCOVERY_SYSTEM_DEFAULT,
    user_template:
      s.competitor_discovery_user_template ??
      COMPETITOR_DISCOVERY_USER_TEMPLATE_DEFAULT,
    max_tokens:
      s.competitor_discovery_max_tokens ?? COMPETITOR_DISCOVERY_MAX_TOKENS_DEFAULT,
    max_web_searches:
      s.competitor_discovery_max_web_searches ??
      COMPETITOR_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT,
  };
}

/**
 * Effektive Settings fuer den Show-Discovery-Inngest-Worker (Phase 10).
 * Modell ist immer Opus 4.7 — kein User-Override vorgesehen.
 */
export function effectiveShowDiscovery(s: AppSettings) {
  return {
    system_prompt: s.show_discovery_system_prompt ?? SHOW_DISCOVERY_SYSTEM_DEFAULT,
    max_tokens: s.show_discovery_max_tokens ?? SHOW_DISCOVERY_MAX_TOKENS_DEFAULT,
    max_web_searches: s.show_discovery_max_web_searches ?? SHOW_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT,
  };
}
