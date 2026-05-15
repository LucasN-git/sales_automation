import type { TokenStats } from "./types";

export function CostView({ stats }: { stats?: TokenStats }) {
  if (!stats) {
    return <p className="text-meta">noch keine token-daten</p>;
  }
  const browserCost = stats.browser_cost_usd ?? 0;
  const total =
    stats.short_cost_usd + stats.deep_cost_usd + stats.chat_cost_usd + browserCost;
  return (
    <div className="space-y-4">
      <CostRow
        label="short"
        count={stats.short_count}
        tokensIn={stats.short_in}
        tokensOut={stats.short_out}
        cost={stats.short_cost_usd}
      />
      <CostRow
        label="deep"
        count={stats.deep_count}
        tokensIn={stats.deep_in}
        tokensOut={stats.deep_out}
        cost={stats.deep_cost_usd}
      />
      <CostRow
        label="chat"
        count={stats.chat_count}
        tokensIn={stats.chat_in}
        tokensOut={stats.chat_out}
        cost={stats.chat_cost_usd}
      />
      {(stats.browser_seconds ?? 0) > 0 && (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-meta-strong">browser</span>
            <span className="tabular-nums text-body-sm">{formatUsd(browserCost)}</span>
          </div>
          <div className="text-meta tabular-nums">
            {formatBrowserDuration(stats.browser_seconds ?? 0)}
          </div>
        </div>
      )}
      <div className="pt-3 border-t border-[var(--color-hairline-light)]">
        <div className="flex items-baseline justify-between">
          <span className="text-meta-strong">gesamt</span>
          <span className="tabular-nums text-title">{formatUsd(total)}</span>
        </div>
      </div>
    </div>
  );
}

function CostRow({
  label,
  count,
  tokensIn,
  tokensOut,
  cost,
}: {
  label: string;
  count: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-meta-strong">
          {label} ({count})
        </span>
        <span className="tabular-nums text-body-sm">{formatUsd(cost)}</span>
      </div>
      <div className="text-meta tabular-nums">
        in {fmtNum(tokensIn)} / out {fmtNum(tokensOut)}
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

function formatBrowserDuration(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}
