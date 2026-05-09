"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RestartButton({ showId }: { showId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function handleRestart() {
    const ok = window.confirm(
      "Crawl komplett neu starten?\n\nAlle bisherigen Aussteller-Daten und Match-Einschätzungen gehen verloren. Eventuell noch laufende Schritte werden ignoriert.",
    );
    if (!ok) return;

    setPending(true);
    setError(null);
    const res = await fetch(`/api/trade-shows/${showId}/restart`, {
      method: "POST",
    });
    setPending(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Konnte nicht neu starten.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleRestart}
        disabled={pending}
        className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)] disabled:opacity-40 transition-colors"
      >
        {pending ? "startet" : "neu starten"}
      </button>
      {error && <span className="text-meta">{error}</span>}
    </div>
  );
}
