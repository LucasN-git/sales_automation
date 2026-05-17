"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Status = "suggested" | "active" | "archived" | "rejected";

const STATUS_OPTIONS: { value: Status; label: string; description: string }[] = [
  { value: "suggested", label: "Vorgeschlagen", description: "Wartet auf Kuration." },
  { value: "active", label: "Aktiv", description: "Wird in der Pipeline gefuehrt." },
  { value: "archived", label: "Archiviert", description: "Nicht mehr relevant, aber behalten." },
  { value: "rejected", label: "Abgelehnt", description: "Kein Wettbewerber, ausblenden." },
];

export function CompetitorSettingsView({
  competitorId,
  currentStatus,
}: {
  competitorId: string;
  currentStatus: Status;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<Status | null>(null);
  const [, startTransition] = useTransition();

  async function changeStatus(next: Status) {
    if (pending || next === currentStatus) return;
    setPending(next);
    try {
      const res = await fetch(`/api/competitors/${competitorId}/curate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) return;
      startTransition(() => router.refresh());
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="mb-10">
      <div className="card-surface p-5 mb-4">
        <p className="text-meta uppercase tracking-wider mb-3 text-[var(--color-near-black)]/40">
          Status
        </p>
        <div className="space-y-2">
          {STATUS_OPTIONS.map((opt) => {
            const active = opt.value === currentStatus;
            const isPending = pending === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => changeStatus(opt.value)}
                disabled={active || isPending}
                className={`w-full text-left px-4 py-3 box-line transition-colors flex items-start justify-between gap-4 ${
                  active
                    ? "bg-[var(--color-near-black)]/[0.04] border-l-2 border-l-[var(--color-near-black)]"
                    : "hover:bg-[var(--color-near-black)]/[0.02]"
                } disabled:cursor-not-allowed`}
              >
                <div className="min-w-0">
                  <div className="text-body-sm font-semibold">{opt.label}</div>
                  <div className="text-meta text-[var(--color-near-black)]/55 mt-0.5">
                    {opt.description}
                  </div>
                </div>
                {active && (
                  <span className="text-meta text-[var(--color-near-black)]/60 shrink-0 pt-px">
                    aktuell
                  </span>
                )}
                {isPending && (
                  <span className="text-meta text-[var(--color-near-black)]/60 shrink-0 pt-px">
                    speichere...
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card-surface p-5">
        <p className="text-meta uppercase tracking-wider mb-2 text-[var(--color-near-black)]/40">
          Weitere Aktionen
        </p>
        <p className="text-body-sm text-[var(--color-near-black)]/55">
          Loeschen und Bulk-Aenderungen laufen ueber den Chat rechts. Sag z.B.
          &quot;loesche diesen Konkurrenten&quot; und bestaetige das Widget.
        </p>
      </div>
    </section>
  );
}
