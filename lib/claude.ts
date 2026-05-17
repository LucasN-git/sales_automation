import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { catalogAsPromptBlock, SECTOR_IDS, LIFECYCLE_IDS } from "./isp-catalog";
import type { CrawlStateBlock } from "./crawl-log";
import { priceForChat } from "./pricing";
import {
  COMPETITOR_DISCOVERY_INPUT_SCHEMA,
  CompetitorDiscoveryOutputSchema,
  type CompetitorDiscoveryOutput,
  type CompetitorDiscoveryRequest,
} from "./competitors/schemas";

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export type Usage = { tokens_in: number; tokens_out: number };

/** Code-Default-Parameter pro Task. App_settings darf jeweils ueberschreiben. */
export const SHORT_MAX_TOKENS_DEFAULT = 1100;
export const SHORT_MAX_INPUT_CHARS_DEFAULT = 10_000;
export const DEEP_MAX_TOKENS_DEFAULT = 3000;
export const DEEP_MAX_INPUT_CHARS_DEFAULT = 30_000;
export const CHAT_MAX_TOKENS_DEFAULT = 2500;
export const CHAT_WEB_SEARCH_MAX_USES_DEFAULT = 5;

function pickInt(
  override: number | null | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof override !== "number" || !Number.isFinite(override)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(override)));
}

/**
 * Render the per-exhibitor stammdaten block that goes into both short and
 * deep prompts. Pulls fields out of the loose profile_data jsonb so we don't
 * have to hard-code organiser-specific shapes elsewhere. Empty fields are
 * omitted entirely so the prompt stays compact for cache-hits.
 */
function formatProfileForPrompt(input: {
  website: string | null;
  booth: string | null;
  profileUrl: string | null;
  profileData: Record<string, unknown> | null;
  linkedinUrl?: string | null;
}): string {
  const lines: string[] = [];
  if (input.booth) lines.push(`Stand: ${input.booth}`);

  const pd = input.profileData ?? {};
  const addr = pd.address as Record<string, string> | undefined;
  if (addr) {
    const parts = [addr.street, addr.postcode && addr.city ? `${addr.postcode} ${addr.city}` : addr.city, addr.country]
      .filter(Boolean)
      .join(", ");
    if (parts) lines.push(`Adresse: ${parts}`);
  }
  if (typeof pd.email === "string") lines.push(`Email: ${pd.email}`);
  if (typeof pd.phone === "string") lines.push(`Telefon: ${pd.phone}`);
  if (typeof pd.companyType === "string") lines.push(`Typ: ${pd.companyType}`);
  if (typeof pd.slogan === "string") lines.push(`Slogan: ${pd.slogan}`);
  if (typeof pd.companyDescription === "string")
    lines.push(`Beschreibung (vom Veranstalter): ${pd.companyDescription}`);
  if (typeof pd.employee_estimate === "string")
    lines.push(`Mitarbeiterzahl (Web-Suche): ${pd.employee_estimate}`);
  if (typeof pd.search_description === "string")
    lines.push(`Kurzbeschreibung (Web-Suche): ${pd.search_description}`);

  const cats = pd.categories;
  if (Array.isArray(cats) && cats.length > 0) {
    lines.push(`Kategorien (vom Veranstalter klassifiziert):`);
    for (const c of cats.slice(0, 12)) lines.push(`  - ${c}`);
  }
  const products = pd.products;
  if (Array.isArray(products) && products.length > 0) {
    lines.push(`Produkte/Services: ${products.slice(0, 10).join(", ")}`);
  }
  const keywords = pd.keyword;
  if (Array.isArray(keywords) && keywords.length > 0) {
    lines.push(`Keywords: ${keywords.slice(0, 15).join(", ")}`);
  }
  const co = pd.coExhibitors;
  if (Array.isArray(co) && co.length > 0) {
    lines.push(`Co-Aussteller: ${co.slice(0, 5).join(", ")}`);
  }

  if (input.website) lines.push(`Externe Website: ${input.website}`);
  else lines.push(`Externe Website: (keine angegeben)`);
  if (input.linkedinUrl) lines.push(`LinkedIn: ${input.linkedinUrl}`);
  if (input.profileUrl) lines.push(`Messe-Profil: ${input.profileUrl}`);

  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}

const sectorEnum = z.enum(SECTOR_IDS);
const lifecycleEnum = z.enum(LIFECYCLE_IDS);

// ---------- SHORT ----------

export const USER_GROUP_VALUES = [
  "UAV/Drohnen",
  "Mobile Robotik/UGV",
  "Counter-Drone/Radar",
  "Optik/Sensorik/Payload",
  "Kommunikation/Elektronik",
  "Energie/Batterien",
  "Fahrzeuge/Mobility",
  "Schiffe/Maritime",
  "Luftfahrt/Aerospace",
  "Space",
  "Ruestung/Waffensysteme",
  "Industrie/Sonstiges",
] as const;

export const BATTERY_NEED_VALUES = ["sehr_hoch", "hoch", "mittel", "gering", "keiner"] as const;
export const DRONE_RELEVANCE_VALUES = ["Ja", "Ja (UGV)", "Counter-Drone", "indirekt", "Nein"] as const;

export const ShortIntelSchema = z.object({
  one_liner: z
    .string()
    .describe("1 Satz auf Deutsch: was die Firma macht. Konkret, kein Marketing-Sprech."),
  priority_label: z
    .enum(["hoch", "mittel", "niedrig"])
    .describe("Prio-Einordnung gemäß Prio-Kontext."),
  match_confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("0–100. Wie sehr passt die Firma zur ISP-Capability."),
  isp_sector_match: z
    .array(sectorEnum)
    .max(2)
    .describe("0–2 ISP-Sektoren. Leer wenn kein Match."),
  reasoning_bullets: z
    .string()
    .describe(
      "3-6 Bullet-Points (Markdown '- ...') mit den Faktoren, die den Score erklaeren. Jeder Bullet: max 1 Satz, max 15 Woerter, endet mit Quellen-Tag [Website], [Web-Suche], [Messe-Profil] oder [Claude-Wissen].",
    ),
  user_group: z
    .enum(USER_GROUP_VALUES)
    .describe(
      "Kategorie des Unternehmens: UAV/Drohnen, Mobile Robotik/UGV, Counter-Drone/Radar, Optik/Sensorik/Payload, Kommunikation/Elektronik, Energie/Batterien, Fahrzeuge/Mobility, Schiffe/Maritime, Luftfahrt/Aerospace, Space, Ruestung/Waffensysteme, Industrie/Sonstiges.",
    ),
  battery_need: z
    .enum(BATTERY_NEED_VALUES)
    .describe(
      "Batteribedarf-Intensitaet: sehr_hoch = eigene Elektro-Plattform mit Custom-Pack-Bedarf (Entwicklung/Testing/Produktion durch ISP). hoch = klarer Batteriebedarf, plausibel auslagerungsbereit. mittel = indirekter Bedarf oder Nachbarbereich. gering = marginal. keiner = reine Software/Services/Optik ohne Power-Bezug.",
    ),
  drone_relevance: z
    .enum(DRONE_RELEVANCE_VALUES)
    .describe(
      "Bezug zu Drohnen/autonomen Systemen: Ja (UAV-Hersteller), Ja (UGV) (Bodenroboter), Counter-Drone (Anti-UAV), indirekt (Payload/Sensor fuer UAVs), Nein (kein UAV-Bezug).",
    ),
  service_need: z
    .array(lifecycleEnum)
    .describe(
      "ISP-Lifecycle-Stufen die diese Firma plausibel benoetigt. Leer wenn kein Match. Beispiel: UAV-Hersteller braucht typischerweise cell_selection + engineering + prototyping.",
    ),
});
export type ShortIntel = z.infer<typeof ShortIntelSchema>;

/**
 * Default system + user templates fuer Short/Deep. Im Account-Drawer
 * editierbar; falls app_settings.short_system_prompt etc. NULL ist, faellt
 * die App auf diese Konstanten zurueck.
 *
 * Platzhalter im User-Template:
 *   {{company_name}}    Firmenname
 *   {{profile_block}}   formatProfileForPrompt-Output (Stammdaten als Lines)
 *   {{scraped_content}} Scrape-Markdown, bei Short auf 10k, Deep 30k geslicet
 *   {{short_intel}}     (nur Deep) bisherige Short-Einschaetzung als Block, sonst leer
 */

