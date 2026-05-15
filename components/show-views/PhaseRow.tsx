import { GoldDot } from "@/components/brand/GoldDot";
import type { Phase } from "./types";

export function PhaseRow({ phase, isLast }: { phase: Phase; isLast: boolean }) {
  return (
    <li className="relative pl-7 pb-7 last:pb-0">
      <PhaseMarker status={phase.status} />
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[7px] top-5 bottom-0 w-px bg-[var(--color-hairline-light)]"
        />
      )}

      <div className="flex items-baseline gap-2.5 mb-1">
        <span className="tabular-nums text-meta">{phase.num}</span>
        <span
          className={
            phase.status === "pending"
              ? "text-body text-[var(--color-near-black)]/45"
              : "text-body font-semibold"
          }
        >
          {phase.label}
        </span>
      </div>

      {phase.detail && (
        <div className="text-body-sm text-[var(--color-near-black)]/65">
          {phase.detail}
        </div>
      )}

      {phase.sub && phase.sub.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {phase.sub.map((line, idx) => {
            const isLabel = idx === 0;
            return (
              <li
                key={idx}
                className={
                  isLabel
                    ? "text-meta"
                    : "text-meta-strong text-[var(--color-near-black)]/65"
                }
              >
                {line}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

export function PhaseMarker({ status }: { status: Phase["status"] }) {
  const base =
    "absolute left-0 top-1 inline-flex items-center justify-center w-4 h-4 text-[10px]";
  if (status === "done") {
    return (
      <span
        className={`${base} border border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold`}
      >
        ✓
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className={base}>
        <GoldDot size={8} />
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span
        className={`${base} border border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold`}
      >
        ‖
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className={`${base} border border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold`}
      >
        ×
      </span>
    );
  }
  return <span className={`${base} border border-[var(--color-hairline-light)]`} />;
}
