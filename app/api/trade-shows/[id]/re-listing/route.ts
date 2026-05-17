import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { tryAppendLog } from "@/lib/crawl-log";
import { CrawlPlanSchema } from "@/lib/crawl-plan";
import { notifyOrchestratorThread } from "@/lib/chat-notify";

const VALID_STRATEGIES = [
  "letter_loop",
  "show_more",
  "pagination",
  "single_page",
] as const;
const VALID_ENGINES = [
  "algolia_api",
  "browserbase",
  "firecrawl",
  "dimedis_api",
  "mapyourshow_api",
  "expofp_api",
] as const;

/**
 * Manual override of the cached crawl plan and trigger a fresh listing run.
 * Used when Discovery picked the wrong approach and the user wants to retry
 * without re-running the (LLM-driven) discovery pass.
 *
 * Two override modes:
 *  - "shallow" — body has `strategy` and/or `engine`. Other plan fields are
 *    inherited from the cached plan. Fast path; works only when the new
 *    strategy needs no extra required fields beyond what the old plan had.
 *  - "full"    — body has `plan` (a complete CrawlPlan object). Replaces the
 *    cached plan entirely. Required when switching strategies that need
 *    additional fields (e.g. single_page → pagination needs page_url_template).
 *
 * Behaviour in both modes:
 *  1. Pause any in-flight Inngest function (status='paused' kicks the next
 *     pause-check into early-return) and wait briefly for it to settle.
 *  2. Build the candidate plan (merged for shallow, replaced for full).
 *  3. Validate against the zod schema. Strategy swaps may fail here when
 *     required fields are missing — caller should switch to full-mode in that
 *     case (or re-discover).
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
    plan?: unknown;
  };

  const fullOverride =
    body.plan !== undefined && body.plan !== null && typeof body.plan === "object";

  if (!fullOverride && body.strategy && !VALID_STRATEGIES.includes(body.strategy as never)) {
    return NextResponse.json(
      { error: `invalid strategy: ${body.strategy}` },
      { status: 400 },
    );
  }
  if (!fullOverride && body.engine && !VALID_ENGINES.includes(body.engine as never)) {
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
      { error: "no plan to re-run, use re-discover instead" },
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

  // 2. Build candidate plan. Full-override replaces; shallow merges.
  const candidate = fullOverride
    ? (body.plan as Record<string, unknown>)
    : {
        ...(show.crawl_plan as Record<string, unknown>),
        ...(body.strategy ? { strategy: body.strategy } : {}),
        ...(body.engine ? { engine: body.engine } : {}),
      };

  // 3. Validate. In shallow mode, strategy swaps without supplemental fields
  // fail here — caller should retry with a full plan or re-discover.
  const parsed = CrawlPlanSchema.safeParse(candidate);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: fullOverride
          ? "plan invalid, see details"
          : "merged plan invalid: required fields missing for the new strategy. Use full plan override or re-discover.",
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
    message: `Re-Listing manuell (${fullOverride ? "full plan" : "shallow"}) — strategy: ${parsed.data.strategy}, engine: ${(parsed.data as { engine?: string }).engine ?? "firecrawl"}`,
    meta: {
      strategy: parsed.data.strategy,
      engine: (parsed.data as { engine?: string }).engine,
      mode: fullOverride ? "full" : "shallow",
    },
  });

  await inngest.send({
    name: "trade-show.requested",
    data: { tradeShowId: id },
  });

  const engine = (parsed.data as { engine?: string }).engine ?? "firecrawl";
  await notifyOrchestratorThread(
    supabase,
    id,
    user.id,
    `Re-Listing manuell gestartet (${parsed.data.strategy} / ${engine}) — per UI. Alle bisherigen Aussteller geloescht.`,
    "trigger_listing",
    { mode: fullOverride ? "full" : "shallow", strategy: parsed.data.strategy, engine },
  );

  return NextResponse.json({ ok: true, plan: parsed.data });
}
