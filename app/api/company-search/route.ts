import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

const PostBody = z.object({
  user_prompt: z.string().min(1).max(2000),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = PostBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: run, error: runErr } = await admin
    .from("company_search_runs")
    .insert({ user_id: user.id, status: "pending", user_prompt: parsed.data.user_prompt })
    .select("id")
    .single();
  if (runErr || !run) {
    return NextResponse.json({ error: runErr?.message ?? "run create failed" }, { status: 500 });
  }

  await inngest.send({
    name: "company.search.requested",
    data: { userId: user.id, runId: (run as { id: string }).id, userPrompt: parsed.data.user_prompt },
  });

  return NextResponse.json({ runId: (run as { id: string }).id });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("company_search_runs")
    .select("id, status, current_phase, user_prompt, candidates_total, candidates_validated, candidates_added, web_search_uses, firecrawl_credits, error_message, created_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
