"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { SendIcon } from "@/components/brand/Icons";
import { apiFetch } from "@/lib/api-fetch";
import { useReportErrorSafe } from "@/components/ErrorReportProvider";

export function CompetitorDiscoveryForm({ hasActiveRun }: { hasActiveRun: boolean }) {
  const router = useRouter();
  const reportError = useReportErrorSafe();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (hasActiveRun || pending) return;
    setError(null);

    const regionFocus = prompt.trim() || undefined;

    startTransition(async () => {
      const r = await apiFetch<{ runId: string }>("/api/competitors/discovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region_focus: regionFocus }),
        reporter: reportError,
      });
      if (!r.ok) {
        setError(r.error ?? "Fehler beim Starten der Analyse.");
        return;
      }
      setPrompt("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card-surface px-5 py-5 mb-8">
      <label className="block text-meta-strong mb-3">Neue Konkurrenzanalyse</label>
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!hasActiveRun && !pending) handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder="Fokus optional, z.B. Verteidigung Europa, Maritime DACH. Leer = global alle Sektoren."
          rows={2}
          disabled={pending || hasActiveRun}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-xl py-3 pl-4 pr-14 text-body placeholder:text-[var(--color-near-black)]/35 resize-none focus:outline-none focus:border-[var(--color-near-black)]/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || hasActiveRun}
          aria-label="Analyse starten"
          className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-lg inline-flex items-center justify-center text-[var(--color-near-black)]/50 hover:text-[var(--color-gold)] disabled:opacity-25 disabled:hover:text-[var(--color-near-black)]/50 transition-colors"
        >
          {pending ? <GoldDot size={6} /> : <SendIcon size={18} />}
        </button>
      </div>
      <p className="mt-2 text-meta text-[var(--color-near-black)]/45">
        ca. $0.20-0.40 pro Lauf , 2-4 Min , Claude Opus 4.7 + Web-Search
      </p>
      {hasActiveRun && (
        <p className="mt-1 text-meta text-[var(--color-near-black)]/55">
          Analyse laeuft bereits. Warte bis sie abgeschlossen ist.
        </p>
      )}
      {error && (
        <p className="mt-1 text-body-sm text-[var(--color-near-black)]/70">{error}</p>
      )}
    </form>
  );
}
