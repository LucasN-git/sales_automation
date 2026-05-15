"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useChatScope } from "@/components/chat/ChatScopeProvider";

export function CompetitorChatScopeBinder({
  competitorMap,
}: {
  competitorMap: Record<string, { name: string; shortStatus: string }>;
}) {
  const pathname = usePathname();
  const { setScope } = useChatScope();

  useEffect(() => {
    const competitorMatch = pathname?.match(/\/competitors\/([a-f0-9-]{36})/);
    const focusCompetitorId = competitorMatch ? competitorMatch[1] : null;
    const focusInfo = focusCompetitorId ? competitorMap[focusCompetitorId] : null;

    setScope({
      kind: "competitor",
      focusCompetitorId,
      focusName: focusInfo?.name ?? null,
    });

    return () => setScope({ kind: "dashboard" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, competitorMap]);

  return null;
}
