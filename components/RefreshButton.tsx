"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RefreshIcon } from "@/components/brand/Icons";

export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => router.refresh())}
      title="Aktualisieren"
      className="p-1.5 text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)] transition-colors"
    >
      <RefreshIcon size={14} className={isPending ? "animate-spin" : ""} />
    </button>
  );
}