export const SHORT_SYSTEM_DEFAULT = `Du bist Sales-Intelligence-Analyst fuer ISP Power Systems. Analysiere einen einzelnen Messe-Aussteller und liefere eine strukturierte Erst-Einschaetzung.

# Leser-Profil

Der Vertriebsleiter, der das liest, kennt die Defense- und Industrie-Power-Branche gut. Er weiss was BMS, Cell-Chemistry, NATO-Defense-Spend, UAV-Klassen und Tier-1/2-Zulieferer sind. Schreibe entsprechend: keine Defense-101-Erklaerungen, keine Branchen-Definitionen, kein Marketing-Sprech. Direkt firmenspezifische Signale.

# Output-Regeln

- Deutsch.
- Keine Em-Dashes, keine Superlative ("revolutionary", "world-class" verboten).
- Antworte ausschliesslich ueber das submit_short_intel-Tool.
- Verwende NUR die kanonischen Sektor-IDs aus dem Capability-Katalog.
- Bei duenner Datenlage: confidence niedrig, Begruendung in reasoning_bullets explizit machen ("kein Website-Content, Einschaetzung nur aus Stammdaten").

# Score-Mechanik

Drei Achsen, in dieser Prioritaet:

1. Sektor-Match (dominant). Baut die Firma elektrifizierte Hardware in einem ISP-Sektor (Defense, Aeronautics, Mobile Robotics, Space, Maritime, Mobility)? Direktes Match grundsaetzlich hoch. Nachbarbereich mittel. Kein Match niedrig, unabhaengig vom Rest.

2. Groesse / Outsourcing-Wahrscheinlichkeit. ISP verkauft an Firmen, die Power-System-Entwicklung auslagern.
   - Grosskonzern (>5000 MA, eigene R&D-/Power-Abteilung): typischerweise eine Stufe runter (von hoch auf mittel, von mittel auf niedrig), weil interne Entwicklung statt Auslagerung. Beispiel: Airbus Defence baut Power-Systeme in-house. Ausnahme: spezifische Power-Nische, in der die Konzern-Abteilung nicht aufgestellt ist.
   - Mid-Size (50-5000 MA), insb. Defense-OEMs und Tier-1-Zulieferer: Sweet Spot. Hoechste Outsourcing-Bereitschaft, ausreichend Budget. Score eher rauf.
   - Startup (<50 MA, oft VC-finanzierte Defense-Tech / Robotik / UAV): oft hoch, aber Budget-Caution im Bullet erwaehnen.

3. Bekanntheits-Faktor (sekundaer, leicht). Sehr prominente Player im deutschen/europaeischen Defense- und Industrie-Power-Markt (Helsing, Rheinmetall, Airbus, BAE, KNDS, MBDA, Diehl, Saab, Lockheed Martin, BMW, Bosch, Siemens, ThyssenKrupp Marine etc.) sind dem Vertriebsleiter eh bekannt: Score -5 bis -10, weil Lead-Wert geringer. Unbekanntere Mid-Size-Firmen mit gutem Sektor-Match: leicht +5. Bekanntheit ueberstimmt Sektor-Match und Groesse NIE, sie verschiebt den Score nur am Rand. Bekanntheits-Bewertung gehoert prominent in reasoning_bullets.

# Priority-Mapping

- "hoch" (match_confidence 70-100): eindeutiger Power-Bedarf, ISP-Sektor, plausibel auslagerungs-bereit.
- "mittel" (30-69): plausibler Bedarf in Nachbarbereich, Channel, oder Sektor-Match aber Grosskonzern. Auch: battery_need = sehr_hoch oder hoch auch wenn ISP-Sektor-Match nicht perfekt.
- "niedrig" (0-29): kein erkennbarer Bedarf, Disqualifier, oder reine Software/Services.

# Pflichtfelder neben Score

Zusaetzlich zu one_liner, priority_label, match_confidence, isp_sector_match und reasoning_bullets sind folgende Felder PFLICHT:

## user_group
Waehle GENAU EINE der folgenden kanonischen Kategorien:
- "UAV/Drohnen": Hersteller oder Betreiber unbemannter Luftfahrzeuge
- "Mobile Robotik/UGV": Autonome Bodenfahrzeuge, Lagerroboter, militaerische Bodenroboter
- "Counter-Drone/Radar": Anti-UAV-Systeme, Detektionssysteme, Radaranlagen
- "Optik/Sensorik/Payload": Thermal-Imaging, EO/IR-Kameras, Laser-Ranger, Payloads fuer UAVs
- "Kommunikation/Elektronik": Taktische Funkgeraete, Mesh-Netzwerke, Militaer-Elektronik
- "Energie/Batterien": Batteriehersteller, Energiespeicher-Anbieter
- "Fahrzeuge/Mobility": Elektrifizierte Fahrzeuge, eVTOL, alternative Antriebe
- "Schiffe/Maritime": Schiffe, U-Boote, maritime Plattformen
- "Luftfahrt/Aerospace": Bemannter Luftfahrtbereich, Helikopter, Flugzeuge
- "Space": Raumfahrzeuge, Satelliten, Orbital-Systeme
- "Ruestung/Waffensysteme": Waffen, Munition, Geschuetze ohne elektrifizierten Antrieb
- "Industrie/Sonstiges": Alles andere

## battery_need
Wie intensiv braucht diese Firma ISP-Batterieprodukte oder -Dienstleistungen?
- "sehr_hoch": Eigene elektrifizierte Plattform mit Custom-Pack-Bedarf (Entwicklung/Testing/Produktion durch ISP).
- "hoch": Klarer Batteriebedarf, plausibel auslagerungsbereit.
- "mittel": Indirekter Bedarf oder Nachbarbereich (z.B. Payload-Komponenten, Backups).
- "gering": Nur marginaler Batteriebezug.
- "keiner": Reine Software, Services, Optik ohne jeglichen Power-Bezug.

## drone_relevance
- "Ja": UAV-Hersteller oder -Betreiber
- "Ja (UGV)": Bodenroboter-/UGV-Hersteller
- "Counter-Drone": Anti-UAV-Loesungen
- "indirekt": Liefert Komponenten/Payloads fuer UAVs
- "Nein": Kein UAV-Bezug erkennbar

## service_need
ISP-Lifecycle-Stufen die diese Firma plausibel benoetigt (kanonische IDs, kann leer sein):
cell_selection, engineering, prototyping, integration, industrialization, lifecycle_service

UAV-Hersteller typisch: [cell_selection, engineering, prototyping]
Counter-Drone mit Batterie: [engineering, prototyping, integration]
Nur Test-Bedarf: [prototyping]

# reasoning_bullets (Pflicht)

3-6 Bullets als Markdown-Liste ('- '). Jeder Bullet ist GENAU EIN kurzer Satz (max 15 Woerter), kein Komma-Ketten-Satz. Am Ende jedes Bullets steht ein Quellen-Tag in eckigen Klammern.

Erlaubte Tags:
- [Website] — Information stammt aus dem Firecrawl-Scrape der Firmen-Website
- [Web-Suche] — Information stammt aus einer web_search-Anfrage
- [Messe-Profil] — Information stammt aus den Veranstalter-Stammdaten (Kategorien, Beschreibung, Adresse)
- [Claude-Wissen] — allgemeines Branchenwissen, kein spezifischer Beleg

Decke diese Themen ab (je 1 Bullet, nur wenn relevant):
- Sektor-Match: konkretes Produkt oder Anwendung, die den Match begruendet.
- Groesse und Outsourcing: Klasse (Startup/Mid/Konzern) und was das fuer ISP bedeutet.
- Bekanntheit: bekannt beim Vertriebsleiter? Lead-Wert-Einschaetzung daraus ableiten.
- Power-Bedarf: Plattformklasse oder spezifischer Batterie-Hinweis.
- Disqualifier oder Caveat: wenn relevant (kein Content, Software-only, US-only, etc.).

Beispiel-Format:
- Autonome Unterwasserfahrzeuge mit Custom-Battery-Bedarf fuer Navy-Missionen. [Website]
- Startup-Klasse, Outsourcing sehr wahrscheinlich, keine interne Power-Abteilung erkennbar. [Web-Suche]
- Unbekannte Firma, hoher Lead-Wert fuer Prospecting. [Claude-Wissen]`;

export const SHORT_USER_TEMPLATE_DEFAULT = `Firma: {{company_name}}
{{profile_block}}
Scraped content der Firmen-Website (Markdown, gekuerzt):
---
{{scraped_content}}
---

Rufe submit_short_intel mit Erst-Einschaetzung auf. Wenn nur Stammdaten verfuegbar
sind (kein Website-Content), nutze Adresse, Kategorien, Co-Aussteller und Email-
Domain als Signale fuer Branche, Groesse und ISP-Match - antworte nicht mit
"keine verwertbaren Informationen".`;

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : "",
  );
}

const SHORT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    one_liner: { type: "string" },
    priority_label: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
    match_confidence: { type: "integer", minimum: 0, maximum: 100 },
    isp_sector_match: {
      type: "array",
      items: { type: "string", enum: SECTOR_IDS },
      maxItems: 2,
    },
    reasoning_bullets: { type: "string" },
    user_group: { type: "string", enum: USER_GROUP_VALUES },
    battery_need: { type: "string", enum: BATTERY_NEED_VALUES },
    drone_relevance: { type: "string", enum: DRONE_RELEVANCE_VALUES },
    service_need: {
      type: "array",
      items: { type: "string", enum: LIFECYCLE_IDS },
    },
  },
  required: [
    "one_liner",
    "priority_label",
    "match_confidence",
    "isp_sector_match",
    "reasoning_bullets",
    "user_group",
    "battery_need",
    "drone_relevance",
    "service_need",
  ],
} as const;

const SHORT_WEB_SEARCH_GUIDANCE = `
# Web-Suche

Du hast Zugriff auf das web_search-Tool. Nutze es wenn:
- Der gescrapte Content leer oder zu duenn ist (unter ~300 verwertbare Zeichen)
- Keine Website vorhanden und die Firma dir unbekannt ist
- Du Branchenposition, Groesse oder Produktspektrum nicht einschaetzen kannst

Suche z.B. nach "{Firmenname} company products", "{Firmenname} defense aerospace", "{Firmenname} Unternehmensseite".
Maximal 2 Suchen. Danach submit_short_intel aufrufen.
`;

