"use client";

import type { SourceRef } from "@/lib/companies";

const TYPE_ICONS: Record<SourceRef["type"], string> = {
  algolia: "⬡",
  messe_profil: "🏷",
  messe_profil_scrape: "🏷",
  website: "🌐",
  web_search: "🔍",
};

const TYPE_LABELS: Record<SourceRef["type"], string> = {
  algolia: "Aussteller-Daten",
  messe_profil: "Messe-Profil",
  messe_profil_scrape: "Messe-Profil",
  website: "Website",
  web_search: "Web-Suche",
};

type Props = {
  source: SourceRef;
  className?: string;
};

export function SourceBadge({ source, className = "" }: Props) {
  const icon = TYPE_ICONS[source.type] ?? "·";
  const label = source.label ?? TYPE_LABELS[source.type] ?? source.type;

  const inner = (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium border border-[var(--border-color-soft)] text-[var(--color-near-black)]/50 leading-none ${className}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </span>
  );

  if (source.url) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-[var(--color-near-black)] hover:border-[var(--color-near-black)]/30 transition-colors"
      >
        {inner}
      </a>
    );
  }

  return inner;
}

/**
 * Parst Quellen-Tags aus reasoning_bullets-Text.
 * Format: "- Bullet-Text [Quelle]" oder "- Bullet-Text [domain.com]"
 */
export function parseSourceTag(bulletText: string): { text: string; tag: string | null } {
  const match = bulletText.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (!match) return { text: bulletText, tag: null };
  return { text: match[1].trim(), tag: match[2] };
}
