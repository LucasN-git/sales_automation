"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Mode = "edit" | "preview";

type Action =
  | { kind: "wrap"; before: string; after: string }
  | { kind: "prefix-line"; prefix: string }
  | { kind: "link" }
  | { kind: "code-block" };

const TOOLS: { label: string; title: string; action: Action }[] = [
  { label: "H1", title: "Ueberschrift 1", action: { kind: "prefix-line", prefix: "# " } },
  { label: "H2", title: "Ueberschrift 2", action: { kind: "prefix-line", prefix: "## " } },
  { label: "H3", title: "Ueberschrift 3", action: { kind: "prefix-line", prefix: "### " } },
  { label: "B", title: "Fett (Strg+B)", action: { kind: "wrap", before: "**", after: "**" } },
  { label: "I", title: "Kursiv (Strg+I)", action: { kind: "wrap", before: "_", after: "_" } },
  { label: "•", title: "Aufzaehlung", action: { kind: "prefix-line", prefix: "- " } },
  { label: "1.", title: "Nummerierung", action: { kind: "prefix-line", prefix: "1. " } },
  { label: "❝", title: "Zitat", action: { kind: "prefix-line", prefix: "> " } },
  { label: "<>", title: "Inline-Code", action: { kind: "wrap", before: "`", after: "`" } },
  { label: "{}", title: "Code-Block", action: { kind: "code-block" } },
  { label: "🔗", title: "Link", action: { kind: "link" } },
];

export function MarkdownEditor({
  value,
  onChange,
  rows = 22,
  placeholders,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  /** Optionale Platzhalter-Liste (z.B. {{company_name}}) als Quick-Insert-Buttons. */
  placeholders?: string[];
  ariaLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>("edit");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  function applyAction(action: Action) {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = ta.value;
    const selected = text.slice(start, end);

    let nextValue: string;
    let nextStart: number;
    let nextEnd: number;

    if (action.kind === "wrap") {
      nextValue =
        text.slice(0, start) + action.before + selected + action.after + text.slice(end);
      nextStart = start + action.before.length;
      nextEnd = end + action.before.length;
    } else if (action.kind === "prefix-line") {
      const lineStart = text.lastIndexOf("\n", start - 1) + 1;
      const lineEnd = end === start ? start : end;
      const block = text.slice(lineStart, lineEnd);
      const lines = block.length === 0 ? [""] : block.split("\n");
      const prefixed = lines.map((l) => action.prefix + l).join("\n");
      nextValue = text.slice(0, lineStart) + prefixed + text.slice(lineEnd);
      nextStart = lineStart + action.prefix.length;
      nextEnd = nextStart + prefixed.length - action.prefix.length;
    } else if (action.kind === "link") {
      const label = selected || "text";
      const block = `[${label}](url)`;
      nextValue = text.slice(0, start) + block + text.slice(end);
      // Cursor in den url-Platzhalter setzen, damit User direkt tippen kann.
      const urlOffset = block.indexOf("url");
      nextStart = start + urlOffset;
      nextEnd = nextStart + 3;
    } else {
      // code-block
      const block = selected
        ? "```\n" + selected + "\n```"
        : "```\n\n```";
      nextValue = text.slice(0, start) + block + text.slice(end);
      nextStart = start + 4; // hinter ```\n
      nextEnd = nextStart + selected.length;
    }

    onChange(nextValue);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(nextStart, nextEnd);
    });
  }

  function insertPlaceholder(token: string) {
    const ta = ref.current;
    if (!ta) {
      onChange(value + token);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b") {
      e.preventDefault();
      applyAction({ kind: "wrap", before: "**", after: "**" });
    } else if (k === "i") {
      e.preventDefault();
      applyAction({ kind: "wrap", before: "_", after: "_" });
    }
  }

  return (
    <div className="border border-[var(--border-color-soft)]">
      <div className="flex items-center justify-between border-b border-[var(--border-color-soft)] bg-[var(--color-cream-sunken)]">
        <div className="flex items-center flex-wrap">
          {TOOLS.map((t) => (
            <button
              key={t.label}
              type="button"
              title={t.title}
              onClick={() => applyAction(t.action)}
              disabled={mode !== "edit"}
              className="px-2.5 py-1.5 text-ui-sm text-[var(--color-near-black)]/70 hover:text-[var(--color-near-black)] hover:bg-[var(--color-cream)] disabled:opacity-30 transition-colors border-r border-[var(--border-color-soft)] last:border-r-0"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center pr-2 gap-1">
          <ModeBtn active={mode === "edit"} onClick={() => setMode("edit")}>
            bearbeiten
          </ModeBtn>
          <ModeBtn active={mode === "preview"} onClick={() => setMode("preview")}>
            vorschau
          </ModeBtn>
        </div>
      </div>

      {placeholders && placeholders.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap px-2 py-1.5 border-b border-[var(--border-color-soft)] bg-[var(--color-cream-sunken)]/50">
          <span className="text-meta pr-1">platzhalter:</span>
          {placeholders.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => insertPlaceholder(p)}
              disabled={mode !== "edit"}
              className="px-2 py-0.5 text-meta-strong text-[var(--color-near-black)]/70 hover:text-[var(--color-near-black)] border border-[var(--border-color-soft)] hover:border-[var(--border-color)] disabled:opacity-30 transition-colors font-mono"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {mode === "edit" ? (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={rows}
          aria-label={ariaLabel}
          spellCheck={false}
          className="w-full bg-transparent p-4 text-body-sm font-mono focus:outline-none resize-y"
        />
      ) : (
        <div
          className="p-4 prose-markdown overflow-y-auto"
          style={{ maxHeight: `${rows * 1.5}em` }}
        >
          {value.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
          ) : (
            <p className="text-meta">leerer text</p>
          )}
        </div>
      )}
    </div>
  );
}

function ModeBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 text-meta-strong transition-colors ${
        active
          ? "text-[var(--color-near-black)] border-b border-[var(--color-near-black)]"
          : "text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)]"
      }`}
    >
      {children}
    </button>
  );
}
