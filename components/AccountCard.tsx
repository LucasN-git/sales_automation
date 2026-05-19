"use client";

import { useState } from "react";
import type { AppSettings } from "@/lib/settings";
import type { UserProfile } from "@/lib/profile";
import { AccountDrawer } from "./AccountDrawer";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AccountCard({
  profile,
  settings,
}: {
  profile: UserProfile;
  settings: AppSettings;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left flex items-center gap-3 px-3 py-3 border-t border-[var(--border-color-soft)] hover:bg-[var(--color-near-black)]/[0.03] transition-colors"
      >
        <span
          className="inline-flex items-center justify-center w-8 h-8 text-meta-strong tabular-nums shrink-0"
          style={{
            borderRadius: "6px",
            background: "rgba(10,10,10,0.07)",
            border: "1px solid rgba(10,10,10,0.12)",
            color: "var(--color-near-black)",
          }}
        >
          {initials(profile.display_name)}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-body-sm font-semibold truncate">
            {profile.display_name}
          </span>
          <span className="block text-meta truncate text-[var(--color-near-black)]/60">
            {profile.email}
          </span>
        </span>
      </button>
      <AccountDrawer
        open={open}
        onClose={() => setOpen(false)}
        profile={profile}
        settings={settings}
      />
    </>
  );
}
