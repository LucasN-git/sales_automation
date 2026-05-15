"use client";

import { useState, useRef } from "react";
import { Hairline } from "@/components/brand/Hairline";
import { parseErrorJson } from "@/lib/fetch-json";

type Table = "short" | "deep";

interface EditableIntelFieldProps {
  exhibitorId: string;
  table: Table;
  field: string;
  value: string;
  children: (value: string) => React.ReactNode;
  singleLine?: boolean;
  rows?: number;
  /**
   * If provided, renders a label row with the pencil icon next to it.
   * When `asSection` is also true, wraps everything in a <section> with
   * hairline — use this to replace a <Block> that contains only this field.
   */
  label?: string;
  asSection?: boolean;
}

export function EditableIntelField({
  exhibitorId,
  table,
  field,
  value: initialValue,
  children,
  singleLine = false,
  rows = 4,
  label,
  asSection = false,
}: EditableIntelFieldProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/exhibitors/${exhibitorId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, field, value }),
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        throw new Error(j.error ?? "Speichern fehlgeschlagen");
      }
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setValue(initialValue);
    setEditing(false);
    setError(null);
  }

  const inputEl = singleLine ? (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      autoFocus
      className="w-full text-body border border-[var(--color-near-black)] px-3 py-2 bg-white focus:outline-none focus:border-[var(--color-gold)] rounded-md"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleSave();
        if (e.key === "Escape") handleCancel();
      }}
      disabled={saving}
    />
  ) : (
    <textarea
      ref={ref as React.RefObject<HTMLTextAreaElement>}
      autoFocus
      rows={rows}
      className="w-full text-body border border-[var(--color-near-black)] px-3 py-2 bg-white focus:outline-none focus:border-[var(--color-gold)] resize-y rounded-md"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") handleCancel();
      }}
      disabled={saving}
    />
  );

  const editButtons = (
    <div className="flex items-center gap-3">
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-meta-strong px-4 py-1.5 border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] disabled:opacity-50 transition-colors"
      >
        {saving ? "speichert…" : "speichern"}
      </button>
      <button
        onClick={handleCancel}
        disabled={saving}
        className="text-meta px-3 py-1.5 border border-[var(--border-color-soft)] hover:border-[var(--color-near-black)] transition-colors rounded-md"
      >
        abbrechen
      </button>
    </div>
  );

  const editingUI = (
    <div className="space-y-2">
      {inputEl}
      {error && <p className="text-meta text-red-600">{error}</p>}
      {editButtons}
    </div>
  );

  // With label: pencil appears inline next to the label heading, no border box.
  if (label) {
    const labelRow = (
      <div className="group flex items-center gap-2 mb-3">
        <span className="text-meta-strong">{label}</span>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] leading-none text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)]"
            title="Bearbeiten"
            aria-label="Bearbeiten"
          >
            ✎
          </button>
        )}
      </div>
    );

    const body = editing ? editingUI : <div>{children(value)}</div>;

    if (asSection) {
      return (
        <section className="py-7">
          <Hairline />
          <div className="pt-5">
            {labelRow}
            {body}
          </div>
        </section>
      );
    }

    return (
      <div>
        {labelRow}
        {body}
      </div>
    );
  }

  // No label: pencil floats borderless at top-right of the content area.
  if (!editing) {
    return (
      <div className="group relative">
        <div>{children(value)}</div>
        <button
          onClick={() => setEditing(true)}
          className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity text-[11px] px-1 py-0.5 text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)]"
          title="Bearbeiten"
          aria-label="Bearbeiten"
        >
          ✎
        </button>
      </div>
    );
  }

  return editingUI;
}

/** Dropdown-based editable field for enum tag values.
 *  Renders as a bordered chip; on hover the pencil icon appears inside the chip. */
interface EditableSelectFieldProps {
  exhibitorId: string;
  table: Table;
  field: string;
  value: string;
  options: { value: string; label: string }[];
  /** Format the displayed value (defaults to raw value). */
  displayLabel?: (v: string) => string;
  /** Tailwind classes for the chip (border color, text color). */
  tagClassName?: string;
  /** Inline style for the chip — receives current value so color can vary. */
  tagStyle?: (v: string) => React.CSSProperties | undefined;
}

export function EditableSelectField({
  exhibitorId,
  table,
  field,
  value: initialValue,
  options,
  displayLabel,
  tagClassName = "border-[var(--color-near-black)]",
  tagStyle,
}: EditableSelectFieldProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(newVal: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/exhibitors/${exhibitorId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, field, value: newVal }),
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        throw new Error(j.error ?? "Speichern fehlgeschlagen");
      }
      setValue(newVal);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler");
    } finally {
      setSaving(false);
    }
  }

  // Non-editing: chip with pencil that fades in inside the border on hover.
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className={`group inline-flex items-center gap-1.5 text-meta-strong px-2 py-1 border ${tagClassName}`}
        style={tagStyle ? tagStyle(value) : undefined}
        title="Bearbeiten"
      >
        <span>{displayLabel ? displayLabel(value) : value}</span>
        <span
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] leading-none"
          aria-hidden
        >
          ✎
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <select
        autoFocus
        className="text-body border border-[var(--color-near-black)] px-3 py-2 bg-white focus:outline-none focus:border-[var(--color-gold)] rounded-md"
        value={value}
        onChange={(e) => handleSave(e.target.value)}
        disabled={saving}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="text-meta text-red-600">{error}</p>}
      <button
        onClick={() => setEditing(false)}
        className="text-meta px-3 py-1 border border-[var(--border-color-soft)] rounded-md"
      >
        schliessen
      </button>
    </div>
  );
}
