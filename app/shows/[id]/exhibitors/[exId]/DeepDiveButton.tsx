"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { formatCost } from "@/lib/pricing";
import { loading } from "@/components/LoadingBar";
import { parseErrorJson } from "@/lib/fetch-json";

export function DeepDiveButton({
  exhibitorId,
  status,
  hasDeep,
  perCallUsd,
  estimateHistorical,
  model,
}: {
  exhibitorId: string;
  status: string;
  hasDeep: boolean;
  perCallUsd: number;
  estimateHistorical: boolean;
  model: string;
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

  const tooltip = isWorking
    ? `laeuft. Pro Call ~${formatCost(perCallUsd)} (${model})`
    : `Geschaetzt ~${formatCost(perCallUsd)} pro Deep-Dive (${model}).\n${estimateHistorical ? "Basis: Durchschnitt aus bisherigen Deep-Calls dieser Show." : "Basis: Default-Tokens (kein Verlauf vorhanden)."}`;

  async function handleClick() {
    if (hasDeep && !confirm("Deep-Dive bereits vorhanden. Neu erstellen?")) return;
    setBusy(true);
    setError(null);
    loading.start();
    try {
      const res = await fetch(`/api/exhibitors/${exhibitorId}/deep-dive`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        setError(j.error ?? "Aktion fehlgeschlagen");
        return;
      }
      const j = await res.json().catch(() => ({}));
      if (j.threadId) {
        window.dispatchEvent(new CustomEvent("deep-dive-triggered", { detail: { threadId: j.threadId } }));
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
      loading.stop();
    }
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        onClick={handleClick}
        disabled={busy || isWorking}
        title={tooltip}
        className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
      >
        <span>{busy ? "sende" : label}</span>
        <GoldDot size={6} />
      </button>
      {!isWorking && (
        <span
          className="text-meta text-[var(--color-near-black)]/55 tabular-nums"
          title={tooltip}
        >
          ~{formatCost(perCallUsd)}
        </span>
      )}
      {error && <span className="text-meta">{error}</span>}
    </div>
  );
}
