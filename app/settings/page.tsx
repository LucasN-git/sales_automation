import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { Hairline } from "@/components/brand/Hairline";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }
  const settings = await getSettings(supabase, user.id);

  return (
    <main className="min-h-screen px-8 py-12 max-w-3xl mx-auto">
      <div className="mb-6 text-meta">
        <Link href="/" className="hover:text-[var(--color-gold)] transition-colors">
          ← Sales Intelligence
        </Link>
      </div>

      <header className="mb-10">
        <h1 className="text-display">
          Einstellungen<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-2xl">
          Der Prio-Kontext geht als gecachter System-Prompt-Block in jeden Match-Call. Aenderungen wirken ab dem naechsten Crawl-Lauf.
        </p>
      </header>

      <Hairline />

      <SettingsForm initial={settings} />

      <footer className="mt-14">
        <Hairline />
        <p className="mt-5 text-body-sm text-[var(--color-near-black)]/55">
          default-kontext wird beim ersten login auto-generiert aus dem brand-doc (ISP_Power_Systems_Brand.md, sektoren + lifecycle + differentiators). manueller reset jederzeit moeglich.
        </p>
      </footer>
    </main>
  );
}
