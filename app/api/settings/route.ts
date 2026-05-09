import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getSettings,
  updatePrioContext,
  updateModels,
  defaultPrioContext,
} from "@/lib/settings";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const settings = await getSettings(supabase, user.id);
  return NextResponse.json(settings);
}

const PutBody = z.object({
  prio_context: z.string().min(10).max(20_000).optional(),
  short_model: z.string().min(3).max(100).optional(),
  deep_model: z.string().min(3).max(100).optional(),
  reset: z.literal(true).optional(),
});

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // ensure row exists
  await getSettings(supabase, user.id);

  let body: z.infer<typeof PutBody>;
  try {
    body = PutBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  if (body.reset) {
    await updatePrioContext(supabase, user.id, defaultPrioContext());
  } else if (body.prio_context !== undefined) {
    await updatePrioContext(supabase, user.id, body.prio_context);
  }

  if (body.short_model || body.deep_model) {
    await updateModels(supabase, user.id, {
      short_model: body.short_model,
      deep_model: body.deep_model,
    });
  }

  const fresh = await getSettings(supabase, user.id);
  return NextResponse.json(fresh);
}
