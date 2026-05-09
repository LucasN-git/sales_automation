import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { catalogAsPromptBlock, SECTOR_IDS, LIFECYCLE_IDS } from "./isp-catalog";

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

const sectorEnum = z.enum(SECTOR_IDS as unknown as [string, ...string[]]);
const lifecycleEnum = z.enum(LIFECYCLE_IDS as unknown as [string, ...string[]]);

export const IntelSchema = z.object({
  business_field: z
    .string()
    .describe("Was die Firma macht, max. 1 Satz auf Deutsch."),
  estimated_size: z
    .string()
    .describe('Größe als "<50" / "50–250" / "250–1000" / ">1000 MA" plus 1-Satz-Begründung.'),
  power_needs_hypothesis: z
    .string()
    .describe(
      "1–3 Sätze auf Deutsch: welcher Power-/Batterie-/E-Drive-Bedarf ist plausibel und warum.",
    ),
  isp_sector_match: z
    .array(sectorEnum)
    .describe("Maximal 2 ISP-Sektoren, die zur Firma passen. Leer lassen, wenn kein Match."),
  isp_lifecycle_match: z
    .array(lifecycleEnum)
    .describe("ISP-Lifecycle-Stufen, die für diese Firma am wertvollsten sind."),
  match_confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("0–100. Wie zuversichtlich, dass ISP für diese Firma relevant ist."),
  pitch_hook: z
    .string()
    .describe('1–2 Sätze auf Deutsch: "Darauf ansprechen". Konkret, kein Marketing-Sprech.'),
  reasoning: z
    .string()
    .describe(
      "3–6 Sätze: warum dieses Match, welche Signale auf der Website, welche Differentiator von ISP relevant sind.",
    ),
});

export type Intel = z.infer<typeof IntelSchema>;

const SYSTEM_INSTRUCTION = `Du bist Sales-Intelligence-Analyst für ISP Power Systems. Deine Aufgabe: pro Aussteller einer Defense-/Industriemesse einschätzen, ob und wie ISP relevant ist.

Regeln:
- Sprache: Deutsch.
- Keine Em-Dashes, keine Superlative ("revolutionary", "world-class", "cutting-edge" sind verboten).
- Antworte AUSSCHLIESSLICH als gültiges JSON, kein Markdown, kein Prosa-Wrapper.
- Verwende NUR die kanonischen Sektor- und Lifecycle-IDs aus dem Capability-Katalog.
- Wenn die Firma offensichtlich kein Power/Batterie/E-Drive-Bezug hat, setze match_confidence niedrig (0–25) und isp_sector_match = [].
- Bei dünner Datenlage: match_confidence niedrig, ehrlich begründen.

Output-Schema (JSON):
{
  "business_field": string,
  "estimated_size": string,
  "power_needs_hypothesis": string,
  "isp_sector_match": [sector_id, ...],   // 0–2 Einträge
  "isp_lifecycle_match": [lifecycle_id, ...],
  "match_confidence": int 0–100,
  "pitch_hook": string,
  "reasoning": string
}`;

/**
 * Single-call enrichment: scraped website -> structured intel + ISP match.
 * Uses prompt caching on the system block (catalog + instructions).
 */
export async function enrichAndMatch(input: {
  companyName: string;
  website: string | null;
  scrapedMarkdown: string;
}): Promise<{ intel: Intel; raw: unknown }> {
  const userContent = `Firma: ${input.companyName}
Website: ${input.website ?? "(keine angegeben)"}

Scraped content (Markdown, ggf. gekürzt):
---
${input.scrapedMarkdown.slice(0, 20_000) || "(kein Content abrufbar — bewerte nur auf Basis des Namens, match_confidence entsprechend niedrig)"}
---

Liefere das JSON-Objekt gemäß Schema.`;

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_INSTRUCTION,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: catalogAsPromptBlock(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const json = extractJson(text);
  const parsed = IntelSchema.parse(json);
  return { intel: parsed, raw: response };
}

function extractJson(s: string): unknown {
  const trimmed = s.trim();
  // Strip ``` fences if present.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;
  // Find first { ... last } if there's noise around.
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in Claude response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
