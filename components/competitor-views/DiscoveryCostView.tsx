export type DiscoveryCostStats = {
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cost_usd: number;
  web_search_uses: number | null;
  web_search_cost_usd: number;
};

export function DiscoveryCostView({ stats }: { stats: DiscoveryCostStats }) {
  const total = stats.tokens_cost_usd + stats.web_search_cost_usd;
  const tokensIn = stats.tokens_in ?? 0;
  const tokensOut = stats.tokens_out ?? 0;
  const wsUses = stats.web_search_uses ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-meta-strong">claude tokens</span>
          <span className="tabular-nums text-body-sm">
            {formatUsd(stats.tokens_cost_usd)}
          </span>
        </div>
        <div className="text-meta tabular-nums">
          {stats.model ?? "model unbekannt"} · in {fmtNum(tokensIn)} / out {fmtNum(tokensOut)}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-meta-strong">web-search</span>
          <span className="tabular-nums text-body-sm">
            {formatUsd(stats.web_search_cost_usd)}
          </span>
        </div>
        <div className="text-meta tabular-nums">
          {wsUses} request(s) × 0.01 $
        </div>
      </div>

      <div className="pt-3 border-t border-[var(--color-hairline-light)]">
        <div className="flex items-baseline justify-between">
          <span className="text-meta-strong">gesamt</span>
          <span className="tabular-nums text-title">{formatUsd(total)}</span>
        </div>
      </div>
    </div>
  );
}

function formatUsd(usd: number): string {
  if (usd === 0) return "0.00 $";
  if (usd < 0.01) return "<0.01 $";
  return `${usd.toFixed(2)} $`;
}

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
