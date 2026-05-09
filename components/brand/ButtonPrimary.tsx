"use client";

import { ButtonHTMLAttributes, ReactNode } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  withGoldDot?: boolean;
};

export function ButtonPrimary({ children, withGoldDot = true, className = "", ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-2 px-5 py-3 text-[15px] font-bold uppercase tracking-[0.04em] bg-[var(--color-near-black)] text-[var(--color-cream)] disabled:opacity-50 transition-opacity hover:opacity-90 ${className}`}
    >
      <span>{children}</span>
      {withGoldDot && (
        <span
          aria-hidden
          style={{ width: 6, height: 6, background: "var(--color-gold)" }}
        />
      )}
    </button>
  );
}
