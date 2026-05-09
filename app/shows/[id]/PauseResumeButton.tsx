"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";

export function PauseResumeButton({
  showId,
  status,
}: {
  showId: string;
  status: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (status === "ready" || status === "partial" || status === "failed") {
    return null;
  }

  const isPaused = status === "paused";
  const action = isPaused ? "resume" : "pause";

  async function handleClick() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/trade-shows/${showId}/${action}`, {
      method: "POST",
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Aktion fehlgeschlagen");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={busy}
        className={`inline-flex items-center gap-2 text-ui-sm px-3 py-1 border transition-colors ${
          isPaused
            ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] hover:scale-[1.05]"
            : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-gold)] hover:border-[var(--border-color)]"
        } disabled:opacity-40`}
      >
        <span>{busy ? (isPaused ? "setze fort" : "pausiere") : isPaused ? "fortsetzen" : "pausieren"}</span>
        {isPaused && <GoldDot size={6} />}
      </button>
      {error && <span className="text-meta">{error}</span>}
    </div>
  );
}
