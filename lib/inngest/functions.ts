import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { scrapeCompanySite } from "@/lib/firecrawl";
import { enrichShort, enrichDeep, type ShortIntel } from "@/lib/claude";
import { discoverSiteStrategy } from "@/lib/discovery";
import { executeCrawlPlan } from "@/lib/strategies";
import { CrawlPlanSchema, type CrawlPlan } from "@/lib/crawl-plan";
import { tryAppendLog } from "@/lib/crawl-log";
import { getSettingsServiceRole, defaultPrioContext, SHORT_MODEL_DEFAULT, DEEP_MODEL_DEFAULT } from "@/lib/settings";

type StepLogEntry = { ts: string; step: string; dur_ms: number; ok: boolean };

async function appendStepLog(
  supabase: ReturnType<typeof createServiceRoleClient>,
  exhibitorId: string,
  entry: StepLogEntry,
): Promise<void> {
  // Read-modify-write; safe enough for single-user, single-row updates.
  const { data } = await supabase
    .from("exhibitors")
    .select("step_log")
    .eq("id", exhibitorId)
    .maybeSingle();
  const cur = (data?.step_log ?? []) as StepLogEntry[];
  const next = [...cur, entry].slice(-50); // keep last 50
  await supabase.from("exhibitors").update({ step_log: next }).eq("id", exhibitorId);
}

async function isPaused(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tradeShowId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("trade_shows")
    .select("status")
    .eq("id", tradeShowId)
    .maybeSingle();
  return data?.status === "paused";
}

/**
 * Step 1 of the pipeline. Triggered when the user creates a new trade show.
 * Crawls the source URL, writes exhibitor rows, then fans out one
 * `exhibitor.enrich.requested` event per exhibitor.
 */
