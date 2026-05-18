import { createClient } from "@/lib/supabase/server";
import { priceFor, priceForBrowserSec, priceForWebSearch, priceForFirecrawlCredits } from "@/lib/pricing";
import { getSettings, SHORT_MODEL_DEFAULT, DEEP_MODEL_DEFAULT } from "@/lib/settings";
import { COMPETITOR_DISCOVERY_MODEL_DEFAULT } from "@/lib/claude";

export const dynamic = "force-dynamic";

// ── Types ────────────────────────────────────────────────────────────────────

type TokenAgg = { tin: number; tout: number; cnt: number };
type FcAgg = { credits: number; cnt: number };

type CostStats = {
  exhibitor_short: TokenAgg;
  exhibitor_deep: TokenAgg;
  chat: TokenAgg & { web_search_uses?: number };
  competitor_discovery: TokenAgg & { web_search_uses: number; web_search_cost_usd: number };
  competitor_versions: TokenAgg;
  show_discovery: TokenAgg & { web_search_uses: number };
  browser_seconds: number;
  fc_short: FcAgg;
  fc_deep: FcAgg;
  fc_profile_enrich: FcAgg;
  fc_competitor_short: FcAgg;
  fc_show_discovery: FcAgg;
  shows: ShowCost[];
  competitor_runs: CompetitorRun[];
  show_discovery_list: ShowDiscoveryRun[];
};

type ShowCost = {
  id: string;
  name: string;
  year: number | null;
  browser_seconds: number;
  short_in: number; short_out: number; short_cnt: number;
  deep_in: number; deep_out: number; deep_cnt: number;
  chat_in: number; chat_out: number; chat_cnt: number;
  fc_short_credits: number;
  fc_deep_credits: number;
  fc_profile_credits: number;
};

type CompetitorRun = {
  id: string;
  status: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  web_search_uses: number;
  web_search_cost_usd: number;
  started_at: string | null;
  finished_at: string | null;
};

