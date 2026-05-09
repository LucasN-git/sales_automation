export const ISP_CATALOG = {
  positioning:
    "ISP Power Systems entwickelt, fertigt und vertreibt anwendungsspezifische Batterie- und elektrifizierte Antriebssysteme. Keine Off-the-Shelf-Lösungen, sondern jeweils auf den Use-Case getailorte Systeme. Validation-first: Anforderungen führen über Test-Bench in die Konstruktion.",
  sectors: [
    { id: "defense", name: "Defense", scope: "Ground, Air, Sea, UAVs" },
    { id: "aeronautics", name: "Aeronautics", scope: "Aircraft, High-Altitude Platforms" },
    { id: "mobile_robotics", name: "Mobile Robotics", scope: "Autonomous Platforms, AGVs" },
    { id: "space", name: "Space", scope: "Spacecraft, Orbital Systems" },
    { id: "maritime", name: "Maritime", scope: "Vessels, Underwater Platforms" },
    { id: "mobility", name: "Mobility", scope: "Alternative Mobility Approaches" },
  ],
  lifecycle: [
    { id: "cell_selection", step: "01", name: "Cell Selection & System Design" },
    { id: "engineering", step: "02", name: "Engineering & Development (Mechanik, Elektrik, Thermik)" },
    { id: "prototyping", step: "03", name: "Prototyping & Testing (Performance, Safety, Abuse)" },
    { id: "integration", step: "04", name: "Integration & Commissioning" },
    { id: "industrialization", step: "05", name: "Industrialization & Production" },
    { id: "lifecycle_service", step: "06", name: "Diagnostics, Updates, Repairs, Second Life" },
  ],
  differentiators: [
    "In-house Batterie-Test-Center seit 2020 (Climate Chambers, Cycling, Abuse, Lifetime auf Cell/Modul/Pack-Level)",
    "30+ Jahre Test-Infrastruktur (ISP The Testing Institute, seit 1994)",
    "Validation-first Design (Anforderungen → Test-Bench → Konstruktion)",
    "Europäische Lieferkette, R&D in Salzbergen und München",
  ],
} as const;

export type SectorId = (typeof ISP_CATALOG.sectors)[number]["id"];
export type LifecycleId = (typeof ISP_CATALOG.lifecycle)[number]["id"];

export const SECTOR_IDS = ISP_CATALOG.sectors.map((s) => s.id);
export const LIFECYCLE_IDS = ISP_CATALOG.lifecycle.map((l) => l.id);

export function catalogAsPromptBlock(): string {
  const sectors = ISP_CATALOG.sectors
    .map((s) => `  ${s.id}: ${s.name} (${s.scope})`)
    .join("\n");
  const lifecycle = ISP_CATALOG.lifecycle
    .map((l) => `  ${l.id} (${l.step}): ${l.name}`)
    .join("\n");
  const diffs = ISP_CATALOG.differentiators.map((d) => `  - ${d}`).join("\n");
  return `# ISP Power Systems — Capability Catalog

## Positioning
${ISP_CATALOG.positioning}

## Target Sectors (canonical IDs)
${sectors}

## Lifecycle Capabilities (canonical IDs)
${lifecycle}

## Differentiators
${diffs}

When matching a prospect, use ONLY the canonical sector and lifecycle IDs above.`;
}
