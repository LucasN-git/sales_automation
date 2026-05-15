import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  status: z.enum(["suggested", "active", "archived", "rejected"]),
});

/**
 * Setzt den Kuratierungs-Status eines Competitors. Wird aus der CurateQueue
 * + dem Detail-Header aufgerufen. RLS scoped via auth.uid().
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
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

  const { id } = await context.params;

  const { data, error } = await supabase
    .from("competitors")
    .update({ status: body.status })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
