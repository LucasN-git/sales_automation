"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { apiFetch } from "@/lib/api-fetch";
import { useReportErrorSafe } from "@/components/ErrorReportProvider";

export function NewDiscoveryForm() {
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
      const r = await apiFetch<{ runId: string }>("/api/show-discovery", {
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
      router.push(`/shows/search/runs/${runId}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="box-line px-5 py-5">
      <label className="block text-meta-strong mb-2">Suchfokus</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="z.B. Defense und Aerospace Shows Europa 2026-2027, kein UK. Oder: Industrieautomation und mobile Robotik DACH."
        rows={3}
        disabled={pending}
        className="w-full bg-transparent px-3 py-2 text-body placeholder:text-[var(--color-near-black)]/35 resize-none focus:outline-none border border-[var(--border-color-soft)] focus:border-[var(--color-near-black)] disabled:opacity-50"
      />
      <div className="mt-3 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-meta text-[var(--color-near-black)]/50">
          ca. $0.25-0.40 pro Lauf , 3-5 Min , Claude Opus 4.7
        </p>
        <button
          type="submit"
          disabled={pending || !prompt.trim()}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-body-sm font-semibold border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {pending ? (
            <>
              <GoldDot size={6} />
              <span>startet...</span>
            </>
          ) : (
            "Suche starten"
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-body-sm text-[var(--color-near-black)]/70">{error}</p>
      )}
    </form>
  );
}
