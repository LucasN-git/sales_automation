import { PhaseRow } from "@/components/show-views/PhaseRow";
import type { Phase } from "@/components/show-views/types";

export type DiscoveryRunStatus = "pending" | "running" | "done" | "failed";
export type DiscoveryPhaseKey =
  | "preparing"
  | "preparing_prompt"
  | "claude_research"
  | "persisting"
  | "done"
  | "failed";

const PHASE_ORDER: DiscoveryPhaseKey[] = [
  "preparing",
  "preparing_prompt",
  "claude_research",
  "persisting",
  "done",
];

function statusFor(
  phase: DiscoveryPhaseKey,
  current: DiscoveryPhaseKey | null,
  runStatus: DiscoveryRunStatus,
): Phase["status"] {
  if (runStatus === "failed") {
    if (current === phase) return "failed";
    const idx = PHASE_ORDER.indexOf(phase);
    const curIdx = current ? PHASE_ORDER.indexOf(current) : -1;
    if (idx <= curIdx) return "done";
    return "pending";
  }
  if (runStatus === "done") return "done";
  if (!current) return phase === "preparing" ? "running" : "pending";
  const idx = PHASE_ORDER.indexOf(phase);
  const curIdx = PHASE_ORDER.indexOf(current);
  if (idx < curIdx) return "done";
  if (idx === curIdx) return "running";
  return "pending";
}

export function DiscoveryPhasesView({
  runStatus,
  currentPhase,
  errorMessage,
  candidatesTotal,
  candidatesKept,
  webSearchUses,
  maxWebSearches,
}: {
  runStatus: DiscoveryRunStatus;
  currentPhase: DiscoveryPhaseKey | null;
  errorMessage: string | null;
  candidatesTotal: number | null;
  candidatesKept: number | null;
  webSearchUses: number | null;
  maxWebSearches: number | null;
}) {
  const phases: Phase[] = [
    {
      num: "00",
      label: "Lauf vorbereiten",
      status: statusFor("preparing", currentPhase, runStatus),
      detail: "Run-Row anlegen, Status auf running",
    },
    {
      num: "01",
      label: "Prompt zusammenstellen",
      status: statusFor("preparing_prompt", currentPhase, runStatus),
      detail: "Settings + Prio-Kontext + Catalog laden",
    },
    {
      num: "02",
      label: "Claude recherchiert",
      status: statusFor("claude_research", currentPhase, runStatus),
      detail:
        currentPhase === "claude_research" && runStatus === "running"
          ? webSearchUses && webSearchUses > 0
            ? `Web-Search laeuft (${webSearchUses}${maxWebSearches ? `/${maxWebSearches}` : ""} bisher)`
            : `Anthropic Web-Search aktiv${maxWebSearches ? ` (max ${maxWebSearches})` : ""}`
          : webSearchUses !== null && webSearchUses > 0
          ? `${webSearchUses} Web-Search(es) verbraucht`
          : "Anthropic + Web-Search",
      sub:
        currentPhase === "claude_research" && runStatus === "running"
          ? [
              "aktuell",
              "Claude waehlt Queries, ruft web_search auf, baut Vorschlagsliste",
            ]
          : undefined,
    },
    {
      num: "03",
      label: "Vorschlaege persistieren",
      status: statusFor("persisting", currentPhase, runStatus),
      detail:
        candidatesTotal !== null
          ? `${candidatesKept ?? 0}/${candidatesTotal} gespeichert (Rest waren Dubletten)`
          : "Dedup gegen vorhandene Konkurrenten",
    },
    {
      num: "04",
      label: "Lauf abgeschlossen",
      status: statusFor("done", currentPhase, runStatus),
      detail:
        runStatus === "done" && candidatesKept !== null
          ? `${candidatesKept} Vorschlaege final`
          : runStatus === "failed"
          ? errorMessage ?? "Fehlgeschlagen"
          : "Wartet",
    },
  ];

  return (
    <ol className="space-y-0">
      {phases.map((p, i) => (
        <PhaseRow key={p.num} phase={p} isLast={i === phases.length - 1} />
      ))}
    </ol>
  );
}
