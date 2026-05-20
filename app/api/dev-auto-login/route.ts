import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

const DEV_PASSWORD = "dev-local-bypass-isp-sales";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || process.env.DEV_BYPASS_AUTH !== "true") {
    return NextResponse.json({ error: "not available" }, { status: 403 });
  }

  const email = process.env.ALLOWED_EMAILS?.split(",")[0]?.trim();
  if (!email) {
    return new Response("ALLOWED_EMAILS nicht in .env.local gesetzt", { status: 500 });
  }

  const admin = createServiceRoleClient();

  // User anlegen wenn nicht vorhanden, sonst Passwort aktualisieren
  const { data: created } = await admin.auth.admin.createUser({
    email,
    password: DEV_PASSWORD,
    email_confirm: true,
  });

  if (!created?.user) {
    const { data: list } = await admin.auth.admin.listUsers();
    const existing = list?.users.find((u) => u.email === email);
    if (existing?.id) {
      await admin.auth.admin.updateUserById(existing.id, {
        password: DEV_PASSWORD,
        email_confirm: true,
      });
    }
  }

  // SSR-Client setzt Session-Cookies automatisch via next/headers
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: DEV_PASSWORD });

  if (error) {
    return new Response(`dev-auto-login fehlgeschlagen: ${error.message}`, { status: 500 });
  }

  const next = new URL(request.url).searchParams.get("next") ?? "/";
  return NextResponse.redirect(new URL(next, request.url));
}
