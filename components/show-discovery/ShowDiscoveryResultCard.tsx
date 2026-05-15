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
    <div className="card-surface p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="text-meta-strong shrink-0 tabular-nums"
            style={{ color: scoreColor }}
          >
            {score}/10
          </span>
          <h3 className="text-body font-semibold leading-tight">{result.name}</h3>
        </div>
        {added ? (
          <a
            href={`/shows/${added}`}
            className="shrink-0 text-meta text-[var(--color-gold)] hover:underline"
          >
            zur Messe →
          </a>
        ) : null}
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-body-sm text-[var(--color-near-black)]/65">
        {locationParts && <span>{locationParts}</span>}
        {dateDisplay && <span>{dateDisplay}</span>}
        {result.is_recurring && result.recurrence_note && (
          <span>{result.recurrence_note}</span>
        )}
        {result.isp_sector_match && result.isp_sector_match.length > 0 && (
          <span className="text-meta">
            {result.isp_sector_match.join(" · ")}
          </span>
        )}
      </div>

      {/* Focus + Audience */}
      {result.focus_description && (
        <p className="text-body-sm text-[var(--color-near-black)]/80 mb-1">
          {result.focus_description}
        </p>
      )}
      {result.target_audience && (
        <p className="text-body-sm text-[var(--color-near-black)]/65 mb-3">
          Publikum: {result.target_audience}
        </p>
      )}

      {/* Relevance reasoning */}
      {result.relevance_reasoning && (
        <div
          className="text-body-sm text-[var(--color-near-black)]/80 mb-3 space-y-0.5"
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
        <div className="mb-3 text-meta text-[var(--color-near-black)]/65 flex items-center gap-3">
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
        <div className="mb-4 flex flex-wrap gap-2">
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
        <div className="mb-3 text-body-sm text-[var(--color-near-black)]/70">{error}</div>
      )}

      {/* Actions */}
      {!added && (
        <div className="flex items-center gap-4 pt-3 border-t border-[var(--color-hairline-light)]">
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-body-sm font-semibold border border-[var(--color-near-black)]/35 rounded-md text-[var(--color-near-black)]/70 hover:border-[var(--color-near-black)] hover:text-[var(--color-near-black)] transition-all duration-150"
          >
            + zur Messeliste
          </button>
          <button
            onClick={handleDismiss}
            className="text-body-sm text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)]/70 transition-colors"
          >
            ignorieren
          </button>
        </div>
      )}
    </div>
  );
}
