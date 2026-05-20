"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";

export type CompanySearchResult = {
  id: string;
  run_id: string;
  name: string;
  website: string | null;
  domain: string | null;
  location_city: string | null;
  location_country: string | null;
  description: string | null;
  isp_sector_match: string[] | null;
  relevance_score: number | null;
  relevance_reasoning: string | null;
  evidence_urls: string[] | null;
  // short overview fields (populated after enrich)
  one_liner: string | null;
  priority_label: "hoch" | "mittel" | "niedrig" | null;
  match_confidence: number | null;
  isp_sector_match_detail: string[] | null;
  reasoning_bullets: string | null;
  battery_need: string | null;
  user_group: string | null;
  // enrich status
  firecrawl_status: "pending" | "running" | "done" | "failed" | "skipped";
  // actions
  dismissed: boolean;
  added_company_id: string | null;
};

const PRIO_BADGE: Record<string, string> = {
  hoch: "border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold",
  mittel: "border-[var(--color-near-black)]/60 text-[var(--color-near-black)]/80",
  niedrig: "border-[var(--border-color-soft)] text-[var(--color-near-black)]/40",
};

export function CompanySearchResultCard({
  result,
  runId,
}: {
  result: CompanySearchResult;
  runId: string;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(result.dismissed);
  const [addedCompanyId, setAddedCompanyId] = useState<string | null>(result.added_company_id);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (dismissed) return null;

  const score = result.relevance_score ?? 0;
  const scoreColor =
    score >= 8
      ? "var(--color-success)"
      : score >= 5
      ? "var(--color-gold)"
      : "rgba(10,10,10,0.4)";

  const confidence = result.match_confidence;
  const confidenceColor =
    confidence === null
      ? null
      : confidence >= 80
      ? "var(--color-success)"
      : confidence >= 50
      ? "var(--color-gold)"
      : "rgba(10,10,10,0.4)";

  const sectors = result.isp_sector_match_detail ?? result.isp_sector_match ?? [];
  const locationParts = [result.location_city, result.location_country].filter(Boolean).join(", ");
  const isEnriching = result.firecrawl_status === "pending" || result.firecrawl_status === "running";

  function handleAdd() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/company-search/${runId}/results/${result.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", confirmed: true }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Hinzufuegen");
        return;
      }
      setAddedCompanyId(json.company_id);
      router.refresh();
    });
  }

  function handleDismiss() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/company-search/${runId}/results/${result.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "dismiss" }),
      });
      if (res.ok) setDismissed(true);
    });
  }

  return (
    <div className="box-line px-5 py-5 hover:bg-[var(--color-near-black)]/[0.015] transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-4 min-w-0">
          <span
            className="text-meta-strong shrink-0 tabular-nums pt-0.5"
            style={{ color: scoreColor }}
          >
            {score}/10
          </span>
          <div className="min-w-0">
            <h3 className="text-subtitle leading-snug">{result.name}</h3>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {locationParts && (
                <span className="text-meta text-[var(--color-near-black)]/55">{locationParts}</span>
              )}
              {result.domain && !locationParts && (
                <span className="text-meta text-[var(--color-near-black)]/55">{result.domain}</span>
              )}
              {sectors.length > 0 && (
                <span className="text-meta text-[var(--color-near-black)]/40">
                  {sectors.join(" , ")}
                </span>
              )}
            </div>
          </div>
        </div>
        {addedCompanyId && (
          <a
            href={`/companies/${addedCompanyId}`}
            className="shrink-0 text-meta text-[var(--color-gold)] hover:underline whitespace-nowrap"
          >
            zur Firma &rarr;
          </a>
        )}
      </div>

      {/* One-liner (after enrich) or description */}
      {result.one_liner ? (
        <p className="text-body-sm text-[var(--color-near-black)]/80 leading-snug">
          {result.one_liner}
        </p>
      ) : result.description ? (
        <p className="text-body-sm text-[var(--color-near-black)]/65 leading-snug line-clamp-2">
          {result.description}
        </p>
      ) : null}

      {/* Reasoning bullets */}
      {result.reasoning_bullets && (
        <div
          className="text-body-sm text-[var(--color-near-black)]/75 mt-2 space-y-0.5"
          dangerouslySetInnerHTML={{
            __html: result.reasoning_bullets
              .split("\n")
              .filter(Boolean)
              .map((line) =>
                line.startsWith("- ")
                  ? `<div class="pl-3 border-l-2" style="border-color:rgba(10,10,10,0.15)">${line.slice(2)}</div>`
                  : `<div>${line}</div>`,
              )
              .join(""),
          }}
        />
      )}

      {/* Battery need + user group */}
      {(result.battery_need || result.user_group) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5">
          {result.battery_need && (
            <span className="text-meta text-[var(--color-near-black)]/55">
              Bedarf: {result.battery_need}
            </span>
          )}
          {result.user_group && (
            <span className="text-meta text-[var(--color-near-black)]/55">
              Segment: {result.user_group}
            </span>
          )}
        </div>
      )}

      {/* Enrich status + website */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        {result.firecrawl_status === "done" && result.website && (
          <>
            <span
              className="inline-block w-2 h-2 shrink-0"
              style={{ background: "var(--color-gold)" }}
            />
            <a
              href={result.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-meta text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors truncate max-w-[240px]"
            >
              {result.website.replace(/^https?:\/\//, "")}
            </a>
          </>
        )}
        {isEnriching && (
          <span className="inline-flex items-center gap-1.5 text-meta text-[var(--color-near-black)]/45">
            <GoldDot size={5} />
            analysiert...
          </span>
        )}
        {result.priority_label && (
          <span
            className={`text-meta-strong px-2 py-0.5 border ${PRIO_BADGE[result.priority_label] ?? ""}`}
          >
            {result.priority_label}
          </span>
        )}
        {confidence !== null && (
          <span
            className="tabular-nums text-body-sm font-semibold"
            style={{ color: confidenceColor ?? undefined }}
          >
            {confidence}%
          </span>
        )}
      </div>

      {/* Evidence links */}
      {(result.evidence_urls ?? []).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(result.evidence_urls ?? []).slice(0, 3).map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-meta text-[var(--color-near-black)]/45 hover:text-[var(--color-near-black)] transition-colors truncate max-w-[200px]"
            >
              {url.replace(/^https?:\/\//, "").slice(0, 40)}
              {url.length > 50 ? "..." : ""}
            </a>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 text-body-sm text-[var(--color-near-black)]/70">{error}</div>
      )}

      {/* Actions */}
      {!addedCompanyId && (
        <div className="mt-4 pt-3 border-t border-[var(--border-color-soft)] flex items-center gap-4">
          <button
            onClick={handleAdd}
            className="px-4 py-2 text-body-sm font-semibold border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-colors"
          >
            zur Unternehmensliste
          </button>
          <button
            onClick={handleDismiss}
            className="text-body-sm text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
          >
            ablehnen
          </button>
        </div>
      )}
    </div>
  );
}
