"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type MobileShell = {
  navOpen: boolean;
  chatOpen: boolean;
  openNav: () => void;
  closeNav: () => void;
  openChat: () => void;
  closeChat: () => void;
};

const Ctx = createContext<MobileShell | null>(null);

export function MobileShellProvider({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const openNav = useCallback(() => {
    setNavOpen(true);
    setChatOpen(false);
  }, []);
  const closeNav = useCallback(() => setNavOpen(false), []);
  const openChat = useCallback(() => {
    setChatOpen(true);
    setNavOpen(false);
  }, []);
  const closeChat = useCallback(() => setChatOpen(false), []);

  // Lock body scroll while a drawer is open so the page underneath doesn't
  // scroll behind the overlay on iOS / mobile Safari.
  useEffect(() => {
    const anyOpen = navOpen || chatOpen;
    const prev = document.body.style.overflow;
    if (anyOpen) document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen, chatOpen]);

  // ESC closes whichever drawer is open
  useEffect(() => {
    if (!navOpen && !chatOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setNavOpen(false);
        setChatOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, chatOpen]);

  const value = useMemo<MobileShell>(
    () => ({ navOpen, chatOpen, openNav, closeNav, openChat, closeChat }),
    [navOpen, chatOpen, openNav, closeNav, openChat, closeChat],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMobileShell(): MobileShell {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useMobileShell must be used inside <MobileShellProvider>");
  }
  return v;
}
