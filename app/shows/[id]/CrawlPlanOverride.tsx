"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loading } from "@/components/LoadingBar";
import { parseErrorJson } from "@/lib/fetch-json";

const STRATEGIES = [
  "letter_loop",
  "show_more",
  "pagination",
  "single_page",
] as const;

const ENGINES = [
  "algolia_api",
  "browserbase",
  "firecrawl",
  "dimedis_api",
  "mapyourshow_api",
  "expofp_api",
] as const;

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

  const initialJson = JSON.stringify(plan, null, 2);

  const [strategy, setStrategy] = useState<Strategy>(initialStrategy);
  const [engine, setEngine] = useState<Engine>(initialEngine);
  const [showJson, setShowJson] = useState(false);
  const [planJson, setPlanJson] = useState(initialJson);
  const [busy, setBusy] = useState<null | "re-listing" | "re-discover" | "re-listing-json">(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const dirty = strategy !== initialStrategy || engine !== initialEngine;
  const jsonDirty = planJson.trim() !== initialJson.trim();
  let jsonParseError: string | null = null;
  if (jsonDirty) {
    try {
      const parsed = JSON.parse(planJson);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        jsonParseError = "Plan muss ein JSON-Objekt sein.";
      }
    } catch (e) {
      jsonParseError = e instanceof Error ? e.message : "JSON ungueltig";
    }
  }

  async function handleReListing() {
    setBusy("re-listing");
    setError(null);
    loading.start();
    try {
      const res = await fetch(`/api/trade-shows/${showId}/re-listing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy: strategy !== initialStrategy ? strategy : undefined,
          engine: engine !== initialEngine ? engine : undefined,
        }),
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        setError(j.error ?? "Re-Listing fehlgeschlagen");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
      loading.stop();
    }
  }

  async function handleReListingJson() {
    if (jsonParseError) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(planJson);
    } catch {
      return;
    }
    setBusy("re-listing-json");
    setError(null);
    loading.start();
    try {
      const res = await fetch(`/api/trade-shows/${showId}/re-listing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: parsed }),
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        const detailStr = j.details ? `: ${JSON.stringify(j.details).slice(0, 400)}` : "";
        setError((j.error ?? "Re-Listing fehlgeschlagen") + detailStr);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
      loading.stop();
    }
  }

  async function handleReDiscover() {
    const ok = window.confirm(
      "Discovery komplett neu laufen lassen?\n\nPlan, Aussteller und Match-Daten werden zurueckgesetzt. Claude analysiert die Site noch einmal frisch.",
    );
    if (!ok) return;

    setBusy("re-discover");
    setError(null);
    loading.start();
    try {
      const res = await fetch(`/api/trade-shows/${showId}/restart`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        setError(j.error ?? "Re-Discover fehlgeschlagen");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
      loading.stop();
    }
  }

  return (
    <div>
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
          title="Listing-Phase mit den oben gewaehlten Werten neu starten. Plan wird beibehalten, Discovery wird uebersprungen."
          className={`text-ui-sm px-3 py-1 border transition-colors ${
            dirty
              ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)]"
              : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)]"
          } disabled:opacity-40`}
        >
          {busy === "re-listing" ? "startet" : "listing neu (override)"}
        </button>

        <span className="text-[var(--color-near-black)]/30 select-none">|</span>

        <button
          onClick={handleReDiscover}
          disabled={busy !== null}
          title="Plan verwerfen, Claude analysiert die Site noch einmal frisch und entscheidet Strategy + Engine selber. Dropdown-Werte werden ignoriert."
          className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)] disabled:opacity-40 transition-colors"
        >
          {busy === "re-discover" ? "startet" : "alles neu (claude entscheidet)"}
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
        <strong>listing neu (override)</strong> behaelt den Plan und tauscht nur
        Strategy und/oder Engine. Schnell, kein neuer Discovery-Call.
        <span className="mx-2">·</span>
        <strong>alles neu (claude entscheidet)</strong> wirft den Plan weg, Claude
        analysiert die Site noch einmal frisch und waehlt Strategy + Engine
        selber. Dropdowns werden ignoriert.
        <span className="mx-2">·</span>
        <strong>json bearbeiten</strong> ueberschreibt den Plan komplett mit
        editiertem JSON (z. B. Strategy-Wechsel auf pagination mit page_url_template).
      </div>

      {showJson && (
        <div className="space-y-2">
          <textarea
            value={planJson}
            onChange={(e) => setPlanJson(e.target.value)}
            disabled={busy !== null}
            spellCheck={false}
            rows={Math.min(28, Math.max(10, planJson.split("\n").length + 1))}
            className="w-full text-meta font-mono text-[var(--color-near-black)]/85 bg-[var(--color-near-black)]/[0.03] border border-[var(--border-color-soft)] focus:border-[var(--color-near-black)] outline-none p-3 whitespace-pre overflow-auto disabled:opacity-40"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleReListingJson}
              disabled={busy !== null || !jsonDirty || jsonParseError !== null}
              title="Plan komplett mit dem JSON oben ersetzen, Listing neu starten."
              className={`text-ui-sm px-3 py-1 border transition-colors ${
                jsonDirty && !jsonParseError
                  ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)]"
                  : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60"
              } disabled:opacity-40`}
            >
              {busy === "re-listing-json" ? "startet" : "plan ueberschreiben (json)"}
            </button>
            <button
              onClick={() => {
                setPlanJson(initialJson);
                setError(null);
              }}
              disabled={busy !== null || !jsonDirty}
              className="text-meta text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] disabled:opacity-40 transition-colors"
            >
              zuruecksetzen
            </button>
            {jsonParseError && (
              <span className="text-meta text-[var(--color-near-black)]/70">
                {jsonParseError}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
