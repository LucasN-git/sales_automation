import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getSession() reads + decodes the JWT cookie locally (no Supabase round-trip).
  // The actual user validation happens in Server Components (layouts call getUser()).
  // Saves ~150-400ms per navigation.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/inngest") ||
    path.startsWith("/api/dev-login") ||
    path.startsWith("/api/dev-auto-login") ||
    path.startsWith("/api/dev-set-session") ||
    path.startsWith("/_next") ||
    path === "/favicon.ico";

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    const devBypass =
      process.env.DEV_BYPASS_AUTH === "true" && process.env.NODE_ENV !== "production";
    if (devBypass) {
      url.pathname = "/api/dev-auto-login";
      url.searchParams.set("next", path);
    } else if (process.env.NODE_ENV === "development") {
      url.pathname = "/api/dev-login";
    } else {
      url.pathname = "/login";
    }
    return NextResponse.redirect(url);
  }

  return response;
}
