"use client";

import { useRef, useSyncExternalStore } from "react";
import { ChevronRight } from "@/components/brand/Icons";

const CHAT_DEFAULT = 620;
const CHAT_MIN = 360;
const CHAT_MAX = 960;
const CHAT_COLLAPSED_WIDTH = 36;

const KEY_COLLAPSED = "global-chat-collapsed";
const KEY_WIDTH = "global-chat-width";
const PREFS_EVENT = "global-chat-prefs";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

type Prefs = { collapsed: boolean; width: number };
let cached: Prefs = { collapsed: false, width: CHAT_DEFAULT };

function readPrefs(): Prefs {
  if (typeof window === "undefined") return cached;
  const collapsed = localStorage.getItem(KEY_COLLAPSED) === "1";
  const raw = parseInt(localStorage.getItem(KEY_WIDTH) ?? "", 10);
  const width = Number.isFinite(raw)
    ? clamp(raw, CHAT_MIN, CHAT_MAX)
    : CHAT_DEFAULT;
  if (cached.collapsed !== collapsed || cached.width !== width) {
    cached = { collapsed, width };
  }
  return cached;
}

const SERVER_PREFS: Prefs = { collapsed: false, width: CHAT_DEFAULT };
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

export function ChatColumnShell({
  renderChat,
}: {
  renderChat: (toggle: () => void) => React.ReactNode;
}) {
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
      const next = clamp(dragRef.current.startW - dx, CHAT_MIN, CHAT_MAX);
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

  // Single DOM tree regardless of collapsed state — see AppSidebarShell for
  // the rationale (avoids click-loss during the hydration tree swap).
  return (
    <aside
      className="hidden lg:flex shrink-0 sticky top-0 h-screen flex-col border-l border-[var(--border-color-soft)] relative bg-[var(--color-cream-sunken)]"
      style={{ width: collapsed ? CHAT_COLLAPSED_WIDTH : width }}
    >
      {collapsed && (
        <button
          onClick={toggle}
          aria-label="Chat ausklappen"
          title="Chat ausklappen"
          className="absolute inset-x-0 top-0 h-screen flex items-start justify-center pt-4 text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] hover:bg-[var(--color-near-black)]/[0.02] transition-colors z-30"
        >
          <ChevronRight size={18} className="rotate-180" />
        </button>
      )}

      {!collapsed && (
        <>
          <div
            onMouseDown={onMouseDownHandle}
            aria-label="Chat Breite anpassen"
            className="absolute top-0 bottom-0 left-0 w-1.5 z-20 cursor-col-resize hover:bg-[var(--color-gold)]/30 transition-colors"
          />
          <div className="flex-1 min-h-0">{renderChat(toggle)}</div>
        </>
      )}
    </aside>
  );
}
