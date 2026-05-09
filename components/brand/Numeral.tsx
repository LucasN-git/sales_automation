export function Numeral({ n, className = "" }: { n: number | string; className?: string }) {
  const value = typeof n === "number" ? String(n).padStart(2, "0") : n;
  return (
    <span className={`tabular-nums font-bold ${className}`}>
      {value}
      <span style={{ color: "var(--color-gold)" }}>.</span>
    </span>
  );
}
