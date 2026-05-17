"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  buildErrorReport,
  buildMailtoUrl,
  copyReportToClipboard,
  formatReportForClipboard,
  getReportEmail,
  type ErrorReport,
} from "@/lib/error-report";

type ReportInput = Omit<ErrorReport, "id" | "ts" | "userAgent" | "route">;

type ErrorReportContextValue = {
  reportError: (input: ReportInput) => ErrorReport;
  current: ErrorReport | null;
  history: ErrorReport[];
  dismiss: () => void;
  clearHistory: () => void;
};

const ErrorReportContext = createContext<ErrorReportContextValue | null>(null);

export function useErrorReporter(): ErrorReportContextValue {
  const ctx = useContext(ErrorReportContext);
  if (!ctx) {
    throw new Error("useErrorReporter must be used within ErrorReportProvider");
  }
  return ctx;
}

export function useReportErrorSafe(): (input: ReportInput) => void {
  const ctx = useContext(ErrorReportContext);
  return useCallback(
    (input: ReportInput) => {
      if (ctx) ctx.reportError(input);
      else if (typeof console !== "undefined") console.error("[ErrorReport]", input);
    },
    [ctx],
  );
}

export function ErrorReportProvider({
  children,
  userEmail,
}: {
  children: React.ReactNode;
  userEmail?: string;
}) {
  const [current, setCurrent] = useState<ErrorReport | null>(null);
  const [history, setHistory] = useState<ErrorReport[]>([]);

  const reportError = useCallback(
    (input: ReportInput): ErrorReport => {
      const report = buildErrorReport({
        ...input,
        userEmail: input.userEmail ?? userEmail,
      });
      setCurrent(report);
      setHistory((prev) => [report, ...prev].slice(0, 20));
      if (typeof console !== "undefined") {
        console.error(`[ErrorReport ${report.id}]`, report);
      }
      return report;
    },
    [userEmail],
  );

  const dismiss = useCallback(() => setCurrent(null), []);
  const clearHistory = useCallback(() => setHistory([]), []);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportError({
        source: "global",
        message: event.message || "Unbekannter Fehler",
        stack: event.error?.stack,
        url: event.filename,
        meta: { lineno: event.lineno, colno: event.colno },
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      let message = "Unhandled Promise Rejection";
      let stack: string | undefined;
      if (reason instanceof Error) {
        message = reason.message;
        stack = reason.stack;
      } else if (typeof reason === "string") {
        message = reason;
      } else if (reason && typeof reason === "object") {
        try {
          message = JSON.stringify(reason);
        } catch {
          message = String(reason);
        }
      }
      reportError({ source: "promise", message, stack });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [reportError]);

  const value = useMemo<ErrorReportContextValue>(
    () => ({ reportError, current, history, dismiss, clearHistory }),
    [reportError, current, history, dismiss, clearHistory],
  );

  return (
    <ErrorReportContext.Provider value={value}>
      {children}
      <ErrorOverlay report={current} onDismiss={dismiss} />
    </ErrorReportContext.Provider>
  );
}

function ErrorOverlay({
  report,
  onDismiss,
}: {
  report: ErrorReport | null;
  onDismiss: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!report) return;
    setCopyStatus("idle");
    setShowDetails(false);
  }, [report?.id]);

  if (!report) return null;

  const reportText = formatReportForClipboard(report);
  const mailtoUrl = buildMailtoUrl(report);

  async function handleCopy() {
    const ok = await copyReportToClipboard(report!);
    setCopyStatus(ok ? "copied" : "failed");
    setTimeout(() => setCopyStatus("idle"), 2500);
  }

  return (
    <div
      role="alertdialog"
      aria-labelledby="error-overlay-title"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 9999,
        maxWidth: 480,
        width: "calc(100vw - 32px)",
        background: "var(--color-cream)",
        boxShadow:
          "0 4px 24px rgba(10,10,10,0.18), 0 0 0 1px rgba(10,10,10,0.22)",
        fontFamily: "var(--font-sans)",
        color: "var(--color-near-black)",
      }}
    >
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--border-color-soft)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            background: "var(--color-gold)",
            display: "inline-block",
          }}
        />
        <span
          id="error-overlay-title"
          style={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }}
        >
          Fehler {report.id} . {report.source}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Schliessen"
          style={{
            width: 28,
            height: 28,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "var(--color-near-black)",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: "12px 16px" }}>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.45,
            wordBreak: "break-word",
          }}
        >
          {report.message}
        </p>
        <p
          style={{
            margin: "8px 0 0 0",
            fontSize: 11,
            color: "rgba(10,10,10,0.55)",
          }}
        >
          {report.route ?? ""}
          {report.status !== undefined ? ` . Status ${report.status}` : ""}
        </p>

        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          style={{
            marginTop: 10,
            fontSize: 11,
            fontWeight: 500,
            background: "transparent",
            border: "none",
            color: "rgba(10,10,10,0.55)",
            padding: 0,
            cursor: "pointer",
          }}
        >
          {showDetails ? "Details ausblenden" : "Details anzeigen"}
        </button>

        {showDetails && (
          <pre
            style={{
              marginTop: 8,
              padding: 10,
              maxHeight: 240,
              overflow: "auto",
              background: "var(--color-cream-sunken)",
              border: "1px solid var(--border-color-soft)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {reportText}
          </pre>
        )}
      </div>

      <div
        style={{
          padding: "10px 16px 14px 16px",
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={handleCopy}
          style={{
            padding: "7px 14px",
            fontSize: 13,
            fontWeight: 500,
            border: "1px solid var(--border-color-strong)",
            background: "transparent",
            color: "var(--color-near-black)",
            cursor: "pointer",
          }}
        >
          {copyStatus === "copied"
            ? "Kopiert"
            : copyStatus === "failed"
              ? "Kopieren fehlgeschlagen"
              : "Fehler kopieren"}
        </button>
        <a
          href={mailtoUrl}
          style={{
            padding: "7px 14px",
            fontSize: 13,
            fontWeight: 500,
            border: "1px solid var(--border-color-strong)",
            background: "transparent",
            color: "var(--color-near-black)",
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          An {getReportEmail().split("@")[0]} senden
        </a>
        <span
          style={{
            fontSize: 11,
            color: "rgba(10,10,10,0.40)",
            marginLeft: "auto",
          }}
        >
          {new Date(report.ts).toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
