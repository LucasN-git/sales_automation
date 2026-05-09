import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=exchange", url.origin));
    }

    const allowed = (process.env.ALLOWED_EMAIL ?? "").trim().toLowerCase();
    const { data: { user } } = await supabase.auth.getUser();
    if (allowed && user?.email?.toLowerCase() !== allowed) {
      await supabase.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=not_allowed", url.origin));
    }
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
