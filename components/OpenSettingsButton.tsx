"use client";

export type AccountDrawerTab =
  | "profile"
  | "context"
  | "anleitung"
  | "short"
  | "deep"
  | "chat"
  | "models"
  | "messen"
  | "konkurrenten"
  | "unternehmen";

export function OpenSettingsButton({
  tab,
  children,
  className,
}: {
  tab: AccountDrawerTab;
  children: React.ReactNode;
  className?: string;
}) {
  function handleClick() {
    window.dispatchEvent(
      new CustomEvent("open-account-drawer", { detail: { tab } }),
    );
  }

  return (
    <button onClick={handleClick} className={className}>
      {children}
    </button>
  );
}
