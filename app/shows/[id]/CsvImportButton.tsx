"use client";

import { useRef, useState } from "react";
import { loading } from "@/components/LoadingBar";

type PreviewRow = { name: string; booth: string; website: string };

type State =
  | { kind: "idle" }
  | { kind: "preview"; rows: PreviewRow[]; total: number; file: File }
  | { kind: "importing" }
  | { kind: "done"; inserted: number; skipped: number; dbError?: string }
  | { kind: "error"; message: string };

function detectSep(line: string): string {
  return (line.match(/;/g) ?? []).length > (line.match(/,/g) ?? []).length ? ";" : ",";
}

function splitLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let inQuote = false;
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && !inQuote) {
      inQuote = true;
    } else if (ch === '"' && inQuote) {
      if (line[i + 1] === '"') { current += '"'; i++; }
      else inQuote = false;
    } else if (ch === sep && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parsePreview(text: string): { rows: PreviewRow[]; total: number } | { error: string } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: "Datei hat keine Datenzeilen." };

  const sep = detectSep(lines[0]);
  const headers = splitLine(lines[0], sep).map((h) =>
    h.toLowerCase().replace(/["\s]/g, "").replace(/[^a-z_]/g, "_"),
  );

  const nameCol = ["name", "company_name", "firma", "aussteller"].reduce(
    (found, k) => (found !== -1 ? found : headers.indexOf(k)),
    -1,
  );
  if (nameCol === -1) return { error: 'Keine Namensspalte gefunden ("name", "company_name", "firma").' };

  const boothCol = ["booth", "stand", "booth_number"].reduce(
    (f, k) => (f !== -1 ? f : headers.indexOf(k)), -1,
  );
  const webCol = ["website", "url", "homepage"].reduce(
    (f, k) => (f !== -1 ? f : headers.indexOf(k)), -1,
  );

  const dataLines = lines.slice(1).filter((l) => l.trim());
  const preview = dataLines.slice(0, 5).map((line) => {
    const cells = splitLine(line, sep);
    return {
      name: cells[nameCol]?.trim() ?? "",
      booth: boothCol !== -1 ? cells[boothCol]?.trim() ?? "" : "",
      website: webCol !== -1 ? cells[webCol]?.trim() ?? "" : "",
    };
  }).filter((r) => r.name);

  return { rows: preview, total: dataLines.filter((l) => {
    const cells = splitLine(l, sep);
    return (cells[nameCol]?.trim() ?? "").length > 0;
  }).length };
}

export function CsvImportButton({ showId }: { showId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!inputRef.current) inputRef.current!.value = "";
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parsePreview(text);
      if ("error" in result) {
        setState({ kind: "error", message: result.error });
        return;
      }
      setState({ kind: "preview", rows: result.rows, total: result.total, file });
    };
    reader.readAsText(file, "utf-8");

    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleConfirm() {
    if (state.kind !== "preview") return;
    const { file } = state;

    setState({ kind: "importing" });
    loading.start();

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/shows/${showId}/exhibitors/csv-import`, {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setState({ kind: "error", message: json.error ?? "Import fehlgeschlagen." });
        return;
      }
      setState({ kind: "done", inserted: json.inserted, skipped: json.skipped, dbError: json.error });
      window.location.reload();
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    } finally {
      loading.stop();
    }
  }

  function reset() {
    setState({ kind: "idle" });
  }

  const showModal = state.kind === "preview" || state.kind === "importing" || state.kind === "done" || state.kind === "error";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 text-ui-sm px-3 py-1.5 border border-[var(--border-color-soft)] rounded-md text-[var(--color-near-black)]/60 hover:text-[var(--color-blue)] hover:border-[var(--color-blue)]/50 transition-colors"
      >
        csv import
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(10,10,10,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget && state.kind !== "importing") reset(); }}
        >
          <div
            className="bg-[var(--color-cream)] w-full max-w-lg mx-4"
            style={{ boxShadow: "0 8px 40px rgba(10,10,10,0.18), 0 0 0 1px rgba(10,10,10,0.10)" }}
          >
            <div className="px-6 pt-6 pb-2 border-b border-[var(--border-color-soft)]">
              <h2 className="text-title">
                csv import
                <span style={{ color: "var(--color-gold)" }}>.</span>
              </h2>
            </div>

            <div className="px-6 py-5">
              {state.kind === "preview" && (
                <>
                  <p className="text-body mb-1">
                    <span className="tabular-nums font-semibold">{state.total}</span> aussteller erkannt.
                  </p>
                  <p className="text-meta text-[var(--color-near-black)]/55 mb-4">
                    vorschau (erste {state.rows.length}):
                  </p>
                  <div className="border border-[var(--border-color-soft)] mb-5">
                    {state.rows.map((r, i) => (
                      <div
                        key={i}
                        className="px-4 py-2.5 flex items-start gap-3 border-b border-[var(--border-color-soft)] last:border-b-0"
                      >
                        <span className="text-body flex-1 min-w-0 truncate">{r.name}</span>
                        {r.booth && (
                          <span className="text-meta text-[var(--color-near-black)]/45 shrink-0">
                            {r.booth}
                          </span>
                        )}
                        {r.website && (
                          <span className="text-meta text-[var(--color-near-black)]/45 shrink-0 truncate max-w-[140px]">
                            {r.website.replace(/^https?:\/\/(www\.)?/, "")}
                          </span>
                        )}
                      </div>
                    ))}
                    {state.total > state.rows.length && (
                      <div className="px-4 py-2.5 text-meta text-[var(--color-near-black)]/40">
                        + {state.total - state.rows.length} weitere
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleConfirm}
                      className="px-4 py-2 text-ui rounded-md border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:border-[var(--color-gold)] transition-colors"
                    >
                      {state.total} aussteller importieren
                    </button>
                    <button
                      onClick={reset}
                      className="px-4 py-2 text-ui rounded-md border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
                    >
                      abbrechen
                    </button>
                  </div>
                </>
              )}

              {state.kind === "importing" && (
                <div className="flex items-center gap-3 py-4">
                  <span
                    className="inline-block"
                    style={{
                      width: 8,
                      height: 8,
                      background: "var(--color-gold)",
                      animation: "pulse 1s ease-in-out infinite",
                    }}
                  />
                  <span className="text-body">wird importiert...</span>
                </div>
              )}

              {state.kind === "done" && (
                <>
                  <p className="text-body mb-1">
                    <span className="tabular-nums font-semibold">{state.inserted}</span> aussteller hinzugefügt
                    {state.skipped > 0 && (
                      <span className="text-[var(--color-near-black)]/50">
                        {" "}· {state.skipped} übersprungen
                      </span>
                    )}
                    <span style={{ color: "var(--color-gold)" }}>.</span>
                  </p>
                  {state.dbError ? (
                    <p className="text-meta text-[var(--color-error)] mb-5">
                      db-fehler: {state.dbError}
                    </p>
                  ) : (
                    <p className="text-meta text-[var(--color-near-black)]/55 mb-5">
                      url-search und short-overview können jetzt gestartet werden.
                    </p>
                  )}
                  <button
                    onClick={reset}
                    className="px-4 py-2 text-ui rounded-md border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
                  >
                    schließen
                  </button>
                </>
              )}

              {state.kind === "error" && (
                <>
                  <p className="text-body text-[var(--color-error)] mb-4">{state.message}</p>
                  <button
                    onClick={reset}
                    className="px-4 py-2 text-ui rounded-md border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
                  >
                    schließen
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