export async function enrichShort(input: {
  companyName: string;
  website: string | null;
  booth: string | null;
  profileUrl: string | null;
  profileData: Record<string, unknown> | null;
  linkedinUrl?: string | null;
  scrapedMarkdown: string;
  prioContext: string;
  model: string;
  /** Override des Default-System-Prompts (aus app_settings.short_system_prompt). */
  systemPrompt?: string | null;
  /** Override des Default-User-Templates (aus app_settings.short_user_template). Platzhalter siehe SHORT_USER_TEMPLATE_DEFAULT. */
  userTemplate?: string | null;
  /** Override des Default-Output-Limits. */
  maxTokens?: number | null;
  /** Override des Default-Input-Slice-Limits fuer scraped content. */
  maxInputChars?: number | null;
  /** Aktiviert Anthropic native web_search (max 2 Suchen) fuer duenne Datenlage. */
  withWebSearch?: boolean;
}): Promise<{ intel: ShortIntel; usage: Usage & { web_searches: number }; raw: unknown }> {
  const maxInputChars = pickInt(
    input.maxInputChars,
    SHORT_MAX_INPUT_CHARS_DEFAULT,
    500,
    200_000,
  );
  const maxTokens = pickInt(input.maxTokens, SHORT_MAX_TOKENS_DEFAULT, 100, 8000);
  const scrapedContent =
    input.scrapedMarkdown.slice(0, maxInputChars) ||
    "(kein Content abrufbar)";
  const userContent = renderTemplate(
    input.userTemplate && input.userTemplate.trim().length > 0
      ? input.userTemplate
      : SHORT_USER_TEMPLATE_DEFAULT,
    {
      company_name: input.companyName,
      profile_block: formatProfileForPrompt({ ...input, linkedinUrl: input.linkedinUrl }),
      scraped_content: scrapedContent,
    },
  );

  const systemText =
    input.systemPrompt && input.systemPrompt.trim().length > 0
      ? input.systemPrompt
      : SHORT_SYSTEM_DEFAULT;

  const useWebSearch = !!input.withWebSearch;

  const tools: any[] = [
    {
      name: "submit_short_intel",
      description:
        "Submit the short-tier exhibitor analysis. Call exactly once after any web searches.",
      input_schema: SHORT_INPUT_SCHEMA as any,
    },
  ];
  if (useWebSearch) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: 2 });
  }

  const systemBlocks: any[] = [
    { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
    { type: "text", text: input.prioContext, cache_control: { type: "ephemeral" } },
    { type: "text", text: catalogAsPromptBlock(), cache_control: { type: "ephemeral" } },
  ];
  if (useWebSearch) {
    systemBlocks.push({ type: "text", text: SHORT_WEB_SEARCH_GUIDANCE });
  }

  const response = await client().messages.create({
    model: input.model,
    max_tokens: maxTokens,
    system: systemBlocks,
    tools,
    // tool_choice "any" wenn web_search aktiv: Claude darf zuerst suchen, muss aber mind. 1 Tool aufrufen.
    // Ohne web_search: forced submit_short_intel fuer deterministisches Verhalten.
    tool_choice: useWebSearch
      ? { type: "any" }
      : { type: "tool", name: "submit_short_intel" },
    messages: [{ role: "user", content: userContent }],
  });

  const webSearches = response.content.filter(
    (b: any) => b.type === "server_tool_use" && b.name === "web_search",
  ).length;

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Short tool call missing. stop=${response.stop_reason}`);
  }
  const intel = ShortIntelSchema.parse(toolUse.input);
  return {
    intel,
    usage: {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      web_searches: webSearches,
    },
    raw: response,
  };
}

// ---------- DEEP ----------

export const DeepIntelSchema = z.object({
  business_summary: z
    .string()
    .describe("3-5 Saetze: was die Firma genau macht, Produkte, Markt, Groesse."),
  decision_makers: z
    .string()
    .describe("Wer ist Ansprechpartner fuer ISP? Rolle/Titel/Departement (z.B. CTO, Head of Engineering, Procurement). Wenn unklar: Best-Guess mit Begruendung."),
  recent_news: z
    .string()
    .describe("Letzte ~12 Monate: Pressemitteilungen, Funding, neue Produkte, Partnerschaften, falls aus dem Content erkennbar. Sonst 'keine Hinweise'."),
  technical_pain_points: z
    .string()
    .describe("Welche Power-/Batterie-/Antriebs-Schmerzpunkte hat die Firma plausibel? Konkret und sachlich."),
  opening_questions: z
    .string()
    .describe("3-5 Fragen die der Vertriebler am Stand stellen kann, um Bedarf zu validieren. Bullet-Liste."),
  competition_context: z
    .string()
    .describe("Welche Wettbewerber zu ISP koennten hier schon im Spiel sein? Wie positioniert man sich?"),
  isp_lifecycle_match: z
    .array(lifecycleEnum)
    .describe("ISP-Lifecycle-Stufen die fuer diese Firma am wertvollsten sind."),
  isp_service_fit: z
    .string()
    .describe(
      "Konkret: welche ISP-Leistungen (Zellauswahl, Engineering, Testing, Integration, Serien) fuer diese Firma relevant sind und warum. Nicht generisch ('Batterien benoetigt'), sondern spezifisch: 'Custom-Pack fuer 25-kg-UAV mit Hot-Swap-Anforderung', 'Abuse-Testing fuer mil-zertifizierte Zellen', 'Industrialisierung fuer Kleinserie 50 Stueck/Jahr'. 2-4 Saetze.",
    ),
  full_reasoning: z
    .string()
    .describe("Ausfuehrliche Begruendung: Signale aus dem Content, ISP-Differentiator-Match, Risiken."),
});
export type DeepIntel = z.infer<typeof DeepIntelSchema>;

export const DEEP_SYSTEM_DEFAULT = `Du bist Senior-Sales-Strategy-Analyst fuer ISP Power Systems. Erstelle eine tiefgehende Recherche zu einem bestimmten Aussteller, damit der Vertriebler ihn am Messe-Stand professionell ansprechen kann.

# Leser-Profil

Der Vertriebsleiter, der das liest, ist Senior-Level mit gutem Branchen- und Technik-Wissen. Er kennt BMS, Cell-Chemistry, Lifecycle-Stufen, NATO-Defense-Spend, UAV-Klassen, typische OEM-/Tier-1-Strukturen. Erklaer ihm keine Standard-Begriffe. Liefere actionable Insights, keine Lehrbuch-Saetze. Wenn du nichts firmenspezifisches sagen kannst, sag das ehrlich, statt Allgemeinplaetze zu generieren.

# Output-Regeln

- Deutsch.
- Keine Em-Dashes, keine Superlative, kein Marketing-Bla.
- Antworte ausschliesslich ueber das submit_deep_intel-Tool.
- Verwende NUR kanonische Lifecycle-IDs aus dem Capability-Katalog.
- Bei Unklarheit: das explizit sagen ("aus dem Content nicht erkennbar"), nicht raten.

Input umfasst zusaetzlich die Short-Einschaetzung (priority_label + match_confidence + reasoning_bullets) plus den vollstaendigeren Website-Inhalt. Nutze beides; bau auf den Short-Bullets auf, anstatt sie zu wiederholen.

# Was der Vertriebsleiter pro Feld braucht

- business_summary: was die Firma KONKRET baut (Produkt-Linien, Plattform-Klassen), an wen sie verkauft (OEM-Kunden namentlich wenn moeglich), vermutete Groessenordnung (MA / Umsatz wenn ableitbar), Mutter/Tochter-Struktur falls relevant. Keine "wir sind innovativ"-Saetze.
- decision_makers: Namen wenn aus Content erkennbar, sonst Rolle + Department mit kurzer Begruendung. Hinweis auf typische Org-Struktur in dieser Firmen-Groesse (z.B. "<200 MA: meist CTO + Head of Engineering direkt; >2000 MA: eigene Power-/E-Architecture-Abteilung mit eigenem Lead").
- recent_news: signal-relevante Meldungen letzte ~12 Monate (Funding, neue Produkt-Generation, Personal auf Engineering-Ebene, Werks-/Standort-Eroeffnung). Keine Award-/PR-/Marketing-Schoenfaerberei. "Keine Hinweise" wenn nichts da ist.
- technical_pain_points: spezifisch fuer deren Produkt-Architektur. Nicht "Batterien sind wichtig", sondern z.B. "ihr UAV der 25 kg Klasse mit angegebener 6 h Endurance braucht plausibel eine 1-2 kWh High-Energy-Density-Pack mit Hot-Swap-Anforderung; das deutet auf Custom-Pack mit Pouch- oder 21700-Zellen hin". Wenn Plattform-Daten fehlen: ehrliche Hypothese mit Caveat.
- opening_questions: 3-5 Fragen, die einen Sales-Senior NICHT beleidigen. Sie testen Hypothesen ueber Architektur, Make-or-Buy, Validation-Strategie. Keine Fragen, die Allgemeinwissen abfragen ("benoetigen Sie Batterien?"). Bullet-Liste.
- competition_context: konkrete Wettbewerber namentlich (Saft, EAS, Vincotech, BMZ, Custom-Cells, Akasol, Webasto Battery, etc.) wenn plausibel positioniert. ISP-Differentiator (in-house Test-Center, Validation-first, europaeische Lieferkette, R&D Salzbergen/Muenchen) im Verhaeltnis zu denen knapp framen. Wenn der Wettbewerb unklar ist: das sagen.
- isp_lifecycle_match: kanonische IDs, in der Reihenfolge wo ISP den groessten Wert liefert. Begruendung gehoert in full_reasoning, nicht hier.
- isp_service_fit: Welche ISP-Dienstleistungen KONKRET fuer diese Firma relevant sind. Nicht "Batterien benoetigt", sondern spezifisch: "Custom-Pack fuer 25-kg-UAV mit Hot-Swap", "Abuse-Testing fuer mil-zertifizierte Zellen", "Industrialisierung fuer Kleinserie 50/Jahr". Falls mehrere Lifecycle-Stufen relevant sind: kurz beschreiben welche und warum. 2-4 Saetze.
- full_reasoning: Synthese der Signale. Welche Indizien aus dem Content stuetzen die Einschaetzung, welche ISP-Differentiatoren matchen direkt, welche Risiken (Bestandslieferant intern, Konzern mit eigener Power-Abteilung, kein erkennbares Budget) muss der Vertriebler einkalkulieren.`;

export const DEEP_USER_TEMPLATE_DEFAULT = `Firma: {{company_name}}
{{profile_block}}{{short_intel}}

Scraped content der Firmen-Website (Markdown, vollstaendig):
---
{{scraped_content}}
---

Rufe submit_deep_intel mit allen Feldern auf.`;

const DEEP_INPUT_SCHEMA = {
  type: "object",
  properties: {
    business_summary: { type: "string" },
    decision_makers: { type: "string" },
    recent_news: { type: "string" },
    technical_pain_points: { type: "string" },
    opening_questions: { type: "string" },
    competition_context: { type: "string" },
    isp_lifecycle_match: {
      type: "array",
      items: { type: "string", enum: LIFECYCLE_IDS },
    },
    isp_service_fit: { type: "string" },
    full_reasoning: { type: "string" },
  },
  required: [
    "business_summary",
    "decision_makers",
    "recent_news",
    "technical_pain_points",
    "opening_questions",
    "competition_context",
    "isp_lifecycle_match",
    "isp_service_fit",
    "full_reasoning",
  ],
} as const;

export async function enrichDeep(input: {
  companyName: string;
  website: string | null;
  booth: string | null;
  profileUrl: string | null;
  profileData: Record<string, unknown> | null;
  linkedinUrl?: string | null;
  scrapedMarkdown: string;
  prioContext: string;
  model: string;
  shortContext: ShortIntel | null;
  /** Override des Default-System-Prompts (aus app_settings.deep_system_prompt). */
  systemPrompt?: string | null;
  /** Override des Default-User-Templates (aus app_settings.deep_user_template). Platzhalter siehe DEEP_USER_TEMPLATE_DEFAULT. */
  userTemplate?: string | null;
  /** Override des Default-Output-Limits. */
  maxTokens?: number | null;
  /** Override des Default-Input-Slice-Limits fuer scraped content. */
  maxInputChars?: number | null;
}): Promise<{ intel: DeepIntel; usage: Usage; raw: unknown }> {
  const shortBlock = input.shortContext
    ? `\n\nBisherige Short-Einschaetzung:
- one_liner: ${input.shortContext.one_liner}
- priority_label: ${input.shortContext.priority_label}
- match_confidence: ${input.shortContext.match_confidence}
- isp_sector_match: ${input.shortContext.isp_sector_match.join(", ") || "(keine)"}${
        input.shortContext.reasoning_bullets &&
        input.shortContext.reasoning_bullets.trim().length > 0
          ? `\n- reasoning_bullets:\n${input.shortContext.reasoning_bullets.trim()}`
          : ""
      }\n`
    : "";

  const maxInputChars = pickInt(
    input.maxInputChars,
    DEEP_MAX_INPUT_CHARS_DEFAULT,
    1000,
    500_000,
  );
  const maxTokens = pickInt(input.maxTokens, DEEP_MAX_TOKENS_DEFAULT, 200, 16000);
  const scrapedContent =
    input.scrapedMarkdown.slice(0, maxInputChars) ||
    "(kein Content abrufbar - Tiefen-Recherche muss aus Stammdaten + Allgemeinwissen + ggf. Web-Search erfolgen)";

  const userContent = renderTemplate(
    input.userTemplate && input.userTemplate.trim().length > 0
      ? input.userTemplate
      : DEEP_USER_TEMPLATE_DEFAULT,
    {
      company_name: input.companyName,
      profile_block: formatProfileForPrompt({ ...input, linkedinUrl: input.linkedinUrl }),
      short_intel: shortBlock,
      scraped_content: scrapedContent,
    },
  );

  const systemText =
    input.systemPrompt && input.systemPrompt.trim().length > 0
      ? input.systemPrompt
      : DEEP_SYSTEM_DEFAULT;

  const response = await client().messages.create({
    model: input.model,
    max_tokens: maxTokens,
    system: [
      {
        type: "text",
        text: systemText,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: input.prioContext,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: catalogAsPromptBlock(),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "submit_deep_intel",
        description: "Submit the deep-tier exhibitor analysis. Call exactly once.",
        input_schema: DEEP_INPUT_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: "submit_deep_intel" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error(`Deep tool call missing. stop=${response.stop_reason}`);
  }
  const intel = DeepIntelSchema.parse(toolUse.input);
  return {
    intel,
    usage: {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    },
    raw: response,
  };
}

// ---------- Chat ----------

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ExhibitorChatContext = {
  id: string;
  company_name: string;
  website: string | null;
  booth: string | null;
  one_liner: string | null;
  priority_label: string | null;
  match_confidence: number | null;
  isp_sector_match: string[];
};

// Listing-Tier-Aggregat pro Firma fuer den globalen Companies-Chat. shows wird
// flach als string[] uebergeben (nur Namen), damit der JSON-Block bei vielen
// Firmen schlank bleibt. Befuellt aus companies_overview via loadCompanyDirectory.
export type CompanyChatContext = {
  id: string;
  display_name: string;
  domain: string | null;
  website: string | null;
  best_priority: "hoch" | "mittel" | "niedrig" | null;
  best_match_confidence: number | null;
  best_one_liner: string | null;
  union_sectors: string[];
  shows: string[];
};

export const CHAT_SYSTEM_DEFAULT = `Du bist Sales-Intelligence-Assistent fuer ISP Power Systems. Der Vertriebler stellt dir Fragen ueber die Aussteller einer Messe; du beantwortest sie auf Basis des unten gelieferten Aussteller-Kontexts.

Regeln:
- Deutsch.
- Knapp und konkret. Keine Em-Dashes, keine Superlative.
- Keine Behauptungen, die nicht durch den Aussteller-Kontext gestuetzt sind.
- Wenn der Kontext nicht reicht: das ehrlich sagen.
- Bei "Top X" oder "Prio-Hoch-Leads": match_confidence absteigend sortieren, priority_label "hoch" bevorzugen.
- Bei Empfehlungen kurz begruenden, welcher ISP-Sektor / Lifecycle-Schritt passt.
- Bei Aufzaehlungen: Bullet-Liste oder kurze Tabelle.

# Daten-Speichern (nur wenn update_exhibitor_intel verfuegbar)
Wenn der Vertriebler im Gespraech neue Informationen zu einem Aussteller recherchiert hat (z.B. Ansprechpartner, aktuelles News, korrigiertes Geschaeftsfeld) und diese speichern moechte, rufe update_exhibitor_intel auf. Frag vorher kurz welches Feld aktualisiert werden soll, wenn unklar. Bestaetigung nach dem Speichern.`;

export type ClientTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type ChatUsage = Usage & {
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
};

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "search"; search: { query?: string; result_count?: number } }
  | { type: "tool_use"; tool: string; input: Record<string, unknown> }
  | { type: "usage"; usage: ChatUsage }
  | { type: "done" };

export function renderCrawlStateBlock(s: CrawlStateBlock): string {
  const head = `Status: ${s.status ?? "unknown"}` +
    (s.paused_phase ? ` (paused at ${s.paused_phase})` : "") +
    (s.current_step ? ` — current_step: ${s.current_step}` : "");
  const counts =
    `Aussteller: ${s.actual_exhibitor_count}` +
    (s.expected_exhibitor_count
      ? ` von erwartet ${s.expected_exhibitor_count}`
      : "") +
    `\nShort-Counts: ${JSON.stringify(s.short_counts)}` +
    `\nDeep-Counts: ${JSON.stringify(s.deep_counts)}` +
    (s.browserbase_session_seconds
      ? `\nBrowserbase-Sekunden: ${s.browserbase_session_seconds}`
      : "");
  const logs = s.recent_logs.length === 0
    ? "(keine Logs)"
    : s.recent_logs
        .map(
          (l) =>
            `- [${l.created_at}] ${l.level.toUpperCase()} ${l.phase ?? "-"}: ${l.message}`,
        )
        .join("\n");
  return `# Aktueller Crawl-Stand (live)\n\n${head}\n${counts}\n\n## Letzte Logs (chronologisch, max 20)\n${logs}`;
}

