export default function Loading() {
  return (
    <>
      <div
        aria-hidden
        className="fixed top-0 left-0 right-0 h-[2px] z-[100] pointer-events-none"
      >
        <div className="isp-loading-stripe h-full w-full" />
      </div>

      <div aria-busy="true" aria-live="polite">
        <div className="mb-6 text-meta opacity-60">laedt</div>

        <header className="mb-10">
          <div className="h-[44px] w-3/4 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
          <div className="mt-3 flex gap-4 flex-wrap">
            <div className="h-3 w-24 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
            <div className="h-3 w-28 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
            <div className="h-3 w-20 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
          </div>
          <div className="mt-6 h-12 w-56 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
        </header>

        <div className="flex gap-3 mb-5 flex-wrap">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-9 w-32 bg-[var(--color-near-black)]/[0.04] animate-pulse"
            />
          ))}
        </div>

        <div className="border-t border-[var(--border-color-soft)]" />

        <ul className="mt-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <li
              key={i}
              className="px-5 py-4 border-b border-[var(--border-color-soft)] flex items-start gap-4"
            >
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-4 w-1/3 bg-[var(--color-near-black)]/[0.08] animate-pulse" />
                <div className="h-3 w-2/3 bg-[var(--color-near-black)]/[0.05] animate-pulse" />
              </div>
              <div className="h-7 w-24 bg-[var(--color-near-black)]/[0.06] animate-pulse" />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
