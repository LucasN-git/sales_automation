"use client";

import { useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { useReportErrorSafe } from "./ErrorReportProvider";

type Source = "show" | "competitors" | "show-discovery";

export function HelpRequestButton({
  source,
  label,
  context,
  className,
}: {
  source: Source;
  label: string;
  context?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reportError = useReportErrorSafe();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | "failed">("idle");

  function buildRoute(): string {
    const qs = searchParams?.toString();
    return qs ? `${pathname}?${qs}` : pathname ?? "/";
  }

  function handleClick() {
    if (state === "sent" || pending) return;
    startTransition(async () => {
      const r = await apiFetch("/api/help-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          label,
          route: buildRoute(),
          context,
        }),
        reporter: reportError,
        meta: { source, label },
      });
      setState(r.ok ? "sent" : "failed");
    });
  }

  const isSent = state === "sent";
  const isFailed = state === "failed";

  const baseClass =
    className ??
    "inline-flex items-center gap-2 text-ui-sm px-3 py-1.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)] hover:border-[var(--color-near-black)]/40 transition-colors disabled:cursor-not-allowed";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending || isSent}
      className={baseClass}
      aria-live="polite"
      title={
        isSent
          ? "Lucas wurde kontaktiert"
          : isFailed
            ? "Versand fehlgeschlagen, nochmal probieren"
            : "Schickt eine Mail an Lucas mit der aktuellen Seite und User-Info."
      }
    >
      {(isSent || isFailed) && (
        <span
          aria-hidden
          className="inline-block w-1.5 h-1.5"
          style={{
            background: isSent
              ? "var(--color-success, #16A34A)"
              : "var(--color-error, #DC2626)",
          }}
        />
      )}
      <span>
        {pending
          ? "sendet..."
          : isSent
            ? "Lucas wurde kontaktiert"
            : isFailed
              ? "Fehler. Nochmal senden?"
              : "Hilfe anfordern"}
      </span>
    </button>
  );
}
