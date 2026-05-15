"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loading } from "@/components/LoadingBar";

type Props = {
  resultId: string;
  runId: string;
  addedTradeShowId: string | null;
  exhibitorListAvailable: boolean | null;
};

export function AnalyzeDiscoveredShowButton({
  resultId,
  runId,
  addedTradeShowId,
  exhibitorListAvailable,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (addedTradeShowId) {
    return (
      <Link
        href={`/shows/${addedTradeShowId}`}
        className="text-meta-strong text-[var(--color-near-black)]/60 hover:text-[var(--color-near-black)] transition-colors"
      >
        zur Messe →
      </Link>
    );
  }

  async function handleAnalyze() {
    setError(null);
    loading.start();
    startTransition(async () => {
      const res = await fetch(`/api/show-discovery/${runId}/results/${resultId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      if (res.status === 409) {
        // loading.stop() via NavigationLoadingTrigger on pathname commit.
        router.push(`/shows/${json.tradeShowId}`);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Fehler");
        loading.stop();
        return;
      }
      // loading.stop() via NavigationLoadingTrigger on pathname commit.
      router.push(`/shows/${json.tradeShowId}`);
    });
  }

  return (
    <div className="flex items-center gap-3">
      {exhibitorListAvailable === false && (
        <span className="text-meta text-[var(--color-near-black)]/35">
          keine Ausstellerliste
        </span>
      )}
      <button
        onClick={handleAnalyze}
        disabled={isPending}
        className="text-meta-strong text-[var(--color-near-black)] hover:text-[var(--color-near-black)]/65 transition-colors disabled:opacity-40"
      >
        {isPending ? "…" : "jetzt analysieren →"}
      </button>
      {error && (
        <span className="text-meta text-[var(--color-near-black)]/50">{error}</span>
      )}
    </div>
  );
}
