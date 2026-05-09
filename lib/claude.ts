import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { catalogAsPromptBlock, SECTOR_IDS, LIFECYCLE_IDS } from "./isp-catalog";

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

export type Usage = { tokens_in: number; tokens_out: number };

const sectorEnum = z.enum(SECTOR_IDS as unknown as [string, ...string[]]);
const lifecycleEnum = z.enum(LIFECYCLE_IDS as unknown as [string, ...string[]]);

// ---------- SHORT ----------

export const ShortIntelSchema = z.object({
  one_liner: z
    .string()
    .describe("1 Satz auf Deutsch: was die Firma macht. Konkret, kein Marketing-Sprech."),
  priority_label: z
    .enum(["hot", "warm", "cold"])
    .describe("Hot/Warm/Cold-Einordnung gemäß Prio-Kontext."),
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
});
export type ShortIntel = z.infer<typeof ShortIntelSchema>;

const SHORT_SYSTEM = `Du bist Sales-Intelligence-Analyst fuer ISP Power Systems. Analysiere einen einzelnen Messe-Aussteller und liefere eine sehr kurze Erst-Einschaetzung.

Regeln:
- Deutsch.
- Keine Em-Dashes, keine Superlative ("revolutionary", "world-class" verboten).
- Antworte ausschliesslich ueber das submit_short_intel-Tool.
- Verwende NUR die kanonischen Sektor-IDs aus dem Capability-Katalog.
- Bei duenner Datenlage: confidence niedrig, Begruendung implizit ueber priority_label "cold".

Priority-Mapping:
- "hot": match_confidence 70-100, eindeutiger Bedarf an ISP-Loesungen.
- "warm": 30-69, plausibler Bedarf in Nachbarbereich oder Channel.
- "cold": 0-29, kein erkennbarer Bedarf oder Disqualifier.`;

const SHORT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    one_liner: { type: "string" },
    priority_label: { type: "string", enum: ["hot", "warm", "cold"] },
    match_confidence: { type: "integer", minimum: 0, maximum: 100 },
    isp_sector_match: {
      type: "array",
      items: { type: "string", enum: SECTOR_IDS },
      maxItems: 2,
    },
  },
  required: ["one_liner", "priority_label", "match_confidence", "isp_sector_match"],
} as const;

export async function enrichShort(input: {
  companyName: string;
  website: string | null;
  scrapedMarkdown: string;
  prioContext: string;
  model: string;
}): Promise<{ intel: ShortIntel; usage: Usage; raw: unknown }> {
  const userContent = `Firma: ${input.companyName}
Website: ${input.website ?? "(keine angegeben)"}

Scraped content (Markdown, gekuerzt):
---
${input.scrapedMarkdown.slice(0, 10_000) || "(kein Content abrufbar)"}
---

Rufe submit_short_intel mit Erst-Einschaetzung auf.`;

  const response = await client().messages.create({
    model: input.model,
    max_tokens: 800,
    system: [
      {
        type: "text",
        text: SHORT_SYSTEM,
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
        name: "submit_short_intel",
        description: "Submit the short-tier exhibitor analysis. Call exactly once.",
        input_schema: SHORT_INPUT_SCHEMA as any,
      },
    ],
    tool_choice: { type: "tool", name: "submit_short_intel" },
    messages: [{ role: "user", content: userContent }],
  });

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
  full_reasoning: z
    .string()
    .describe("Ausfuehrliche Begruendung: Signale aus dem Content, ISP-Differentiator-Match, Risiken."),
});
export type DeepIntel = z.infer<typeof DeepIntelSchema>;

const DEEP_SYSTEM = `Du bist Senior-Sales-Strategy-Analyst fuer ISP Power Systems. Erstelle eine tiefgehende Recherche zu einem bestimmten Aussteller, damit der Vertriebler ihn am Messe-Stand professionell ansprechen kann.

Regeln:
- Deutsch.
- Keine Em-Dashes, keine Superlative.
- Antworte ausschliesslich ueber das submit_deep_intel-Tool.
- Sei konkret, kein Marketing-Bla. Wenn etwas unklar ist, das ehrlich sagen.
- Verwende NUR kanonische Lifecycle-IDs aus dem Capability-Katalog.

Du hast als Input zusaetzlich die Short-Einschaetzung (priority_label + match_confidence) plus den vollstaendigeren Website-Inhalt. Nutze beides.`;

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
    "full_reasoning",
  ],
} as const;

