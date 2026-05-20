"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { NavLink } from "@/components/NavLink";

type ShowView = "aussteller" | "prozess" | "log" | "kosten" | "progress" | "einstellungen";

const SHOW_VIEWS: { id: ShowView; label: string }[] = [
  { id: "aussteller", label: "Aussteller" },
  { id: "prozess", label: "Prozess" },
  { id: "log", label: "Log" },
  { id: "kosten", label: "Kosten" },
  { id: "progress", label: "Progress" },
  { id: "einstellungen", label: "Einstellungen" },
];

type DiscoveryRunView = "prozess" | "log" | "kosten";

const DISCOVERY_RUN_VIEWS: { id: DiscoveryRunView; label: string }[] = [
  { id: "prozess", label: "Prozess" },
  { id: "log", label: "Log" },
  { id: "kosten", label: "Kosten" },
];

type ShowSearchRunView = "ergebnisse" | "prozess" | "log" | "kosten";

const SHOW_SEARCH_RUN_VIEWS: { id: ShowSearchRunView; label: string }[] = [
  { id: "ergebnisse", label: "Ergebnisse" },
  { id: "prozess", label: "Prozess" },
  { id: "log", label: "Log" },
  { id: "kosten", label: "Kosten" },
];

type CompanySearchRunView = "ergebnisse" | "log" | "kosten";

const COMPANY_SEARCH_RUN_VIEWS: { id: CompanySearchRunView; label: string }[] = [
  { id: "ergebnisse", label: "Ergebnisse" },
  { id: "log", label: "Log" },
  { id: "kosten", label: "Kosten" },
];

type CompetitorDetailView = "intel" | "verlauf" | "kunden" | "einstellungen";

const COMPETITOR_DETAIL_VIEWS: { id: CompetitorDetailView; label: string }[] = [
  { id: "intel", label: "Intel" },
  { id: "verlauf", label: "Verlauf" },
  { id: "kunden", label: "Kunden" },
  { id: "einstellungen", label: "Einstellungen" },
];

// Static route segments under /shows/ that are not show UUIDs
const SHOWS_STATIC_ROUTES = new Set(["search"]);

function parseShowId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/shows\/([^/]+)/);
  const id = m ? m[1] : null;
  if (!id || SHOWS_STATIC_ROUTES.has(id)) return null;
  return id;
}

function parseShowSearchRunId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/shows\/search\/runs\/([^/]+)/);
  return m ? m[1] : null;
}

function parseCompanySearchRunId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/companies\/search\/runs\/([^/]+)/);
  return m ? m[1] : null;
}

function parseCompanyId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/companies\/([^/]+)/);
  const id = m ? m[1] : null;
  if (!id || id === "search") return null;
  return id;
}

function parseDiscoveryRunId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/competitors\/runs\/([^/]+)/);
  return m ? m[1] : null;
}

// Static route segments under /competitors/ that are not competitor UUIDs
const COMPETITORS_STATIC_ROUTES = new Set(["runs"]);

function parseCompetitorId(pathname: string | null): string | null {
  if (!pathname) return null;
  const m = pathname.match(/^\/competitors\/([^/]+)/);
  const id = m ? m[1] : null;
  if (!id || COMPETITORS_STATIC_ROUTES.has(id)) return null;
  return id;
}

export function SidebarContextSection({
  onNavigate,
}: {
  onNavigate?: () => void;
} = {}) {
  const pathname = usePathname();
  const companySearchRunId = parseCompanySearchRunId(pathname);
  const showSearchRunId = parseShowSearchRunId(pathname);
  const showId = parseShowId(pathname);
  const companyId = parseCompanyId(pathname);
  const runId = parseDiscoveryRunId(pathname);
  const competitorId = parseCompetitorId(pathname);

  // Order matters: more specific routes first.
  if (companySearchRunId) return <CompanySearchRunContextNav runId={companySearchRunId} onNavigate={onNavigate} />;
  if (showSearchRunId) return <ShowSearchRunContextNav runId={showSearchRunId} onNavigate={onNavigate} />;
  if (showId) return <ShowContextNav showId={showId} pathname={pathname ?? ""} onNavigate={onNavigate} />;
  if (companyId) return <CompanyContextNav onNavigate={onNavigate} />;
  if (runId) return <DiscoveryRunContextNav runId={runId} onNavigate={onNavigate} />;
  if (competitorId) return <CompetitorDetailContextNav competitorId={competitorId} onNavigate={onNavigate} />;
  return null;
}

