import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

const Body = z.object({
  name: z.string().min(2).max(200),
  source_url: z.string().url().nullable().optional(),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
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
  } catch (err) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("trade_shows")
    .insert({
      user_id: user.id,
      name: body.name,
      source_url: body.source_url ?? null,
      year: body.year ?? null,
      status: "queued",
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  await inngest.send({
    name: "trade-show.requested",
    data: { tradeShowId: data.id },
  });

  return NextResponse.json({ id: data.id });
}
