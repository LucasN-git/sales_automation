"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ProcessSidebar } from "@/components/ProcessSidebar";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ChevronLeft, ChevronRight } from "@/components/brand/Icons";
import type { CrawlPlan } from "@/lib/crawl-plan";
import { ChatPanel } from "./ChatPanel";

type ExhibitorLite = {
  company_name: string;
  short_status: string;
  deep_status: string;
  current_step: string | null;
};

type LogEntry = {
  id: number;
  level: string;
  phase: string | null;
  message: string;
  meta?: Record<string, unknown> | null;
  created_at: string;
};

type TokenStats = {
  short_in: number;
  short_out: number;
  short_count: number;
  deep_in: number;
  deep_out: number;
  deep_count: number;
  chat_in: number;
  chat_out: number;
  chat_count: number;
  short_cost_usd: number;
  deep_cost_usd: number;
  chat_cost_usd: number;
};

const PROCESS_DEFAULT = 320;
const PROCESS_MIN = 220;
const PROCESS_MAX = 560;
const CHAT_DEFAULT = 620;
const CHAT_MIN = 360;
const CHAT_MAX = 960;

export function LayoutShell({
  children,
  showId,
  showStatus,
  showCurrentStep,
  errorMessage,
  pollIntervalMs,
  exhibitors,
  crawlPlan,
  logEntries,
  tokenStats,
  exhibitorMap,
}: {
  children: React.ReactNode;
  showId: string;
  showStatus: string;
  showCurrentStep: string | null;
  errorMessage: string | null;
  pollIntervalMs: number;
  exhibitors: ExhibitorLite[];
  crawlPlan: CrawlPlan | null;
  logEntries: LogEntry[];
  tokenStats: TokenStats;
  exhibitorMap: Record<string, { name: string; hasDeep: boolean }>;
}) {
  const pathname = usePathname();
  const [processCollapsed, setProcessCollapsed] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [processWidth, setProcessWidth] = useState(PROCESS_DEFAULT);
  const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setProcessCollapsed(localStorage.getItem("process-collapsed") === "1");
    setChatCollapsed(localStorage.getItem("chat-collapsed") === "1");
    const pw = parseInt(localStorage.getItem("process-width") ?? "", 10);
    if (Number.isFinite(pw)) setProcessWidth(clamp(pw, PROCESS_MIN, PROCESS_MAX));
    const cw = parseInt(localStorage.getItem("chat-width") ?? "", 10);
    if (Number.isFinite(cw)) setChatWidth(clamp(cw, CHAT_MIN, CHAT_MAX));
  }, []);

  function toggleProcess() {
    const next = !processCollapsed;
    setProcessCollapsed(next);
    localStorage.setItem("process-collapsed", next ? "1" : "0");
  }
  function toggleChat() {
    const next = !chatCollapsed;
    setChatCollapsed(next);
    localStorage.setItem("chat-collapsed", next ? "1" : "0");
  }
  function persistProcessWidth(w: number) {
    setProcessWidth(w);
    localStorage.setItem("process-width", String(Math.round(w)));
  }
  function persistChatWidth(w: number) {
    setChatWidth(w);
    localStorage.setItem("chat-width", String(Math.round(w)));
  }

  const exMatch = pathname?.match(/\/shows\/[^/]+\/exhibitors\/([^/]+)/);
  const focusExhibitorId = exMatch ? exMatch[1] : null;
  const focusInfo = focusExhibitorId ? exhibitorMap[focusExhibitorId] : null;

  return (
    <div className="min-h-screen flex">
      {pollIntervalMs > 0 && <AutoRefresh intervalMs={pollIntervalMs} />}

      <CollapsibleColumn
        side="left"
        collapsed={processCollapsed}
        onToggle={toggleProcess}
        label="Prozess"
        width={processWidth}
        minWidth={PROCESS_MIN}
        maxWidth={PROCESS_MAX}
        onResize={persistProcessWidth}
      >
        <div className="p-5 pt-12 h-full overflow-y-auto">
          <ProcessSidebar
            showId={showId}
            showStatus={showStatus}
            showCurrentStep={showCurrentStep}
            errorMessage={errorMessage}
            crawlPlan={crawlPlan}
            exhibitors={exhibitors}
            logEntries={logEntries}
            tokenStats={tokenStats}
          />
        </div>
      </CollapsibleColumn>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-8 py-12 max-w-5xl mx-auto">{children}</div>
      </main>

      <CollapsibleColumn
        side="right"
        collapsed={chatCollapsed}
        onToggle={toggleChat}
        label="Chat"
        width={chatWidth}
        minWidth={CHAT_MIN}
        maxWidth={CHAT_MAX}
        onResize={persistChatWidth}
        suppressInternalToggle
      >
        <ChatPanel
          showId={showId}
          focusExhibitorId={focusExhibitorId}
          focusExhibitorName={focusInfo?.name ?? null}
          hasDeep={focusInfo?.hasDeep ?? false}
          fitParent
          onCollapse={toggleChat}
        />
      </CollapsibleColumn>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function CollapsibleColumn({
  side,
  collapsed,
  onToggle,
  label,
  width,
  minWidth,
  maxWidth,
  onResize,
  children,
  suppressInternalToggle = false,
}: {
  side: "left" | "right";
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  onResize: (w: number) => void;
  children: React.ReactNode;
  suppressInternalToggle?: boolean;
}) {
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  function onMouseDownHandle(e: React.MouseEvent) {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const next = clamp(
        side === "left"
          ? dragRef.current.startW + dx
          : dragRef.current.startW - dx,
        minWidth,
        maxWidth,
      );
      onResize(next);
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

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        aria-label={`${label} ausklappen`}
        title={`${label} ausklappen`}
        className={`hidden lg:flex shrink-0 w-9 sticky top-0 h-screen items-start justify-center pt-4 text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] hover:bg-[var(--color-near-black)]/[0.02] transition-colors ${
          side === "left"
            ? "border-r border-[var(--border-color-soft)]"
            : "border-l border-[var(--border-color-soft)]"
        }`}
      >
        {side === "left" ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
    );
  }

  return (
    <aside
      className={`hidden lg:flex shrink-0 sticky top-0 h-screen flex-col ${
        side === "left"
          ? "border-r border-[var(--border-color-soft)]"
          : "border-l border-[var(--border-color-soft)]"
      } relative`}
      style={{ width }}
    >
      {!suppressInternalToggle && (
        <button
          onClick={onToggle}
          aria-label={`${label} einklappen`}
          title={`${label} einklappen`}
          className={`absolute top-3 ${
            side === "left" ? "right-3" : "left-3"
          } w-7 h-7 inline-flex items-center justify-center text-[var(--color-near-black)]/45 hover:text-[var(--color-gold)] z-30 transition-colors`}
        >
          {side === "left" ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>
      )}

      {/* Resize handle on the inner edge */}
      <div
        onMouseDown={onMouseDownHandle}
        aria-label={`${label} Breite anpassen`}
        className={`absolute top-0 bottom-0 w-1.5 z-20 cursor-col-resize hover:bg-[var(--color-gold)]/30 transition-colors ${
          side === "left" ? "right-0" : "left-0"
        }`}
      />

      <div className="flex-1 min-h-0">{children}</div>
    </aside>
  );
}
