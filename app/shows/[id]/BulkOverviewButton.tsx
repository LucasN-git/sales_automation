"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { formatCost } from "@/lib/pricing";
import { loading } from "@/components/LoadingBar";
import { parseErrorJson } from "@/lib/fetch-json";

export function BulkOverviewButton({
  showId,
  pendingCount,
  runningCount,
  preFilterActive,
  perCallUsd,
  estimateHistorical,
  model,
}: {
  showId: string;
  pendingCount: number;
  runningCount: number;
  preFilterActive: boolean;
  perCallUsd: number;
  estimateHistorical: boolean;
  model: string;
}) {
  const [busy, setBusy] = useState(false);
  // Optimistic flag: bleibt true zwischen erfolgreichem POST und dem Zeitpunkt,
  // an dem das 5s-Polling den ersten Aussteller in `running` sieht.
  // Inngest-Fanout braucht ~1-2s, ohne Optimistic-State zeigt der Button in
  // dieser Luecke wieder das Start-Label und der User klickt unnoetig nochmal.
  const [pretendRunning, setPretendRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const isRunning = runningCount > 0;

  // Drop optimistic flag, sobald der Server-State eingeholt hat (oder alles
  // schon fertig ist). Verhindert, dass das Label permanent stuck waere, falls
  // das Inngest-Event still aus irgendeinem Grund nichts auf "running" setzt.
  useEffect(() => {
    if (pretendRunning && (isRunning || pendingCount === 0)) {
      setPretendRunning(false);
    }
  }, [pretendRunning, isRunning, pendingCount]);

  if (pendingCount === 0 && runningCount === 0 && !pretendRunning && !preFilterActive) return null;

  const showRunning = isRunning || pretendRunning;

  let label: string;
  if (busy) label = "wird gestartet";
  else if (preFilterActive) label = "pre-filter laeuft noch...";
  else if (showRunning) label = isRunning ? `short laeuft (${runningCount})` : "short-overviews laufen";
  else label = `short-overviews fuer ${pendingCount} starten`;

  const totalUsd = perCallUsd * pendingCount;
  const tooltip = showRunning
    ? `${isRunning ? runningCount : pendingCount} laufen. Pro Call ~${formatCost(perCallUsd)} (${model})`
    : `Geschaetzt ~${formatCost(totalUsd)} fuer ${pendingCount} Calls.\nPro Call ~${formatCost(perCallUsd)} (${model}).\n${estimateHistorical ? "Basis: Durchschnitt aus bisherigen Calls dieser Show." : "Basis: Default-Tokens (kein Verlauf vorhanden)."}`;

  async function handleClick() {
    setBusy(true);
    setError(null);
    loading.start();
    try {
      const res = await fetch(`/api/trade-shows/${showId}/short-overview`, {
        method: "POST",
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        setError(j.error ?? "Aktion fehlgeschlagen");
        return;
      }
      setPretendRunning(true);
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
        disabled={busy || showRunning || preFilterActive}
        title={preFilterActive ? "Pre-Filter laeuft noch. Bitte warten bis die Vorfilterung abgeschlossen ist." : tooltip}
        className="inline-flex items-center gap-2 text-ui-sm px-3 py-1.5 border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] hover:scale-[1.05] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
      >
        <span>{label}</span>
        <GoldDot size={6} />
      </button>
      {!showRunning && (
        <span
          className="text-meta text-[var(--color-near-black)]/55 tabular-nums"
          title={tooltip}
        >
          ~{formatCost(totalUsd)}
        </span>
      )}
      {error && <span className="text-meta">{error}</span>}
    </div>
  );
}
