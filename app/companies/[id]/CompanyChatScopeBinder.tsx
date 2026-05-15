"use client";

import { useEffect } from "react";
import { useChatScope } from "@/components/chat/ChatScopeProvider";

export function CompanyChatScopeBinder({
  companyId,
  companyName,
}: {
  companyId: string;
  companyName: string;
}) {
  const { setScope } = useChatScope();

  useEffect(() => {
    setScope({ kind: "companies", focusCompanyId: companyId, focusName: companyName });
    return () => setScope({ kind: "dashboard" });
  }, [companyId, companyName, setScope]);

  return null;
}
