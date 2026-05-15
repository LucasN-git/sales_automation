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
      className={`inline-flex items-center gap-2 px-5 py-3 text-[14px] font-semibold uppercase tracking-[0.06em] bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center ${className}`}
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
