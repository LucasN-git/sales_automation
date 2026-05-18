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
  /**
   * User-Anleitung als Markdown. Wird NICHT in den Default-System-Prompts
   * mitgeschickt — die Orchestrator-Chats laden sie per `read_handbook`-Tool
   * nur dann, wenn der User Fragen zur Funktionsweise des Tools stellt.
   * NULL = Code-Default aus HANDBOOK_DEFAULT.
   */
  handbook: string | null;
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

/**
 * Default-Anleitung fuer das Sales-Intelligence-Tool. Wird per `read_handbook`-
 * Tool von den Orchestrator-Chats bei Bedarf geladen. Ist im Account-Drawer
 * vollstaendig editierbar — User kann eigene Workflows, Notizen, FAQ-Antworten
 * hinterlegen, ohne dass der Inhalt im Default-Kontext mitlaeuft.
 */
export const HANDBOOK_DEFAULT = `# Anleitung — ISP Sales-Intelligence-Tool

Dieses Dokument wird von den Chat-Assistenten in der App nur bei Bedarf abgerufen
(via Tool \`read_handbook\`). Hier kannst du eintragen, was die Chats ueber das
Tool, ueber typische Workflows und ueber dich als User wissen sollen, OHNE dass
es jede Anfrage mitkostet.

## Was dieses Tool macht

Das Tool unterstuetzt den Vertrieb bei der Recherche und Bewertung von Leads.
Du gibst die URL einer Messe oder einer Aussteller-Liste an, und die Pipeline
holt automatisch alle Aussteller, recherchiert pro Firma das Geschaeftsfeld,
matcht es gegen den ISP-Power-Systems-Capability-Katalog und liefert pro Lead
einen Pitch-Hook. Zusaetzlich findet das Tool relevante Messen (Show-Discovery)
und analysiert Wettbewerber (Konkurrenten).

## Module-Uebersicht

- **Dashboard** — Startseite mit Zahlen-Ueberblick und Quick-Links.
- **Messen** — Liste aller Messen. Pro Messe gibt es Aussteller, Pipeline-Status,
  Kosten, Logs.
- **Aussteller (in einer Messe)** — die Firmen, die du auf der Messe gefunden
  hast. Werden in einer Pipeline angereichert: kurze Einschaetzung (Short) und
  ausfuehrliches Lead-Profil (Deep-Dive).
- **Unternehmen (cross-show)** — alle Firmen aus allen Messen, dedupliziert.
  Hier siehst du, wenn dieselbe Firma auf mehreren Messen auftritt.
- **Konkurrenten** — Wettbewerber-Recherche. Per Web-Suche werden Kandidaten
  vorgeschlagen, du akzeptierst oder verwirfst.
- **Messen suchen** — entdeckt neue Messen via Web-Suche. Liefert Kandidaten
  mit Relevanz-Score und Aussteller-Listen-URL.
- **Kosten** — wie viel Token und Web-Suche pro Messe / Konkurrenten / Discovery.

## Pipeline-Phasen pro Messe

1. **Discovery** — kurze Voranalyse der Aussteller-Listen-URL. Entscheidet, wie
   gescraped werden soll.
2. **Listing** — alle Aussteller werden eingelesen.
3. **Profile-Enrich** — falls die Messe pro Aussteller eine Detail-Seite hat,
   wird die Website automatisch gefunden.
4. **URL-Search** — fuer Aussteller ohne Website wird via Web-Suche die offizielle
   Website + LinkedIn gesucht.
5. **Short-Overview** — pro Aussteller wird die Website kurz analysiert. Ergebnis:
   one_liner, Prio (hoch/mittel/niedrig), Match-Confidence, Sektoren.
6. **Deep-Dive** — nur auf Anfrage. Liefert business_summary, decision_makers,
   recent_news, technical_pain_points, opening_questions.

## Status-Werte

**Messe (trade_shows.status):**
- \`queued\` — wartet auf Start
- \`crawling\` — laeuft gerade
- \`ready\` — fertig
- \`partial\` — weniger Aussteller als erwartet gefunden
- \`paused\` — pausiert (du hast \`pause_pipeline\` getriggert)
- \`failed\` — Fehler, siehe Log-Tab

**Aussteller-Short (exhibitors.short_status):**
- \`pending\` — noch nicht gestartet
- \`running\` — laeuft
- \`done\` — Short-Analyse vorhanden
- \`failed\` — Fehler beim Scrapen oder bei der LLM-Analyse
- \`url_not_found\` — keine Website gefunden, Short nicht moeglich

**Aussteller-Deep (exhibitors.deep_status):** \`pending\` → \`running\` → \`done\`/\`failed\`.

**Aussteller-URL-Search (exhibitors.url_search_status):**
- \`skipped\` — hatte schon eine Website aus dem Listing
- \`pending\`/\`running\`/\`done\` — Web-Suche laeuft/lief
- \`url_not_found\` — auch via Web-Suche keine Website gefunden
- \`failed\` — Web-Suche fehlgeschlagen, Short laeuft trotzdem ohne Website

## Typische Workflows

**Neue Messe anlegen:** Im Messen-Modul "Messe hinzufuegen" → URL der Aussteller-
Liste angeben → Discovery laeuft automatisch. Danach im Chat \`trigger_listing\`
oder einfach "alle Aussteller einlesen" sagen.

**Aussteller bewerten:** Wenn das Listing fertig ist, im Chat sagen "Short-Overview
fuer alle starten". Der Vorgang dauert je nach Anzahl 10-50 Minuten und kostet
ein paar Euro. Danach kannst du nach Prio "hoch" filtern.

**Deep-Dive fuer einen Lead:** Auf einen Aussteller klicken, im Chat "Deep-Dive
starten". Dauert ~30 Sekunden, kostet ~0.10-0.20 EUR. Liefert Gespraechs-
Munition fuer den ersten Call.

**Konkurrent recherchieren:** Im Konkurrenten-Modul "Discovery starten". Web-Suche
laeuft ~1-2 Minuten. Kandidaten erscheinen als "suggested", du musst sie
explizit als "active" markieren.

**Neue Messen finden:** Im Messen-Suchen-Modul Prompt eingeben, z.B. "Defense-
Messen 2026 in Europa". Web-Suche dauert ~1-2 Minuten, Kandidaten erscheinen
mit Relevanz-Score.

## Kosten — wo entsteht was

- **Short-Overview** (Haiku 4.5): ~0.03 EUR pro Aussteller (Tokens + Firecrawl-Scrape + ggf. URL-Search). Bei 1000 Ausstellern: ~30 EUR.
- **Deep-Dive** (Sonnet 4.6): ~0.05-0.15 EUR pro Lead (je nach Inputgroesse und Firecrawl).
- **Konkurrenten-Discovery** (Web-Suche): ~0.15-0.30 EUR pro Lauf.
- **Messen-Suche** (Opus + Web-Suche): ~0.20 EUR pro Lauf.
- **Chat selbst**: typisch < 0.05 EUR pro Nachricht.

Alle Kosten siehst du im Kosten-Tab (pro Messe) und unter /costs (global).

## FAQ

**Warum ist mein Aussteller \`url_not_found\`?**
Weder das Listing noch die Web-Suche haben eine Website gefunden. Manchmal sind
das nur kleine Aussteller ohne eigene Online-Praesenz. Du kannst die Website
manuell im Detail-Editor eintragen, dann den Chat "Short neu rechnen" lassen.

**Wieso pausiert die Pipeline?**
Entweder du hast \`pause_pipeline\` getriggert (im Chat oder UI), oder ein Rate-
Limit wurde erreicht. Ein \`resume_pipeline\` startet die naechste offene Phase.

**Wann sollte ich Deep-Dive triggern?**
Nur fuer Aussteller mit Prio "hoch" (oder ggf. "mittel"). Deep-Dive ist 5-10x
teurer als Short. Auf 1000 Ausstellern alle Deep-Dives zu rechnen waere
prohibitiv.

**Was passiert, wenn ich eine Messe neu starte?**
\`restart_pipeline\` loescht ALLE Aussteller dieser Messe und startet das
Listing neu. Verwende es nur, wenn die Aussteller-Liste sich grundlegend
geaendert hat. Sonst reicht \`re-listing\` (im Toolbar).

**Wieso sehe ich die gleiche Firma auf mehreren Messen?**
Das ist Absicht — Aussteller leben pro Messe, Companies sind cross-show
dedupliziert. Im Unternehmen-Modul siehst du die zusammengefasste Sicht.`;