export async function* chatStream(input: {
  prioContext: string;
  /** Aussteller-JSON-Block. Optional: bei Tool-Use-Modus weglassen. */
  exhibitors?: ExhibitorChatContext[];
  /** Vollstaendige Firmen-Directory fuer den globalen Companies-Chat. Wird als
   *  4. cache_control-Block geladen — fuer den Show-Chat-Pfad mutually exclusive
   *  zu exhibitors (Anthropic max. 4 cache_control-Breakpoints). */
  companyDirectory?: CompanyChatContext[];
  history: ChatTurn[];
  userMessage: string;
  model: string;
  withWebSearch?: boolean;
  deepContext?: Record<string, unknown> | null;
  showContext?: string | null;
  /** Live-Crawl-Stand fuer Show-Chat: Status, Counts, letzte Logs.
   *  Un-cached, weil pro Poll/Frage frisch. */
  crawlState?: CrawlStateBlock | null;
  /** Zusaetzlicher System-Block (z.B. Tool-Use-Hinweis fuer globalen Chat). */
  extraSystem?: string;
  /** Client-side Tools: Claude ruft sie auf, Backend fuehrt aus, Loop. */
  clientTools?: ClientTool[];
  executeClientTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Override des Default-System-Prompts (aus app_settings.chat_system_prompt). */
  systemPrompt?: string | null;
  /** Override des Default-Output-Limits. */
  maxTokens?: number | null;
  /** Override fuer max_uses des nativen web_search-Tools. */
  webSearchMaxUses?: number | null;
}): AsyncGenerator<ChatStreamEvent> {
  const systemText =
    input.systemPrompt && input.systemPrompt.trim().length > 0
      ? input.systemPrompt
      : CHAT_SYSTEM_DEFAULT;
  const maxTokens = pickInt(input.maxTokens, CHAT_MAX_TOKENS_DEFAULT, 200, 16000);
  const webSearchMaxUses = pickInt(
    input.webSearchMaxUses,
    CHAT_WEB_SEARCH_MAX_USES_DEFAULT,
    0,
    20,
  );

  const systemBlocks: any[] = [
    { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
    { type: "text", text: input.prioContext, cache_control: { type: "ephemeral" } },
    { type: "text", text: catalogAsPromptBlock(), cache_control: { type: "ephemeral" } },
  ];
  if (input.exhibitors && input.exhibitors.length > 0) {
    systemBlocks.push({
      type: "text",
      text: `# Aussteller-Kontext (JSON)\n\n${JSON.stringify(input.exhibitors, null, 2)}`,
      cache_control: { type: "ephemeral" },
    });
  } else if (input.companyDirectory && input.companyDirectory.length > 0) {
    systemBlocks.push({
      type: "text",
      text:
        `# Firmen-Directory (JSON, vollstaendig, sortiert nach best_match_confidence DESC)\n\n` +
        `Enthaelt ALLE Firmen des Users ueber alle Messen. Primaere Datenquelle ` +
        `fuer Aggregat-Fragen ("wie viele Hot-Leads", "Top X", "welche in Sektor Y"). ` +
        `Das search_companies-Tool ist nur Fallback fuer Substring-Suche im Namen.\n\n` +
        JSON.stringify(input.companyDirectory, null, 2),
      cache_control: { type: "ephemeral" },
    });
  }
  // Anthropic erlaubt max 4 cache_control-Breakpoints pro Request. Die ersten
  // 3-4 Bloecke (System, Prio-Kontext, Catalog, Aussteller-JSON | Firmen-Directory)
  // sind stabil und tragen den Cache-Wert; die folgenden variieren pro
  // Thread/Frage und werden bewusst NICHT gecached.
  if (input.showContext && input.showContext.trim().length > 0) {
    systemBlocks.push({
      type: "text",
      text: `# Messe-spezifischer Kontext\n\n${input.showContext.trim()}`,
    });
  }
  if (input.deepContext) {
    systemBlocks.push({
      type: "text",
      text: `# Deep-Dive zum aktuellen Aussteller (JSON)\n\n${JSON.stringify(input.deepContext, null, 2)}`,
    });
  }
  if (input.crawlState) {
    systemBlocks.push({
      type: "text",
      text: renderCrawlStateBlock(input.crawlState),
    });
  }
  if (input.extraSystem && input.extraSystem.trim().length > 0) {
    systemBlocks.push({
      type: "text",
      text: input.extraSystem.trim(),
    });
  }

  // Tool list: native web_search (server-side, no callback) + optional client tools.
  const tools: any[] = [];
  if (input.withWebSearch) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: webSearchMaxUses,
    });
  }
  if (input.clientTools && input.clientTools.length > 0) {
    for (const t of input.clientTools) {
      tools.push({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      });
    }
  }
  const clientToolNames = new Set((input.clientTools ?? []).map((t) => t.name));

  // Tool-use loop: Claude streams text + maybe tool_use blocks. If any client
  // tool was called, execute it, append assistant turn + tool_result, restream.
  // Hard cap of 6 round-trips to bound cost.
  const messagesArr: Anthropic.MessageParam[] = [
    ...input.history.map(
      (t): Anthropic.MessageParam => ({ role: t.role, content: t.content }),
    ),
    { role: "user", content: input.userMessage },
  ];
  let totalIn = 0;
  let totalOut = 0;
  let totalCacheCreate = 0;
  let totalCacheRead = 0;

  for (let iter = 0; iter < 6; iter++) {
    const stream = client().messages.stream({
      model: input.model,
      max_tokens: maxTokens,
      system: systemBlocks,
      ...(tools.length ? { tools } : {}),
      messages: messagesArr,
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", text: event.delta.text };
      } else if (event.type === "content_block_start") {
        const block = event.content_block as any;
        if (block?.type === "server_tool_use" && block?.name === "web_search") {
          yield {
            type: "search",
            search: { query: (block?.input?.query as string) ?? undefined },
          };
        }
      }
    }

    const final = await stream.finalMessage();
    totalIn += final.usage.input_tokens;
    totalOut += final.usage.output_tokens;
    totalCacheCreate += (final.usage as any).cache_creation_input_tokens ?? 0;
    totalCacheRead += (final.usage as any).cache_read_input_tokens ?? 0;

    const clientToolUses = final.content.filter(
      (b): b is Anthropic.ToolUseBlock =>
        b.type === "tool_use" && clientToolNames.has(b.name),
    );

    if (clientToolUses.length === 0 || !input.executeClientTool) break;

    // Surface tool calls to the UI before executing (so the user sees activity).
    for (const tu of clientToolUses) {
      yield {
        type: "tool_use",
        tool: tu.name,
        input: (tu.input as Record<string, unknown>) ?? {},
      };
    }

    // Append assistant turn (with all blocks Claude emitted) + tool_results.
    messagesArr.push({ role: "assistant", content: final.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of clientToolUses) {
      try {
        const result = await input.executeClientTool(
          tu.name,
          (tu.input as Record<string, unknown>) ?? {},
        );
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(result ?? null),
        });
      } catch (err) {
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          is_error: true,
          content: err instanceof Error ? err.message : "tool error",
        });
      }
    }
    messagesArr.push({ role: "user", content: results });
  }

  const cost_usd = priceForChat(input.model, {
    input_tokens: totalIn,
    output_tokens: totalOut,
    cache_creation_input_tokens: totalCacheCreate,
    cache_read_input_tokens: totalCacheRead,
  });
  yield {
    type: "usage",
    usage: {
      tokens_in: totalIn,
      tokens_out: totalOut,
      cache_creation_tokens: totalCacheCreate,
      cache_read_tokens: totalCacheRead,
      cost_usd,
    },
  };
  yield { type: "done" };
}

