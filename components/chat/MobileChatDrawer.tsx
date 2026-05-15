"use client";

import { ChatPanel, type ChatScope } from "./ChatPanel";
import { useMobileShell } from "../MobileShellProvider";

function scopeKey(s: ChatScope): string {
  if (s.kind === "show") {
    return `show:${s.showId}:${s.focusExhibitorId ?? ""}`;
  }
  if (s.kind === "competitor") {
    return `competitor:${s.focusCompetitorId ?? ""}`;
  }
  if (s.kind === "companies") {
    return `companies:${s.focusCompanyId ?? ""}`;
  }
  return "dashboard";
}

export function MobileChatDrawer({ scope }: { scope: ChatScope }) {
  const { chatOpen, closeChat } = useMobileShell();

  return (
    <div
      aria-hidden={!chatOpen}
      className={`lg:hidden fixed inset-0 z-50 transition-opacity ${
        chatOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
    >
      <div
        className={`absolute inset-0 bg-[var(--color-cream-sunken)] transition-transform duration-200 ${
          chatOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {chatOpen && (
          <ChatPanel
            key={scopeKey(scope)}
            scope={scope}
            fitParent
            onClose={closeChat}
          />
        )}
      </div>
    </div>
  );
}
