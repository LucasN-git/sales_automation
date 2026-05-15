"use client";

import { useRef, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight } from "@/components/brand/Icons";

const SIDEBAR_DEFAULT = 252;
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_COLLAPSED_WIDTH = 36;

const KEY_COLLAPSED = "app-sidebar-collapsed";
const KEY_WIDTH = "app-sidebar-width";
const PREFS_EVENT = "app-sidebar-prefs";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Cache the snapshot so useSyncExternalStore gets a stable reference across
// polls (returning a new object every call would trigger an infinite render).
type Prefs = { collapsed: boolean; width: number };
const SERVER_PREFS: Prefs = { collapsed: false, width: SIDEBAR_DEFAULT };
let cached: Prefs = SERVER_PREFS;

function readPrefs(): Prefs {
  if (typeof window === "undefined") return SERVER_PREFS;
  const collapsed = localStorage.getItem(KEY_COLLAPSED) === "1";
  const raw = parseInt(localStorage.getItem(KEY_WIDTH) ?? "", 10);
  const width = Number.isFinite(raw)
    ? clamp(raw, SIDEBAR_MIN, SIDEBAR_MAX)
    : SIDEBAR_DEFAULT;
  if (cached.collapsed !== collapsed || cached.width !== width) {
    cached = { collapsed, width };
  }
  return cached;
}

function getServerPrefs(): Prefs {
  return SERVER_PREFS;
}

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY_COLLAPSED || e.key === KEY_WIDTH) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(PREFS_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(PREFS_EVENT, cb);
  };
}

function notify() {
  cached = { ...cached };
  window.dispatchEvent(new Event(PREFS_EVENT));
}

export function AppSidebarShell({ children }: { children: React.ReactNode }) {
  const { collapsed, width } = useSyncExternalStore(
    subscribe,
    readPrefs,
    getServerPrefs,
  );
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  function toggle() {
    localStorage.setItem(KEY_COLLAPSED, collapsed ? "0" : "1");
    notify();
  }

  function onMouseDownHandle(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const next = clamp(dragRef.current.startW + dx, SIDEBAR_MIN, SIDEBAR_MAX);
      localStorage.setItem(KEY_WIDTH, String(Math.round(next)));
      notify();
    };
    const handleUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }

  // Single DOM tree regardless of collapsed state. The toggle button is
  // always at the same React node, so it stays mounted across hydration —
  // clicks on it never get swallowed by a tree swap.
  return (
    <aside
      className="hidden lg:flex shrink-0 sticky top-0 h-screen flex-col border-r border-[var(--border-color-soft)] relative bg-[var(--color-cream-sunken)]"
      style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : width }}
    >
      <button
        onClick={toggle}
        aria-label={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
        title={collapsed ? "Sidebar ausklappen" : "Sidebar einklappen"}
        className={
          collapsed
            ? "absolute inset-x-0 top-0 h-screen flex items-start justify-center pt-4 text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] hover:bg-[var(--color-near-black)]/[0.02] transition-colors z-30"
            : "absolute top-3 right-3 w-7 h-7 inline-flex items-center justify-center text-[var(--color-near-black)]/45 hover:text-[var(--color-gold)] transition-colors z-30"
        }
      >
        {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={16} />}
      </button>

      {!collapsed && (
        <>
          <div
            onMouseDown={onMouseDownHandle}
            aria-label="Sidebar Breite anpassen"
            className="absolute top-0 bottom-0 right-0 w-1.5 z-20 cursor-col-resize hover:bg-[var(--color-gold)]/30 transition-colors"
          />
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </>
      )}
    </aside>
  );
}
