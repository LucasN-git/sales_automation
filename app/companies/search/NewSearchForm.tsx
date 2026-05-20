"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { SendIcon } from "@/components/brand/Icons";
import { apiFetch } from "@/lib/api-fetch";
import { useReportErrorSafe } from "@/components/ErrorReportProvider";

export function NewSearchForm() {
  const router = useRouter();
  const reportError = useReportErrorSafe();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setError(null);

    startTransition(async () => {
      const r = await apiFetch<{ runId: string }>("/api/company-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_prompt: prompt.trim() }),
        reporter: reportError,
      });
      if (!r.ok) {
        setError(r.error ?? "Fehler beim Starten der Suche.");
        return;
      }
      const runId = r.data.runId;
      if (!runId) {
        setError("Server-Antwort enthielt keine runId.");
        return;
      }
      router.push(`/companies/search/runs/${runId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card-surface px-5 py-5">
      <label className="block text-meta-strong mb-3">Suchfokus</label>
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (prompt.trim() && !pending) handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder="z.B. Drohnen-Hersteller Deutschland und Frankreich, militaerisch und kommerziell. Oder: UGV-Hersteller Europa, verteidigungsrelevant."
          rows={2}
          disabled={pending}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-xl py-3 pl-4 pr-14 text-body placeholder:text-[var(--color-near-black)]/35 resize-none focus:outline-none focus:border-[var(--color-near-black)]/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !prompt.trim()}
          aria-label="Suche starten"
          className="absolute bottom-2.5 right-2.5 w-9 h-9 rounded-lg inline-flex items-center justify-center text-[var(--color-near-black)]/50 hover:text-[var(--color-gold)] disabled:opacity-25 disabled:hover:text-[var(--color-near-black)]/50 transition-colors"
        >
          {pending ? <GoldDot size={6} /> : <SendIcon size={18} />}
        </button>
      </div>
      <p className="mt-2 text-meta text-[var(--color-near-black)]/45">
        ca. $0.25-0.40 pro Lauf , 3-5 Min , Claude Opus 4.7 plus Short-Analyse per Kandidat
      </p>
      {error && (
        <p className="mt-1 text-body-sm text-[var(--color-near-black)]/70">{error}</p>
      )}
    </form>
  );
}
