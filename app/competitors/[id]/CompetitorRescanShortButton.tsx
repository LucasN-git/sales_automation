"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CompetitorRescanShortButton({
  competitorId,
  shortStatus,
  hasAnalysis,
}: {
  competitorId: string;
  shortStatus: string | null;
  hasAnalysis: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const isRunning = shortStatus === "running";
  const isPending = shortStatus === "pending";
  const isActive = isRunning || isPending;

  async function onClick() {
    if (pending || isActive) return;
    setPending(true);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/rescan-short`, {
        method: "POST",
      });
      if (!res.ok) return;
      startTransition(() => router.refresh());
    } finally {
      setPending(false);
    }
  }

  const label = pending
    ? "loese aus..."
    : isRunning
      ? "Analyse laeuft"
      : isPending
        ? "Analyse steht an"
        : hasAnalysis
          ? "Neu analysieren"
          : "Analyse starten";

  return (
    <button
      onClick={onClick}
      disabled={pending || isActive}
      className="inline-flex items-center gap-1.5 text-ui px-3 py-1.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70 hover:text-[var(--color-near-black)] hover:border-[var(--color-near-black)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}
