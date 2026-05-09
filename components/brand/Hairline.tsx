export function Hairline({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-px w-full bg-[var(--color-hairline-light)] ${className}`}
    />
  );
}
