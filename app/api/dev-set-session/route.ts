import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Dev-only: sets a Supabase session from explicit token params.
// Used by the dev-login flow to bypass the OAuth redirect loop on localhost.
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not available" }, { status: 403 });
  }

  const url = new URL(request.url);
  const accessToken = url.searchParams.get("access_token");
  const refreshToken = url.searchParams.get("refresh_token");

  if (!accessToken || !refreshToken) {
    return new Response("fehlende tokens", { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    return new Response(`setSession fehlgeschlagen: ${error.message}`, { status: 500 });
  }

  return NextResponse.redirect(new URL("/", request.url));
}
