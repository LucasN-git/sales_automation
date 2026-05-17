"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";

export type UrlSearchEvidence = {
  url: string | null;
  confidence: "low" | "medium" | "high";
  reasoning: string;
  candidates: Array<{ url: string; reason: string }>;
  web_searches?: number;
  searched_at?: string;
};

export type UrlSearchStatus =
  | "idle"
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "url_not_found";

const CONFIDENCE_LABEL: Record<UrlSearchEvidence["confidence"], string> = {
  high: "hoch",
  medium: "mittel",
  low: "niedrig",
};

export function UrlSearchBanner({
  showId,
  status,
  sourceUrl,
  evidence,
}: {
  showId: string;
  status: UrlSearchStatus;
  sourceUrl: string | null;
  evidence: UrlSearchEvidence | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "idle" || status === "done") {
    if (status === "done" && sourceUrl) return null;
    if (status === "done" && evidence?.url && !sourceUrl) {
      return (
        <ProposalBanner
          showId={showId}
          evidence={evidence}
          pending={pending}
          error={error}
          onAccept={() => {
            setError(null);
            startTransition(async () => {
              const res = await fetch(`/api/trade-shows/${showId}/auto-discovery`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: evidence.url }),
              });
              if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setError(j?.error ?? "Fehler beim Übernehmen.");
                return;
              }
              router.refresh();
            });
          }}
          onReject={() => {
            setError(null);
            startTransition(async () => {
              const res = await fetch(`/api/trade-shows/${showId}/auto-discovery`, {
                method: "DELETE",
              });
              if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                setError(j?.error ?? "Fehler beim Ablehnen.");
                return;
              }
              router.refresh();
            });
          }}
        />
      );
    }
    return null;
  }

  if (status === "pending" || status === "running") {
    return (
      <div className="mb-6 px-5 py-4 bg-[var(--color-cream-sunken)] border-t border-b border-[var(--border-color-soft)]">
        <div className="flex items-center gap-3">
          <GoldDot size={6} />
          <p className="text-body-sm font-medium">
            Ich suche die Aussteller-URL per Web-Search.
          </p>
        </div>
        <p className="text-meta mt-1.5 text-[var(--color-near-black)]/55">
          Das dauert ungefähr 30 Sekunden. Die Seite aktualisiert sich automatisch.
        </p>
      </div>
    );
  }

  if (status === "url_not_found") {
    return (
      <div className="mb-6 px-5 py-4 bg-[var(--color-cream-sunken)] border-t border-b border-[var(--border-color-soft)]">
        <p className="text-body-sm font-medium mb-1">
          Keine eindeutige Aussteller-URL gefunden.
        </p>
        {evidence?.reasoning && (
          <p className="text-meta mb-2 text-[var(--color-near-black)]/65">
            {evidence.reasoning}
          </p>
        )}
        <Link
          href={`/shows/${showId}/settings`}
          className="inline-flex items-center gap-1.5 text-ui-sm px-3 py-1.5 border border-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-colors"
        >
          URL manuell eintragen
        </Link>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="mb-6 px-5 py-4 bg-[var(--color-cream-sunken)] border-t border-b border-[var(--border-color-soft)]">
        <p className="text-body-sm font-medium mb-1 text-[var(--color-error)]">
          URL-Suche fehlgeschlagen.
        </p>
        <p className="text-meta mb-2 text-[var(--color-near-black)]/65">
          Bitte trage die Aussteller-URL manuell in den Einstellungen ein.
        </p>
        <Link
          href={`/shows/${showId}/settings`}
          className="inline-flex items-center gap-1.5 text-ui-sm px-3 py-1.5 border border-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-colors"
        >
          zu den Einstellungen
        </Link>
      </div>
    );
  }

  return null;
}

function ProposalBanner({
  showId,
  evidence,
  pending,
  error,
  onAccept,
  onReject,
}: {
  showId: string;
  evidence: UrlSearchEvidence;
  pending: boolean;
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
}) {
  const url = evidence.url!;
  const otherCandidates = evidence.candidates.filter((c) => c.url !== url).slice(0, 3);

  return (
    <div className="mb-6 px-5 py-4 bg-[var(--color-cream-sunken)] border-t border-b border-[var(--border-color-soft)]">
      <div className="flex items-start justify-between gap-4 mb-2">
        <p className="text-body-sm font-medium">Aussteller-URL gefunden.</p>
        <span className="text-meta text-[var(--color-near-black)]/55">
          Konfidenz: {CONFIDENCE_LABEL[evidence.confidence]}
        </span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block text-body-sm font-mono mb-2 break-all underline underline-offset-4 hover:text-[var(--color-gold)] transition-colors"
      >
        {url}
      </a>
      {evidence.reasoning && (
        <p className="text-meta mb-3 text-[var(--color-near-black)]/65">
          {evidence.reasoning}
        </p>
      )}
      {otherCandidates.length > 0 && (
        <details className="mb-3">
          <summary className="text-meta cursor-pointer text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors">
            {otherCandidates.length} weitere geprüfte URLs
          </summary>
          <ul className="mt-2 space-y-1">
            {otherCandidates.map((c, i) => (
              <li key={i} className="text-meta">
                <span className="font-mono text-[var(--color-near-black)]/70">{c.url}</span>
                <span className="text-[var(--color-near-black)]/45"> – {c.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onAccept}
          disabled={pending}
          className="inline-flex items-center gap-2 px-4 py-2 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{pending ? "starte" : "übernehmen, Discovery starten"}</span>
        </button>
        <button
          onClick={onReject}
          disabled={pending}
          className="text-ui text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] disabled:opacity-40 transition-colors"
        >
          ablehnen, manuell eintragen
        </button>
        <Link
          href={`/shows/${showId}/settings`}
          className="text-ui text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
        >
          zu den Einstellungen
        </Link>
        {error && (
          <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>
        )}
      </div>
    </div>
  );
}
