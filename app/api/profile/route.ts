import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile, updateProfile } from "@/lib/profile";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const profile = await getProfile(supabase, user);
  return NextResponse.json(profile);
}

const PatchBody = z.object({
  display_name: z.string().min(1).max(120).optional(),
});

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // ensure row exists
  await getProfile(supabase, user);

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  await updateProfile(supabase, user.id, body);
  const fresh = await getProfile(supabase, user);
  return NextResponse.json(fresh);
}
