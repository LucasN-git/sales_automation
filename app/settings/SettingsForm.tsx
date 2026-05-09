"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/settings";
import { GoldDot } from "@/components/brand/GoldDot";
import { Hairline } from "@/components/brand/Hairline";

const SHORT_MODEL_OPTIONS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
];
const DEEP_MODEL_OPTIONS = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
];

export function SettingsForm({ initial }: { initial: AppSettings }) {
  const [prioContext, setPrioContext] = useState(initial.prio_context);
  const [shortModel, setShortModel] = useState(initial.short_model);
  const [deepModel, setDeepModel] = useState(initial.deep_model);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Speichern fehlgeschlagen");
      return null;
    }
    const data = (await res.json()) as AppSettings;
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return data;
  }

  async function handleSavePrio() {
    await save({ prio_context: prioContext });
  }

  async function handleResetPrio() {
    if (!confirm("Prio-Kontext auf Default aus dem Brand-Doc zuruecksetzen?")) return;
    const fresh = await save({ reset: true });
    if (fresh) setPrioContext(fresh.prio_context);
  }

  async function handleSaveModels() {
    await save({ short_model: shortModel, deep_model: deepModel });
  }

  return (
    <div className="py-8 space-y-12">
      <section>
        <div className="text-meta-strong mb-3">prio-kontext</div>
        <textarea
          value={prioContext}
          onChange={(e) => setPrioContext(e.target.value)}
          rows={28}
          className="w-full bg-transparent box-line p-4 text-body-sm font-mono focus:outline-none focus:border-[var(--color-near-black)]"
          spellCheck={false}
        />
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            onClick={handleSavePrio}
            disabled={busy || prioContext === initial.prio_context}
            className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
          >
            <span>{busy ? "speichere" : "speichern"}</span>
            <GoldDot size={6} />
          </button>
          <button
            onClick={handleResetPrio}
            disabled={busy}
            className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)] transition-colors"
          >
            default wiederherstellen
          </button>
          {savedAt && (
            <span className="text-meta">gespeichert um {savedAt}</span>
          )}
          {error && (
            <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>
          )}
        </div>
      </section>

      <Hairline />

      <section>
        <div className="text-meta-strong mb-3">modelle</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <label className="block text-meta mb-2">short-overview</label>
            <select
              value={shortModel}
              onChange={(e) => setShortModel(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-[var(--border-color-soft)] py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
            >
              {SHORT_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="mt-2 text-meta">
              empfehlung: haiku 4.5. schnell, billig, reicht fuer 1-satz-match.
            </p>
          </div>
          <div>
            <label className="block text-meta mb-2">deep-dive</label>
            <select
              value={deepModel}
              onChange={(e) => setDeepModel(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-[var(--border-color-soft)] py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
            >
              {DEEP_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <p className="mt-2 text-meta">
              empfehlung: sonnet 4.6 fuer alle recherchen. opus nur wenn besonders schwierig.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={handleSaveModels}
            disabled={busy || (shortModel === initial.short_model && deepModel === initial.deep_model)}
            className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
          >
            <span>modelle speichern</span>
          </button>
        </div>
      </section>
    </div>
  );
}
