"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function CompetitorRescanShortButton({
  competitorId,
  disabled = false,
}: {
  competitorId: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  async function onClick() {
    if (pending || disabled) return;
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

  return (
    <button
      onClick={onClick}
      disabled={pending || disabled}
      className="inline-flex items-center gap-1.5 text-ui px-3 py-1.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70 hover:text-[var(--color-near-black)] hover:border-[var(--color-near-black)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? "loese aus..." : disabled ? "short laeuft" : "short neu starten"}
    </button>
  );
}
