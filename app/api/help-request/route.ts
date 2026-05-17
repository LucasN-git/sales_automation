import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const HELP_TO = "nasch.lucas@gmail.com";
const HELP_FROM = process.env.EMAIL_FROM ?? "noreply@isp-powersystems.com";

const Body = z.object({
  source: z.enum(["show", "competitors", "show-discovery"]),
  label: z.string().min(1).max(200),
  route: z.string().min(1).max(500),
  context: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "RESEND_API_KEY not configured" },
      { status: 500 },
    );
  }

  const sourceLabel: Record<typeof body.source, string> = {
    "show": "Messen-Crawling",
    "competitors": "Konkurrenten-Analyse",
    "show-discovery": "Messen-Suche",
  };

  const ts = new Date().toLocaleString("de-DE", {
    dateStyle: "full",
    timeStyle: "medium",
    timeZone: "Europe/Berlin",
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const fullUrl = appUrl ? `${appUrl}${body.route}` : body.route;

  const subject = `[ISP Sales] Hilfe angefordert . ${sourceLabel[body.source]} . ${body.label}`;

  const lines = [
    `Bereich: ${sourceLabel[body.source]}`,
    `Seite: ${body.label}`,
    `Route: ${body.route}`,
    appUrl ? `Link: ${fullUrl}` : null,
    `User: ${user.email ?? user.id}`,
    `Zeit: ${ts}`,
    body.context ? `\nKontext:\n${body.context}` : null,
  ].filter(Boolean);

  const text = lines.join("\n");
  const html = `<pre style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#0A0A0A;white-space:pre-wrap;">${escapeHtml(
    text,
  )}</pre>`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: HELP_FROM,
      to: HELP_TO,
      reply_to: user.email ?? undefined,
      subject,
      text,
      html,
    }),
  });

  if (!resendRes.ok) {
    const responseText = await resendRes.text().catch(() => "");
    return NextResponse.json(
      {
        error: "Mail-Versand fehlgeschlagen.",
        status: resendRes.status,
        details: responseText.slice(0, 500),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
