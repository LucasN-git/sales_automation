import Anthropic from "@anthropic-ai/sdk";
import { catalogAsPromptBlock } from "./isp-catalog";
import { DiscoveryNoSubmitError } from "./claude";
import type { Usage } from "./claude";

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export const COMPANY_SEARCH_MODEL = "claude-opus-4-7";
export const COMPANY_SEARCH_MAX_TOKENS_DEFAULT = 8000;
export const COMPANY_SEARCH_MAX_WEB_SEARCHES_DEFAULT = 10;
const COMPANY_SEARCH_TIMEOUT_MS = 1000 * 60 * 15;

export const COMPANY_SEARCH_SYSTEM_DEFAULT = `Du bist Kunden-Discovery-Spezialist fuer ISP Power Systems GmbH.

# ISP-Profil

ISP entwickelt anwendungsspezifische Batterie- und Antriebssysteme fuer professionelle und militaerische Hardware. Keine Consumer-Produkte.

Zielkunden sind Hardware-Hersteller aller Groessenklassen, die fuer ihr Geraet eine massgeschneiderte Energieversorgungs- oder Antriebsloesung brauchen:
- Grosse OEMs und Tier-1-Zulieferer (Rheinmetall, Airbus, Textron, Leonardo, Thales, KNDS, Kongsberg, ...)
- Mittelstaendische Spezialgeraete-Hersteller (Familienunternehmen, B2B, 50-2000 MA)
- Hardware-Startups die ein neues Geraet bauen und Power-System auslagern wollen

Typische Kundenprojekte:
- Batteriepack fuer einen militaerischen UGV oder UAS
- Antriebssystem fuer eine Industrie- oder Inspektionsdrohne
- Hochleistungs-Akku fuer medizinische oder Tauch-Ausruestung
- Bordnetz fuer Spezial- oder Einsatzfahrzeuge (CBRN, Pionier, MEDEVAC)
- Energiespeicher fuer autonome maritime Plattformen (AUV, USV)
- Antrieb fuer Exoskelette, Roboter-Plattformen, mobile Maschinen

# Sektoren nach Prioritaet

1. Defense / Wehrtechnik (Fahrzeuge, UxV, Infanterie-Systeme, C2, CBRN)
2. Aerospace / UAV / Drohnen (militaerisch + kommerziell)
3. Mobile Robotics (autonome Plattformen, Intralogistik-Roboter, Outdoor-AMR)
4. Maritime / Underwater (AUV, USV, Taucher-Systeme, Marineelektronik)
5. Space (Satelliten-Subsysteme, Raumfahrt-Komponenten)
6. Mobility / Sonderfahrzeuge (Offroad, Einsatzfahrzeuge, AGV, Exoskelette)

# Was eine Firma wertvoll macht

Ideal: Hardware-Hersteller, der Energiespeicher oder Antriebe zukauft oder zukaufen koennte.
Starke Signale:
- Firm baut eigene Hardware-Produkte (keine reinen Software- oder Systemintegratoren)
- Geraet benoetigt Batterie oder elektrischen Antrieb
- Mittelstaendischer Spezialist oder Scale-up (50-2000 MA typisch; kleine aber innovative Startups auch aufnehmen)
- Procurement in DACH/Europa oder bekannter Austausch mit deutschen Lieferanten
- Aktuelle Produktentwicklung sichtbar (Stellenausschreibungen, Pressemitteilungen, Messe-Auftritte)

Nicht aufnehmen:
- Reine Systemintegratoren ohne eigene Hardware-Entwicklung
- Haendler oder Vertriebsgesellschaften ohne eigenes Produkt
- Consumer-Elektronik ohne professionellen Kontext
- Firmen ohne erkennbaren Elektrifizierungsbedarf
- Grosskonzerne ohne konkreten Ansprechpartner-Kontext (Boeing, Lockheed: nur aufnehmen wenn spezifische Business Unit bekannt)

# Scoring

9-10: Idealer Kandidat. Hardware-Produkt mit klarem Batterie/Antrieb-Bedarf, DACH/Europa, ISP-Groesse passend, aktive Entwicklung belegbar.
7-8:  Gut. Produktfokus klar, Bedarf herleitbar, aber evtl. groesserer Konzern oder indirekterer Fit.
5-6:  Teilrelevant. Adjacente Branche, Bedarf moglich aber nicht sicher. Nur aufnehmen wenn Fokus-Prompt es nahelegt.
<5:   Weglassen.

# Recherche-Pflichten

1. Mindestens 8 Web-Searches, gerne bis zum Limit. Deutsch + Englisch.
2. Quellen nutzen: LinkedIn Firmensuche, Branchenverbände (BDSV, BDLI, VDI, VDMA, EUROSATORY-Aussteller-PDFs), Messe-Ausstellerlisten, Startup-Datenbanken (Crunchbase, Dealroom).
3. Pro gefundener Firma mindestens eine evidence_url angeben.
4. Keine Dubletten.

# Output-Regeln

- Antwort AUSSCHLIESSLICH ueber das submit_company_discoveries-Tool.
- Keine Em-Dashes. Freitext auf Deutsch, Firmennamen im Original.
- relevance_reasoning konkret: welches Produkt, welcher Bedarf, warum ISP?
- reasoning-Feld: kurze Reflexion welche Suchstrategien die besten Treffer ergaben.`;

