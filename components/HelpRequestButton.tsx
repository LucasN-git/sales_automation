"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function buildRoute(): string {
    const qs = searchParams?.toString();
    return qs ? `${pathname}?${qs}` : pathname ?? "/";
  }

  function buildContext(): string | undefined {
    const trimmed = note.trim();
    if (context && trimmed) {
      return `${context}\n\nBeschreibung vom Nutzer:\n${trimmed}`;
    }
    if (trimmed) return `Beschreibung vom Nutzer:\n${trimmed}`;
    return context;
  }

  function send() {
    if (pending) return;
    const finalContext = buildContext();
    startTransition(async () => {
      const r = await apiFetch("/api/help-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          label,
          route: buildRoute(),
          context: finalContext,
        }),
        reporter: reportError,
        meta: { source, label },
      });
      if (r.ok) {
        setState("sent");
        setOpen(false);
        setNote("");
      } else {
        setState("failed");
      }
    });
  }

  function handleOpenClick() {
    if (state === "sent" || pending) return;
    setOpen((v) => !v);
    if (state === "failed") setState("idle");
  }

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();

    function onPointer(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        send();
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, note, pending]);

  const isSent = state === "sent";
  const isFailed = state === "failed";

  const baseClass =
    className ??
    "inline-flex items-center gap-2 text-ui-sm px-3 py-1.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)] hover:border-[var(--color-near-black)]/40 transition-colors disabled:cursor-not-allowed";

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={handleOpenClick}
        disabled={pending || isSent}
        className={baseClass}
        aria-live="polite"
        aria-expanded={open}
        title={
          isSent
            ? "Lucas wurde kontaktiert"
            : isFailed
              ? "Versand fehlgeschlagen, nochmal probieren"
              : "Beschreibung eingeben und an Lucas senden."
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

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[360px] bg-[var(--color-cream)] shadow-[0_8px_24px_rgba(10,10,10,0.16),0_0_0_1px_rgba(10,10,10,0.12)]"
          role="dialog"
          aria-label="Hilfe anfordern"
        >
          <div className="p-4 flex flex-col gap-3">
            <div className="text-meta-strong text-[var(--color-near-black)]/70">
              Was ist passiert?
            </div>
            <textarea
              ref={textareaRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1800}
              rows={5}
              placeholder="z.B. Sammeln der Messen-Infos hat nicht funktioniert oder die KI hat nicht alle Aussteller gefunden."
              className="w-full resize-none bg-[var(--color-cream-sunken)] p-3 text-body-sm text-[var(--color-near-black)] placeholder:text-[var(--color-near-black)]/35 outline-none focus:shadow-[0_0_0_1px_var(--color-near-black)]"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-meta text-[var(--color-near-black)]/45 tabular-nums">
                {note.length}/1800
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="text-ui-sm px-3 py-1.5 text-[var(--color-near-black)]/60 hover:text-[var(--color-near-black)] transition-colors"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={pending}
                  className="text-ui-sm px-3 py-1.5 border border-[var(--color-near-black)]/80 text-[var(--color-near-black)] hover:border-[var(--color-gold)] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? "sendet..." : "Senden"}
                </button>
              </div>
            </div>
            {isFailed && (
              <div className="text-meta text-[var(--color-error,#DC2626)]">
                Versand fehlgeschlagen, bitte nochmal probieren.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
