"use client";

import { usePathname } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { GoldDot } from "@/components/brand/GoldDot";
import type { FavoriteShow } from "@/lib/favorites";

export function SidebarFavorites({
  favorites,
  onNavigate,
}: {
  favorites: FavoriteShow[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  if (favorites.length === 0) return null;

  return (
    <ul className="px-3 pb-3 space-y-0">
      {favorites.map((s) => {
        const href = `/shows/${s.id}`;
        const active = pathname === href || pathname?.startsWith(`${href}/`);
        return (
          <li key={s.id}>
            <NavLink
              href={href}
              onClick={onNavigate}
              className={`flex items-center gap-2 px-3 py-1.5 text-body-sm transition-colors border-l-2 ${
                active
                  ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
                  : "border-transparent text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)]"
              }`}
            >
              <GoldDot size={4} className="shrink-0" />
              <span className="truncate">{s.name}</span>
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}
