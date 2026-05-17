"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export type ShowDiscoveryResult = {
  id: string;
  run_id: string;
  name: string;
  website: string | null;
  location_city: string | null;
  location_country: string | null;
  dates_raw: string | null;
  focus_description: string | null;
  target_audience: string | null;
  isp_sector_match: string[] | null;
  relevance_score: number | null;
  relevance_reasoning: string | null;
  evidence_urls: string[];
  is_recurring: boolean | null;
  recurrence_note: string | null;
  firecrawl_status: "pending" | "running" | "done" | "failed" | "skipped";
  firecrawl_confirmed_url: string | null;
  firecrawl_extracted: {
    exhibitor_count?: number;
    visitor_count?: number;
    next_edition_dates?: string;
    location_city?: string;
    venue_name?: string;
  } | null;
  dismissed: boolean;
  added_trade_show_id: string | null;
};

export function ShowDiscoveryResultCard({
  result,
  runId,
}: {
  result: ShowDiscoveryResult;
  runId: string;
}) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(result.dismissed);
  const [added, setAdded] = useState<string | null>(result.added_trade_show_id);
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

  const displayUrl = result.firecrawl_confirmed_url || result.website;
  const exhibitorCount = result.firecrawl_extracted?.exhibitor_count;
  const fcDates = result.firecrawl_extracted?.next_edition_dates;
  const fcCity = result.firecrawl_extracted?.location_city;
  const fcVenue = result.firecrawl_extracted?.venue_name;

  const locationParts = [
    fcCity || result.location_city,
    result.location_country,
  ].filter(Boolean).join(", ");

  const dateDisplay = fcDates || result.dates_raw;

  async function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/show-discovery/${runId}/results/${result.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setError(`Bereits vorhanden: "${json.showName}"`);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Fehler beim Hinzufuegen");
        return;
      }
      setAdded(json.tradeShowId);
      router.push(`/shows/${json.tradeShowId}`);
    });
  }

  async function handleDismiss() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/show-discovery/${runId}/results/${result.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
      if (res.ok) setDismissed(true);
    });
  }

  return (
    <div className="box-line px-5 py-5 hover:bg-[var(--color-near-black)]/[0.015] transition-colors">
      {/* Header */}
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
            {/* Meta row directly under name */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
              {locationParts && (
                <span className="text-meta text-[var(--color-near-black)]/55">
                  {locationParts}
                </span>
              )}
              {dateDisplay && (
                <span className="text-meta text-[var(--color-near-black)]/55">
                  {dateDisplay}
                </span>
              )}
              {result.is_recurring && result.recurrence_note && (
                <span className="text-meta text-[var(--color-near-black)]/55">
                  {result.recurrence_note}
                </span>
              )}
              {result.isp_sector_match && result.isp_sector_match.length > 0 && (
                <span className="text-meta text-[var(--color-near-black)]/40">
                  {result.isp_sector_match.join(" , ")}
                </span>
              )}
            </div>
          </div>
        </div>
        {added ? (
          <a
            href={`/shows/${added}`}
            className="shrink-0 text-meta text-[var(--color-gold)] hover:underline"
          >
            zur Messe &rarr;
          </a>
        ) : null}
      </div>

      {/* Focus + Audience */}
      {result.focus_description && (
        <p className="text-body-sm text-[var(--color-near-black)]/80 mt-2 leading-snug">
          {result.focus_description}
        </p>
      )}
      {result.target_audience && (
        <p className="text-body-sm text-[var(--color-near-black)]/55 mt-1 leading-snug">
          Publikum: {result.target_audience}
        </p>
      )}

      {/* Relevance reasoning */}
      {result.relevance_reasoning && (
        <div
          className="text-body-sm text-[var(--color-near-black)]/75 mt-3 space-y-0.5"
          dangerouslySetInnerHTML={{
            __html: result.relevance_reasoning
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

      {/* Firecrawl validation badge */}
      {result.firecrawl_status === "done" && (
        <div className="mt-3 text-meta text-[var(--color-near-black)]/65 flex items-center gap-3">
          <span
            className="inline-block w-2 h-2 shrink-0"
            style={{ background: "var(--color-gold)" }}
          />
          {displayUrl && (
            <a
              href={displayUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--color-near-black)] transition-colors truncate max-w-[240px]"
            >
              {displayUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
          {exhibitorCount && <span>{exhibitorCount} Aussteller lt. Website</span>}
          {fcVenue && !exhibitorCount && <span>{fcVenue}</span>}
        </div>
      )}

      {/* Evidence URLs */}
      {result.evidence_urls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {result.evidence_urls.slice(0, 3).map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-meta text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)] transition-colors truncate max-w-[200px]"
            >
              {url.replace(/^https?:\/\//, "").slice(0, 40)}
              {url.length > 50 ? "..." : ""}
            </a>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 text-body-sm text-[var(--color-near-black)]/70">{error}</div>
      )}

      {/* Actions */}
      {!added && (
        <div className="mt-4 pt-3 border-t border-[var(--border-color-soft)] flex items-center gap-4">
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-body-sm font-semibold border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-colors"
          >
            zur Messeliste
          </button>
          <button
            onClick={handleDismiss}
            className="text-body-sm text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
          >
            ignorieren
          </button>
        </div>
      )}
    </div>
  );
}
