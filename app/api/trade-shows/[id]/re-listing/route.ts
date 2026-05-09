import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { tryAppendLog } from "@/lib/crawl-log";
import { CrawlPlanSchema } from "@/lib/crawl-plan";

const VALID_STRATEGIES = [
  "letter_loop",
  "show_more",
  "pagination",
  "single_page",
] as const;
const VALID_ENGINES = ["algolia_api", "browserbase", "firecrawl"] as const;

/**
 * Manual override of the cached crawl plan: swap strategy and/or engine on
 * the existing plan and trigger a fresh listing run. Used when Discovery
 * picked the wrong approach and the user wants to retry without re-running
 * the (LLM-driven) discovery pass.
 *
 * Behaviour:
 *  1. Pause any in-flight Inngest function (status='paused' kicks the next
 *     pause-check into early-return) and wait briefly for it to settle.
 *  2. Patch crawl_plan with the user override.
 *  3. Validate the merged plan against the zod schema. Strategy swaps may
 *     fail here when required fields are missing — caller should re-discover
 *     in that case.
 *  4. Wipe exhibitors (the previous listing was wrong) and reset state.
 *  5. Send a fresh trade-show.requested event. The function reuses the
 *     cached plan on next run, so Discovery is skipped entirely.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    strategy?: string;
    engine?: string;
  };

  if (body.strategy && !VALID_STRATEGIES.includes(body.strategy as never)) {
    return NextResponse.json(
      { error: `invalid strategy: ${body.strategy}` },
      { status: 400 },
    );
  }
  if (body.engine && !VALID_ENGINES.includes(body.engine as never)) {
    return NextResponse.json(
      { error: `invalid engine: ${body.engine}` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: show, error: showError } = await supabase
    .from("trade_shows")
    .select("id, status, crawl_plan")
    .eq("id", id)
    .single();
  if (showError || !show) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!show.crawl_plan) {
    return NextResponse.json(
      { error: "no plan to re-run — use re-discover instead" },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();

  // 1. Pause any active run.
  if (show.status === "crawling" || show.status === "queued") {
    await admin
      .from("trade_shows")
      .update({ status: "paused", paused_phase: "listing" })
      .eq("id", id);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // 2. Patch plan with override.
  const merged = {
    ...(show.crawl_plan as Record<string, unknown>),
    ...(body.strategy ? { strategy: body.strategy } : {}),
    ...(body.engine ? { engine: body.engine } : {}),
  };

  // 3. Validate. Strategy swaps without supplemental fields fail here.
  const parsed = CrawlPlanSchema.safeParse(merged);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "merged plan invalid — required fields missing for the new strategy. Use re-discover.",
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  // 4. Wipe stale listing data + reset state.
  const { error: delError } = await admin
    .from("exhibitors")
    .delete()
    .eq("trade_show_id", id);
  if (delError) {
    return NextResponse.json(
      { error: `cleanup failed: ${delError.message}` },
      { status: 500 },
    );
  }

  const { error: resetError } = await admin
    .from("trade_shows")
    .update({
      status: "crawling",
      current_step: null,
      paused_phase: null,
      error_message: null,
      crawl_plan: parsed.data,
      browserbase_session_seconds: 0,
    })
    .eq("id", id);
  if (resetError) {
    return NextResponse.json(
      { error: `reset failed: ${resetError.message}` },
      { status: 500 },
    );
  }

  await tryAppendLog(admin, id, {
    phase: "listing",
    level: "warn",
    message: `Re-Listing manuell — strategy: ${parsed.data.strategy}, engine: ${(parsed.data as { engine?: string }).engine ?? "firecrawl"}`,
    meta: {
      strategy: parsed.data.strategy,
      engine: (parsed.data as { engine?: string }).engine,
    },
  });

  await inngest.send({
    name: "trade-show.requested",
    data: { tradeShowId: id },
  });

  return NextResponse.json({ ok: true, plan: parsed.data });
}
