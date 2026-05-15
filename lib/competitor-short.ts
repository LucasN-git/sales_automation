import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

let _anthropic: Anthropic | null = null;
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _anthropic;
}

export const CompetitorShortSchema = z.object({
  one_liner: z.string().describe("1 Satz: was diese Firma macht. Konkret, kein Marketing-Sprech."),
  positioning: z
    .string()
    .describe("2-4 Saetze: Marktpositionierung, Zielkunden, Unterschied zu Commodity-Anbietern."),
  portfolio: z
    .array(z.string())
    .min(1)
    .max(10)
    .describe("Produkt/Service-Liste, kurze Labels wie 'Custom Battery Pack', 'BMS Design'."),
  isp_sector_match: z
    .array(z.string())
    .max(3)
    .describe(
      "Ueberschneidende ISP-Sektoren aus: defense, aeronautics, mobile_robotics, space, maritime, mobility. Leer wenn kein direkter Wettbewerb.",
    ),
  threat_level: z
    .enum(["low", "medium", "high", "critical"])
    .describe(
      "low = anderer Markt/Nische; medium = teilweise Ueberschneidung; high = direkter Wettbewerb in ISP-Kernsektoren; critical = stark ueberlappend + aehnliche Groesse.",
    ),
  growth_signals: z
    .array(z.string())
    .max(5)
    .describe(
      "Konkrete Signale: Funding, neue Kunden, Expansionsplaene, Pressemitteilungen. Leer wenn keine gefunden.",
    ),
  competitive_angles_vs_isp: z
    .string()
    .describe(
      "Kurze Analyse: Wo konkurrieren sie direkt mit ISP? Was koennen sie besser/schlechter? Max 3 Saetze.",
    ),
});

export type CompetitorShortIntel = z.infer<typeof CompetitorShortSchema>;

const COMPETITOR_SHORT_SYSTEM = `Du bist ein Competitive-Intelligence-Analyst fuer ISP Power Systems GmbH. ISP entwickelt anwendungsspezifische Batterie- und elektrifizierte Antriebssysteme fuer Defense, Aeronautics, Mobile Robotics, Space, Maritime und Mobility. Validation-First, Custom-Engineering, europaeische Lieferkette.

Deine Aufgabe: Analysiere den Wettbewerber basierend auf dem mitgelieferten Website-Content und fuehre submit_competitor_short_intel mit strukturierten Ergebnissen aus.

Regeln:
- Sachlich und praezise, kein Marketing-Sprech
- Threat-Level bezieht sich auf direkte Konkurrenz zu ISP (nicht generelle Marktstaerke)
- Nutze nur Informationen aus dem Website-Content (kein Halluzinieren)
- Falls Informationen fehlen: conservativer Wert (low threat, leere arrays)`;

export type Usage = {
  tokens_in: number;
  tokens_out: number;
};

export async function enrichCompetitorShort(input: {
  websiteContent: string;
  competitorName: string;
  model: string;
}): Promise<{ intel: CompetitorShortIntel; usage: Usage }> {
  const userPrompt = `# Wettbewerber: ${input.competitorName}

## Website-Content
${input.websiteContent.slice(0, 8000)}

---

Analysiere diesen Wettbewerber und fuehre submit_competitor_short_intel aus.`;

  const response = await anthropic().messages.create({
    model: input.model,
    max_tokens: 2000,
    system: COMPETITOR_SHORT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    tools: [
      {
        name: "submit_competitor_short_intel",
        description: "Gibt die strukturierte Wettbewerber-Analyse zurueck.",
        input_schema: {
          type: "object" as const,
          properties: {
            one_liner: { type: "string" },
            positioning: { type: "string" },
            portfolio: { type: "array", items: { type: "string" } },
            isp_sector_match: { type: "array", items: { type: "string" } },
            threat_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            growth_signals: { type: "array", items: { type: "string" } },
            competitive_angles_vs_isp: { type: "string" },
          },
          required: [
            "one_liner",
            "positioning",
            "portfolio",
            "isp_sector_match",
            "threat_level",
            "growth_signals",
            "competitive_angles_vs_isp",
          ],
        },
      },
    ],
    tool_choice: { type: "any" },
  });

  const usage: Usage = {
    tokens_in: response.usage.input_tokens,
    tokens_out: response.usage.output_tokens,
  };

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("enrichCompetitorShort: Claude did not call submit_competitor_short_intel");
  }

  const intel = CompetitorShortSchema.parse(toolUse.input);
  return { intel, usage };
}
