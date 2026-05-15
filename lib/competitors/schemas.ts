import { z } from "zod";
import { SECTOR_IDS } from "../isp-catalog";

const sectorEnum = z.enum(SECTOR_IDS);

// ---------- DISCOVERY ----------
//
// Claude + Anthropic-Web-Search erzeugt eine Vorschlagsliste von Competitors.
// User kuratiert (CurateQueue) und akzeptiert oder verwirft. Akzeptierte Eintraege
// gehen dann durch Short/Deep-Tier (zweite Welle).

export const CompetitorDiscoveryItemSchema = z.object({
  display_name: z
    .string()
    .min(2)
    .max(200)
    .describe("Firmenname wie auf der Website / im Markt gefuehrt."),
  website: z
    .string()
    .nullable()
    .optional()
    .describe("Hauptdomain als URL (https://...). Null wenn nicht ermittelbar."),
  hq_country: z
    .string()
    .nullable()
    .optional()
    .describe("ISO-Country-Code oder Klartext (DE, US, FR ...). Null wenn unklar."),
  isp_sector_match: z
    .array(sectorEnum)
    .max(3)
    .describe(
      "0-3 ISP-Sektoren in denen dieser Competitor gegen ISP antritt. Leer wenn rein adjazent.",
    ),
  why_competitor: z
    .string()
    .min(10)
    .max(600)
    .describe(
      "1-3 Saetze auf Deutsch: warum ist diese Firma ein Competitor von ISP? Konkret welches Produkt / welche Loesung positioniert sie wo ISP auch positioniert ist. Keine Em-Dashes.",
    ),
  evidence_urls: z
    .array(z.string().url())
    .min(1)
    .max(5)
    .describe(
      "1-5 URLs als Evidenz fuer die Einordnung als Competitor. Mindestens eine, sonst Vorschlag verwerfen.",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Wie sicher dieser Vorschlag ist (0..1). 0.6+ = zuverlaessig."),
});
export type CompetitorDiscoveryItem = z.infer<typeof CompetitorDiscoveryItemSchema>;

export const CompetitorDiscoveryOutputSchema = z.object({
  items: z
    .array(CompetitorDiscoveryItemSchema)
    .min(0)
    .max(50)
    .describe("Liste der vorgeschlagenen Competitors. Max 50 Eintraege."),
  reasoning: z
    .string()
    .describe(
      "Kurze Reflektion: nach welchen Kriterien wurde gesucht, was wurde bewusst weggelassen, wo ist die Datenlage duenn.",
    ),
});
export type CompetitorDiscoveryOutput = z.infer<typeof CompetitorDiscoveryOutputSchema>;

// JSON-Schema-Variante fuer das Anthropic-Tool (input_schema).
export const COMPETITOR_DISCOVERY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        properties: {
          display_name: { type: "string", minLength: 2, maxLength: 200 },
          website: { type: ["string", "null"] },
          hq_country: { type: ["string", "null"] },
          isp_sector_match: {
            type: "array",
            maxItems: 3,
            items: { type: "string", enum: SECTOR_IDS },
          },
          why_competitor: { type: "string", minLength: 10, maxLength: 600 },
          evidence_urls: {
            type: "array",
            minItems: 1,
            maxItems: 5,
            items: { type: "string" },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: [
          "display_name",
          "isp_sector_match",
          "why_competitor",
          "evidence_urls",
          "confidence",
        ],
      },
    },
    reasoning: { type: "string" },
  },
  required: ["items", "reasoning"],
} as const;

// ---------- DISCOVERY-INPUT (User-Side) ----------
//
// Filter aus dem DiscoveryDialog: optionale Sektor-Vorgabe, optionale Region.
// Defaults: alle Sektoren, keine Region-Constraint.

export const CompetitorDiscoveryRequestSchema = z.object({
  sector_focus: z
    .array(sectorEnum)
    .max(6)
    .optional()
    .describe("Optional: Sektor-Filter. Leer / fehlt = alle ISP-Sektoren."),
  region_focus: z
    .string()
    .max(100)
    .optional()
    .describe("Optional: Klartext-Region (z.B. 'Europa', 'DACH', 'NATO'). Leer = global."),
  target_count: z
    .number()
    .int()
    .min(5)
    .max(50)
    .default(20)
    .describe("Wie viele Vorschlaege Claude liefern soll. 5-50."),
  notes: z
    .string()
    .max(2000)
    .optional()
    .describe("Optional: zusaetzliche Hinweise (z.B. 'fokussiere auf Mid-Size, keine Konzerne')."),
});
export type CompetitorDiscoveryRequest = z.infer<typeof CompetitorDiscoveryRequestSchema>;