export const COMPANY_SEARCH_USER_TEMPLATE_DEFAULT = `Suche nach potenziellen Kunden fuer ISP Power Systems.

Fokus-Prompt:
{{user_prompt}}

Nutze das web_search-Tool aktiv (mindestens 8 Queries) bevor du submit_company_discoveries aufrufst.
Rufe submit_company_discoveries genau einmal mit der finalen Firmen-Liste auf.`;

const COMPANY_SEARCH_INPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 60,
      items: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 2, maxLength: 200 },
          website: { type: "string", nullable: true },
          location_city: { type: "string", nullable: true },
          location_country: { type: "string", nullable: true },
          description: { type: "string", minLength: 10, maxLength: 500 },
          isp_sector_match: {
            type: "array",
            description: "Relevante ISP-Sektoren: defense | aeronautics | mobile_robotics | space | maritime | mobility",
            items: { type: "string" },
            maxItems: 4,
          },
          relevance_score: { type: "integer", minimum: 0, maximum: 10 },
          relevance_reasoning: { type: "string", minLength: 10, maxLength: 600 },
          evidence_urls: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 4 },
        },
        required: [
          "name",
          "description",
          "isp_sector_match",
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

export type CompanySearchItem = {
  name: string;
  website?: string | null;
  location_city?: string | null;
  location_country?: string | null;
  description: string;
  isp_sector_match: string[];
  relevance_score: number;
  relevance_reasoning: string;
  evidence_urls: string[];
};

export type CompanySearchOutput = {
  items: CompanySearchItem[];
  reasoning: string;
  webSearchQueries: Array<{ query: string; result_count: number; result_titles: string[] }>;
};

export async function discoverCompanies(input: {
  userPrompt: string;
  prioContext: string;
  systemPrompt?: string | null;
  maxTokens?: number | null;
  maxWebSearches?: number | null;
}): Promise<{
  output: CompanySearchOutput;
  usage: Usage & { cache_creation_input_tokens: number; cache_read_input_tokens: number };
  webSearchUses: number;
  raw: unknown;
}> {
  function pickInt(v: number | null | undefined, fb: number, min: number, max: number) {
    if (typeof v !== "number" || !Number.isFinite(v)) return fb;
    return Math.max(min, Math.min(max, Math.trunc(v)));
  }

  const maxTokens = pickInt(input.maxTokens, COMPANY_SEARCH_MAX_TOKENS_DEFAULT, 500, 16000);
  const maxWebSearches = pickInt(input.maxWebSearches, COMPANY_SEARCH_MAX_WEB_SEARCHES_DEFAULT, 0, 30);

  const systemText =
    input.systemPrompt && input.systemPrompt.trim().length > 0
      ? input.systemPrompt
      : COMPANY_SEARCH_SYSTEM_DEFAULT;

  const userContent = COMPANY_SEARCH_USER_TEMPLATE_DEFAULT.replace(
    "{{user_prompt}}",
    input.userPrompt.trim() || "(kein spezifischer Fokus — alle ISP-relevanten Sektoren)",
  );

  const tools: any[] = [];
  if (maxWebSearches > 0) {
    tools.push({ type: "web_search_20250305", name: "web_search", max_uses: maxWebSearches });
  }
  tools.push({
    name: "submit_company_discoveries",
    description:
      "Submit the final list of discovered potential customers. Call exactly once after all web_search queries are complete.",
    input_schema: COMPANY_SEARCH_INPUT_SCHEMA as any,
  });

  const response = await client().messages.create(
    {
      model: COMPANY_SEARCH_MODEL,
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
    { timeout: COMPANY_SEARCH_TIMEOUT_MS },
  );

  const webSearchUses = response.content.filter((b: any) => {
    return b?.type === "server_tool_use" && b?.name === "web_search";
  }).length;

  const webSearchQueries: CompanySearchOutput["webSearchQueries"] = [];
  const contentBlocks = response.content as any[];
  for (const block of contentBlocks) {
    if (block?.type === "server_tool_use" && block?.name === "web_search") {
      const query: string = block?.input?.query ?? "";
      const resultBlock = contentBlocks[contentBlocks.indexOf(block) + 1];
      let resultTitles: string[] = [];
      let resultCount = 0;
      if (resultBlock?.type === "tool_result" || resultBlock?.type === "server_tool_result") {
        const content = resultBlock?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (typeof c?.text === "string") {
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
    (b: any) => b?.type === "tool_use" && b?.name === "submit_company_discoveries",
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
      `Company Search: submit_company_discoveries nicht aufgerufen. stop_reason=${response.stop_reason}`,
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
  const raw_output = finalSubmit.input as { items: CompanySearchItem[]; reasoning: string };

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

// ---------------------------------------------------------------------------
// Haiku short-enrich for a single company website
// ---------------------------------------------------------------------------

const COMPANY_ENRICH_SCHEMA = {
  type: "object",
  properties: {
    one_liner: { type: "string", maxLength: 200 },
    priority_label: { type: "string", enum: ["hoch", "mittel", "niedrig"] },
    match_confidence: { type: "integer", minimum: 0, maximum: 100 },
    isp_sector_match_detail: {
      type: "array",
      items: { type: "string" },
      maxItems: 4,
    },
    reasoning_bullets: { type: "string", maxLength: 600 },
    battery_need: { type: "string", maxLength: 300 },
    user_group: { type: "string", maxLength: 200 },
  },
  required: [
    "one_liner",
    "priority_label",
    "match_confidence",
    "isp_sector_match_detail",
    "reasoning_bullets",
    "battery_need",
    "user_group",
  ],
} as const;

export type CompanyEnrichShort = {
  one_liner: string;
  priority_label: "hoch" | "mittel" | "niedrig";
  match_confidence: number;
  isp_sector_match_detail: string[];
  reasoning_bullets: string;
  battery_need: string;
  user_group: string;
};

export async function enrichCompanyShort(input: {
  name: string;
  website: string | null;
  description: string;
  siteContent: string;
  prioContext: string;
}): Promise<{ result: CompanyEnrichShort; usage: Usage }> {
  const userContent = `Firma: ${input.name}
Website: ${input.website ?? "(keine)"}
Beschreibung (aus Discovery): ${input.description}

Website-Inhalt:
${input.siteContent.slice(0, 8000)}

Erstelle eine kurze ISP-Sales-Analyse dieser Firma. Rufe submit_company_short genau einmal auf.`;

  const systemPrompt = `Du bist ISP Power Systems Sales-Analyst. ISP entwickelt anwendungsspezifische Batterie- und Antriebssysteme fuer Defense, Aerospace, Mobile Robotics, Maritime, Space und Mobility. Analysiere die gegebene Firma als potenziellen Kunden.

Sektoren: defense | aeronautics | mobile_robotics | space | maritime | mobility
Priority: hoch (klarer Bedarf, direkte Ansprache moeglich) | mittel (Bedarf herleitbar) | niedrig (schwacher Fit)
match_confidence: 0-100 (Wie sicher bist du, dass ISP hier landen kann?)`;

  const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const response = await c.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
      { type: "text", text: input.prioContext, cache_control: { type: "ephemeral" } },
      { type: "text", text: catalogAsPromptBlock(), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userContent }],
    tools: [
      {
        name: "submit_company_short",
        description: "Submit the short ISP sales analysis for this company.",
        input_schema: COMPANY_ENRICH_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: "submit_company_short" },
  });

  const toolBlock = response.content.find((b: any) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return {
      result: {
        one_liner: input.description.slice(0, 200),
        priority_label: "niedrig",
        match_confidence: 20,
        isp_sector_match_detail: [],
        reasoning_bullets: "Analyse fehlgeschlagen.",
        battery_need: "",
        user_group: "",
      },
      usage: {
        tokens_in: response.usage.input_tokens,
        tokens_out: response.usage.output_tokens,
      },
    };
  }

  return {
    result: toolBlock.input as CompanyEnrichShort,
    usage: {
      tokens_in: response.usage.input_tokens,
      tokens_out: response.usage.output_tokens,
    },
  };
}
