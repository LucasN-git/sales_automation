// Generic fallback when a layout itself is suspending (e.g. cold-start on
// the show-detail layout's metadata query). The route-specific loading.tsx
// in app/shows/[id]/ takes over once the layout has rendered.

export default function Loading() {
  return (
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 h-[2px] z-[100] pointer-events-none"
    >
      <div className="isp-loading-stripe h-full w-full" />
    </div>
  );
}
