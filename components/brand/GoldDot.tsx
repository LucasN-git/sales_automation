export function GoldDot({ size = 8, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block align-middle ${className}`}
      style={{
        width: size,
        height: size,
        background: "var(--color-gold)",
      }}
    />
  );
}
