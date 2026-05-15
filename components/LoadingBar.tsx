"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Module-level pub/sub for global "something is loading" indications. Both
 * automatic (URL change → flash) and explicit (button-handler calls
 * loading.start/stop) sources increment a shared counter; the bar is visible
 * whenever the counter is > 0.
 *
 * Intentionally not a React Context — this lets any module (server-action
 * helpers, fetch wrappers, even imports of pages) flip the indicator without
 * threading a hook through the tree.
 */

type Listener = (active: boolean) => void;
const listeners = new Set<Listener>();
let activeCount = 0;

function notify() {
  const active = activeCount > 0;
  for (const l of listeners) l(active);
}

export const loading = {
  start(): void {
    activeCount += 1;
    notify();
  },
  stop(): void {
    activeCount = Math.max(0, activeCount - 1);
    notify();
  },
  /** Run an async function with the indicator active for its duration. */
  async wrap<T>(fn: () => Promise<T>): Promise<T> {
    loading.start();
    try {
      return await fn();
    } finally {
      loading.stop();
    }
  },
};

/**
 * Top-of-page progress bar. Mount once in the root layout. Shows a thin gold
 * line whenever `loading.start()` has been called more often than
 * `loading.stop()`, OR briefly after every URL change as a "page just loaded"
 * cue. The two sources stack via the shared counter, so transitions that
 * include both navigation and an explicit POST stay visible until both end.
 */
export function LoadingBar() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    listeners.add(setActive);
    return () => {
      listeners.delete(setActive);
    };
  }, []);

  return (
    <div
      aria-hidden
      className={`fixed top-0 left-0 right-0 h-[2px] z-[100] pointer-events-none transition-opacity duration-200 ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="isp-loading-stripe h-full w-full" />
    </div>
  );
}

/**
 * Auto-trigger for the loading bar on navigation.
 *
 * Problem: usePathname() only updates after React commits the new page (i.e.
 * after the server has responded). Reacting to it fires the bar *after* load,
 * not before — giving the "feedbackless 2-second wait" the user sees.
 *
 * Fix: a capture-phase click listener on document fires synchronously on every
 * click, before any React transition starts. Internal link clicks → start bar
 * immediately. Pathname/searchParams commit → stop bar (navigation done).
 *
 * For router.push() calls from button handlers, use loading.start/stop directly
 * in that handler — the pathname effect will stop any remaining count on commit.
 */
export function NavigationLoadingTrigger() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();
  const navStartsRef = useRef(0);
  const mountedRef = useRef(false);

  // Intercept internal link clicks synchronously on click — well before
  // usePathname() would update.
  useEffect(() => {
    function onLinkClick(e: MouseEvent) {
      const a = (e.target as Element).closest("a[href]");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;
      // Skip external, hash-only, new-tab, and download links.
      if (
        href.startsWith("http") ||
        href.startsWith("//") ||
        href.startsWith("#") ||
        a.getAttribute("target") === "_blank" ||
        a.hasAttribute("download")
      )
        return;
      // Skip modified clicks (open in new tab, etc.).
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      navStartsRef.current += 1;
      loading.start();
    }
    document.addEventListener("click", onLinkClick, true);
    return () => document.removeEventListener("click", onLinkClick, true);
  }, []);

  // Stop loading when the navigation commits. Skip initial mount so we don't
  // cancel an in-flight loading.start() from a button handler.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    // Drain all link-click starts that are still pending.
    const pending = navStartsRef.current;
    navStartsRef.current = 0;
    for (let i = 0; i < pending; i++) loading.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, sp.toString()]);

  void startTransition;
  return null;
}
