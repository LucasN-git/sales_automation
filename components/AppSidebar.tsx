import Link from "next/link";
import type { AppSettings } from "@/lib/settings";
import type { UserProfile } from "@/lib/profile";
import type { FavoriteShow } from "@/lib/favorites";
import { AppSidebarShell } from "./AppSidebarShell";
import { SidebarTopNav } from "./SidebarTopNav";
import { SidebarFavorites } from "./SidebarFavorites";
import { SidebarContextSection } from "./SidebarContextSection";
import { AccountCard } from "./AccountCard";

export function AppSidebarBody({
  profile,
  settings,
  favorites,
  onNavigate,
}: {
  profile: UserProfile;
  settings: AppSettings;
  favorites: FavoriteShow[];
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="px-5 pt-5 pb-1">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2 text-body-sm font-semibold tracking-wide text-[var(--color-near-black)]"
        >
          <span
            aria-hidden
            style={{ display: "inline-block", width: 7, height: 7, background: "var(--color-gold)", flexShrink: 0 }}
          />
          ISP Sales
        </Link>
        <p className="mt-1 section-eyebrow pl-[15px]">Intelligence</p>
      </div>

      <SidebarTopNav onNavigate={onNavigate} />
      <SidebarFavorites favorites={favorites} onNavigate={onNavigate} />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <SidebarContextSection onNavigate={onNavigate} />
      </div>

      <AccountCard profile={profile} settings={settings} />
    </>
  );
}

export function AppSidebar({
  profile,
  settings,
  favorites,
}: {
  profile: UserProfile;
  settings: AppSettings;
  favorites: FavoriteShow[];
}) {
  return (
    <AppSidebarShell>
      <AppSidebarBody profile={profile} settings={settings} favorites={favorites} />
    </AppSidebarShell>
  );
}
