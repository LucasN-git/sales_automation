import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  company_name: z.string().min(1).max(300),
  website: z.string().url().nullable().optional(),
  booth: z.string().max(100).nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: showId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Show ownership via RLS
  const { data: show } = await supabase
    .from("trade_shows")
    .select("id")
    .eq("id", showId)
    .single();
  if (!show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("exhibitors")
    .insert({
      trade_show_id: showId,
      company_name: body.company_name,
      website: body.website ?? null,
      booth: body.booth ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "insert failed" }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}