export function defaultHandbook(): string {
  return HANDBOOK_DEFAULT;
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

  const seed = {
    user_id: userId,
    prio_context: defaultPrioContext(),
    short_model: SHORT_MODEL_DEFAULT,
    deep_model: DEEP_MODEL_DEFAULT,
  };
  const { error: upsertError } = await supabase
    .from("app_settings")
    .upsert(seed, { onConflict: "user_id", ignoreDuplicates: true });
  if (upsertError) throw new Error(`init settings failed: ${upsertError.message}`);

  const { data: row, error: refetchError } = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (refetchError || !row) {
    throw new Error(`init settings failed: ${refetchError?.message ?? "no row after upsert"}`);
  }
  return row as AppSettings;
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

export async function updateHandbook(
  supabase: SupabaseClient,
  userId: string,
  handbook: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .update({ handbook })
    .eq("user_id", userId);
  if (error) throw new Error(`update handbook: ${error.message}`);
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

/**
 * Effektives Handbuch: User-Override aus app_settings, sonst Code-Default.
 * Wird vom `read_handbook`-Tool in allen Orchestratoren genutzt — der Inhalt
 * landet ausschliesslich als Tool-Response im Chat, nie im Default-System-Prompt.
 */
export function effectiveHandbook(s: AppSettings): string {
  const trimmed = s.handbook?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : HANDBOOK_DEFAULT;
}
