"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { ChatScope } from "./ChatPanel";

const DEFAULT_SCOPE: ChatScope = { kind: "dashboard" };

type Ctx = {
  scope: ChatScope;
  setScope: (s: ChatScope) => void;
};

const ChatScopeContext = createContext<Ctx | null>(null);

export function ChatScopeProvider({ children }: { children: React.ReactNode }) {
  const [scope, setScope] = useState<ChatScope>(DEFAULT_SCOPE);
  return (
    <ChatScopeContext.Provider value={{ scope, setScope }}>
      {children}
    </ChatScopeContext.Provider>
  );
}

export function useChatScope(): Ctx {
  const ctx = useContext(ChatScopeContext);
  if (!ctx) throw new Error("useChatScope outside ChatScopeProvider");
  return ctx;
}

/**
 * Effect-only helper: set the chat scope for the current route, reset to
 * global when the component unmounts. Use in show/exhibitor/company pages.
 */
export function ChatScopeBinding({ scope }: { scope: ChatScope }) {
  const { setScope } = useChatScope();
  const key = JSON.stringify(scope);
  useEffect(() => {
    setScope(scope);
    return () => setScope(DEFAULT_SCOPE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
