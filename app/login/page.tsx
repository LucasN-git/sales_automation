"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Hairline } from "@/components/brand/Hairline";
import { GoldDot } from "@/components/brand/GoldDot";

function callbackErrorMessage(code: string | null): string | null {
  switch (code) {
    case "not_allowed":
      return "diese e-mail ist nicht freigegeben. bei lucas melden, um den zugang einzurichten.";
    case "exchange":
      return "der magic-link ist abgelaufen oder ungueltig. bitte neuen link anfordern.";
    case null:
    case "":
      return null;
    default:
      return "anmeldung fehlgeschlagen. bitte neuen link anfordern.";
  }
}

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = callbackErrorMessage(searchParams.get("error"));

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    try {
      const check = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!check.ok) {
        const data = (await check.json().catch(() => ({}))) as { error?: string };
        setStatus("error");
        if (check.status === 403 || data.error === "not_allowed") {
          setErrorMsg("diese e-mail ist nicht freigegeben.");
        } else if (data.error === "invalid_email") {
          setErrorMsg("bitte eine gueltige e-mail eingeben.");
        } else {
          setErrorMsg(data.error || "anmeldung fehlgeschlagen.");
        }
        return;
      }

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
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "netzwerkfehler.");
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

        {callbackError && status !== "sent" && (
          <div
            className="mb-6 px-4 py-3 border text-body-sm"
            style={{
              borderColor: "var(--color-error)",
              color: "var(--color-error)",
              background: "rgba(220,38,38,0.05)",
            }}
          >
            {callbackError}
          </div>
        )}

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
            <p className="text-body-sm" style={{ color: "var(--color-error)" }}>
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

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