export async function enrichDeep(input: {
  companyName: string;
  website: string | null;
  scrapedMarkdown: string;
  prioContext: string;
  model: string;
  shortContext: ShortIntel | null;
}): Promise<{ intel: DeepIntel; usage: Usage; raw: unknown }> {
  const shortBlock = input.shortContext
    ? `\n\nBisherige Short-Einschaetzung:
- one_liner: ${input.shortContext.one_liner}
- priority_label: ${input.shortContext.priority_label}
- match_confidence: ${input.shortContext.match_confidence}
- isp_sector_match: ${input.shortContext.isp_sector_match.join(", ") || "(keine)"}\n`
    : "";

  const userContent = `Firma: ${input.companyName}
Website: ${input.website ?? "(keine angegeben)"}
${shortBlock}

Scraped content (Markdown, vollstaendig):
---
${input.scrapedMarkdown.slice(0, 30_000) || "(kein Content abrufbar)"}
---

Rufe submit_deep_intel mit allen Feldern auf.`;

  const response = await client().messages.create({
    model: input.model,
    max_tokens: 3000,
    system: [
      {
        type: "text",
        text: DEEP_SYSTEM,
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
  company_name: string;
  website: string | null;
  booth: string | null;
  one_liner: string | null;
  priority_label: string | null;
  match_confidence: number | null;
  isp_sector_match: string[];
};

const CHAT_SYSTEM = `Du bist Sales-Intelligence-Assistent fuer ISP Power Systems. Der Vertriebler stellt dir Fragen ueber die Aussteller einer Messe; du beantwortest sie auf Basis des unten gelieferten Aussteller-Kontexts.

Regeln:
- Deutsch.
- Knapp und konkret. Keine Em-Dashes, keine Superlative.
- Keine Behauptungen, die nicht durch den Aussteller-Kontext gestuetzt sind.
- Wenn der Kontext nicht reicht: das ehrlich sagen.
- Bei "Top X" oder "Hot Leads": match_confidence absteigend sortieren, priority_label "hot" bevorzugen.
- Bei Empfehlungen kurz begruenden, welcher ISP-Sektor / Lifecycle-Schritt passt.
- Bei Aufzaehlungen: Bullet-Liste oder kurze Tabelle.`;

export async function* chatStream(input: {
  prioContext: string;
  exhibitors: ExhibitorChatContext[];
  history: ChatTurn[];
  userMessage: string;
  model: string;
  withWebSearch?: boolean;
  deepContext?: Record<string, unknown> | null;
  showContext?: string | null;
}): AsyncGenerator<{
  type: "text" | "done" | "usage" | "search";
  text?: string;
  usage?: Usage;
  search?: { query?: string; result_count?: number };
}> {
  const exhibitorBlock = JSON.stringify(input.exhibitors, null, 2);

  const systemBlocks: any[] = [
    { type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: input.prioContext, cache_control: { type: "ephemeral" } },
    { type: "text", text: catalogAsPromptBlock(), cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: `# Aussteller-Kontext (JSON)\n\n${exhibitorBlock}`,
      cache_control: { type: "ephemeral" },
    },
  ];
  if (input.showContext && input.showContext.trim().length > 0) {
    systemBlocks.push({
      type: "text",
      text: `# Messe-spezifischer Kontext\n\n${input.showContext.trim()}`,
      cache_control: { type: "ephemeral" },
    });
  }
  if (input.deepContext) {
    systemBlocks.push({
      type: "text",
      text: `# Deep-Dive zum aktuellen Aussteller (JSON)\n\n${JSON.stringify(input.deepContext, null, 2)}`,
      cache_control: { type: "ephemeral" },
    });
  }

  // Anthropic native web_search tool. The tool is server-side, no callback
  // needed — Claude calls it, search results stream back as additional content.
  const tools: any[] = input.withWebSearch
    ? [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }]
    : [];

  const stream = client().messages.stream({
    model: input.model,
    max_tokens: 2500,
    system: systemBlocks,
    ...(tools.length ? { tools } : {}),
    messages: [
      ...input.history.map((t) => ({ role: t.role, content: t.content })),
      { role: "user" as const, content: input.userMessage },
    ],
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
  yield {
    type: "usage",
    usage: {
      tokens_in: final.usage.input_tokens,
      tokens_out: final.usage.output_tokens,
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
