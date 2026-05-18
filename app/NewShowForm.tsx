"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { loading } from "@/components/LoadingBar";
import { parseErrorJson } from "@/lib/fetch-json";

export function NewShowForm() {
  const [name, setName] = useState("");
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    loading.start();
    const res = await fetch("/api/trade-shows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        year: year ? Number(year) : null,
      }),
    });
    if (!res.ok) {
      const j = await parseErrorJson(res);
      setError(j.error ?? "Fehler beim Anlegen.");
      loading.stop();
      return;
    }
    const { id } = await res.json();
    setOpen(false);
    setName("");
    // loading.stop() is handled by NavigationLoadingTrigger on pathname commit.
    startTransition(() => {
      router.push(`/shows/${id}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] transition-all duration-150 origin-center"
      >
        <span>neue messe</span>
        <GoldDot size={6} />
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-b border-[var(--border-color-soft)] py-8 grid grid-cols-1 md:grid-cols-8 gap-6"
    >
      <div className="md:col-span-6">
        <label className="block text-meta mb-2">messe-name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="AUSA Annual Meeting"
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        />
        <p className="text-meta mt-1.5 text-[var(--color-near-black)]/55">
          Ich suche danach automatisch die Aussteller-URL per Web-Search.
        </p>
      </div>
      <div className="md:col-span-2">
        <label className="block text-meta mb-2">jahr</label>
        <input
          type="number"
          min={2020}
          max={2030}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body tabular-nums focus:outline-none focus:border-[var(--color-near-black)]"
        />
      </div>

      <div className="md:col-span-8 flex items-center gap-4 flex-wrap">
        <button
          type="submit"
          disabled={pending || !name}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{pending ? "starte" : "anlegen"}</span>
          <GoldDot size={6} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-ui text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] transition-colors"
        >
          abbrechen
        </button>
        {error && <p className="text-body-sm text-[var(--color-near-black)]/70">{error}</p>}
      </div>
    </form>
  );
}
