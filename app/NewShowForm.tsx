"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";

export function NewShowForm() {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/trade-shows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        source_url: url || null,
        year: year ? Number(year) : null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Fehler beim Anlegen.");
      return;
    }
    const { id } = await res.json();
    setOpen(false);
    setName("");
    setUrl("");
    startTransition(() => {
      router.push(`/shows/${id}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-5 py-3 text-[15px] font-bold uppercase tracking-[0.04em] bg-[var(--color-near-black)] text-[var(--color-cream)]"
      >
        <span>Neue Messe</span>
        <GoldDot size={6} />
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-b border-[var(--color-hairline-light)] py-8 grid grid-cols-1 md:grid-cols-12 gap-6"
    >
      <div className="md:col-span-5">
        <label className="block text-[13px] uppercase tracking-[0.06em] mb-2">Messe-Name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="AUSA Annual Meeting"
          className="w-full bg-transparent border-0 border-b border-[var(--color-hairline-light)] py-2 text-[18px] focus:outline-none focus:border-[var(--color-near-black)]"
        />
      </div>
      <div className="md:col-span-5">
        <label className="block text-[13px] uppercase tracking-[0.06em] mb-2">URL Aussteller-Liste</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://meeting.ausa.org/exhibitors"
          className="w-full bg-transparent border-0 border-b border-[var(--color-hairline-light)] py-2 text-[18px] focus:outline-none focus:border-[var(--color-near-black)]"
        />
      </div>
      <div className="md:col-span-2">
        <label className="block text-[13px] uppercase tracking-[0.06em] mb-2">Jahr</label>
        <input
          type="number"
          min={2020}
          max={2030}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="w-full bg-transparent border-0 border-b border-[var(--color-hairline-light)] py-2 text-[18px] tabular-nums focus:outline-none focus:border-[var(--color-near-black)]"
        />
      </div>

      <div className="md:col-span-12 flex items-center gap-4">
        <button
          type="submit"
          disabled={pending || !name}
          className="inline-flex items-center gap-2 px-5 py-3 text-[15px] font-bold uppercase tracking-[0.04em] bg-[var(--color-near-black)] text-[var(--color-cream)] disabled:opacity-50"
        >
          <span>{pending ? "Starte" : "Crawl starten"}</span>
          <GoldDot size={6} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)]"
        >
          Abbrechen
        </button>
        {error && <p className="text-[15px] text-[var(--color-near-black)]/70">{error}</p>}
      </div>
    </form>
  );
}
