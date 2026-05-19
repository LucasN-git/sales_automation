"use client";

import { usePathname } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import { HelpIcon } from "@/components/brand/Icons";

export function SidebarGuideLink({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  return (
    <div className="px-3 pb-1 border-t border-[var(--border-color-soft)] pt-3">
      <NavLink
        href="/guide"
        onClick={onNavigate}
        className={`flex items-center gap-2.5 px-3 py-2.5 text-body-sm transition-colors border-l-2 ${
          pathname === "/guide"
            ? "bg-[var(--color-near-black)]/[0.06] border-[var(--color-gold)] text-[var(--color-near-black)] font-semibold"
            : "border-transparent text-[var(--color-near-black)]/45 hover:bg-[var(--color-near-black)]/[0.04] hover:text-[var(--color-near-black)]"
        }`}
      >
        <HelpIcon size={16} className="shrink-0" />
        <span>Kurzanleitung</span>
      </NavLink>
    </div>
  );
}
