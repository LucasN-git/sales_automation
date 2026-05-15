"use client";

import type { AppSettings } from "@/lib/settings";
import type { UserProfile } from "@/lib/profile";
import type { FavoriteShow } from "@/lib/favorites";
import { CloseIcon } from "@/components/brand/Icons";
import { AppSidebarBody } from "./AppSidebar";
import { useMobileShell } from "./MobileShellProvider";

export function MobileNavDrawer({
  profile,
  settings,
  favorites,
}: {
  profile: UserProfile;
  settings: AppSettings;
  favorites: FavoriteShow[];
}) {
  const { navOpen, closeNav } = useMobileShell();

  return (
    <div
      aria-hidden={!navOpen}
      className={`lg:hidden fixed inset-0 z-50 transition-opacity ${
        navOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
    >
      <button
        type="button"
        aria-label="Navigation schliessen"
        onClick={closeNav}
        className="absolute inset-0 bg-[var(--color-near-black)]/40 w-full h-full"
      />
      <aside
        className={`absolute inset-y-0 left-0 w-[min(85vw,320px)] flex flex-col bg-[var(--color-cream-sunken)] border-r border-[var(--border-color-soft)] transition-transform duration-200 ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <button
          onClick={closeNav}
          aria-label="Navigation schliessen"
          title="Schliessen"
          className="absolute top-3 right-3 w-8 h-8 inline-flex items-center justify-center text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] transition-colors z-10"
        >
          <CloseIcon size={14} />
        </button>
        <AppSidebarBody
          profile={profile}
          settings={settings}
          favorites={favorites}
          onNavigate={closeNav}
        />
      </aside>
    </div>
  );
}