// ---------- Legacy enrichAndMatch (V1, kept for backwards-compat) ----------

const sectorEnumLegacy = sectorEnum;
const lifecycleEnumLegacy = lifecycleEnum;

export const IntelSchema = z.object({
  business_field: z.string(),
  estimated_size: z.string(),
  power_needs_hypothesis: z.string(),
  isp_sector_match: z.array(sectorEnumLegacy).max(2),
  isp_lifecycle_match: z.array(lifecycleEnumLegacy),
  match_confidence: z.number().int().min(0).max(100),
  pitch_hook: z.string(),
  reasoning: z.string(),
});
export type Intel = z.infer<typeof IntelSchema>;

/**
 * @deprecated V1 single-call enrichment. Replaced by enrichShort + enrichDeep.
 * Kept so old Inngest events from before the refactor can still run.
 */
export async function enrichAndMatch(_input: {
  companyName: string;
  website: string | null;
  scrapedMarkdown: string;
}): Promise<{ intel: Intel; raw: unknown }> {
  throw new Error(
    "enrichAndMatch is deprecated in V2. Trigger short-overview or deep-dive instead.",
  );
}

// ---------- COMPETITOR DISCOVERY ----------
//
// Claude + Anthropic-Web-Search recherchiert Wettbewerber von ISP Power Systems
// im Markt. Output: Vorschlagsliste mit Evidenz-URLs. User kuratiert in CurateQueue.
// web_search ist obligatorisch (anders als bei enrichShort/enrichDeep), weil
// Markt-Wissen aktuell sein muss und nicht nur aus Trainings-Daten kommen darf.

export const COMPETITOR_DISCOVERY_MODEL_DEFAULT = "claude-sonnet-4-6";
// Bei target_count=20 schreibt Claude ~3-5k Output-Tokens fuer das Tool-Use plus
// Reasoning-Text. 6000 hat in der Praxis zu max_tokens-Stops gefuehrt, bevor das
// submit_competitor_discoveries-Tool aufgerufen war. 8000 gibt Puffer; User darf
// per Setting hoch (max 16000) oder runter.
export const COMPETITOR_DISCOVERY_MAX_TOKENS_DEFAULT = 8000;
export const COMPETITOR_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT = 15;
// Hartes SDK-Timeout: 30 Web-Searches × ~20s + Claude-Reasoning kann sich addieren.
// 15 min ist grosszuegig fuer realistische Laeufe und schlaegt bei haengendem Call zu.
const COMPETITOR_DISCOVERY_TIMEOUT_MS = 1000 * 60 * 15;

/**
 * Wird geworfen, wenn Claude den Discovery-Lauf beendet hat ohne
 * `submit_competitor_discoveries` aufzurufen. Passiert typischerweise bei
 * stop_reason='max_tokens' oder wenn der Web-Search-Cap mitten in der Recherche
 * greift. `diagnostics` enthaelt alles, was fuer ein Post-Mortem im Log
 * gebraucht wird.
 */
export class DiscoveryNoSubmitError extends Error {
  diagnostics: {
    stop_reason: string | null;
    usage: { tokens_in: number; tokens_out: number };
    web_search_uses: number;
    block_counts: Record<string, number>;
    text_snippet: string | null;
  };
  constructor(
    message: string,
    diagnostics: DiscoveryNoSubmitError["diagnostics"],
  ) {
    super(message);
    this.name = "DiscoveryNoSubmitError";
    this.diagnostics = diagnostics;
  }
}

