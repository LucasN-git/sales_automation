"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const STRATEGIES = [
  "letter_loop",
  "show_more",
  "pagination",
  "single_page",
] as const;

const ENGINES = ["algolia_api", "browserbase", "firecrawl"] as const;

type Strategy = (typeof STRATEGIES)[number];
type Engine = (typeof ENGINES)[number];

export function CrawlPlanOverride({
  showId,
  plan,
}: {
  showId: string;
  plan: Record<string, unknown>;
}) {
  const initialStrategy = (plan.strategy as Strategy | undefined) ?? "letter_loop";
  const initialEngine = (plan.engine as Engine | undefined) ?? "firecrawl";

  const [strategy, setStrategy] = useState<Strategy>(initialStrategy);
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [showJson, setShowJson] = useState(false);
  const [busy, setBusy] = useState<null | "re-listing" | "re-discover">(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const dirty = strategy !== initialStrategy || engine !== initialEngine;

  async function handleReListing() {
    setBusy("re-listing");
    setError(null);
    const res = await fetch(`/api/trade-shows/${showId}/re-listing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategy: strategy !== initialStrategy ? strategy : undefined,
        engine: engine !== initialEngine ? engine : undefined,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Re-Listing fehlgeschlagen");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function handleReDiscover() {
    const ok = window.confirm(
      "Discovery komplett neu laufen lassen?\n\nPlan, Aussteller und Match-Daten werden zurueckgesetzt. Claude analysiert die Site noch einmal frisch.",
    );
    if (!ok) return;

    setBusy("re-discover");
    setError(null);
    const res = await fetch(`/api/trade-shows/${showId}/restart`, {
      method: "POST",
    });
    setBusy(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Re-Discover fehlgeschlagen");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className="mb-10 border-t border-[var(--border-color-soft)] pt-6">
      <h2 className="text-ui-sm uppercase tracking-wider text-[var(--color-near-black)]/60 mb-4">
        Crawl-Plan
      </h2>

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-meta uppercase tracking-wider text-[var(--color-near-black)]/55">
            Strategy
          </span>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
            disabled={busy !== null}
            className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] bg-transparent text-[var(--color-near-black)] hover:border-[var(--border-color)] focus:border-[var(--color-near-black)] outline-none transition-colors disabled:opacity-40"
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
                {s === initialStrategy ? "  (aktuell)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-meta uppercase tracking-wider text-[var(--color-near-black)]/55">
            Engine
          </span>
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value as Engine)}
            disabled={busy !== null}
            className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] bg-transparent text-[var(--color-near-black)] hover:border-[var(--border-color)] focus:border-[var(--color-near-black)] outline-none transition-colors disabled:opacity-40"
          >
            {ENGINES.map((e) => (
              <option key={e} value={e}>
                {e}
                {e === initialEngine ? "  (aktuell)" : ""}
              </option>
            ))}
          </select>
        </label>

        <button
          onClick={handleReListing}
          disabled={busy !== null}
          className={`text-ui-sm px-3 py-1 border transition-colors ${
            dirty
              ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)]"
              : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)]"
          } disabled:opacity-40`}
        >
          {busy === "re-listing" ? "startet" : "re-listing"}
        </button>

        <button
          onClick={handleReDiscover}
          disabled={busy !== null}
          className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)] disabled:opacity-40 transition-colors"
        >
          {busy === "re-discover" ? "startet" : "re-discover"}
        </button>

        <button
          onClick={() => setShowJson((v) => !v)}
          className="text-meta text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] transition-colors ml-auto"
        >
          {showJson ? "json einklappen" : "json anzeigen"}
        </button>
      </div>

      {error && (
        <div className="text-meta text-[var(--color-near-black)]/70 mb-3">
          {error}
        </div>
      )}

      <div className="text-meta text-[var(--color-near-black)]/55 mb-3">
        <strong>Re-Listing</strong> behaelt den Plan und tauscht nur Strategy
        und/oder Engine. Schnell, kein neuer Discovery-Call. <strong>Re-Discover</strong>{" "}
        wirft den Plan weg, Claude analysiert die Site neu (gut wenn das URL-Pattern
        falsch ist, nicht nur die Engine).
      </div>

      {showJson && (
        <pre className="text-meta text-[var(--color-near-black)]/75 bg-[var(--color-near-black)]/[0.03] p-3 overflow-x-auto whitespace-pre">
          {JSON.stringify(plan, null, 2)}
        </pre>
      )}
    </section>
  );
}
