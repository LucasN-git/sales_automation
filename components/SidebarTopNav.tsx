"use client";

import { usePathname } from "next/navigation";
import { NavLink } from "@/components/NavLink";
import {
  DashboardIcon,
  BuildingIcon,
  BriefcaseIcon,
  CompetitorsIcon,
  CostIcon,
  HelpIcon,
  SearchIcon,
} from "@/components/brand/Icons";

type Item = {
  href: string;
  label: string;
  matchPrefix?: string;
  excludePrefixes?: string[];
  indent?: boolean;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

const ITEMS: Item[] = [
  { href: "/", label: "Dashboard", Icon: DashboardIcon },
  { href: "/companies", label: "Unternehmen", matchPrefix: "/companies", Icon: BuildingIcon },
  { href: "/shows", label: "Messen", matchPrefix: "/shows", excludePrefixes: ["/shows/search"], Icon: BriefcaseIcon },
  { href: "/shows/search", label: "Messen suchen", matchPrefix: "/shows/search", indent: true, Icon: SearchIcon },
  { href: "/competitors", label: "Konkurrenten", matchPrefix: "/competitors", Icon: CompetitorsIcon },
  { href: "/costs", label: "Kosten", matchPrefix: "/costs", Icon: CostIcon },
];

function isActive(pathname: string | null, item: Item): boolean {
  if (!pathname) return false;
  if (item.excludePrefixes?.some((p) => pathname === p || pathname.startsWith(p + "/"))) return false;
  if (item.matchPrefix) return pathname === item.matchPrefix || pathname.startsWith(item.matchPrefix + "/");
  return pathname === item.href;
}

export function SidebarTopNav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const pathname = usePathname();
  return (
    <nav className="px-3 pt-12 pb-3">
      <ul className="space-y-0">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.Icon;
          return (
            <li key={item.href}>
              <NavLink
                href={item.href}
                onClick={onNavigate}
                className={`flex items-center gap-2.5 py-2.5 text-body-sm transition-colors border-l-2 ${
                  item.indent ? "pl-8 pr-3" : "px-3"
                } ${
                  active
                    ? "bg-[var(--color-near-black)]/[0.06] border-[var(--color-gold)] text-[var(--color-near-black)] font-semibold"
                    : "border-transparent text-[var(--color-near-black)]/60 hover:bg-[var(--color-near-black)]/[0.04] hover:text-[var(--color-near-black)]"
                }`}
              >
                <Icon size={16} className="shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
      <div className="pt-3 mt-3 border-t border-[var(--border-color-soft)]">
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
    </nav>
  );
}
