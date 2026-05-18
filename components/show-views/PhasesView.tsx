import type { CrawlPlan } from "@/lib/crawl-plan";
import { planSummary } from "@/lib/crawl-plan";
import { PhaseRow } from "./PhaseRow";
import type { ExhibitorLite, Phase } from "./types";

const STEP_LABELS: Record<string, string> = {
  discovering: "Claude analysiert Site-Struktur",
  fetching_list: "Aussteller-Liste von URL holen",
  inserting_exhibitors: "Aussteller in DB schreiben",
  scraping: "Firecrawl: Website laden",
  analyzing: "Claude: Match analysieren",
  saving: "Ergebnisse speichern",
  deep_scraping: "Firecrawl: Website (Deep)",
  deep_analyzing: "Claude: Deep-Analyse",
  scraping_single_page: "Firecrawl: Einzelseite laden",
  clicking_show_more: "Firecrawl: Show-more klicken",
};

function stepLabel(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^listing:([^:]+)(?::(.+))?$/.exec(s);
  if (m) {
    const sub = m[2];
    if (!sub) return "Listing-Plan startet";
    const letter = /^letter_(.+?)(?:_.*)?$/.exec(sub);
    if (letter) {
      const tail = sub.slice(letter[0].length);
      return tail ? `Buchstabe ${letter[1]}${tail}` : `Buchstabe ${letter[1]}`;
    }
    const page = /^page_(\d+)$/.exec(sub);
    if (page) return `Seite ${page[1]}`;
    return STEP_LABELS[sub] ?? sub;
  }
  return STEP_LABELS[s] ?? s;
}

export function PhasesView({
  showStatus,
  showCurrentStep,
  errorMessage,
  exhibitors,
  crawlPlan,
}: {
  showStatus: string;
  showCurrentStep: string | null;
  errorMessage: string | null;
  exhibitors: ExhibitorLite[];
  crawlPlan: CrawlPlan | null;
}) {
  const total = exhibitors.length;
  const shortDone = exhibitors.filter((e) => e.short_status === "done").length;
  const shortFailed = exhibitors.filter((e) => e.short_status === "failed").length;
  const shortRunning = exhibitors.filter((e) => e.short_status === "running");
  const shortPending = exhibitors.filter((e) => e.short_status === "pending").length;
  const deepDone = exhibitors.filter((e) => e.deep_status === "done").length;
  const deepRunning = exhibitors.filter(
    (e) => e.deep_status === "running" || e.deep_status === "pending",
  ).length;

  const preFilterPassed = exhibitors.filter((e) => e.pre_filter_status === "passed").length;
  const preFilterOut = exhibitors.filter((e) => e.pre_filter_status === "filtered_out").length;
  const preFilterRunning = exhibitors.filter((e) => e.pre_filter_status === "running").length;
  const preFilterPending = exhibitors.filter(
    (e) => !e.pre_filter_status || e.pre_filter_status === "pending",
  ).length;
  const preFilterDecided = preFilterPassed + preFilterOut;
  const preFilterInProgress = preFilterRunning + preFilterPending;

  const planExists = !!crawlPlan;
  const listingDone = total > 0;
  const listingFailed = showStatus === "failed" && total === 0;

  const isPausedAtDiscovery = showStatus === "paused" && !planExists;
  const phase0Status: Phase["status"] = isPausedAtDiscovery
    ? "paused"
    : listingFailed && !planExists
    ? "failed"
    : planExists
    ? "done"
    : showCurrentStep === "discovering" || showStatus === "queued" || showStatus === "crawling"
    ? "running"
    : "pending";

  const isPausedAtListing = showStatus === "paused" && planExists && !listingDone;
  const phase1Status: Phase["status"] = listingFailed
    ? "failed"
    : isPausedAtListing
    ? "paused"
    : listingDone
    ? "done"
    : planExists
    ? "running"
    : "pending";

  const shortFinished = total > 0 && shortDone + shortFailed === total;
  const shortTouched = shortDone + shortFailed + shortRunning.length > 0;
  const phase2Status: Phase["status"] = shortFinished
    ? "done"
    : shortTouched
    ? "running"
    : listingDone
    ? "pending"
    : "pending";

  const runningLines = shortRunning.slice(0, 4).map((e) => {
    const label = stepLabel(e.current_step);
    return label ? `${e.company_name} (${label})` : e.company_name;
  });

  const phase3Status: Phase["status"] = deepDone > 0 ? "done" : deepRunning > 0 ? "running" : "pending";

  const preFilterStatus: Phase["status"] = !listingDone
    ? "pending"
    : preFilterInProgress > 0
    ? "running"
    : preFilterDecided > 0
    ? "done"
    : "pending";

  const phases: Phase[] = [
    {
      num: "00",
      label: "Site-Discovery",
      status: phase0Status,
      detail: planExists
        ? planSummary(crawlPlan)
        : showCurrentStep === "discovering"
        ? "Claude liest die Listing-Seite"
        : "Wartet auf Crawl-Start",
    },
    {
      num: "01",
      label: "Aussteller-Liste",
      status: phase1Status,
      detail: listingFailed
        ? errorMessage ?? "Konnte nicht extrahiert werden."
        : listingDone
        ? `${total} gefunden`
        : planExists
        ? "Plan wird ausgefuehrt"
        : "Wartet auf Plan",
      sub:
        !listingDone && showCurrentStep && showCurrentStep.startsWith("listing:")
          ? ["aktuell", stepLabel(showCurrentStep) ?? showCurrentStep]
          : undefined,
    },
    {
      num: "02",
      label: "Pre-Filter",
      status: preFilterStatus,
      detail: !listingDone
        ? "Wartet auf Listing"
        : preFilterInProgress > 0
        ? `${preFilterDecided}/${total} bewertet${preFilterRunning > 0 ? `, ${preFilterRunning} laufen` : ""}`
        : preFilterDecided > 0
        ? `${preFilterPassed} relevant, ${preFilterOut} rausgefiltert`
        : "Wartet auf Start",
      sub:
        preFilterRunning > 0
          ? [`Sonnet bewertet Aussteller in Batches a 25`]
          : undefined,
    },
    {
      num: "03",
      label: "Short-Overviews",
      status: phase2Status,
      detail: listingDone
        ? `${shortDone}/${total} fertig${shortFailed > 0 ? `, ${shortFailed} fehlgeschlagen` : ""}${shortPending > 0 ? `, ${shortPending} offen` : ""}`
        : "Wartet auf Listing",
      sub:
        shortRunning.length > 0
          ? [
              "laeuft parallel (max. 5)",
              ...runningLines,
              ...(shortPending > 4 ? [`+ ${shortPending} in warteschlange`] : []),
            ]
          : undefined,
    },
    {
      num: "04",
      label: "Deep-Dives (manuell)",
      status: phase3Status,
      detail: deepDone > 0
        ? `${deepDone} erstellt${deepRunning > 0 ? `, ${deepRunning} laufen` : ""}`
        : deepRunning > 0
        ? `${deepRunning} laufen`
        : "Per Aussteller-Klick",
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

