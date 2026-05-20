"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useReportErrorSafe } from "@/components/ErrorReportProvider";

export function SearchRunRowActions({
  runId,
  canCancel,
  canResume,
}: {
  runId: string;
  canCancel: boolean;
  canResume: boolean;
}) {
  const router = useRouter();
  const reportError = useReportErrorSafe();
  const [pending, startTransition] = useTransition();

  function cancel() {
    startTransition(async () => {
      await apiFetch(`/api/company-search/${runId}/cancel`, {
        method: "POST",
        reporter: reportError,
      });
      router.refresh();
    });
  }

  function resume() {
    startTransition(async () => {
      await apiFetch(`/api/company-search/${runId}/resume`, {
        method: "POST",
        reporter: reportError,
      });
      router.refresh();
    });
  }

  function del() {
    if (!confirm("Diesen Lauf endgueltig loeschen? Ergebnisse und Log werden mit entfernt.")) return;
    startTransition(async () => {
      await apiFetch(`/api/company-search/${runId}`, {
        method: "DELETE",
        reporter: reportError,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      {canCancel && (
        <ActionButton onClick={cancel} disabled={pending} label="Stoppen" />
      )}
      {canResume && (
        <ActionButton onClick={resume} disabled={pending} label="Fortsetzen" />
      )}
      <ActionButton onClick={del} disabled={pending} label="Loeschen" />
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      className="px-2 py-1 text-meta border border-[var(--border-color-soft)] text-[var(--color-near-black)]/65 hover:border-[var(--color-near-black)] hover:text-[var(--color-near-black)] transition-colors disabled:opacity-40"
    >
      {label}
    </button>
  );
}
