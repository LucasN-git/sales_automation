import { NextResponse } from "next/server";
import { isEmailAllowed } from "@/lib/auth-allowlist";

export async function POST(request: Request) {
  let body: { email?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  if (!isEmailAllowed(email)) {
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
