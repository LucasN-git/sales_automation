"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useChatScope } from "@/components/chat/ChatScopeProvider";

export function ShowChatScopeBinder({
  showId,
  exhibitorMap,
  showStatus,
}: {
  showId: string;
  exhibitorMap: Record<string, { name: string; hasDeep: boolean; deepStatus: string; currentStep: string | null }>;
  showStatus?: string | null;
}) {
  const pathname = usePathname();
  const { setScope } = useChatScope();

  useEffect(() => {
    const exMatch = pathname?.match(/\/shows\/[^/]+\/exhibitors\/([^/]+)/);
    const focusExhibitorId = exMatch ? exMatch[1] : null;
    const focusInfo = focusExhibitorId ? exhibitorMap[focusExhibitorId] : null;
    setScope({
      kind: "show",
      showId,
      focusExhibitorId,
      focusName: focusInfo?.name ?? null,
      hasDeep: focusInfo?.hasDeep ?? false,
      deepStatus: focusInfo?.deepStatus ?? null,
      currentStep: focusInfo?.currentStep ?? null,
    });
    return () => setScope({ kind: "dashboard" });
  }, [pathname, showId, exhibitorMap, setScope]);

  // Auto-open the chat column when the show is brand new (queued) so the
  // orchestrator greeting is immediately visible.
  useEffect(() => {
    if (showStatus === "queued") {
      try {
        localStorage.setItem("global-chat-collapsed", "0");
        window.dispatchEvent(new Event("global-chat-prefs"));
      } catch {
        // localStorage not available (SSR edge case)
      }
    }
  }, [showStatus]);

  return null;
}