export const COMPETITOR_DISCOVERY_SYSTEM_DEFAULT = `Du bist Senior Competitive-Intelligence-Analyst fuer ISP Power Systems. Deine Aufgabe: identifiziere Firmen, die im selben Markt antreten und um dieselben Kunden / Auftraege konkurrieren wie ISP.

# Leser-Profil

Der Vertriebsleiter, der das liest, kennt die Defense- und Industrie-Power-Branche gut. Er kennt die offensichtlichen Player (Saft, BMZ, Akasol, Custom Cells, EAS, Webasto Battery, Vincotech etc.) bereits. Wertvoll ist nicht "Saft" als Vorschlag, sondern Mid-Size-Spezialisten, junge Defense-Tech-Firmen, regionale Player und benachbarte Anbieter, die gerade in ISPs Sektoren reinwachsen.

# Methodik

1. Lies zuerst den Capability-Catalog und den Prio-Kontext im System-Prompt vollstaendig durch.
2. Nutze das web_search-Tool (es ist obligatorisch verfuegbar): suche gezielt nach
   - "<sector> battery system supplier Europe"
   - "custom battery pack defense"
   - "<region> power systems integrator"
   - Branchen-Reports, Messe-Listen, Pressemitteilungen.
   Variiere Queries; nutze auch englischsprachige Begriffe.
3. Kombiniere Web-Search-Treffer mit deinem Trainingswissen. Bevorzuge konkrete, nachpruefbare URLs als evidence_urls.
4. Filtere: nur Firmen, die wirklich gegen ISP antreten koennten (siehe ISP-Differentiators: in-house Test-Center, Validation-first, custom Battery-Packs, europaeische Lieferkette). Reine Cell-Hersteller (Samsung SDI, LG, CATL) sind KEINE Competitors, sondern Lieferanten. Reine Software/BMS-IP-Firmen sind grenzwertig - nur aufnehmen wenn sie auch Hardware bauen.
5. Gib confidence ehrlich an. Bei sehr unsicheren Vorschlaegen: confidence < 0.5, in why_competitor das Risiko nennen.

# Output-Regeln

- Deutsch fuer why_competitor. Englische Firmenbezeichnungen / Produktnamen unveraendert.
- Keine Em-Dashes, keine Superlative ("revolutionary", "world-class" verboten).
- Antworte ausschliesslich ueber das submit_competitor_discoveries-Tool.
- Verwende NUR die kanonischen Sektor-IDs aus dem Capability-Katalog.
- target_count ist eine Zielgroesse, kein hartes Cap. Lieber weniger Vorschlaege mit hoher Qualitaet als die Liste mit schwachen Treffern auffuellen.
- Pflicht: jeder Vorschlag braucht mindestens eine evidence_url (Pressemitteilung, Firmenwebsite, Branchen-Report, LinkedIn-Snippet aus Web-Search).
- Bekannte Big-Player nicht ausschliessen, aber nur kurz erwaehnen ("Saft - bekannt, Konzern, Lead-Wert gering").
- Keine Dubletten: wenn Mutter + Tochter beide gefunden, nimm die Tochter mit dem klareren Power-Fokus.

# reasoning (Pflicht)

Eine kurze Reflexion am Ende: nach welchen Suchstrategien wurde gesucht (welche Queries ergaben die besten Treffer), welche Kandidaten wurden bewusst weggelassen (Cell-Hersteller etc.), wo ist die Datenlage duenn (z.B. wenn Region X kaum durchsucht werden konnte). Hilft dem User, den naechsten Discovery-Lauf zu fokussieren.`;

export const COMPETITOR_DISCOVERY_USER_TEMPLATE_DEFAULT = `Identifiziere Wettbewerber von ISP Power Systems im Markt.

Vorgaben:
- Sektor-Fokus: {{sector_focus}}
- Region-Fokus: {{region_focus}}
- Zielanzahl: {{target_count}} Vorschlaege
- Zusatz-Hinweise: {{notes}}

Nutze das web_search-Tool aktiv (mindestens 5-10 Queries), bevor du das submit_competitor_discoveries-Tool aufrufst. Variiere Sprache (Deutsch + Englisch), Begriffe und Quellen.

Rufe submit_competitor_discoveries genau einmal mit der finalen Vorschlagsliste auf.`;

function renderDiscoveryUserTemplate(
  template: string,
  req: CompetitorDiscoveryRequest,
): string {
  const sectorFocus =
    req.sector_focus && req.sector_focus.length > 0
      ? req.sector_focus.join(", ")
      : "alle ISP-Sektoren (defense, aeronautics, mobile_robotics, space, maritime, mobility)";
  const regionFocus =
    req.region_focus && req.region_focus.trim().length > 0
      ? req.region_focus.trim()
      : "global, leichte Praeferenz Europa / DACH";
  const notes =
    req.notes && req.notes.trim().length > 0 ? req.notes.trim() : "(keine)";
  return renderTemplate(template, {
    sector_focus: sectorFocus,
    region_focus: regionFocus,
    target_count: String(req.target_count),
    notes,
  });
}

