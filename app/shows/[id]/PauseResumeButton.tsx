"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { loading } from "@/components/LoadingBar";
import { parseErrorJson } from "@/lib/fetch-json";

export function PauseResumeButton({
  showId,
  status,
  shortActive = 0,
}: {
  showId: string;
  status: string;
  /**
   * Number of pending+running short-overviews. Used so we can pause/resume
   * during the short bulk run (status='ready' but background work in flight).
   */
  shortActive?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const isPaused = status === "paused";
  // Visible during pipeline phases (queued/crawling), the paused state, OR
  // when short-overviews are still active in the background.
  const visible =
    status === "queued" ||
    status === "crawling" ||
    isPaused ||
    (status === "ready" && shortActive > 0);
  if (!visible) return null;

  const action = isPaused ? "resume" : "pause";

  async function handleClick() {
    setBusy(true);
    setError(null);
    loading.start();
    try {
      const res = await fetch(`/api/trade-shows/${showId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        setError(j.error ?? "Aktion fehlgeschlagen");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
      loading.stop();
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleClick}
        disabled={busy}
        className={`inline-flex items-center gap-2 text-ui-sm px-3 py-1.5 border rounded-md transition-colors ${
          isPaused
            ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] hover:scale-[1.05]"
            : "border-[var(--border-color-soft)] text-[var(--color-near-black)]/60 hover:text-[var(--color-blue)] hover:border-[var(--color-blue)]/50"
        } disabled:opacity-40`}
      >
        <span>{busy ? (isPaused ? "setze fort" : "pausiere") : isPaused ? "fortsetzen" : "pausieren"}</span>
        {isPaused && <GoldDot size={6} />}
      </button>
      {error && <span className="text-meta">{error}</span>}
    </div>
  );
}
