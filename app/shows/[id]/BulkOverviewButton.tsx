"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";

export function BulkOverviewButton({
  showId,
  pendingCount,
  runningCount,
}: {
  showId: string;
  pendingCount: number;
  runningCount: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  if (pendingCount === 0 && runningCount === 0) return null;

  const isRunning = runningCount > 0;
  const label = isRunning
    ? `short laeuft (${runningCount})`
    : `short-overviews fuer ${pendingCount} starten`;

  async function handleClick() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/trade-shows/${showId}/short-overview`, {
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
        disabled={busy || isRunning}
        className="inline-flex items-center gap-2 text-ui-sm px-3 py-1 border border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] hover:scale-[1.05] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
      >
        <span>{busy ? "sende" : label}</span>
        <GoldDot size={6} />
      </button>
      {error && <span className="text-meta">{error}</span>}
    </div>
  );
}