export const crawlTradeShow = inngest.createFunction(
  {
    id: "crawl-trade-show",
    retries: 2,
  },
  { event: "trade-show.requested" },
  async ({ event, step }) => {
    const { tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    await step.run("mark-crawling", async () => {
      const { error } = await supabase
        .from("trade_shows")
        .update({ status: "crawling", current_step: "discovering", error_message: null })
        .eq("id", tradeShowId);
      if (error) throw new Error(`update status: ${error.message}`);
    });

    const show = await step.run("load-show", async () => {
      const { data, error } = await supabase
        .from("trade_shows")
        .select("id, name, source_url, crawl_plan")
        .eq("id", tradeShowId)
        .single();
      if (error || !data) throw new NonRetriableError(`show not found: ${tradeShowId}`);
      return data;
    });

    if (!show.source_url) {
      await step.run("mark-no-source", async () => {
        await supabase
          .from("trade_shows")
          .update({
            status: "ready",
            current_step: null,
            error_message: "Keine Aussteller-URL hinterlegt — Aussteller manuell pflegen.",
          })
          .eq("id", tradeShowId);
      });
      return { exhibitors: 0, reason: "no source_url" };
    }

    if (await step.run("check-paused-pre-discovery", () => isPaused(supabase, tradeShowId))) {
      await tryAppendLog(supabase, tradeShowId, { phase: "discovery", message: "Pausiert vor Discovery" });
      return { paused: true, phase: "discovery" };
    }

    // Phase 00: Discovery (skip if a plan is already cached on this trade-show)
    const plan: CrawlPlan = await step.run("discover-site-strategy", async () => {
      if (show.crawl_plan) {
        const reused = CrawlPlanSchema.safeParse(show.crawl_plan);
        if (reused.success) {
          await tryAppendLog(supabase, tradeShowId, {
            phase: "discovery",
            message: `Plan aus Cache wiederverwendet (${reused.data.strategy})`,
          });
          return reused.data;
        }
      }
      await tryAppendLog(supabase, tradeShowId, {
        phase: "discovery",
        message: "Site wird analysiert (Firecrawl + Claude)",
      });

      const result = await discoverSiteStrategy(show.source_url!);

      // Save plan + expected count
      await supabase
        .from("trade_shows")
        .update({
          crawl_plan: result.plan,
          discovery_log: result.log,
          expected_exhibitor_count: result.expectedTotalCount ?? null,
        })
        .eq("id", tradeShowId);

      // Trace: Prompt-Preview (separate log line, expandable in UI)
      await tryAppendLog(supabase, tradeShowId, {
        phase: "discovery",
        message: "Discovery-Prompt an Claude",
        meta: { prompt: result.promptPreview },
      });

      // Trace: Response with full plan + expected count
      await tryAppendLog(supabase, tradeShowId, {
        phase: "discovery",
        message: `Plan: ${result.plan.strategy}${
          result.expectedTotalCount ? ` (erwartet ${result.expectedTotalCount} Aussteller)` : ""
        }`,
        meta: {
          plan: result.plan,
          expected_total_count: result.expectedTotalCount,
          response: result.responseRaw,
        },
      });

      return result.plan;
    });

    if (await step.run("check-paused-pre-listing", () => isPaused(supabase, tradeShowId))) {
      await tryAppendLog(supabase, tradeShowId, { phase: "listing", message: "Pausiert vor Listing" });
      return { paused: true, phase: "listing" };
    }

    await step.run("mark-listing", async () => {
      await supabase
        .from("trade_shows")
        .update({ current_step: `listing:${plan.strategy}` })
        .eq("id", tradeShowId);
    });

    const planResult = await step.run("execute-crawl-plan", async () => {
      return await executeCrawlPlan(plan, async (sub, meta) => {
        await supabase
          .from("trade_shows")
          .update({ current_step: `listing:${plan.strategy}:${sub}` })
          .eq("id", tradeShowId);
        const message = (meta?.message as string | undefined) ?? sub;
        const interesting =
          !!meta || sub.includes("_done") || sub.includes("count_");
        if (interesting) {
          await tryAppendLog(supabase, tradeShowId, {
            phase: "listing",
            message,
            meta: meta ?? undefined,
          });
        }
      });
    });
    const listing = planResult.exhibitors;

    if (planResult.browserSec > 0) {
      await step.run("persist-browser-seconds", async () => {
        await supabase
          .from("trade_shows")
          .update({ browserbase_session_seconds: planResult.browserSec })
          .eq("id", tradeShowId);
        await tryAppendLog(supabase, tradeShowId, {
          phase: "listing",
          message: `Browser-Session-Zeit: ${planResult.browserSec}s`,
          meta: { browser_seconds: planResult.browserSec },
        });
      });
    }

    if (listing.length === 0) {
      await step.run("mark-empty", async () => {
        await supabase
          .from("trade_shows")
          .update({
            status: "failed",
            current_step: null,
            error_message: "Aussteller-Liste konnte nicht extrahiert werden.",
          })
          .eq("id", tradeShowId);
      });
      return { exhibitors: 0, reason: "empty listing" };
    }

    await step.run("mark-inserting", async () => {
      await supabase
        .from("trade_shows")
        .update({ current_step: "inserting_exhibitors" })
        .eq("id", tradeShowId);
    });

    const inserted = await step.run("insert-exhibitors", async () => {
      const rows = listing.map((e) => ({
        trade_show_id: tradeShowId,
        company_name: e.name,
        website: e.website,
        booth: e.booth,
        listing_raw: e as unknown as Record<string, unknown>,
      }));
      const { data, error } = await supabase
        .from("exhibitors")
        .upsert(rows, { onConflict: "trade_show_id,company_name", ignoreDuplicates: false })
        .select("id");
      if (error) throw new Error(`insert exhibitors: ${error.message}`);
      return data ?? [];
    });

    if (await step.run("check-paused-pre-finalize", () => isPaused(supabase, tradeShowId))) {
      await tryAppendLog(supabase, tradeShowId, {
        phase: "listing",
        message: `Listing-Daten gespeichert (${inserted.length}), dann pausiert`,
      });
      return { paused: true, phase: "listing", exhibitors: inserted.length };
    }

    await step.run("mark-listing-ready", async () => {
      await supabase
        .from("trade_shows")
        .update({ status: "ready", current_step: null })
        .eq("id", tradeShowId);
      await tryAppendLog(supabase, tradeShowId, {
        phase: "listing",
        message: `Listing fertig: ${inserted.length} Aussteller`,
      });

      // Total-count verification (Phase 3)
      const { data: showRow } = await supabase
        .from("trade_shows")
        .select("expected_exhibitor_count")
        .eq("id", tradeShowId)
        .maybeSingle();
      const expected = showRow?.expected_exhibitor_count ?? null;
      if (expected && expected > 0) {
        const found = inserted.length;
        const diff = Math.abs(expected - found);
        const pct = diff / expected;
        if (pct > 0.05) {
          await tryAppendLog(supabase, tradeShowId, {
            phase: "listing",
            level: "warn",
            message: `Mismatch: erwartet ~${expected}, gefunden ${found} (${Math.round(pct * 100)}% Differenz)`,
            meta: { expected, found, diff },
          });
        } else {
          await tryAppendLog(supabase, tradeShowId, {
            phase: "listing",
            message: `Vollstaendigkeit OK: ${found}/${expected} (${Math.round((1 - pct) * 100)}%)`,
            meta: { expected, found },
          });
        }
      }
    });

    return { exhibitors: inserted.length };
  },
);

// ---------- Bulk-Trigger fuer Short-Overviews ----------

export const shortOverviewBulk = inngest.createFunction(
  { id: "short-overview-bulk", retries: 1 },
  { event: "short-overview.bulk-requested" },
  async ({ event, step }) => {
    const { tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    if (await step.run("check-paused", () => isPaused(supabase, tradeShowId))) {
      return { paused: true };
    }

    const targets = await step.run("collect-pending", async () => {
      const { data } = await supabase
        .from("exhibitors")
        .select("id")
        .eq("trade_show_id", tradeShowId)
        .in("short_status", ["pending", "failed"]);
      return data ?? [];
    });

    await tryAppendLog(supabase, tradeShowId, {
      phase: "short",
      message: `Bulk-Short fuer ${targets.length} Aussteller startet`,
    });

    if (targets.length === 0) return { fanned_out: 0 };

    await step.sendEvent(
      "fan-out-short",
      targets.map((row) => ({
        name: "exhibitor.short.requested" as const,
        data: { exhibitorId: row.id, tradeShowId },
      })),
    );

    return { fanned_out: targets.length };
  },
);

// ---------- Per-Aussteller Short-Overview ----------

export const exhibitorShort = inngest.createFunction(
  {
    id: "exhibitor-short",
    concurrency: { limit: 5 },
    throttle: { limit: 30, period: "1m" },
    retries: 4,
    onFailure: async ({ event, error }) => {
      const supabase = createServiceRoleClient();
      const data = (event.data as any).event?.data ?? event.data;
      const exhibitorId = data.exhibitorId;
      if (exhibitorId) {
        await supabase
          .from("exhibitors")
          .update({ short_status: "failed", current_step: null })
          .eq("id", exhibitorId);
        await appendStepLog(supabase, exhibitorId, {
          ts: new Date().toISOString(),
          step: "short_failed",
          dur_ms: 0,
          ok: false,
        });
      }
    },
  },
  { event: "exhibitor.short.requested" },
  async ({ event, step }) => {
    const { exhibitorId, tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    if (await step.run("check-paused", () => isPaused(supabase, tradeShowId))) {
      return { paused: true };
    }

    const exhibitor = await step.run("load-exhibitor", async () => {
      const { data, error } = await supabase
        .from("exhibitors")
        .select("id, company_name, website")
        .eq("id", exhibitorId)
        .single();
      if (error || !data) throw new NonRetriableError(`exhibitor not found: ${exhibitorId}`);
      return data;
    });

    const settings = await step.run("load-settings", async () => {
      const s = await getSettingsServiceRole(supabase);
      return {
        prio_context: s?.prio_context ?? defaultPrioContext(),
        model: s?.short_model ?? SHORT_MODEL_DEFAULT,
      };
    });

    await step.run("mark-scraping", async () => {
      await supabase
        .from("exhibitors")
        .update({ short_status: "running", current_step: "scraping" })
        .eq("id", exhibitorId);
    });

    const scrapeStart = Date.now();
    const markdown = await step.run("scrape-company-site", async () => {
      if (!exhibitor.website) return "";
      return await scrapeCompanySite(exhibitor.website);
    });
    await step.run("log-scrape", async () => {
      await appendStepLog(supabase, exhibitorId, {
        ts: new Date().toISOString(),
        step: "short_scrape",
        dur_ms: Date.now() - scrapeStart,
        ok: true,
      });
    });

    await step.run("mark-analyzing", async () => {
      await supabase
        .from("exhibitors")
        .update({ current_step: "analyzing" })
        .eq("id", exhibitorId);
    });

    const claudeStart = Date.now();
    const result = await step.run("claude-short", async () => {
      return await enrichShort({
        companyName: exhibitor.company_name,
        website: exhibitor.website,
        scrapedMarkdown: markdown,
        prioContext: settings.prio_context,
        model: settings.model,
      });
    });

    await step.run("upsert-short", async () => {
      const { error: shortError } = await supabase.from("exhibitor_short").upsert(
        {
          exhibitor_id: exhibitorId,
          one_liner: result.intel.one_liner,
          priority_label: result.intel.priority_label,
          match_confidence: result.intel.match_confidence,
          isp_sector_match: result.intel.isp_sector_match,
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
        },
        { onConflict: "exhibitor_id" },
      );
      if (shortError) throw new Error(`upsert short: ${shortError.message}`);

      await supabase
        .from("exhibitors")
        .update({ short_status: "done", current_step: null })
        .eq("id", exhibitorId);

      await appendStepLog(supabase, exhibitorId, {
        ts: new Date().toISOString(),
        step: "short_claude",
        dur_ms: Date.now() - claudeStart,
        ok: true,
      });

      await tryAppendLog(supabase, tradeShowId, {
        phase: "short",
        message: `${exhibitor.company_name}: ${result.intel.priority_label} / confidence ${result.intel.match_confidence}`,
        meta: {
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
        },
      });
    });

    return {
      ok: true,
      priority: result.intel.priority_label,
      confidence: result.intel.match_confidence,
    };
  },
);

// ---------- Per-Aussteller Deep-Dive ----------

export const exhibitorDeep = inngest.createFunction(
  {
    id: "exhibitor-deep",
    concurrency: { limit: 3 },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const supabase = createServiceRoleClient();
      const data = (event.data as any).event?.data ?? event.data;
      const exhibitorId = data.exhibitorId;
      if (exhibitorId) {
        await supabase
          .from("exhibitors")
          .update({ deep_status: "failed", current_step: null })
          .eq("id", exhibitorId);
      }
    },
  },
  { event: "exhibitor.deep.requested" },
  async ({ event, step }) => {
    const { exhibitorId, tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    if (await step.run("check-paused", () => isPaused(supabase, tradeShowId))) {
      return { paused: true };
    }

    const exhibitor = await step.run("load-exhibitor", async () => {
      const { data, error } = await supabase
        .from("exhibitors")
        .select("id, company_name, website, exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match)")
        .eq("id", exhibitorId)
        .single();
      if (error || !data) throw new NonRetriableError(`exhibitor not found: ${exhibitorId}`);
      return data;
    });

    const shortContext: ShortIntel | null = exhibitor.exhibitor_short
      ? {
          one_liner: (exhibitor.exhibitor_short as any).one_liner,
          priority_label: (exhibitor.exhibitor_short as any).priority_label,
          match_confidence: (exhibitor.exhibitor_short as any).match_confidence,
          isp_sector_match: (exhibitor.exhibitor_short as any).isp_sector_match ?? [],
        }
      : null;

    const settings = await step.run("load-settings", async () => {
      const s = await getSettingsServiceRole(supabase);
      return {
        prio_context: s?.prio_context ?? defaultPrioContext(),
        model: s?.deep_model ?? DEEP_MODEL_DEFAULT,
      };
    });

    await step.run("mark-scraping", async () => {
      await supabase
        .from("exhibitors")
        .update({ deep_status: "running", current_step: "deep_scraping" })
        .eq("id", exhibitorId);
    });

    const scrapeStart = Date.now();
    const markdown = await step.run("scrape-company-site", async () => {
      if (!exhibitor.website) return "";
      return await scrapeCompanySite(exhibitor.website);
    });
    await step.run("log-scrape", async () => {
      await appendStepLog(supabase, exhibitorId, {
        ts: new Date().toISOString(),
        step: "deep_scrape",
        dur_ms: Date.now() - scrapeStart,
        ok: true,
      });
    });

    await step.run("mark-analyzing", async () => {
      await supabase
        .from("exhibitors")
        .update({ current_step: "deep_analyzing" })
        .eq("id", exhibitorId);
    });

    const claudeStart = Date.now();
    const result = await step.run("claude-deep", async () => {
      return await enrichDeep({
        companyName: exhibitor.company_name,
        website: exhibitor.website,
        scrapedMarkdown: markdown,
        prioContext: settings.prio_context,
        model: settings.model,
        shortContext,
      });
    });

    await step.run("upsert-deep", async () => {
      const { error: deepError } = await supabase.from("exhibitor_deep").upsert(
        {
          exhibitor_id: exhibitorId,
          business_summary: result.intel.business_summary,
          decision_makers: result.intel.decision_makers,
          recent_news: result.intel.recent_news,
          technical_pain_points: result.intel.technical_pain_points,
          opening_questions: result.intel.opening_questions,
          competition_context: result.intel.competition_context,
          isp_lifecycle_match: result.intel.isp_lifecycle_match,
          full_reasoning: result.intel.full_reasoning,
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
        },
        { onConflict: "exhibitor_id" },
      );
      if (deepError) throw new Error(`upsert deep: ${deepError.message}`);

      await supabase
        .from("exhibitors")
        .update({ deep_status: "done", current_step: null })
        .eq("id", exhibitorId);

      await appendStepLog(supabase, exhibitorId, {
        ts: new Date().toISOString(),
        step: "deep_claude",
        dur_ms: Date.now() - claudeStart,
        ok: true,
      });

      await tryAppendLog(supabase, tradeShowId, {
        phase: "deep",
        message: `${exhibitor.company_name}: Deep-Dive fertig`,
        meta: {
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
        },
      });
    });

    return { ok: true };
  },
);

export const functions = [
  crawlTradeShow,
  shortOverviewBulk,
  exhibitorShort,
  exhibitorDeep,
];