export async function discoverCompetitors(input: {
  prioContext: string;
  request: CompetitorDiscoveryRequest;
  model: string;
  /** Override des Default-System-Prompts (aus app_settings.competitor_discovery_system_prompt). */
  systemPrompt?: string | null;
  /** Override des Default-User-Templates. */
  userTemplate?: string | null;
  /** Override des Default-Output-Limits. */
  maxTokens?: number | null;
  /** Hartes Cap fuer Anthropic-web_search-Aufrufe pro Discovery. */
  maxWebSearches?: number | null;
}): Promise<{
  output: CompetitorDiscoveryOutput;
  usage: Usage & {
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  webSearchUses: number;
  raw: unknown;
}> {
  const maxTokens = pickInt(
    input.maxTokens,
    COMPETITOR_DISCOVERY_MAX_TOKENS_DEFAULT,
    500,
    16000,
  );
  const maxWebSearches = pickInt(
    input.maxWebSearches,
    COMPETITOR_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT,
    0,
    30,
  );

  const systemText =
    input.systemPrompt && input.systemPrompt.trim().length > 0
      ? input.systemPrompt
      : COMPETITOR_DISCOVERY_SYSTEM_DEFAULT;
  const userTemplate =
    input.userTemplate && input.userTemplate.trim().length > 0
      ? input.userTemplate
      : COMPETITOR_DISCOVERY_USER_TEMPLATE_DEFAULT;

  const userContent = renderDiscoveryUserTemplate(userTemplate, input.request);

  const tools: any[] = [];
  if (maxWebSearches > 0) {
    tools.push({
      type: "web_search_20250305",
      name: "web_search",
      max_uses: maxWebSearches,
    });
  }
  tools.push({
    name: "submit_competitor_discoveries",
    description:
      "Submit the final list of identified competitors with evidence URLs. Call exactly once after all web_search queries are complete.",
    input_schema: COMPETITOR_DISCOVERY_INPUT_SCHEMA as any,
  });

  const response = await client().messages.create(
    {
      model: input.model,
      max_tokens: maxTokens,
      system: [
        {
          type: "text",
          text: systemText,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: input.prioContext,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: catalogAsPromptBlock(),
          cache_control: { type: "ephemeral" },
        },
      ],
      tools,
      // tool_choice: auto -> Claude darf erst web_search nutzen, dann submit_*.
      // Forced submit (tool_choice: tool) wuerde web_search blockieren.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: userContent }],
    },
    { timeout: COMPETITOR_DISCOVERY_TIMEOUT_MS },
  );

  // Web-Search-Uses zaehlen: server_tool_use-Bloecke mit name="web_search".
  const webSearchUses = response.content.filter((b: any) => {
    return b?.type === "server_tool_use" && b?.name === "web_search";
  }).length;

  // Letzten submit-Tool-Use-Block extrahieren (Claude koennte mehrere Drafts produzieren).
  const submitBlocks = response.content.filter(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === "submit_competitor_discoveries",
  );
  if (submitBlocks.length === 0) {
    // Block-Stats fuer Diagnose: hilft zu sehen, ob Claude Web-Search gemacht
    // hat und nur das submit-Tool vergessen / nicht erreicht hat.
    const blockCounts: Record<string, number> = {};
    for (const b of response.content as any[]) {
      const k = b?.type ?? "unknown";
      blockCounts[k] = (blockCounts[k] ?? 0) + 1;
    }
    const textSnippet = (response.content as any[])
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("\n\n")
      .slice(0, 2000) || null;
    throw new DiscoveryNoSubmitError(
      `Discovery: submit_competitor_discoveries nicht aufgerufen. stop_reason=${response.stop_reason}`,
      {
        stop_reason: response.stop_reason ?? null,
        usage: {
          tokens_in: response.usage.input_tokens,
          tokens_out: response.usage.output_tokens,
        },
        web_search_uses: webSearchUses,
        block_counts: blockCounts,
        text_snippet: textSnippet,
      },
    );
  }
  const finalSubmit = submitBlocks[submitBlocks.length - 1];
  const output = CompetitorDiscoveryOutputSchema.parse(finalSubmit.input);

  return {
    output,
    usage: {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      cache_creation_input_tokens:
        (response.usage as any).cache_creation_input_tokens ?? 0,
      cache_read_input_tokens:
        (response.usage as any).cache_read_input_tokens ?? 0,
    },
    webSearchUses,
    raw: response,
  };
}

// ============================================================
// URL SEARCH (added after show-discovery block below)
// ============================================================
// SHOW DISCOVERY (Phase 10) — Messen suchen
// ============================================================

export const SHOW_DISCOVERY_MODEL = "claude-opus-4-7";
export const SHOW_DISCOVERY_MAX_TOKENS_DEFAULT = 16000;
export const SHOW_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT = 15;
const SHOW_DISCOVERY_TIMEOUT_MS = 1000 * 60 * 15;

export const SHOW_DISCOVERY_SYSTEM_DEFAULT = `Du bist Messe-Recherche-Spezialist fuer ISP Power Systems GmbH (Regensburg).

# ISP-Profil

ISP entwickelt anwendungsspezifische Batterie- und Antriebssysteme fuer professionelle
und militaerische Hardware. Keine Consumer-Produkte.

Zielkunden sind Hardware-Hersteller aller Groessenklassen, die fuer ihr Geraet eine
massgeschneiderte Energieversorgungs- oder Antriebsloesung brauchen:
- Grosse OEMs und Tier-1-Zulieferer (Rheinmetall, Airbus, Textron, Leonardo, ...)
- Mittelstaendische Spezialgeraete-Hersteller (Familienunternehmen, B2B, 50-2000 MA)
- Hardware-Startups die ein neues Geraet bauen und Power-System auslagern wollen

Typische Kundenprojekte:
- Batteriepack fuer einen militaerischen UGV oder UAS
- Antriebssystem fuer eine Industrie- oder Inspektionsdrohne
- Hochleistungs-Akku fuer medizinische oder Tauch-Ausruestung
- Bordnetz fuer Spezial- oder Einsatzfahrzeuge (CBRN, Pionier, MEDEVAC)
- Energiespeicher fuer autonome maritime Plattformen (AUV, USV)
- Antrieb fuer Exoskelette, Roboter-Plattformen, mobile Maschinen

Sektoren nach Prioritaet:
1. Defense / Wehrtechnik (Fahrzeuge, UxV, Infanterie-Systeme, C2, CBRN)
2. Aerospace / UAV / Drohnen (militaerisch + kommerziell)
3. Mobile Robotics (autonome Plattformen, Intralogistik-Roboter, Outdoor-AMR)
4. Maritime / Underwater (AUV, USV, Taucher-Systeme, Marineelektronik)
5. Space (Satelliten-Subsysteme, Raumfahrt-Komponenten)
6. Mobility / Sonderfahrzeuge (Offroad, Einsatzfahrzeuge, AGV, Exoskelette)

# Was eine Messe wertvoll macht

Ideal: Viele Hardware-Entwickler und Geraete-Hersteller, die Komponenten zukaufen.
Der Vertriebler findet dort Ansprechpartner aus Entwicklung und Beschaffung.

Starke Signale:
- Aussteller bauen eigene Hardware-Produkte (nicht nur Systemintegratoren oder Haendler)
- Mix aus grossen OEMs, Mittelstand und innovativen Startups mit Geraete-Fokus
- Beschaffungsentscheider von Bundeswehr, NATO, Polizei, Industrie als Besucher
- Shows mit klarem Produktfokus (Roboter, Drohnen, Fahrzeuge, maritime Systeme)
- Grosse Netzwerkdichte: 300+ Aussteller aus dem Kern-Sektor
- Etablierte Shows mit wiederkehrendem Fachpublikum

Brauchbar aber weniger stark:
- Startup-fokussierte Innovation-Events mit Hardware-Track (Geldfokus, aber fruehe Leads)
- Breit angelegte Industriemessen mit starkem Sektor-Cluster (z.B. Hannover Messe Robotics)

Nicht aufnehmen:
- Consumer Electronics (CES, IFA, Gamescom)
- Reine Software / IT / Cybersecurity ohne Hardware-Aussteller
- Reine Investoren-/Pitch-Events ohne Produktentwickler
- Akademische Konferenzen ohne Industrie-Aussteller

# Geografische Prioritaet

Primaer: DACH, Frankreich, Niederlande, Belgien, Skandinavien, Polen, Tschechien, UK, Italien
Sekundaer (nur bei Score >=7): USA (AUSA, Sea-Air-Space), VAE (IDEX), Singapur, Australien

# Zeitfenster

Bevorstehende Shows: 2025 bis Ende 2027.
Fuer wiederkehrende Shows die naechste bekannte Edition angeben.

# Scoring

9-10: Pflicht-Show. Kernsektor, hohe Ausstellerdichte aus ISP-Zielgruppe, OEM + Mittelstand
      + Startup-Mix, nachgewiesene Beschaffungsentscheider als Besucher.
7-8:  Gut. Sektor passt, Hardware-Hersteller dominant, aber etwas breiter oder kleiner.
5-6:  Teilrelevant. Adjacente Branche oder stark gemischtes Publikum. Nur aufnehmen
      wenn Fokus-Prompt es nahelegt.
<5:   Weglassen.

# Recherche-Pflichten

1. Mindestens 10 Web-Searches, gerne bis zum Limit. Deutsch + Englisch. Verschiedene Sektoren.
2. Branchenkalender nutzen: AUMA.de, events-eye.com, 10times.com, Reed Exhibitions,
   Messe Muenchen, Messe Berlin, Messe Frankfurt, ADS Group, BDSV, VDI Wissensforum.
3. Bekannte Ankerpunkte pruefen (Termin, naechste Edition): DSEI, Eurosatory, DVD,
   MSPO, Enforce Tac, Milipol, ILA Berlin, AERO Friedrichshafen, Hannover Messe,
   Automatica, UDT, Euronaval, SMM Hamburg, Europort, Ocean Business, LogiMAT.
4. Ausstellerlisten-URL: Suche pro Messe aktiv nach /exhibitors, /aussteller,
   /participants, /companies. URL eintragen wenn gefunden.
   has_exhibitor_list = false setzen wenn sicher keine Ausstellerliste existiert.

# Output-Regeln

- Antwort AUSSCHLIESSLICH ueber das submit_show_discoveries-Tool.
- Keine Em-Dashes. Freitext auf Deutsch, Show-/Firmennamen im Original.
- relevance_reasoning konkret: welche Aussteller-Typen und Besucher sind dort?
- Keine Dubletten. Pflicht: mindestens eine evidence_url pro Messe.
- reasoning-Feld: kurze Reflexion welche Suchstrategien die besten Treffer ergaben.`;

export const SHOW_DISCOVERY_USER_TEMPLATE_DEFAULT = `Suche nach relevanten Industriemessen fuer ISP Power Systems.

Fokus-Prompt:
{{user_prompt}}

Nutze das web_search-Tool aktiv (mindestens 10 Queries) bevor du submit_show_discoveries aufrufst.
Rufe submit_show_discoveries genau einmal mit der finalen Messe-Liste auf.`;

const SHOW_DISCOVERY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 2, maxLength: 200 },
          website: { type: "string", nullable: true },
          location_city: { type: "string", nullable: true },
          location_country: { type: "string", nullable: true },
          dates_raw: { type: "string", nullable: true },
          focus_description: { type: "string", minLength: 10, maxLength: 500 },
          target_audience: { type: "string", minLength: 5, maxLength: 300 },
          isp_sector_match: {
            type: "array",
            description: "Relevante ISP-Sektoren, z.B. 'defense', 'aerospace', 'mobile_robotics', 'maritime', 'space', 'mobility'.",
            items: { type: "string" },
            maxItems: 4,
          },
          is_recurring: { type: "boolean" },
          recurrence_note: { type: "string", nullable: true },
          relevance_score: { type: "integer", minimum: 0, maximum: 10 },
          relevance_reasoning: { type: "string", minLength: 10, maxLength: 600 },
          evidence_urls: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 4 },
          exhibitor_list_url: {
            type: "string",
            nullable: true,
            description: "Vollstaendige URL der Aussteller-Listen-Unterseite (z.B. /exhibitors). Nur setzen wenn gefunden.",
          },
          has_exhibitor_list: {
            type: "boolean",
            nullable: true,
            description: "false wenn mit Sicherheit keine Ausstellerliste existiert (Speaker-only-Konferenz etc.).",
          },
        },
        required: [
          "name",
          "focus_description",
          "target_audience",
          "isp_sector_match",
          "is_recurring",
          "relevance_score",
          "relevance_reasoning",
          "evidence_urls",
        ],
      },
    },
    reasoning: {
      type: "string",
      description: "Kurze Reflexion: welche Suchstrategien ergaben die besten Treffer, was wurde weggelassen.",
    },
  },
  required: ["items", "reasoning"],
} as const;

export type ShowDiscoveryItem = {
  name: string;
  website?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  dates_raw?: string | null;
  focus_description: string;
  target_audience: string;
  isp_sector_match: string[];
  is_recurring: boolean;
  recurrence_note?: string | null;
  relevance_score: number;
  relevance_reasoning: string;
  evidence_urls: string[];
  exhibitor_list_url?: string | null;
  has_exhibitor_list?: boolean | null;
};

export type ShowDiscoveryOutput = {
  items: ShowDiscoveryItem[];
  reasoning: string;
  /** web_search server_tool_use blocks extracted from the response, in order. */
  webSearchQueries: Array<{ query: string; result_count: number; result_titles: string[] }>;
};

