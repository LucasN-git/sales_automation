import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ISP Sales Intelligence",
  description: "Messe-Aussteller-Recherche und ISP-Capability-Match.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-[var(--color-cream)] text-[var(--color-near-black)]">
        {children}
      </body>
    </html>
  );
}
