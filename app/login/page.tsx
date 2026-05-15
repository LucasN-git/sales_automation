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
        <header className="mb-10">
          <h1 className="text-display">
            Sales Intelligence<span style={{ color: "var(--color-gold)" }}>.</span>
          </h1>
          <p className="mt-3 text-body text-[var(--color-near-black)]/65">
            ISP Power Systems, internes Tool. Login per Magic-Link.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-meta mb-2">e-mail</label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
              placeholder="vertrieb@isp-power-systems.de"
              disabled={status === "sending" || status === "sent"}
            />
          </div>

          <button
            type="submit"
            disabled={status === "sending" || status === "sent" || !email}
            className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
          >
            <span>{status === "sending" ? "sende" : "magic-link senden"}</span>
            <GoldDot size={6} />
          </button>

          {status === "sent" && (
            <p className="text-body-sm text-[var(--color-near-black)]/65">
              link versendet. postfach pruefen.
            </p>
          )}
          {status === "error" && (
            <p className="text-body-sm text-[var(--color-near-black)]/65">
              fehler: {errorMsg}
            </p>
          )}
        </form>

        <div className="mt-14">
          <Hairline />
          <p className="mt-4 text-meta">zugang nur fuer freigegebene adressen</p>
        </div>
      </div>
    </main>
  );
}