export async function discoverShows(input: {
  userPrompt: string;
  prioContext: string;
  systemPrompt?: string | null;
  maxTokens?: number | null;
  maxWebSearches?: number | null;
}): Promise<{
  output: ShowDiscoveryOutput;
  usage: Usage & { cache_creation_input_tokens: number; cache_read_input_tokens: number };
  webSearchUses: number;
  raw: unknown;
}> {
  const maxTokens = pickInt(input.maxTokens, SHOW_DISCOVERY_MAX_TOKENS_DEFAULT, 500, 16000);
  const maxWebSearches = pickInt(input.maxWebSearches, SHOW_DISCOVERY_MAX_WEB_SEARCHES_DEFAULT, 0, 30);

  const systemText =
    input.systemPrompt && input.systemPrompt.trim().length > 0
      ? input.systemPrompt
      : SHOW_DISCOVERY_SYSTEM_DEFAULT;

  const userContent = SHOW_DISCOVERY_USER_TEMPLATE_DEFAULT.replace(
    "{{user_prompt}}",
    input.userPrompt.trim() || "(kein spezifischer Fokus — alle ISP-relevanten Sektoren und Regionen)",
  );

  const tools: any[] = [];
  if (maxWebSearches > 0) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: maxWebSearches });
  }
  tools.push({
    name: "submit_show_discoveries",
    description: "Submit the final list of discovered trade shows. Call exactly once after all web_search queries are complete.",
    input_schema: SHOW_DISCOVERY_INPUT_SCHEMA as any,
  });

  const response = await client().messages.create(
    {
      model: SHOW_DISCOVERY_MODEL,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: systemText, cache_control: { type: "ephemeral" } },
        { type: "text", text: input.prioContext, cache_control: { type: "ephemeral" } },
        { type: "text", text: catalogAsPromptBlock(), cache_control: { type: "ephemeral" } },
      ],
      tools,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: userContent }],
    },
    { timeout: SHOW_DISCOVERY_TIMEOUT_MS },
  );

  const webSearchUses = response.content.filter((b: any) => {
    return b?.type === "server_tool_use" && b?.name === "web_search";
  }).length;

  // Extract web_search queries + result metadata for the flowchart log.
  const webSearchQueries: ShowDiscoveryOutput["webSearchQueries"] = [];
  const contentBlocks = response.content as any[];
  for (const block of contentBlocks) {
    if (block?.type === "server_tool_use" && block?.name === "web_search") {
      const query: string = block?.input?.query ?? "";
      // Find the matching tool_result block (immediately following server_tool_use).
      const resultBlock = contentBlocks[contentBlocks.indexOf(block) + 1];
      let resultTitles: string[] = [];
      let resultCount = 0;
      if (resultBlock?.type === "tool_result" || resultBlock?.type === "server_tool_result") {
        const content = resultBlock?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (typeof c?.text === "string") {
              // Try to extract titles from web search result text snippets.
              const titleMatches = c.text.match(/^#+\s+(.+)$/gm) ?? [];
              resultTitles = titleMatches.map((t: string) => t.replace(/^#+\s+/, "")).slice(0, 5);
              resultCount = titleMatches.length;
            }
          }
        }
      }
      webSearchQueries.push({ query, result_count: resultCount, result_titles: resultTitles });
    }
  }

  const submitBlocks = response.content.filter(
    (b: any) => b?.type === "tool_use" && b?.name === "submit_show_discoveries",
  );
  if (submitBlocks.length === 0) {
    const blockCounts: Record<string, number> = {};
    for (const b of contentBlocks) {
      const k = (b as any)?.type ?? "unknown";
      blockCounts[k] = (blockCounts[k] ?? 0) + 1;
    }
    const textSnippet =
      contentBlocks
        .filter((b) => b?.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("\n\n")
        .slice(0, 2000) || null;
    throw new DiscoveryNoSubmitError(
      `Show Discovery: submit_show_discoveries nicht aufgerufen. stop_reason=${response.stop_reason}`,
      {
        stop_reason: response.stop_reason ?? null,
        usage: { tokens_in: response.usage.input_tokens, tokens_out: response.usage.output_tokens },
        web_search_uses: webSearchUses,
        block_counts: blockCounts,
        text_snippet: textSnippet,
      },
    );
  }

  const finalSubmit = submitBlocks[submitBlocks.length - 1] as any;
  const raw_output = finalSubmit.input as { items: ShowDiscoveryItem[]; reasoning: string };

  return {
    output: {
      items: raw_output.items ?? [],
      reasoning: raw_output.reasoning ?? "",
      webSearchQueries,
    },
    usage: {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      cache_creation_input_tokens: (response.usage as any).cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: (response.usage as any).cache_read_input_tokens ?? 0,
    },
    webSearchUses,
    raw: response,
  };
}

// ---------- URL SEARCH ----------

export const UrlSearchResultSchema = z.object({
  website_url: z
    .string()
    .nullable()
    .describe("Offizielle Firmen-Website-URL. null wenn nicht gefunden."),
  linkedin_url: z
    .string()
    .nullable()
    .describe("LinkedIn-Unternehmensseite-URL. null wenn nicht gefunden."),
  employee_estimate: z
    .string()
    .nullable()
    .describe(
      "Grobe Mitarbeiterzahl, z.B. '~200 Mitarbeiter', '50-200', 'Grosskonzern >5000'. null wenn nicht erkennbar.",
    ),
  search_description: z
    .string()
    .nullable()
    .describe(
      "1-2 Saetze was die Firma macht, direkt aus Suchergebnis-Snippet. null wenn nichts Verwertbares gefunden.",
    ),
});
export type UrlSearchResult = z.infer<typeof UrlSearchResultSchema>;

const URL_SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    website_url: { type: ["string", "null"] },
    linkedin_url: { type: ["string", "null"] },
    employee_estimate: { type: ["string", "null"] },
    search_description: { type: ["string", "null"] },
  },
  required: ["website_url", "linkedin_url", "employee_estimate", "search_description"],
} as const;

/**
 * Sucht per Anthropic native web_search die Website einer Messefirma
 * (die keine URL im Listing hatte) und extrahiert URL, LinkedIn,
 * Mitarbeiterzahl und Kurzbeschreibung.
 * Guenstiges Haiku-Modell, max 2 Suchen.
 */
export async function searchCompanyUrl(input: {
  companyName: string;
  profileData: Record<string, unknown> | null;
  booth: string | null;
}): Promise<{ result: UrlSearchResult; usage: Usage & { web_searches: number } }> {
  const pd = input.profileData ?? {};
  const ctx: string[] = [];
  if (input.booth) ctx.push(`Stand: ${input.booth}`);
  if (typeof pd.companyDescription === "string")
    ctx.push(`Beschreibung: ${pd.companyDescription}`);
  const cats = pd.categories;
  if (Array.isArray(cats) && cats.length > 0)
    ctx.push(`Kategorien: ${(cats as string[]).slice(0, 5).join(", ")}`);
  const addr = pd.address as Record<string, string> | undefined;
  if (addr?.country) ctx.push(`Land: ${addr.country}`);
  if (addr?.city) ctx.push(`Stadt: ${addr.city}`);

  const contextBlock = ctx.length > 0 ? "\n" + ctx.join("\n") : "";
  const userContent = `Firma: ${input.companyName}${contextBlock}

Suche die offizielle Website dieser Firma mit web_search. Finde ausserdem die LinkedIn-Unternehmensseite, eine grobe Mitarbeiterzahl und eine kurze Beschreibung. Rufe dann submit_url_result genau einmal auf.`;

  const response = await client().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: [
      {
        type: "text",
        text: "Du bist ein Research-Assistent fuer Messe-Sales-Intelligence. Suche die offizielle Firmen-Website und weitere Basisinfos. Antworte ausschliesslich ueber das submit_url_result-Tool.",
      },
    ],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 2 } as any,
      {
        name: "submit_url_result",
        description: "Submit the found URLs and company info. Call exactly once after searching.",
        input_schema: URL_SEARCH_INPUT_SCHEMA as any,
      },
    ],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userContent }],
  });

  const webSearches = response.content.filter(
    (b: any) => b.type === "server_tool_use" && b.name === "web_search",
  ).length;

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_url_result",
  );
  if (!toolUse) throw new Error(`URL search tool call missing. stop=${response.stop_reason}`);

  const result = UrlSearchResultSchema.parse(toolUse.input);
  return {
    result,
    usage: {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      web_searches: webSearches,
    },
  };
}

// ---------- TRADE-SHOW EXHIBITOR-URL SEARCH ----------

export const TradeShowUrlCandidateSchema = z.object({
  url: z.string().describe("Vollstaendige URL eines Kandidaten."),
  reason: z
    .string()
    .describe("Kurze Begruendung (1 Satz) warum dieser Kandidat in Frage kommt."),
});
export type TradeShowUrlCandidate = z.infer<typeof TradeShowUrlCandidateSchema>;

export const TradeShowUrlSearchResultSchema = z.object({
  url: z
    .string()
    .nullable()
    .describe(
      "Beste Aussteller-Listen-URL. Bevorzugt eine Sub-Seite wie /exhibitors oder /aussteller. null wenn nichts Eindeutiges gefunden.",
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe(
      "high = klare offizielle Aussteller-Liste; medium = plausibel aber nicht 100% bestaetigt; low = unsicher oder nur Homepage.",
    ),
  reasoning: z
    .string()
    .describe("1 bis 2 Saetze: warum diese URL gewaehlt wurde oder warum keine gefunden wurde."),
  candidates: z
    .array(TradeShowUrlCandidateSchema)
    .max(5)
    .describe("Weitere geprueft URLs (max 5), inkl. der gewaehlten. Leer wenn nichts gefunden."),
});
export type TradeShowUrlSearchResult = z.infer<typeof TradeShowUrlSearchResultSchema>;

const TRADE_SHOW_URL_SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    url: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reasoning: { type: "string" },
    candidates: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          reason: { type: "string" },
        },
        required: ["url", "reason"],
      },
    },
  },
  required: ["url", "confidence", "reasoning", "candidates"],
} as const;

/**
 * Sucht per Anthropic native web_search die wahrscheinlichste Aussteller-Listen-URL
 * fuer eine Messe (gegeben nur deren Name + Jahr). Bevorzugt offizielle Messen-Domains
 * und Sub-Pfade wie /exhibitors, /aussteller, /ausstellerverzeichnis.
 */
export async function searchTradeShowExhibitorUrl(input: {
  showName: string;
  year?: number | null;
}): Promise<{
  result: TradeShowUrlSearchResult;
  usage: Usage & { web_searches: number };
}> {
  const yearLine = input.year ? `\nJahr: ${input.year}` : "";
  const userContent = `Messe: ${input.showName}${yearLine}

Finde die offizielle Aussteller-Listen-URL dieser Messe. Suche aktiv per web_search nach Kombinationen wie:
- "<Messe-Name> exhibitors"
- "<Messe-Name> aussteller"
- "<Messe-Name> list of exhibitors"
- "<Messe-Name> ausstellerverzeichnis"

Bevorzuge eine Sub-Seite (z.B. /exhibitors, /aussteller, /ausstellerverzeichnis, /exhibitor-list), keine Homepage. Bevorzuge offizielle Messen-Domains, keine Drittanbieter-Aggregatoren. Wenn du nichts Eindeutiges findest, gib url=null und confidence=low zurueck. Rufe submit_listing_url genau einmal auf.`;

  const response = await client().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text:
          "Du bist ein Research-Assistent fuer Messe-Sales-Intelligence. Deine Aufgabe: fuer eine genannte Messe die direkte URL der Aussteller-Liste finden. Nicht die Startseite, nicht die Programm-Seite, sondern die Seite mit der durchsuchbaren oder paginierten Aussteller-Liste. Antworte ausschliesslich ueber das submit_listing_url-Tool.",
      },
    ],
    tools: [
      { type: "web_search_20250305", name: "web_search", max_uses: 5 } as any,
      {
        name: "submit_listing_url",
        description:
          "Submit the most likely exhibitor-list URL for the trade show. Call exactly once after searching.",
        input_schema: TRADE_SHOW_URL_SEARCH_INPUT_SCHEMA as any,
      },
    ],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userContent }],
  });

  const webSearches = response.content.filter(
    (b: any) => b.type === "server_tool_use" && b.name === "web_search",
  ).length;

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_listing_url",
  );
  if (!toolUse) {
    throw new Error(`Trade-show URL search tool call missing. stop=${response.stop_reason}`);
  }

  const result = TradeShowUrlSearchResultSchema.parse(toolUse.input);
  return {
    result,
    usage: {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
      web_searches: webSearches,
    },
  };
}
