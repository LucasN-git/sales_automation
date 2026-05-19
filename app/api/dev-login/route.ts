import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Dev-only auto-login: generates a magic link via admin API and redirects to it.
// Only active when NODE_ENV === 'development'. Returns 403 in production.
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not available" }, { status: 403 });
  }

  const email = process.env.ALLOWED_EMAILS?.split(",")[0]?.trim();
  if (!email) {
    return new Response(
      "ALLOWED_EMAILS not configured in .env.local",
      { status: 500 },
    );
  }

  const supabase = createServiceRoleClient();
  const origin = new URL(request.url).origin;

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: {
      redirectTo: `${origin}/auth/callback?next=/`,
    },
  });

  if (error || !data?.properties?.action_link) {
    return new Response(
      `dev-login fehlgeschlagen: ${error?.message ?? "kein action_link"}`,
      { status: 500 },
    );
  }

  return NextResponse.redirect(data.properties.action_link);
}
