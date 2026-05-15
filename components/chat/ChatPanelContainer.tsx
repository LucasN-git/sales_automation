"use client";

import { ChatPanel } from "./ChatPanel";
import { ChatColumnShell } from "@/components/ChatColumnShell";
import { useChatScope } from "./ChatScopeProvider";
import type { ChatScope } from "./ChatPanel";
import { MobileChatDrawer } from "./MobileChatDrawer";

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

export function ChatPanelContainer() {
  const { scope } = useChatScope();
  return (
    <>
      <ChatColumnShell
        renderChat={(toggle) => (
          <ChatPanel key={scopeKey(scope)} scope={scope} fitParent onCollapse={toggle} />
        )}
      />
      <MobileChatDrawer scope={scope} />
    </>
  );
}
