"use client";

import { useState } from "react";
import {
  buildErrorReport,
  buildMailtoUrl,
  copyReportToClipboard,
  formatReportForClipboard,
} from "@/lib/error-report";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [showDetails, setShowDetails] = useState(false);

  const report = buildErrorReport({
    source: "render",
    message: error.message,
    stack: error.stack,
    meta: error.digest ? { digest: error.digest } : undefined,
  });

  async function handleCopy() {
    const ok = await copyReportToClipboard(report);
    setCopyStatus(ok ? "copied" : "failed");
    setTimeout(() => setCopyStatus("idle"), 2500);
  }

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#FFFFFF",
          color: "#0A0A0A",
          fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          padding: 32,
        }}
      >
        <div style={{ maxWidth: 640 }}>
          <div
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: "#D4A843",
              marginBottom: 16,
            }}
          />
          <h1
            style={{
              fontSize: 44,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            Ein schwerer Fehler ist aufgetreten<span style={{ color: "#D4A843" }}>.</span>
          </h1>
          <p style={{ marginTop: 16, fontSize: 14, color: "rgba(10,10,10,0.7)" }}>
            Das Layout konnte nicht gerendert werden. Bitte den Fehler kopieren
            und an Lucas schicken, damit er das beheben kann.
          </p>
          <p
            style={{
              marginTop: 8,
              fontSize: 11,
              color: "rgba(10,10,10,0.5)",
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
            }}
          >
            ID {report.id} . {error.message}
            {error.digest ? ` . digest ${error.digest}` : ""}
          </p>

          <div style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid #0A0A0A",
                background: "transparent",
                color: "#0A0A0A",
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
              href={buildMailtoUrl(report)}
              style={{
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 600,
                border: "1px solid #0A0A0A",
                background: "transparent",
                color: "#0A0A0A",
                textDecoration: "none",
              }}
            >
              An Lucas senden
            </a>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "10px 20px",
                fontSize: 13,
                fontWeight: 500,
                border: "1px solid rgba(10,10,10,0.10)",
                background: "transparent",
                color: "rgba(10,10,10,0.7)",
                cursor: "pointer",
              }}
            >
              Neu laden
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowDetails((v) => !v)}
            style={{
              marginTop: 16,
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
                marginTop: 12,
                padding: 12,
                maxHeight: 320,
                overflow: "auto",
                background: "#F5F6F8",
                border: "1px solid rgba(10,10,10,0.10)",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {formatReportForClipboard(report)}
            </pre>
          )}
        </div>
      </body>
    </html>
  );
}
