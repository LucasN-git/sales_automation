import { GoldDot } from "@/components/brand/GoldDot";
import type { ExhibitorLite } from "./types";

export function ProgressView({ exhibitors }: { exhibitors: ExhibitorLite[] }) {
  const total = exhibitors.length;
  if (total === 0) {
    return <p className="text-meta">keine daten — listing noch nicht durch</p>;
  }
  const shortDone = exhibitors.filter((e) => e.short_status === "done").length;
  const shortFailed = exhibitors.filter((e) => e.short_status === "failed").length;
  const shortRunning = exhibitors.filter((e) => e.short_status === "running").length;
  const shortDoneOrFailed = shortDone + shortFailed;
  const shortRemaining = total - shortDoneOrFailed;

  const etaSec = shortRemaining > 0 ? Math.round(shortRemaining * 1.2) : 0;

  return (
    <div className="space-y-5">
      <ProgressBar
        label="short-overviews"
        done={shortDoneOrFailed}
        running={shortRunning}
        total={total}
      />
      {shortRemaining > 0 && (
        <p className="text-meta">
          verbleibend ~{formatEta(etaSec)} (concurrency 5)
        </p>
      )}
    </div>
  );
}

function ProgressBar({
  label,
  done,
  running,
  total,
}: {
  label: string;
  done: number;
  running: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-meta-strong">{label}</span>
        <span className="tabular-nums text-body-sm">
          {done}/{total} · {pct}%
        </span>
      </div>
      <div className="relative h-1 bg-[var(--color-hairline-light)] overflow-hidden">
        <div
          className="absolute left-0 top-0 bottom-0 bg-[var(--color-near-black)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {running > 0 && (
        <div className="mt-1 text-meta inline-flex items-center gap-1">
          <GoldDot size={4} /> {running} laeuft
        </div>
      )}
    </div>
  );
}

function formatEta(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m} min ${s} s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
