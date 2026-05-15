import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { priceFor, priceForBrowserSec } from "@/lib/pricing";
import {
  getSettings,
  SHORT_MODEL_DEFAULT,
  DEEP_MODEL_DEFAULT,
} from "@/lib/settings";
import { GoldDot } from "@/components/brand/GoldDot";
import { FavoriteToggle } from "@/components/FavoriteToggle";
import {
  ArrowRight,
  BuildingIcon,
  BriefcaseIcon,
  PlusIcon,
  FlameIcon,
  ActivityIcon,
} from "@/components/brand/Icons";

export const dynamic = "force-dynamic";

type TokenAgg = { tin: number; tout: number; cnt: number };
type GlobalTokenStats = {
  short: TokenAgg;
  deep: TokenAgg;
  chat: TokenAgg;
  browser_seconds: number;
};
const ZERO_AGG: TokenAgg = { tin: 0, tout: 0, cnt: 0 };

type ShowRow = {
  id: string;
  name: string;
  year: number | null;
  status: string;
  created_at: string;
  is_favorite: boolean;
  exhibitor_count: number;
};

function formatUsd(usd: number): string {
  if (usd === 0) return "0.00 $";
  if (usd < 0.01) return "<0.01 $";
  return `${usd.toFixed(2)} $`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [
    { data: tokenStatsData },
    { data: companyOverview },
    { count: showCount },
    { count: activeShowCount },
    { data: shows },
    settings,
  ] = await Promise.all([
    supabase.rpc("get_global_token_stats", { p_user_id: user.id }),
    supabase.from("companies_overview").select("best_priority"),
    supabase.from("trade_shows").select("id", { count: "exact", head: true }),
    supabase
      .from("trade_shows")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "crawling"]),
    supabase
      .from("trade_shows")
      .select(
        "id, name, year, status, created_at, is_favorite, exhibitors(count)",
      )
      .order("is_favorite", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(8),
    getSettings(supabase, user.id),
  ]);

  const tokenSums =
    (tokenStatsData as GlobalTokenStats | null) ?? {
      short: ZERO_AGG,
      deep: ZERO_AGG,
      chat: ZERO_AGG,
      browser_seconds: 0,
    };

  const shortModel = settings?.short_model ?? SHORT_MODEL_DEFAULT;
  const deepModel = settings?.deep_model ?? DEEP_MODEL_DEFAULT;
  const totalCost =
    priceFor(shortModel, tokenSums.short.tin, tokenSums.short.tout) +
    priceFor(deepModel, tokenSums.deep.tin, tokenSums.deep.tout) +
    priceFor(deepModel, tokenSums.chat.tin, tokenSums.chat.tout) +
    priceForBrowserSec(tokenSums.browser_seconds ?? 0);

  const overview = (companyOverview ?? []) as Array<{
    best_priority: string | null;
  }>;
  const hotCount = overview.filter((r) => r.best_priority === "hoch").length;
  const companyCount = overview.length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const showRows: ShowRow[] = ((shows ?? []) as any[]).map((s) => ({
    id: s.id,
    name: s.name,
    year: s.year,
    status: s.status,
    created_at: s.created_at,
    is_favorite: Boolean(s.is_favorite),
    exhibitor_count: s.exhibitors?.[0]?.count ?? 0,
  }));

  return (
    <>
      <header className="mb-12">
        <p className="section-eyebrow mb-2">UBERSICHT</p>
        <h1 className="text-display">
          Dashboard<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          Ueberblick ueber alle erfassten Messen, Unternehmen und laufende Aktivitaet.
        </p>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="messen" value={String(showCount ?? 0)} Icon={BriefcaseIcon} />
        <StatCard label="unternehmen" value={String(companyCount)} Icon={BuildingIcon} />
        <StatCard label="prio hoch" value={String(hotCount)} Icon={FlameIcon} />
        <StatCard
          label="laufende crawls"
          value={String(activeShowCount ?? 0)}
          Icon={ActivityIcon}
          activity={(activeShowCount ?? 0) > 0}
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-12">
        <QuickLink
          href="/companies"
          Icon={BuildingIcon}
          title="Alle Unternehmen"
          desc={`${companyCount} Firmen aggregiert ueber alle Messen`}
        />
        <QuickLink
          href="/shows"
          Icon={BriefcaseIcon}
          title="Alle Messen"
          desc={`${showCount ?? 0} Messen erfasst`}
        />
        <QuickLink
          href="/shows"
          Icon={PlusIcon}
          title="Neue Messe"
          desc="Aussteller-Listing starten"
        />
      </section>

      <section className="mb-12">
        <p className="section-eyebrow mb-2">ZULETZT AKTIV</p>
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-meta-strong">letzte messen</h2>
          <Link
            href="/shows"
            className="text-meta inline-flex items-center gap-1.5 hover:text-[var(--color-near-black)] transition-colors"
          >
            alle ansehen <ArrowRight size={12} />
          </Link>
        </div>
        {showRows.length === 0 ? (
          <div className="py-10 text-body text-[var(--color-near-black)]/50 box-line px-5">
            noch keine messen erfasst
          </div>
        ) : (
          <ul className="space-y-2">
            {showRows.map((s) => (
              <li key={s.id} className="relative">
                <Link
                  href={`/shows/${s.id}`}
                  className="flex flex-col lg:flex-row lg:items-baseline lg:justify-between gap-2 lg:gap-6 px-5 py-4 pr-14 box-line rounded-lg hover:bg-[var(--color-near-black)]/[0.02] transition-colors"
                >
                  <div className="flex items-baseline gap-4 min-w-0">
                    <BriefcaseIcon
                      size={14}
                      className="shrink-0 self-center text-[var(--color-near-black)]/45"
                    />
                    <span className="text-title truncate">{s.name}</span>
                    {s.year && (
                      <span className="text-body text-[var(--color-near-black)]/50">
                        {s.year}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 lg:gap-6 shrink-0">
                    <span className="text-meta-strong">
                      {s.exhibitor_count} aussteller
                    </span>
                    <StatusBadge status={s.status} />
                  </div>
                </Link>
                <div className="absolute top-1/2 right-3 -translate-y-1/2">
                  <FavoriteToggle
                    showId={s.id}
                    initialFavorite={s.is_favorite}
                    size={16}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="token in"
          value={formatNum(tokenSums.short.tin + tokenSums.deep.tin + tokenSums.chat.tin)}
        />
        <StatCard
          label="token out"
          value={formatNum(tokenSums.short.tout + tokenSums.deep.tout + tokenSums.chat.tout)}
        />
        <StatCard label="kosten gesamt" value={formatUsd(totalCost)} />
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  Icon,
  activity = false,
}: {
  label: string;
  value: string;
  Icon?: React.ComponentType<{ size?: number; className?: string }>;
  activity?: boolean;
}) {
  return (
    <div className="card-surface px-6 py-8 flex flex-col gap-2">
      <span className="text-meta inline-flex items-center gap-2">
        {Icon && <Icon size={12} className="text-[var(--color-near-black)]/45" />}
        {label}
      </span>
      <span className="text-display tabular-nums inline-flex items-baseline gap-2">
        {value}
        {activity && (
          <span
            className="inline-block rounded-full"
            style={{ width: 8, height: 8, background: "var(--color-gold)" }}
          />
        )}
      </span>
    </div>
  );
}

function QuickLink({
  href,
  Icon,
  title,
  desc,
}: {
  href: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <Link href={href} className="card-surface group flex flex-col px-5 py-5 transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <Icon size={16} className="text-[var(--color-near-black)]/50 mt-0.5 shrink-0 group-hover:text-[var(--color-near-black)] transition-colors" />
        <ArrowRight size={13} className="text-[var(--color-near-black)]/30 group-hover:text-[var(--color-near-black)]/70 transition-colors" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body-sm font-semibold">{title}</div>
        <div className="text-meta text-[var(--color-near-black)]/55 mt-0.5">{desc}</div>
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    queued: "wartet",
    crawling: "laeuft",
    paused: "pausiert",
    ready: "fertig",
    partial: "teilweise",
    failed: "fehler",
  };
  const colorClass =
    status === "crawling"
      ? "text-[var(--color-gold)]"
      : status === "ready" || status === "partial"
        ? "text-[var(--color-success)]"
        : status === "failed"
          ? "text-[var(--color-error)]"
          : "text-[var(--color-near-black)]/50";
  return (
    <span className={`inline-flex items-center gap-2 text-meta-strong ${colorClass}`}>
      {status === "crawling" && <GoldDot size={6} />}
      {labels[status] ?? status}
    </span>
  );
}
