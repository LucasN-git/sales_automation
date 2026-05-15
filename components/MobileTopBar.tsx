"use client";

import Link from "next/link";
import { ChatIcon, MenuIcon } from "@/components/brand/Icons";
import { useMobileShell } from "./MobileShellProvider";

export function MobileTopBar() {
  const { openNav, openChat } = useMobileShell();

  return (
    <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 h-12 px-3 bg-[var(--color-cream)] border-b border-[var(--border-color-soft)]">
      <button
        onClick={openNav}
        aria-label="Navigation oeffnen"
        title="Navigation oeffnen"
        className="w-10 h-10 -ml-1 inline-flex items-center justify-center text-[var(--color-near-black)]/70 hover:text-[var(--color-gold)] transition-colors"
      >
        <MenuIcon size={20} />
      </button>

      <Link
        href="/"
        className="text-body-sm tracking-wide text-[var(--color-near-black)]"
      >
        ISP Sales
      </Link>

      <button
        onClick={openChat}
        aria-label="Chat oeffnen"
        title="Chat oeffnen"
        className="w-10 h-10 -mr-1 inline-flex items-center justify-center text-[var(--color-near-black)]/70 hover:text-[var(--color-gold)] transition-colors"
      >
        <ChatIcon size={18} />
      </button>
    </header>
  );
}
