"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";

export function DeepDiveButton({
  exhibitorId,
  status,
  hasDeep,
}: {
  exhibitorId: string;
  status: string;
  hasDeep: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const isWorking = status === "pending" || status === "running";
  const label = isWorking
    ? `deep laeuft (${status})`
    : hasDeep
    ? "deep-dive neu erstellen"
    : "deep-dive anfordern";

  async function handleClick() {
    if (hasDeep && !confirm("Deep-Dive bereits vorhanden. Neu erstellen?")) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/exhibitors/${exhibitorId}/deep-dive`, {
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
    <div>
      <button
        onClick={handleClick}
        disabled={busy || isWorking}
        className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
      >
        <span>{busy ? "sende" : label}</span>
        <GoldDot size={6} />
      </button>
      {error && <span className="ml-3 text-meta">{error}</span>}
    </div>
  );
}