type ShowDiscoveryRun = {
  id: string;
  user_prompt: string;
  status: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  web_search_uses: number;
  firecrawl_calls: number;
  started_at: string | null;
  finished_at: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(usd: number): string {
  if (usd === 0) return "0.00 $";
  if (usd < 0.001) return "<0.01 $";
  if (usd < 0.01) return `${usd.toFixed(3)} $`;
  return `${usd.toFixed(2)} $`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function modelShortLabel(model: string | null | undefined): string {
  if (!model) return "—";
  if (model.includes("haiku")) return "Haiku";
  if (model.includes("sonnet")) return "Sonnet";
  if (model.includes("opus")) return "Opus";
  return model;
}

const ZERO_AGG: TokenAgg = { tin: 0, tout: 0, cnt: 0 };
const ZERO_FC: FcAgg = { credits: 0, cnt: 0 };

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function CostsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: rawStats }, settings] = await Promise.all([
    supabase.rpc("get_full_cost_stats", { p_user_id: user.id }),
    getSettings(supabase, user.id),
  ]);

  const stats = (rawStats as CostStats | null) ?? {
    exhibitor_short: ZERO_AGG,
    exhibitor_deep: ZERO_AGG,
    chat: { ...ZERO_AGG, web_search_uses: 0 },
    competitor_discovery: { ...ZERO_AGG, web_search_uses: 0, web_search_cost_usd: 0 },
    competitor_versions: ZERO_AGG,
    show_discovery: { ...ZERO_AGG, web_search_uses: 0 },
    browser_seconds: 0,
    fc_short: ZERO_FC,
    fc_deep: ZERO_FC,
    fc_profile_enrich: ZERO_FC,
    fc_competitor_short: ZERO_FC,
    fc_show_discovery: ZERO_FC,
    shows: [],
    competitor_runs: [],
    show_discovery_list: [],
  };

  const shortModel = settings?.short_model ?? SHORT_MODEL_DEFAULT;
  const deepModel = settings?.deep_model ?? DEEP_MODEL_DEFAULT;
  const compShortModel = settings?.competitor_short_model ?? SHORT_MODEL_DEFAULT;
  const compDiscModel = settings?.competitor_discovery_model ?? COMPETITOR_DISCOVERY_MODEL_DEFAULT;

  // Claude category costs
  const costShort = priceFor(shortModel, stats.exhibitor_short.tin, stats.exhibitor_short.tout);
  const costDeep = priceFor(deepModel, stats.exhibitor_deep.tin, stats.exhibitor_deep.tout);
  const costChat = priceFor(deepModel, stats.chat.tin, stats.chat.tout);
  const costCompVersions = priceFor(compShortModel, stats.competitor_versions.tin, stats.competitor_versions.tout);
  const costCompDiscovery =
    priceFor(compDiscModel, stats.competitor_discovery.tin, stats.competitor_discovery.tout) +
    stats.competitor_discovery.web_search_cost_usd;
  const costShowDiscovery = stats.show_discovery_list.reduce((acc, r) => {
    return acc + priceFor(r.model ?? "", r.tokens_in, r.tokens_out) + priceForWebSearch(r.web_search_uses);
  }, 0);
  const costBrowser = priceForBrowserSec(stats.browser_seconds);
  const totalClaudeCost = costShort + costDeep + costChat + costCompVersions + costCompDiscovery + costShowDiscovery + costBrowser;

  // Firecrawl category costs
  const fcCostShort = priceForFirecrawlCredits(stats.fc_short.credits);
  const fcCostDeep = priceForFirecrawlCredits(stats.fc_deep.credits);
  const fcCostProfileEnrich = priceForFirecrawlCredits(stats.fc_profile_enrich.credits);
  const fcCostCompShort = priceForFirecrawlCredits(stats.fc_competitor_short.credits);
  const fcCostShowDisc = priceForFirecrawlCredits(stats.fc_show_discovery.credits);
  const totalFcCredits =
    stats.fc_short.credits +
    stats.fc_deep.credits +
    stats.fc_profile_enrich.credits +
    stats.fc_competitor_short.credits +
    stats.fc_show_discovery.credits;
  const totalFcCost = fcCostShort + fcCostDeep + fcCostProfileEnrich + fcCostCompShort + fcCostShowDisc;

  const totalCost = totalClaudeCost + totalFcCost;

  const totalIn =
    stats.exhibitor_short.tin +
    stats.exhibitor_deep.tin +
    stats.chat.tin +
    stats.competitor_versions.tin +
    stats.competitor_discovery.tin +
    stats.show_discovery.tin;

  const totalOut =
    stats.exhibitor_short.tout +
    stats.exhibitor_deep.tout +
    stats.chat.tout +
    stats.competitor_versions.tout +
    stats.competitor_discovery.tout +
    stats.show_discovery.tout;

  // Per-show costs
  const showsWithCost = stats.shows.map((s) => {
    const claudeCost =
      priceFor(shortModel, s.short_in, s.short_out) +
      priceFor(deepModel, s.deep_in, s.deep_out) +
      priceFor(deepModel, s.chat_in, s.chat_out) +
      priceForBrowserSec(s.browser_seconds);
    const fcCredits = s.fc_short_credits + s.fc_deep_credits + s.fc_profile_credits;
    const fcCost = priceForFirecrawlCredits(fcCredits);
    return { ...s, claudeCost, fcCredits, fcCost, totalCost: claudeCost + fcCost };
  }).sort((a, b) => b.totalCost - a.totalCost);

  // Category rows: Claude + Firecrawl side-by-side
  const categories: {
    label: string;
    claudeCost: number;
    claudeTokensIn: number;
    claudeTokensOut: number;
    claudeCnt?: number;
    claudeExtra?: string;
    fcCredits: number;
    fcCost: number;
    fcCnt?: number;
    fcExtra?: string;
  }[] = [
    {
      label: "Aussteller Short",
      claudeCost: costShort,
      claudeTokensIn: stats.exhibitor_short.tin,
      claudeTokensOut: stats.exhibitor_short.tout,
      claudeCnt: stats.exhibitor_short.cnt,
      claudeExtra: shortModel.includes("haiku") ? "Haiku" : shortModel.includes("sonnet") ? "Sonnet" : "Opus",
      fcCredits: stats.fc_short.credits,
      fcCost: fcCostShort,
      fcCnt: stats.fc_short.cnt,
      fcExtra: "1 Cr./Scrape",
    },
    {
      label: "Aussteller Deep",
      claudeCost: costDeep,
      claudeTokensIn: stats.exhibitor_deep.tin,
      claudeTokensOut: stats.exhibitor_deep.tout,
      claudeCnt: stats.exhibitor_deep.cnt,
      claudeExtra: deepModel.includes("haiku") ? "Haiku" : deepModel.includes("sonnet") ? "Sonnet" : "Opus",
      fcCredits: stats.fc_deep.credits,
      fcCost: fcCostDeep,
      fcCnt: stats.fc_deep.cnt,
      fcExtra: "1 Cr./Scrape",
    },
    {
      label: "Profile-Enrich",
      claudeCost: 0,
      claudeTokensIn: 0,
      claudeTokensOut: 0,
      fcCredits: stats.fc_profile_enrich.credits,
      fcCost: fcCostProfileEnrich,
      fcCnt: stats.fc_profile_enrich.cnt,
      fcExtra: "5 Cr./Scrape",
    },
    {
      label: "Chat",
      claudeCost: costChat,
      claudeTokensIn: stats.chat.tin,
      claudeTokensOut: stats.chat.tout,
      claudeCnt: stats.chat.cnt,
      fcCredits: 0,
      fcCost: 0,
    },
    {
      label: "Konkurrenz-Analyse",
      claudeCost: costCompDiscovery,
      claudeTokensIn: stats.competitor_discovery.tin,
      claudeTokensOut: stats.competitor_discovery.tout,
      claudeCnt: stats.competitor_discovery.cnt,
      claudeExtra: `inkl. ${stats.competitor_discovery.web_search_uses} Searches`,
      fcCredits: 0,
      fcCost: 0,
    },
    {
      label: "Konkurrenz-Kurzanalyse",
      claudeCost: costCompVersions,
      claudeTokensIn: stats.competitor_versions.tin,
      claudeTokensOut: stats.competitor_versions.tout,
      claudeCnt: stats.competitor_versions.cnt,
      fcCredits: stats.fc_competitor_short.credits,
      fcCost: fcCostCompShort,
      fcCnt: stats.fc_competitor_short.cnt,
      fcExtra: "1 Cr./Scrape",
    },
    {
      label: "Messen-Suche",
      claudeCost: costShowDiscovery,
      claudeTokensIn: stats.show_discovery.tin,
      claudeTokensOut: stats.show_discovery.tout,
      claudeCnt: stats.show_discovery.cnt,
      claudeExtra: `${stats.show_discovery.web_search_uses} Searches`,
      fcCredits: stats.fc_show_discovery.credits,
      fcCost: fcCostShowDisc,
      fcCnt: stats.fc_show_discovery.cnt,
      fcExtra: "5 Cr./Validierung",
    },
    {
      label: "Browserbase",
      claudeCost: costBrowser,
      claudeTokensIn: 0,
      claudeTokensOut: 0,
      claudeExtra: `${Math.round(stats.browser_seconds / 60)} Min.`,
      fcCredits: 0,
      fcCost: 0,
    },
  ];

  return (
    <>
      <header className="mb-12">
        <p className="section-eyebrow mb-2">API NUTZUNG</p>
        <h1 className="text-display">
          Kosten<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
          Claude API, Firecrawl und Browserbase — aggregiert nach Kategorie und Messe.
        </p>
      </header>

      {/* ── Stat cards ── */}
      <section className="grid grid-cols-4 gap-4 mb-10">
        <StatCard label="gesamt" value={formatUsd(totalCost)} highlight />
        <StatCard label="claude" value={formatUsd(totalClaudeCost)} />
        <StatCard label="firecrawl" value={`${formatNum(totalFcCredits)} Cr.`} sub={formatUsd(totalFcCost)} />
        <StatCard label="token in / out" value={`${formatNum(totalIn)} / ${formatNum(totalOut)}`} />
      </section>

      {/* ── Category breakdown ── */}
      <section className="mb-10">
        <p className="section-eyebrow mb-3">NACH KATEGORIE</p>
        <div className="box-line overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-[var(--border-color-soft)]">
                <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50" rowSpan={2}>Kategorie</th>
                {/* Claude columns */}
                <th className="text-center px-3 py-2 text-meta font-normal text-[var(--color-near-black)]/40 border-l border-[var(--border-color-soft)]" colSpan={4}>
                  Claude
                </th>
                {/* Firecrawl columns */}
                <th className="text-center px-3 py-2 text-meta font-normal text-[var(--color-near-black)]/40 border-l border-[var(--border-color-soft)]" colSpan={3}>
                  Firecrawl
                </th>
              </tr>
              <tr className="border-b border-[var(--border-color-soft)]">
                <th className="text-right px-4 py-2 text-meta font-normal text-[var(--color-near-black)]/40 border-l border-[var(--border-color-soft)]">Token In</th>
                <th className="text-right px-4 py-2 text-meta font-normal text-[var(--color-near-black)]/40">Token Out</th>
                <th className="text-right px-4 py-2 text-meta font-normal text-[var(--color-near-black)]/40">Aufrufe</th>
                <th className="text-right px-4 py-2 text-meta font-normal text-[var(--color-near-black)]/40">Kosten</th>
                <th className="text-right px-4 py-2 text-meta font-normal text-[var(--color-near-black)]/40 border-l border-[var(--border-color-soft)]">Credits</th>
                <th className="text-right px-4 py-2 text-meta font-normal text-[var(--color-near-black)]/40">Aufrufe</th>
                <th className="text-right px-4 py-2 text-meta font-normal text-[var(--color-near-black)]/40">Kosten</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat, i) => (
                <tr
                  key={cat.label}
                  className={`border-b border-[var(--border-color-soft)] last:border-0 ${
                    i % 2 === 0 ? "" : "bg-[var(--color-near-black)]/[0.02]"
                  }`}
                >
                  <td className="px-5 py-3">
                    <span className="text-body-sm font-medium">{cat.label}</span>
                    {cat.claudeExtra && (
                      <span className="ml-2 text-meta text-[var(--color-near-black)]/40">{cat.claudeExtra}</span>
                    )}
                  </td>
                  {/* Claude */}
                  <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60 border-l border-[var(--border-color-soft)]">
                    {cat.claudeTokensIn > 0 ? formatNum(cat.claudeTokensIn) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                    {cat.claudeTokensOut > 0 ? formatNum(cat.claudeTokensOut) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                    {cat.claudeCnt != null ? cat.claudeCnt : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-meta-strong tabular-nums">
                    {cat.claudeCost > 0 ? formatUsd(cat.claudeCost) : "—"}
                  </td>
                  {/* Firecrawl */}
                  <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60 border-l border-[var(--border-color-soft)]">
                    {cat.fcCredits > 0 ? (
                      <span>
                        {formatNum(cat.fcCredits)}
                        {cat.fcExtra && (
                          <span className="ml-1 text-[var(--color-near-black)]/35">{cat.fcExtra}</span>
                        )}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                    {cat.fcCnt != null && cat.fcCnt > 0 ? cat.fcCnt : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-meta-strong tabular-nums">
                    {cat.fcCost > 0 ? formatUsd(cat.fcCost) : "—"}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-[var(--color-near-black)]/[0.03] border-t border-[var(--border-color)]">
                <td className="px-5 py-3 text-body-sm font-semibold">Gesamt</td>
                <td className="px-4 py-3 text-right text-meta tabular-nums font-semibold border-l border-[var(--border-color-soft)]">
                  {formatNum(totalIn)}
                </td>
                <td className="px-4 py-3 text-right text-meta tabular-nums font-semibold">
                  {formatNum(totalOut)}
                </td>
                <td />
                <td className="px-4 py-3 text-right text-meta-strong tabular-nums font-semibold">
                  {formatUsd(totalClaudeCost)}
                </td>
                <td className="px-4 py-3 text-right text-meta tabular-nums font-semibold border-l border-[var(--border-color-soft)]">
                  {formatNum(totalFcCredits)} Cr.
                </td>
                <td />
                <td className="px-4 py-3 text-right text-meta-strong tabular-nums font-semibold">
                  {formatUsd(totalFcCost)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-meta text-[var(--color-near-black)]/40">
          Firecrawl: Hobby-Plan, $0.0032/Credit. 1 Cr. = Markdown/HTML-Scrape, 5 Cr. = LLM-Extraktion (JSON-Schema).
        </p>
      </section>

      {/* ── Per-show breakdown ── */}
      <section className="mb-10">
        <p className="section-eyebrow mb-3">NACH MESSE</p>
        {showsWithCost.length === 0 ? (
          <div className="py-8 text-body text-[var(--color-near-black)]/50 box-line px-5">
            Noch keine Messen erfasst.
          </div>
        ) : (
          <div className="box-line overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border-color-soft)]">
                  <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Messe</th>
                  <th className="text-right px-4 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Short</th>
                  <th className="text-right px-4 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Deep</th>
                  <th className="text-right px-4 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Chat</th>
                  <th className="text-right px-4 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Browser</th>
                  <th className="text-right px-4 py-3 text-meta font-normal text-[var(--color-near-black)]/50 border-l border-[var(--border-color-soft)]">FC Short</th>
                  <th className="text-right px-4 py-3 text-meta font-normal text-[var(--color-near-black)]/50">FC Deep</th>
                  <th className="text-right px-4 py-3 text-meta font-normal text-[var(--color-near-black)]/50">FC Profile</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50 border-l border-[var(--border-color-soft)]">Gesamt</th>
                </tr>
              </thead>
              <tbody>
                {showsWithCost.map((s, i) => {
                  const sc = priceFor(shortModel, s.short_in, s.short_out);
                  const dc = priceFor(deepModel, s.deep_in, s.deep_out);
                  const cc = priceFor(deepModel, s.chat_in, s.chat_out);
                  const bc = priceForBrowserSec(s.browser_seconds);
                  const fcSc = priceForFirecrawlCredits(s.fc_short_credits);
                  const fcDc = priceForFirecrawlCredits(s.fc_deep_credits);
                  const fcPc = priceForFirecrawlCredits(s.fc_profile_credits);
                  return (
                    <tr
                      key={s.id}
                      className={`border-b border-[var(--border-color-soft)] last:border-0 hover:bg-[var(--color-near-black)]/[0.02] transition-colors ${
                        i % 2 === 0 ? "" : "bg-[var(--color-near-black)]/[0.02]"
                      }`}
                    >
                      <td className="px-5 py-3">
                        <a
                          href={`/shows/${s.id}`}
                          className="text-body-sm font-medium hover:underline underline-offset-2"
                        >
                          {s.name}
                          {s.year && (
                            <span className="ml-1.5 text-meta text-[var(--color-near-black)]/40 font-normal">
                              {s.year}
                            </span>
                          )}
                        </a>
                      </td>
                      {/* Claude */}
                      <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {sc > 0 ? formatUsd(sc) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {dc > 0 ? formatUsd(dc) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {cc > 0 ? formatUsd(cc) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {bc > 0 ? formatUsd(bc) : "—"}
                      </td>
                      {/* Firecrawl */}
                      <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60 border-l border-[var(--border-color-soft)]">
                        {s.fc_short_credits > 0 ? `${s.fc_short_credits} Cr.` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {s.fc_deep_credits > 0 ? `${s.fc_deep_credits} Cr.` : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {s.fc_profile_credits > 0 ? `${s.fc_profile_credits} Cr.` : "—"}
                      </td>
                      {/* Total */}
                      <td className="px-5 py-3 text-right text-meta-strong tabular-nums border-l border-[var(--border-color-soft)]">
                        {formatUsd(s.totalCost)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Competitor discovery runs ── */}
      <section className="mb-10">
        <p className="section-eyebrow mb-3">KONKURRENZANALYSEN</p>
        {stats.competitor_runs.length === 0 ? (
          <div className="py-8 text-body text-[var(--color-near-black)]/50 box-line px-5">
            Noch keine Konkurrenzanalysen durchgefuhrt.
          </div>
        ) : (
          <div className="box-line">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border-color-soft)]">
                  <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Datum</th>
                  <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Modell</th>
                  <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Status</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Token</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Searches</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Kosten</th>
                </tr>
              </thead>
              <tbody>
                {stats.competitor_runs.map((r, i) => {
                  const rc = priceFor(r.model ?? "", r.tokens_in, r.tokens_out) + r.web_search_cost_usd;
                  const modelShort = modelShortLabel(r.model);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-[var(--border-color-soft)] last:border-0 ${
                        i % 2 === 0 ? "" : "bg-[var(--color-near-black)]/[0.02]"
                      }`}
                    >
                      <td className="px-5 py-3 text-meta text-[var(--color-near-black)]/60">
                        {formatDate(r.started_at)}
                      </td>
                      <td className="px-5 py-3 text-meta text-[var(--color-near-black)]/60">{modelShort}</td>
                      <td className="px-5 py-3">
                        <StatusDot status={r.status} />
                      </td>
                      <td className="px-5 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {formatNum(r.tokens_in + r.tokens_out)}
                      </td>
                      <td className="px-5 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {r.web_search_uses}
                      </td>
                      <td className="px-5 py-3 text-right text-meta-strong tabular-nums">
                        {formatUsd(rc)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Show discovery runs ── */}
      <section className="mb-10">
        <p className="section-eyebrow mb-3">MESSEN-SUCHE</p>
        {stats.show_discovery_list.length === 0 ? (
          <div className="py-8 text-body text-[var(--color-near-black)]/50 box-line px-5">
            Noch keine Messen-Suchen durchgefuhrt.
          </div>
        ) : (
          <div className="box-line">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border-color-soft)]">
                  <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Datum</th>
                  <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Suchanfrage</th>
                  <th className="text-left px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Status</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Token</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Searches</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">FC Credits</th>
                  <th className="text-right px-5 py-3 text-meta font-normal text-[var(--color-near-black)]/50">Kosten</th>
                </tr>
              </thead>
              <tbody>
                {stats.show_discovery_list.map((r, i) => {
                  const fcCredits = (r.firecrawl_calls ?? 0) * 5;
                  const rc =
                    priceFor(r.model ?? "", r.tokens_in, r.tokens_out) +
                    priceForWebSearch(r.web_search_uses) +
                    priceForFirecrawlCredits(fcCredits);
                  return (
                    <tr
                      key={r.id}
                      className={`border-b border-[var(--border-color-soft)] last:border-0 ${
                        i % 2 === 0 ? "" : "bg-[var(--color-near-black)]/[0.02]"
                      }`}
                    >
                      <td className="px-5 py-3 text-meta text-[var(--color-near-black)]/60 whitespace-nowrap">
                        {formatDate(r.started_at)}
                      </td>
                      <td className="px-5 py-3 text-body-sm max-w-xs">
                        <span className="line-clamp-1 text-[var(--color-near-black)]/70">
                          {r.user_prompt || "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <StatusDot status={r.status} />
                      </td>
                      <td className="px-5 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {formatNum(r.tokens_in + r.tokens_out)}
                      </td>
                      <td className="px-5 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {r.web_search_uses}
                      </td>
                      <td className="px-5 py-3 text-right text-meta tabular-nums text-[var(--color-near-black)]/60">
                        {fcCredits > 0 ? `${fcCredits} Cr.` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-meta-strong tabular-nums">
                        {formatUsd(rc)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  highlight = false,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="card-surface px-6 py-8 flex flex-col gap-2">
      <span className="text-meta">{label}</span>
      <span
        className="text-display tabular-nums"
        style={highlight ? { color: "var(--color-near-black)" } : undefined}
      >
        {value}
      </span>
      {sub && <span className="text-meta text-[var(--color-near-black)]/50 tabular-nums">{sub}</span>}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const labels: Record<string, string> = {
    done: "fertig",
    running: "laeuft",
    failed: "fehler",
    preparing: "vorbereitung",
    pending: "wartet",
  };
  const color =
    status === "done"
      ? "var(--color-success)"
      : status === "running" || status === "preparing"
      ? "var(--color-gold)"
      : status === "failed"
      ? "var(--color-error)"
      : "rgba(10,10,10,0.35)";
  return (
    <span className="inline-flex items-center gap-1.5 text-meta" style={{ color }}>
      <span
        className="inline-block rounded-full shrink-0"
        style={{ width: 6, height: 6, background: color }}
      />
      {labels[status] ?? status}
    </span>
  );
}
