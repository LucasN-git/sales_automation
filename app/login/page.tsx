"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Hairline } from "@/components/brand/Hairline";
import { GoldDot } from "@/components/brand/GoldDot";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setStatus("error");
      setErrorMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <header className="mb-12">
          <h1 className="text-[40px] leading-[1.05] font-extrabold tracking-[-0.02em]">
            Sales Intelligence<span style={{ color: "var(--color-gold)" }}>.</span>
          </h1>
          <p className="mt-3 text-[15px] text-[var(--color-near-black)]/70">
            ISP Power Systems, internes Tool. Login per Magic-Link.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[13px] uppercase tracking-[0.06em] mb-2">
              E-Mail
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-transparent border-0 border-b border-[var(--color-hairline-light)] py-2 text-[18px] focus:outline-none focus:border-[var(--color-near-black)]"
              placeholder="vertrieb@isp-power-systems.de"
              disabled={status === "sending" || status === "sent"}
            />
          </div>

          <button
            type="submit"
            disabled={status === "sending" || status === "sent" || !email}
            className="inline-flex items-center gap-2 px-5 py-3 text-[15px] font-bold uppercase tracking-[0.04em] bg-[var(--color-near-black)] text-[var(--color-cream)] disabled:opacity-50"
          >
            <span>{status === "sending" ? "Sende" : "Magic-Link senden"}</span>
            <GoldDot size={6} />
          </button>

          {status === "sent" && (
            <p className="text-[15px] text-[var(--color-near-black)]/70">
              Link versendet. Postfach prüfen.
            </p>
          )}
          {status === "error" && (
            <p className="text-[15px] text-[var(--color-near-black)]/70">
              Fehler: {errorMsg}
            </p>
          )}
        </form>

        <div className="mt-16">
          <Hairline />
          <p className="mt-4 text-[13px] text-[var(--color-near-black)]/50">
            Zugang nur für freigegebene Adressen.
          </p>
        </div>
      </div>
    </main>
  );
}
