"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function StarIcon({
  size = 16,
  filled,
  className = "",
}: {
  size?: number;
  filled: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      className={className}
      aria-hidden
    >
      <path
        d="M8 1.5 L10 5.8 L14.5 6.4 L11.2 9.6 L12 14 L8 11.8 L4 14 L4.8 9.6 L1.5 6.4 L6 5.8 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FavoriteToggle({
  showId,
  initialFavorite,
  size = 18,
  className = "",
}: {
  showId: string;
  initialFavorite: boolean;
  size?: number;
  className?: string;
}) {
  const router = useRouter();
  const [favorite, setFavorite] = useState(initialFavorite);
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !favorite;
    setFavorite(next);
    setBusy(true);
    const res = await fetch(`/api/trade-shows/${showId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setFavorite(!next);
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={favorite}
      aria-label={favorite ? "Favorit entfernen" : "Als Favorit markieren"}
      title={favorite ? "Favorit entfernen" : "Als Favorit markieren"}
      className={`inline-flex items-center justify-center w-7 h-7 transition-colors ${
        favorite
          ? "text-[var(--color-gold)]"
          : "text-[var(--color-near-black)]/35 hover:text-[var(--color-gold)]"
      } ${className}`}
    >
      <StarIcon size={size} filled={favorite} />
    </button>
  );
}