function ShowSearchRunContextNav({
  runId,
  onNavigate,
}: {
  runId: string;
  onNavigate?: () => void;
}) {
  const searchParams = useSearchParams();
  const activeView =
    (searchParams.get("view") as ShowSearchRunView | null) ?? "ergebnisse";

  return (
    <div className="px-3 py-3 border-t border-[var(--border-color-soft)]">
      <NavLink
        href="/shows/search"
        onClick={onNavigate}
        className="block px-3 py-1.5 text-meta hover:text-[var(--color-near-black)] transition-colors"
      >
        &larr; zur Lauf-Liste
      </NavLink>

      <ul className="mt-2 space-y-0">
        {SHOW_SEARCH_RUN_VIEWS.map((v) => {
          const active = activeView === v.id;
          const href =
            v.id === "ergebnisse"
              ? `/shows/search/runs/${runId}`
              : `/shows/search/runs/${runId}?view=${v.id}`;
          return (
            <li key={v.id}>
              <NavLink
                href={href}
                onClick={onNavigate}
                className={`block px-3 py-1.5 text-body-sm transition-colors border-l-2 ${
                  active
                    ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
                    : "border-transparent text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)]"
                }`}
              >
                {v.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShowContextNav({
  showId,
  pathname,
  onNavigate,
}: {
  showId: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const searchParams = useSearchParams();
  const onExhibitorDetail = /^\/shows\/[^/]+\/exhibitors\/[^/]+/.test(pathname);
  const activeView = (searchParams.get("view") as ShowView | null) ?? "aussteller";

  return (
    <div className="px-3 py-3 border-t border-[var(--border-color-soft)]">
      <NavLink
        href="/shows"
        onClick={onNavigate}
        className="block px-3 py-1.5 text-meta hover:text-[var(--color-near-black)] transition-colors"
      >
        &larr; zur Messen-Liste
      </NavLink>

      {onExhibitorDetail && (
        <NavLink
          href={`/shows/${showId}`}
          onClick={onNavigate}
          className="block px-3 py-1.5 text-meta hover:text-[var(--color-near-black)] transition-colors"
        >
          &larr; zur Aussteller-Liste
        </NavLink>
      )}

      {!onExhibitorDetail && (
        <ul className="mt-2 space-y-0">
          {SHOW_VIEWS.map((v) => {
            const active = activeView === v.id;
            const href =
              v.id === "aussteller"
                ? `/shows/${showId}`
                : `/shows/${showId}?view=${v.id}`;
            return (
              <li key={v.id}>
                <NavLink
                  href={href}
                  onClick={onNavigate}
                  className={`block px-3 py-1.5 text-body-sm transition-colors border-l-2 ${
                    active
                      ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
                      : "border-transparent text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)]"
                  }`}
                >
                  {v.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CompanyContextNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="px-3 py-3 border-t border-[var(--border-color-soft)]">
      <NavLink
        href="/companies"
        onClick={onNavigate}
        className="block px-3 py-1.5 text-meta hover:text-[var(--color-near-black)] transition-colors"
      >
        &larr; zur Unternehmens-Liste
      </NavLink>
    </div>
  );
}

function CompetitorDetailContextNav({
  competitorId,
  onNavigate,
}: {
  competitorId: string;
  onNavigate?: () => void;
}) {
  const searchParams = useSearchParams();
  const activeView =
    (searchParams.get("view") as CompetitorDetailView | null) ?? "intel";

  return (
    <div className="px-3 py-3 border-t border-[var(--border-color-soft)]">
      <NavLink
        href="/competitors"
        onClick={onNavigate}
        className="block px-3 py-1.5 text-meta hover:text-[var(--color-near-black)] transition-colors"
      >
        &larr; zur Konkurrenten-Liste
      </NavLink>

      <ul className="mt-2 space-y-0">
        {COMPETITOR_DETAIL_VIEWS.map((v) => {
          const active = activeView === v.id;
          const href =
            v.id === "intel"
              ? `/competitors/${competitorId}`
              : `/competitors/${competitorId}?view=${v.id}`;
          return (
            <li key={v.id}>
              <NavLink
                href={href}
                onClick={onNavigate}
                className={`block px-3 py-1.5 text-body-sm transition-colors border-l-2 ${
                  active
                    ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
                    : "border-transparent text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)]"
                }`}
              >
                {v.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DiscoveryRunContextNav({
  runId,
  onNavigate,
}: {
  runId: string;
  onNavigate?: () => void;
}) {
  const searchParams = useSearchParams();
  const activeView =
    (searchParams.get("view") as DiscoveryRunView | null) ?? "prozess";

  return (
    <div className="px-3 py-3 border-t border-[var(--border-color-soft)]">
      <NavLink
        href="/competitors"
        onClick={onNavigate}
        className="block px-3 py-1.5 text-meta hover:text-[var(--color-near-black)] transition-colors"
      >
        &larr; zur Konkurrenten-Liste
      </NavLink>

      <ul className="mt-2 space-y-0">
        {DISCOVERY_RUN_VIEWS.map((v) => {
          const active = activeView === v.id;
          const href =
            v.id === "prozess"
              ? `/competitors/runs/${runId}`
              : `/competitors/runs/${runId}?view=${v.id}`;
          return (
            <li key={v.id}>
              <NavLink
                href={href}
                onClick={onNavigate}
                className={`block px-3 py-1.5 text-body-sm transition-colors border-l-2 ${
                  active
                    ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
                    : "border-transparent text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)]"
                }`}
              >
                {v.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CompanySearchRunContextNav({
  runId,
  onNavigate,
}: {
  runId: string;
  onNavigate?: () => void;
}) {
  const searchParams = useSearchParams();
  const activeView =
    (searchParams.get("view") as CompanySearchRunView | null) ?? "ergebnisse";

  return (
    <div className="px-3 py-3 border-t border-[var(--border-color-soft)]">
      <NavLink
        href="/companies/search"
        onClick={onNavigate}
        className="block px-3 py-1.5 text-meta hover:text-[var(--color-near-black)] transition-colors"
      >
        &larr; zur Lauf-Liste
      </NavLink>

      <ul className="mt-2 space-y-0">
        {COMPANY_SEARCH_RUN_VIEWS.map((v) => {
          const active = activeView === v.id;
          const href =
            v.id === "ergebnisse"
              ? `/companies/search/runs/${runId}`
              : `/companies/search/runs/${runId}?view=${v.id}`;
          return (
            <li key={v.id}>
              <NavLink
                href={href}
                onClick={onNavigate}
                className={`block px-3 py-1.5 text-body-sm transition-colors border-l-2 ${
                  active
                    ? "border-[var(--color-near-black)] text-[var(--color-near-black)] font-semibold"
                    : "border-transparent text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)]"
                }`}
              >
                {v.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
