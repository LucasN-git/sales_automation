"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { parseErrorJson } from "@/lib/fetch-json";

export function AddCompanyForm() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    let normalizedUrl = website.trim();
    if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    const res = await fetch("/api/companies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        website: normalizedUrl || null,
      }),
    });
    if (!res.ok) {
      const j = await parseErrorJson(res);
      setError(j.error ?? "Fehler beim Anlegen.");
      return;
    }
    const { id } = await res.json();
    setOpen(false);
    setName("");
    setWebsite("");
    startTransition(() => {
      router.push(`/companies/${id}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] transition-all duration-150 origin-center"
      >
        <span>firma manuell hinzufuegen</span>
        <GoldDot size={6} />
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-b border-[var(--border-color-soft)] py-8 grid grid-cols-1 md:grid-cols-12 gap-6"
    >
      <div className="md:col-span-6">
        <label className="block text-meta mb-2">firmen-name</label>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bosch GmbH"
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        />
      </div>
      <div className="md:col-span-6">
        <label className="block text-meta mb-2">website (optional)</label>
        <input
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="bosch.com"
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        />
      </div>

      <div className="md:col-span-12 flex items-center gap-4 flex-wrap">
        <button
          type="submit"
          disabled={pending || name.trim().length < 2}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{pending ? "starte" : "anlegen + deep dive"}</span>
          <GoldDot size={6} />
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
            setWebsite("");
            setError(null);
          }}
          className="text-ui text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] transition-colors"
        >
          abbrechen
        </button>
        <span className="text-meta text-[var(--color-near-black)]/60">
          claude scrapt website (falls angegeben), liefert one-liner, prio,
          isp-match, ansprechpartner, schmerzpunkte, oeffnungsfragen.
        </span>
        {error && (
          <span className="text-body-sm text-[var(--color-near-black)]/70 basis-full">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
