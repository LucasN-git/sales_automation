"use client";

import { useEffect } from "react";
import { useReportErrorSafe } from "@/components/ErrorReportProvider";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const report = useReportErrorSafe();

  useEffect(() => {
    report({
      source: "render",
      message: error.message,
      stack: error.stack,
      meta: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error, report]);

  return (
    <div className="px-6 py-12 max-w-2xl">
      <div
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          background: "var(--color-gold)",
          marginBottom: 16,
        }}
        aria-hidden
      />
      <h1 className="text-display">
        Etwas ist schiefgegangen<span style={{ color: "var(--color-gold)" }}>.</span>
      </h1>
      <p className="mt-4 text-body text-[var(--color-near-black)]/70">
        Die Seite konnte nicht geladen werden. Der Fehler wurde unten rechts
        protokolliert. Du kannst ihn dort kopieren oder direkt per Mail schicken.
      </p>
      <p className="mt-2 text-meta text-[var(--color-near-black)]/50">
        {error.message}
        {error.digest ? ` . digest ${error.digest}` : ""}
      </p>
      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="px-5 py-2.5 text-body-sm font-semibold border border-[var(--color-near-black)] hover:text-[var(--color-gold)] transition-colors"
        >
          Erneut versuchen
        </button>
        <button
          type="button"
          onClick={() => (window.location.href = "/")}
          className="px-5 py-2.5 text-body-sm font-medium border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70 hover:text-[var(--color-near-black)] transition-colors"
        >
          Zur Startseite
        </button>
      </div>
    </div>
  );
}
