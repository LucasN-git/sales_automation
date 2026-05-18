import { z } from "zod";
import { NonRetriableError } from "inngest";
import { revalidateTag } from "next/cache";
import { inngest } from "./client";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { showExhibitorsTag, exhibitorIntelTag } from "@/lib/show-cache";
import { scrapeCompanySite, scrapeShowSite } from "@/lib/firecrawl";
import {
  enrichShort,
  enrichDeep,
  searchCompanyUrl,
  searchTradeShowExhibitorUrl,
  discoverCompetitors,
  discoverShows,
  DiscoveryNoSubmitError,
  SHOW_DISCOVERY_MODEL,
  type ShortIntel,
} from "@/lib/claude";
import { discoverSiteStrategy } from "@/lib/discovery";
import { executeCrawlPlan } from "@/lib/strategies";
import { isEngineApiError } from "@/lib/strategies/errors";
import { CrawlPlanSchema, type CrawlPlan } from "@/lib/crawl-plan";
import { tryAppendLog } from "@/lib/crawl-log";
import { tryAppendDiscoveryLog, tryAppendCompetitorLog } from "@/lib/competitor-log";
import { enrichCompetitorShort } from "@/lib/competitor-short";
import { tryAppendShowDiscoveryLog } from "@/lib/show-discovery-log";
import {
  getSettingsServiceRole,
  defaultPrioContext,
  SHORT_MODEL_DEFAULT,
  DEEP_MODEL_DEFAULT,
  effectiveCompetitorDiscovery,
  effectiveShowDiscovery,
} from "@/lib/settings";
import { ensureCompany } from "@/lib/companies";
import { persistDiscoveryBatch } from "@/lib/competitors/match";
import { priceForWebSearch } from "@/lib/pricing";

type StepLogEntry = { ts: string; step: string; dur_ms: number; ok: boolean };

async function postToOrchestratorThread(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tradeShowId: string,
  content: string,
): Promise<void> {
  // user_id muss mit rein: chat_messages.user_id ist NOT NULL (0010) und die
  // RLS-Policy "chat_messages_owner_all" filtert auf user_id = auth.uid().
  // Service-Role-Insert ohne user_id => entweder NOT-NULL-Fehler oder (frueher)
  // unsichtbar fuer den eigentlichen Besitzer.
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id, user_id")
    .eq("trade_show_id", tradeShowId)
    .is("exhibitor_focus", null)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!thread) return;
  const now = new Date().toISOString();
  await supabase.from("chat_messages").insert({
    trade_show_id: tradeShowId,
    user_id: thread.user_id,
    thread_id: thread.id,
    role: "assistant",
    content,
  });
  await supabase.from("chat_threads").update({ last_message_at: now }).eq("id", thread.id);
}

// Bulk-Short-Notification mit atomic claim. concurrency=5 + throttle bedeutet,
// dass mehrere Worker fast gleichzeitig den letzten Aussteller abschliessen
// koennen. Der UPDATE ... WHERE short_bulk_notified_at IS NULL gewinnt
// atomar fuer genau einen Worker; alle anderen sehen empty.select und skippen.
async function notifyShortBulkIfDone(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tradeShowId: string,
): Promise<void> {
  const { count: pendingCount } = await supabase
    .from("exhibitors")
    .select("id", { count: "exact", head: true })
    .eq("trade_show_id", tradeShowId)
    .in("short_status", ["pending", "running"]);
  if ((pendingCount ?? 0) > 0) return;

  const { data: claimed } = await supabase
    .from("trade_shows")
    .update({ short_bulk_notified_at: new Date().toISOString() })
    .eq("id", tradeShowId)
    .is("short_bulk_notified_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) return;

  const { data: shorts } = await supabase
    .from("exhibitor_short")
    .select("priority_label, exhibitors!inner(trade_show_id)")
    .eq("exhibitors.trade_show_id", tradeShowId);
  const rows = (shorts ?? []) as Array<{ priority_label: string | null }>;
  const total = rows.length;
  const hoch = rows.filter((r) => r.priority_label === "hoch").length;
  const mittel = rows.filter((r) => r.priority_label === "mittel").length;
  const niedrig = rows.filter((r) => r.priority_label === "niedrig").length;
  const { count: failedCount } = await supabase
    .from("exhibitors")
    .select("id", { count: "exact", head: true })
    .eq("trade_show_id", tradeShowId)
    .eq("short_status", "failed");
  const failedSuffix = (failedCount ?? 0) > 0 ? ` ${failedCount} fehlgeschlagen.` : "";

  await postToOrchestratorThread(
    supabase,
    tradeShowId,
    `Short-Overview fertig: ${total} Aussteller analysiert (${hoch} hoch, ${mittel} mittel, ${niedrig} niedrig).${failedSuffix} Wenn du tiefer in einzelne Aussteller einsteigen willst, kann ich Deep-Dives starten.`,
  );
}

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
    onFailure: async ({ event, error }) => {
      const supabase = createServiceRoleClient();
      const data = (event.data as any).event?.data ?? event.data;
      const tradeShowId = data.tradeShowId;
      if (tradeShowId) {
        const msg = error instanceof Error ? error.message : String(error);
        await supabase
          .from("trade_shows")
          .update({ status: "failed", current_step: null, error_message: msg.slice(0, 500) })
          .eq("id", tradeShowId);
        await tryAppendLog(supabase, tradeShowId, {
          phase: "discovery",
          level: "error",
          message: `Pipeline fehlgeschlagen: ${msg.slice(0, 500)}`,
        });
        await postToOrchestratorThread(
          supabase,
          tradeShowId,
          `Pipeline fehlgeschlagen: ${msg.slice(0, 200)}. Pruefe das Log oder starte einen neuen Versuch.`,
        );
      }
    },
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

      let result: Awaited<ReturnType<typeof discoverSiteStrategy>>;
      try {
        result = await discoverSiteStrategy(show.source_url!);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await tryAppendLog(supabase, tradeShowId, {
          phase: "discovery",
          level: "error",
          message: `Discovery fehlgeschlagen: ${msg.slice(0, 500)}`,
        });
        throw err;
      }

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
      try {
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
      } catch (err) {
        if (isEngineApiError(err)) {
          throw new NonRetriableError(err.userMessage);
        }
        throw err;
      }
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
      // Need user_id for ensureCompany (RLS-bypass via service-role,
      // but we still scope companies per user).
      const { data: tsRow, error: tsErr } = await supabase
        .from("trade_shows")
        .select("user_id")
        .eq("id", tradeShowId)
        .single();
      if (tsErr || !tsRow) throw new Error(`load trade_show: ${tsErr?.message ?? "not found"}`);
      const userId = (tsRow as { user_id: string }).user_id;

      const rows: Array<Record<string, unknown>> = [];
      for (const e of listing) {
        const companyId = await ensureCompany(supabase, userId, e.name, e.website ?? null);
        rows.push({
          trade_show_id: tradeShowId,
          company_id: companyId,
          company_name: e.name,
          website: e.website,
          booth: e.booth,
          listing_raw: e as unknown as Record<string, unknown>,
          profile_url: e.profile_url ?? null,
          profile_data: e.profile_data ?? null,
          // Anything with a profile_url is a candidate for the Firecrawl scrape.
          // Idle = no URL or already enriched at source.
          profile_enrich_status: e.profile_url ? "pending" : "idle",
          // Exhibitors without a website need URL-search before Short can run.
          url_search_status: e.website ? "skipped" : "pending",
        });
      }
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
      await postToOrchestratorThread(
        supabase,
        tradeShowId,
        `Listing abgeschlossen: ${inserted.length} Aussteller gefunden${
          expected ? ` (${Math.round((inserted.length / expected) * 100)}% der erwarteten ${expected})` : ""
        }. Pre-Filter laeuft automatisch im Hintergrund. Danach kannst du den Short-Overview starten.`,
      );
    });

    // Auto-trigger profile-enrich for any newly-inserted rows that have a
    // profile_url. The bulk-fanout function takes the snapshot of pending
    // rows from the DB itself, so we just send one event per show.
    await step.run("trigger-profile-enrich", async () => {
      const { count } = await supabase
        .from("exhibitors")
        .select("id", { count: "exact", head: true })
        .eq("trade_show_id", tradeShowId)
        .eq("profile_enrich_status", "pending");
      if ((count ?? 0) > 0) {
        await tryAppendLog(supabase, tradeShowId, {
          phase: "profile_enrich",
          message: `Profile-Enrich queued fuer ${count} Aussteller`,
        });
        await inngest.send({
          name: "profile-enrich.bulk-requested",
          data: { tradeShowId },
        });
      }
    });

    await step.run("trigger-pre-filter", async () => {
      await inngest.send({
        name: "pre-filter.bulk-requested",
        data: { tradeShowId },
      });
      await tryAppendLog(supabase, tradeShowId, {
        phase: "pre_filter",
        message: "Pre-Filter gestartet (laeuft automatisch im Hintergrund)",
      });
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

    // Notification-Flag fuer diesen Bulk-Lauf zuruecksetzen, damit
    // notifyShortBulkIfDone am Ende den atomic claim gewinnen kann.
    await step.run("reset-notify-flag", async () => {
      await supabase
        .from("trade_shows")
        .update({ short_bulk_notified_at: null })
        .eq("id", tradeShowId);
    });

    const targets = await step.run("collect-pending", async () => {
      const { data } = await supabase
        .from("exhibitors")
        .select("id, url_search_status")
        .eq("trade_show_id", tradeShowId)
        .in("short_status", ["pending", "failed"])
        .not("pre_filter_status", "eq", "filtered_out");
      return data ?? [];
    });

    // Exhibitors without website need URL-search first.
    // url_search_status 'skipped' = had website from listing.
    // url_search_status 'done' = URL found via search, ready for Short.
    // url_search_status 'failed' = search crashed, run Short with stammdaten only.
    // url_search_status 'pending' = URL search not yet run — fan out search, not Short.
    // url_search_status 'running' = URL search in progress — skip for now.
    // url_search_status 'url_not_found' = never got a URL, short_status set to url_not_found so excluded by query above.
    // pre_filter_status 'filtered_out' = kein ISP-Fit laut Pre-Filter, aus Bulk ausgeschlossen.
    const needsUrlSearch = targets.filter((r: any) => r.url_search_status === "pending");
    const shortReady = targets.filter((r: any) =>
      ["skipped", "done", "failed"].includes(r.url_search_status),
    );

    await tryAppendLog(supabase, tradeShowId, {
      phase: "short",
      message: `Bulk-Short: ${shortReady.length} direkt, ${needsUrlSearch.length} brauchen URL-Suche zuerst`,
    });

    if (targets.length === 0) return { fanned_out: 0, url_searches: 0 };

    const events: Array<{ name: string; data: Record<string, unknown> }> = [];

    for (const row of shortReady) {
      events.push({ name: "exhibitor.short.requested", data: { exhibitorId: row.id, tradeShowId } });
    }
    for (const row of needsUrlSearch) {
      events.push({ name: "exhibitor.url-search.requested", data: { exhibitorId: row.id, tradeShowId } });
    }

    if (events.length > 0) {
      await step.sendEvent("fan-out-bulk", events as any);
    }

    return { fanned_out: shortReady.length, url_searches: needsUrlSearch.length };
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
      const tradeShowId = data.tradeShowId;
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
      // Auch im Fehlerfall: koennte der letzte Aussteller im Bulk gewesen sein.
      if (tradeShowId) {
        await notifyShortBulkIfDone(supabase, tradeShowId);
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
        .select("id, company_name, website, booth, profile_url, profile_data, linkedin_url")
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
        system_prompt: s?.short_system_prompt ?? null,
        user_template: s?.short_user_template ?? null,
        max_tokens: s?.short_max_tokens ?? null,
        max_input_chars: s?.short_max_input_chars ?? null,
      };
    });

    const borrowed = await step.run("check-existing-short", async () => {
      const { data: exhibitorWithCompany } = await supabase
        .from("exhibitors")
        .select("company_id")
        .eq("id", exhibitorId)
        .single();
      if (!exhibitorWithCompany?.company_id) return null;

      const { data: existing } = await supabase
        .from("exhibitors")
        .select("id, trade_show_id")
        .eq("company_id", exhibitorWithCompany.company_id)
        .eq("short_status", "done")
        .neq("id", exhibitorId)
        .limit(1)
        .maybeSingle();
      if (!existing) return null;

      const [{ data: sourceShort }, { data: sourceShow }] = await Promise.all([
        supabase
          .from("exhibitor_short")
          .select(
            "one_liner, priority_label, match_confidence, isp_sector_match, reasoning_bullets, user_group, battery_need, drone_relevance, service_need",
          )
          .eq("exhibitor_id", existing.id)
          .maybeSingle(),
        supabase
          .from("trade_shows")
          .select("name, year")
          .eq("id", existing.trade_show_id)
          .maybeSingle(),
      ]);
      if (!sourceShort) return null;

      const showName = sourceShow
        ? `${sourceShow.name}${sourceShow.year ? ` ${sourceShow.year}` : ""}`
        : "andere Messe";
      return { sourceExhibitorId: existing.id, shortData: sourceShort, showName };
    });

    if (borrowed) {
      await step.run("borrow-short", async () => {
        const { error } = await supabase.from("exhibitor_short").upsert(
          {
            exhibitor_id: exhibitorId,
            ...borrowed.shortData,
            borrowed_from_show_name: borrowed.showName,
            tokens_in: 0,
            tokens_out: 0,
            firecrawl_credits: 0,
          },
          { onConflict: "exhibitor_id" },
        );
        if (error) throw new Error(`borrow-short upsert: ${error.message}`);

        await supabase
          .from("exhibitors")
          .update({
            short_status: "done",
            borrowed_short_from_exhibitor_id: borrowed.sourceExhibitorId,
            current_step: null,
          })
          .eq("id", exhibitorId);

        revalidateTag(showExhibitorsTag(tradeShowId));
        revalidateTag(exhibitorIntelTag(exhibitorId));

        await tryAppendLog(supabase, tradeShowId, {
          phase: "short",
          message: `[Short] ${exhibitor.company_name}: uebernommen von ${borrowed.showName}`,
        });
      });

      await step.run("notify-bulk-if-done", async () => {
        await notifyShortBulkIfDone(supabase, tradeShowId);
      });

      return { ok: true, borrowed: true, showName: borrowed.showName };
    }

    await step.run("mark-running", async () => {
      await supabase
        .from("exhibitors")
        .update({ short_status: "running", current_step: "scraping" })
        .eq("id", exhibitorId);
      await tryAppendLog(supabase, tradeShowId, {
        phase: "short",
        message: `[Start] ${exhibitor.company_name}${exhibitor.website ? ` — ${exhibitor.website}` : " — keine Website (Stammdaten)"}`,
      });
    });

    const scrapeStart = Date.now();
    const markdown = await step.run("scrape-company-site", async () => {
      if (!exhibitor.website) return "";
      return await scrapeCompanySite(exhibitor.website);
    });
    await step.run("log-scrape", async () => {
      const chars = markdown.length;
      await appendStepLog(supabase, exhibitorId, {
        ts: new Date().toISOString(),
        step: "short_scrape",
        dur_ms: Date.now() - scrapeStart,
        ok: true,
      });
      if (exhibitor.website) {
        await tryAppendLog(supabase, tradeShowId, {
          phase: "short",
          message: `[Scraping] ${exhibitor.company_name}: ${chars > 100 ? chars + " Zeichen" : "kein verwertbarer Content"}`,
        });
      }
    });

    await step.run("mark-analyzing", async () => {
      await supabase
        .from("exhibitors")
        .update({ current_step: "analysiere" })
        .eq("id", exhibitorId);
    });

    const claudeStart = Date.now();
    const result = await step.run("claude-short", async () => {
      return await enrichShort({
        companyName: exhibitor.company_name,
        website: exhibitor.website,
        booth: exhibitor.booth,
        profileUrl: exhibitor.profile_url,
        profileData: exhibitor.profile_data as Record<string, unknown> | null,
        linkedinUrl: (exhibitor as any).linkedin_url ?? null,
        scrapedMarkdown: markdown,
        prioContext: settings.prio_context,
        model: settings.model,
        systemPrompt: settings.system_prompt,
        userTemplate: settings.user_template,
        maxTokens: settings.max_tokens,
        maxInputChars: settings.max_input_chars,
        withWebSearch: false,
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
          reasoning_bullets: result.intel.reasoning_bullets,
          user_group: result.intel.user_group,
          battery_need: result.intel.battery_need,
          drone_relevance: result.intel.drone_relevance,
          service_need: result.intel.service_need,
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
          firecrawl_credits: exhibitor.website ? 1 : 0,
        },
        { onConflict: "exhibitor_id" },
      );
      if (shortError) throw new Error(`upsert short: ${shortError.message}`);

      await supabase
        .from("exhibitors")
        .update({ short_status: "done", current_step: null })
        .eq("id", exhibitorId);

      revalidateTag(showExhibitorsTag(tradeShowId));
      revalidateTag(exhibitorIntelTag(exhibitorId));

      await appendStepLog(supabase, exhibitorId, {
        ts: new Date().toISOString(),
        step: "short_claude",
        dur_ms: Date.now() - claudeStart,
        ok: true,
      });

      const webInfo = result.usage.web_searches > 0
        ? ` · ${result.usage.web_searches}x Web-Suche`
        : "";
      await tryAppendLog(supabase, tradeShowId, {
        phase: "short",
        message: `[Short] ${exhibitor.company_name}: ${result.intel.priority_label} / ${result.intel.match_confidence}%${webInfo}`,
        meta: {
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
          web_searches: result.usage.web_searches,
        },
      });
    });

    await step.run("notify-bulk-if-done", async () => {
      await notifyShortBulkIfDone(supabase, tradeShowId);
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
      const tradeShowId = data.tradeShowId;
      if (exhibitorId) {
        await supabase
          .from("exhibitors")
          .update({ deep_status: "failed", current_step: null })
          .eq("id", exhibitorId);
      }
      if (tradeShowId && exhibitorId) {
        const { data: ex } = await supabase
          .from("exhibitors")
          .select("company_name")
          .eq("id", exhibitorId)
          .maybeSingle();
        const errMsg = error instanceof Error ? error.message : String(error);
        await postToOrchestratorThread(
          supabase,
          tradeShowId,
          `Deep-Dive fuer **${ex?.company_name ?? "Aussteller"}** fehlgeschlagen: ${errMsg.slice(0, 200)}. Versuch es nochmal oder analysiere manuell.`,
        );
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
        .select(
          "id, company_name, website, booth, profile_url, profile_data, linkedin_url, exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match, reasoning_bullets)",
        )
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
          reasoning_bullets:
            (exhibitor.exhibitor_short as any).reasoning_bullets ?? "",
          user_group: (exhibitor.exhibitor_short as any).user_group ?? "Industrie/Sonstiges",
          battery_need: (exhibitor.exhibitor_short as any).battery_need ?? "gering",
          drone_relevance: (exhibitor.exhibitor_short as any).drone_relevance ?? "Nein",
          service_need: (exhibitor.exhibitor_short as any).service_need ?? [],
        }
      : null;

    const settings = await step.run("load-settings", async () => {
      const s = await getSettingsServiceRole(supabase);
      return {
        prio_context: s?.prio_context ?? defaultPrioContext(),
        model: s?.deep_model ?? DEEP_MODEL_DEFAULT,
        system_prompt: s?.deep_system_prompt ?? null,
        user_template: s?.deep_user_template ?? null,
        max_tokens: s?.deep_max_tokens ?? null,
        max_input_chars: s?.deep_max_input_chars ?? null,
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
        booth: exhibitor.booth,
        profileUrl: exhibitor.profile_url,
        profileData: exhibitor.profile_data as Record<string, unknown> | null,
        linkedinUrl: (exhibitor as any).linkedin_url ?? null,
        scrapedMarkdown: markdown,
        prioContext: settings.prio_context,
        model: settings.model,
        shortContext,
        systemPrompt: settings.system_prompt,
        userTemplate: settings.user_template,
        maxTokens: settings.max_tokens,
        maxInputChars: settings.max_input_chars,
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
          isp_service_fit: result.intel.isp_service_fit,
          full_reasoning: result.intel.full_reasoning,
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
          firecrawl_credits: exhibitor.website ? 1 : 0,
        },
        { onConflict: "exhibitor_id" },
      );
      if (deepError) throw new Error(`upsert deep: ${deepError.message}`);

      await supabase
        .from("exhibitors")
        .update({ deep_status: "done", current_step: null })
        .eq("id", exhibitorId);

      revalidateTag(exhibitorIntelTag(exhibitorId));

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

    await step.run("notify-deep-done", async () => {
      const fit = result.intel.isp_service_fit
        ? ` Service-Fit: ${result.intel.isp_service_fit}.`
        : "";
      await postToOrchestratorThread(
        supabase,
        tradeShowId,
        `Deep-Dive fuer **${exhibitor.company_name}** fertig.${fit} Du kannst die Aussteller-Seite oeffnen oder im Chat nachfragen.`,
      );
    });

    return { ok: true };
  },
);

// ---------- Profile-Enrich Bulk-Fanout ----------

export const profileEnrichBulk = inngest.createFunction(
  { id: "profile-enrich-bulk", retries: 1 },
  { event: "profile-enrich.bulk-requested" },
  async ({ event, step }) => {
    const { tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    if (await step.run("check-paused", () => isPaused(supabase, tradeShowId))) {
      return { paused: true };
    }

    const targets = await step.run("collect-pending-profiles", async () => {
      const { data } = await supabase
        .from("exhibitors")
        .select("id, profile_url")
        .eq("trade_show_id", tradeShowId)
        .in("profile_enrich_status", ["pending", "failed"])
        .not("profile_url", "is", null);
      return data ?? [];
    });

    await tryAppendLog(supabase, tradeShowId, {
      phase: "profile_enrich",
      message: `Profile-Scrape fuer ${targets.length} Aussteller startet`,
    });

    if (targets.length === 0) return { fanned_out: 0 };

    await step.sendEvent(
      "fan-out-profile-enrich",
      targets.map((row) => ({
        name: "exhibitor.profile.enrich.requested" as const,
        data: { exhibitorId: row.id, tradeShowId },
      })),
    );

    return { fanned_out: targets.length };
  },
);

// ---------- Per-Aussteller Profile-Scrape ----------

export const exhibitorProfileEnrich = inngest.createFunction(
  {
    id: "exhibitor-profile-enrich",
    concurrency: { limit: 5 },
    throttle: { limit: 60, period: "1m" },
    retries: 2,
  },
  { event: "exhibitor.profile.enrich.requested" },
  async ({ event, step }) => {
    const { exhibitorId, tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    if (await step.run("check-paused", () => isPaused(supabase, tradeShowId))) {
      return { paused: true };
    }

    const exhibitor = await step.run("load-exhibitor", async () => {
      const { data, error } = await supabase
        .from("exhibitors")
        .select("id, company_name, profile_url, profile_data, website, company_id")
        .eq("id", exhibitorId)
        .single();
      if (error || !data) throw new NonRetriableError(`exhibitor not found: ${exhibitorId}`);
      return data;
    });

    if (!exhibitor.profile_url) {
      await step.run("mark-skipped", async () => {
        await supabase
          .from("exhibitors")
          .update({ profile_enrich_status: "idle" })
          .eq("id", exhibitorId);
      });
      return { skipped: "no_profile_url" };
    }

    await step.run("mark-running", async () => {
      await supabase
        .from("exhibitors")
        .update({ profile_enrich_status: "running" })
        .eq("id", exhibitorId);
    });

    const scrape = await step.run("scrape-profile", async () => {
      const { scrapeExhibitorProfile } = await import("@/lib/profile-enrich");
      return await scrapeExhibitorProfile(exhibitor.profile_url!);
    });

    if (!scrape) {
      await step.run("mark-failed", async () => {
        await supabase
          .from("exhibitors")
          .update({ profile_enrich_status: "failed" })
          .eq("id", exhibitorId);
      });
      return { failed: "scrape_returned_null" };
    }

    await step.run("merge-and-save", async () => {
      const { mergeScrapeIntoProfile } = await import("@/lib/profile-enrich");
      const merged = mergeScrapeIntoProfile(
        exhibitor.profile_data as Record<string, unknown> | null,
        scrape,
      );
      const update: Record<string, unknown> = {
        profile_data: merged,
        profile_enrich_status: "done",
        firecrawl_credits_profile_enrich: 5,
      };
      // The external website is the most valuable field — promote it onto
      // the top-level `website` column so existing scrape/short flows pick
      // it up automatically. Only overwrite if we don't already have one.
      if (scrape.external_website && !exhibitor.website) {
        update.website = scrape.external_website;
        if (exhibitor.company_id) {
          const { normalizeDomain } = await import("@/lib/companies");
          await supabase
            .from("companies")
            .update({ website: scrape.external_website, domain: normalizeDomain(scrape.external_website) })
            .eq("id", (exhibitor as any).company_id)
            .is("website", null);
        }
      }
      await supabase.from("exhibitors").update(update).eq("id", exhibitorId);
    });

    return { ok: true };
  },
);

// ---------- Manuelle Firma: Short -> Deep verkettet ----------

/**
 * Triggered when the user adds a company by hand on /companies. We chain the
 * existing short and deep functions sequentially via step.invoke so the deep
 * call always sees a populated exhibitor_short row (better context).
 */
export const manualEnrichChain = inngest.createFunction(
  { id: "manual-enrich-chain", retries: 1 },
  { event: "exhibitor.manual.enrich.requested" },
  async ({ event, step }) => {
    const { exhibitorId, tradeShowId } = event.data;
    // Mark deep as pending up-front so the UI immediately reflects "queued".
    await step.run("mark-pending", async () => {
      const supabase = createServiceRoleClient();
      await supabase
        .from("exhibitors")
        .update({ deep_status: "pending" })
        .eq("id", exhibitorId);
    });

    await step.invoke("run-short", {
      function: exhibitorShort,
      data: { exhibitorId, tradeShowId },
    });
    await step.invoke("run-deep", {
      function: exhibitorDeep,
      data: { exhibitorId, tradeShowId },
    });
    return { ok: true };
  },
);

/**
 * Competitor-Discovery: Claude + web_search recherchiert Wettbewerber von ISP
 * im Markt und persistiert Vorschlaege als competitors.status='suggested'.
 * Concurrency-Key=userId, damit ein User nicht parallel mehrere teure
 * Web-Search-Laeufe triggert. retries=0: web_search-Calls kosten ~$0.15-0.30
 * pro Lauf; ein Retry wuerde die Cost stillschweigend verdoppeln. Stattdessen
 * UI-sichtbares Failure mit Diagnostik-Log fuer Manual-Retry.
 *
 * Step-Splittung gibt dem UI Phase-Tracking via current_phase + Live-Log
 * (analog crawl_log fuer Trade-Shows). Phasen: preparing -> preparing_prompt
 * -> claude_research -> persisting -> done|failed.
 */
export const competitorDiscovery = inngest.createFunction(
  {
    id: "competitor-discovery",
    concurrency: { limit: 1, key: "event.data.userId" },
    throttle: { limit: 5, period: "1m", key: "event.data.userId" },
    retries: 0,
    onFailure: async ({ event }) => {
      const supabase = createServiceRoleClient();
      // Inngest verschachtelt das Failure-Event: event.data.event.data.runId.
      const inner = (event as any).data?.event?.data ?? {};
      const runId = inner.runId as string | undefined;
      const userId = inner.userId as string | undefined;
      const errMsg = String((event as any).data?.error?.message ?? "unknown");
      if (!runId) return;
      await supabase
        .from("competitor_discovery_runs")
        .update({
          status: "failed",
          current_phase: "failed",
          error_message: errMsg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      if (userId) {
        await tryAppendDiscoveryLog(supabase, runId, userId, {
          level: "error",
          phase: "failed",
          message: `Lauf abgebrochen: ${errMsg}`,
        });
      }
    },
  },
  { event: "competitor.discovery.requested" },
  async ({ event, step }) => {
    const { userId, runId, request } = event.data;
    const supabase = createServiceRoleClient();

    await step.run("mark-running", async () => {
      const { error } = await supabase
        .from("competitor_discovery_runs")
        .update({ status: "running", current_phase: "preparing", started_at: new Date().toISOString() })
        .eq("id", runId);
      if (error) throw new Error(`mark-running: ${error.message}`);
      await tryAppendDiscoveryLog(supabase, runId, userId, {
        phase: "preparing",
        message: "Discovery-Lauf gestartet",
        meta: {
          target_count: request.target_count,
          sector_focus: request.sector_focus ?? null,
          region_focus: request.region_focus ?? null,
        },
      });
    });

    const settings = await step.run("load-settings", async () => {
      const s = await getSettingsServiceRole(supabase);
      if (!s) throw new NonRetriableError("no app_settings row found");
      return s;
    });

    const eff = effectiveCompetitorDiscovery(settings);

    await step.run("log-prompt-prepared", async () => {
      await supabase
        .from("competitor_discovery_runs")
        .update({ current_phase: "preparing_prompt" })
        .eq("id", runId);
      await tryAppendDiscoveryLog(supabase, runId, userId, {
        phase: "preparing_prompt",
        message: `Settings geladen: model=${eff.model}, max_tokens=${eff.max_tokens}, max_web_searches=${eff.max_web_searches}`,
        meta: {
          model: eff.model,
          max_tokens: eff.max_tokens,
          max_web_searches: eff.max_web_searches,
          system_prompt_override: !!settings.competitor_discovery_system_prompt,
          user_template_override: !!settings.competitor_discovery_user_template,
        },
      });
    });

    const result = await step.run("claude-research", async () => {
      await supabase
        .from("competitor_discovery_runs")
        .update({ current_phase: "claude_research" })
        .eq("id", runId);
      await tryAppendDiscoveryLog(supabase, runId, userId, {
        phase: "claude_research",
        message: `Anthropic-Call gestartet (Modell ${eff.model}, max ${eff.max_web_searches} Web-Searches)`,
      });
      try {
        const r = await discoverCompetitors({
          prioContext: settings.prio_context,
          request,
          model: eff.model,
          systemPrompt: settings.competitor_discovery_system_prompt,
          userTemplate: settings.competitor_discovery_user_template,
          maxTokens: eff.max_tokens,
          maxWebSearches: eff.max_web_searches,
        });
        await tryAppendDiscoveryLog(supabase, runId, userId, {
          phase: "claude_research",
          message: `Claude fertig: ${r.webSearchUses} Web-Search(es), ${r.output.items.length} Vorschlaege`,
          meta: {
            web_search_uses: r.webSearchUses,
            candidates_in_response: r.output.items.length,
            tokens_in: r.usage.tokens_in,
            tokens_out: r.usage.tokens_out,
            cache_creation_input_tokens: r.usage.cache_creation_input_tokens,
            cache_read_input_tokens: r.usage.cache_read_input_tokens,
          },
        });
        return {
          items: r.output.items,
          reasoning: r.output.reasoning,
          usage: r.usage,
          webSearchUses: r.webSearchUses,
        };
      } catch (e) {
        if (e instanceof DiscoveryNoSubmitError) {
          await tryAppendDiscoveryLog(supabase, runId, userId, {
            level: "error",
            phase: "claude_research",
            message: `Claude hat submit_competitor_discoveries nicht aufgerufen (stop_reason=${e.diagnostics.stop_reason}).`,
            meta: e.diagnostics,
          });
          throw new NonRetriableError(e.message, { cause: e });
        }
        await tryAppendDiscoveryLog(supabase, runId, userId, {
          level: "error",
          phase: "claude_research",
          message: `Claude-Call fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
          meta: { error_name: e instanceof Error ? e.name : "unknown" },
        });
        throw e;
      }
    });

    const persistResult = await step.run("persist-batch", async () => {
      await supabase
        .from("competitor_discovery_runs")
        .update({ current_phase: "persisting" })
        .eq("id", runId);
      await tryAppendDiscoveryLog(supabase, runId, userId, {
        phase: "persisting",
        message: `Persistiere ${result.items.length} Vorschlaege`,
      });
      const r = await persistDiscoveryBatch(
        supabase,
        userId,
        result.items,
        runId,
        async (ev) => {
          if (ev.kind === "created") {
            await tryAppendDiscoveryLog(supabase, runId, userId, {
              phase: "persisting",
              message: `+ ${ev.displayName}`,
              meta: { competitor_id: ev.competitorId },
            });
          } else if (ev.kind === "matched") {
            await tryAppendDiscoveryLog(supabase, runId, userId, {
              phase: "persisting",
              message: `= ${ev.displayName} (bereits bekannt)`,
              meta: { competitor_id: ev.competitorId },
            });
          } else {
            await tryAppendDiscoveryLog(supabase, runId, userId, {
              level: "warn",
              phase: "persisting",
              message: `! ${ev.displayName} konnte nicht gespeichert werden: ${ev.error}`,
            });
          }
        },
      );
      return r;
    });

    await step.run("mark-done", async () => {
      const wsCost = priceForWebSearch(result.webSearchUses);
      const { error } = await supabase
        .from("competitor_discovery_runs")
        .update({
          status: "done",
          current_phase: "done",
          model: eff.model,
          candidates_total: persistResult.total,
          candidates_kept: persistResult.created + persistResult.matched,
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
          web_search_uses: result.webSearchUses,
          web_search_cost_usd: wsCost,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      if (error) throw new Error(`mark-done: ${error.message}`);
      await tryAppendDiscoveryLog(supabase, runId, userId, {
        phase: "done",
        message: `Fertig: ${persistResult.created} neu, ${persistResult.matched} bereits bekannt${persistResult.failed > 0 ? `, ${persistResult.failed} fehlgeschlagen` : ""}`,
        meta: {
          total: persistResult.total,
          created: persistResult.created,
          matched: persistResult.matched,
          failed: persistResult.failed,
          web_search_cost_usd: wsCost,
        },
      });
    });

    return {
      runId,
      total: persistResult.total,
      created: persistResult.created,
      matched: persistResult.matched,
      reasoning: result.reasoning,
      web_search_uses: result.webSearchUses,
    };
  },
);

// ============================================================
// FIND EXHIBITOR LIST URL — Web-Search aus Messen-Namen
// ============================================================

export const findExhibitorListUrl = inngest.createFunction(
  {
    id: "find-exhibitor-list-url",
    concurrency: { limit: 1, key: "event.data.userId" },
    throttle: { limit: 5, period: "1m", key: "event.data.userId" },
    retries: 0,
    onFailure: async ({ event }) => {
      const supabase = createServiceRoleClient();
      const inner = (event as any).data?.event?.data ?? {};
      const tradeShowId = inner.tradeShowId as string | undefined;
      const errMsg = String((event as any).data?.error?.message ?? "unknown");
      if (!tradeShowId) return;
      await supabase
        .from("trade_shows")
        .update({ url_search_status: "failed" })
        .eq("id", tradeShowId);
      await tryAppendLog(supabase, tradeShowId, {
        phase: "url_search",
        level: "error",
        message: `URL-Suche abgebrochen: ${errMsg.slice(0, 400)}`,
      });
      await postToOrchestratorThread(
        supabase,
        tradeShowId,
        `URL-Suche fehlgeschlagen: ${errMsg.slice(0, 200)}. Bitte trage die Aussteller-URL manuell in den Einstellungen ein.`,
      );
    },
  },
  { event: "trade-show.url-search.requested" },
  async ({ event, step }) => {
    const { tradeShowId, userId, showName, year } = event.data as {
      tradeShowId: string;
      userId: string;
      showName: string;
      year: number | null;
    };
    const supabase = createServiceRoleClient();

    await step.run("mark-running", async () => {
      await supabase
        .from("trade_shows")
        .update({ url_search_status: "running" })
        .eq("id", tradeShowId);
      await tryAppendLog(supabase, tradeShowId, {
        phase: "url_search",
        message: `URL-Suche gestartet (web_search, max 5 Queries)`,
        meta: { show_name: showName, year },
      });
    });

    const search = await step.run("claude-web-search", async () => {
      const r = await searchTradeShowExhibitorUrl({ showName, year });
      await tryAppendLog(supabase, tradeShowId, {
        phase: "url_search",
        message: `Claude fertig: ${r.usage.web_searches} Web-Search(es), url=${
          r.result.url ?? "null"
        }, confidence=${r.result.confidence}`,
        meta: {
          web_searches: r.usage.web_searches,
          tokens_in: r.usage.tokens_in,
          tokens_out: r.usage.tokens_out,
          candidates_count: r.result.candidates.length,
          confidence: r.result.confidence,
        },
      });
      return r;
    });

    await step.run("persist-evidence", async () => {
      const url = search.result.url;
      const newStatus = url ? "done" : "url_not_found";
      await supabase
        .from("trade_shows")
        .update({
          url_search_status: newStatus,
          url_search_evidence: {
            url,
            confidence: search.result.confidence,
            reasoning: search.result.reasoning,
            candidates: search.result.candidates,
            web_searches: search.usage.web_searches,
            tokens_in: search.usage.tokens_in,
            tokens_out: search.usage.tokens_out,
            searched_at: new Date().toISOString(),
          },
        })
        .eq("id", tradeShowId);
    });

    await step.run("post-chat-message", async () => {
      const url = search.result.url;
      const conf = search.result.confidence;
      if (url) {
        const confLabel = conf === "high" ? "hoch" : conf === "medium" ? "mittel" : "niedrig";
        const candidatesLine =
          search.result.candidates.length > 1
            ? `\n\nWeitere geprüfte Kandidaten:\n${search.result.candidates
                .filter((c) => c.url !== url)
                .slice(0, 3)
                .map((c) => `- ${c.url}  ${c.reason}`)
                .join("\n")}`
            : "";
        await postToOrchestratorThread(
          supabase,
          tradeShowId,
          `Ich habe folgende Aussteller-URL gefunden:\n\n**${url}**\n\nKonfidenz: ${confLabel}. ${search.result.reasoning}${candidatesLine}\n\nIm Show-Header siehst du jetzt einen Banner. Klicke "Übernehmen + Discovery starten", oder trage in den Einstellungen eine andere URL ein.`,
        );
      } else {
        await postToOrchestratorThread(
          supabase,
          tradeShowId,
          `Ich konnte keine eindeutige Aussteller-URL finden. ${search.result.reasoning}\n\nBitte trage die URL manuell in den Einstellungen unter "Stammdaten" ein, dann kann ich Discovery starten.`,
        );
      }
    });

    return {
      tradeShowId,
      url: search.result.url,
      confidence: search.result.confidence,
      web_searches: search.usage.web_searches,
    };
  },
);

// ============================================================
// SHOW DISCOVERY (Phase 10) — Messen suchen
// ============================================================

export const showDiscovery = inngest.createFunction(
  {
    id: "show-discovery",
    concurrency: { limit: 1, key: "event.data.userId" },
    throttle: { limit: 3, period: "1m", key: "event.data.userId" },
    retries: 0,
    onFailure: async ({ event }) => {
      const supabase = createServiceRoleClient();
      const inner = (event as any).data?.event?.data ?? {};
      const runId = inner.runId as string | undefined;
      const userId = inner.userId as string | undefined;
      const errMsg = String((event as any).data?.error?.message ?? "unknown");
      if (!runId) return;
      await supabase
        .from("show_discovery_runs")
        .update({
          status: "failed",
          current_phase: "failed",
          error_message: errMsg,
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
      if (userId) {
        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          level: "error",
          phase: "failed",
          message: `Lauf abgebrochen: ${errMsg}`,
        });
      }
    },
  },
  { event: "show.discovery.requested" },
  async ({ event, step }) => {
    const { userId, runId, userPrompt } = event.data as {
      userId: string;
      runId: string;
      userPrompt: string;
    };
    const supabase = createServiceRoleClient();

    await step.run("mark-running", async () => {
      const { error } = await supabase
        .from("show_discovery_runs")
        .update({ status: "running", current_phase: "preparing" })
        .eq("id", runId);
      if (error) throw new Error(`mark-running: ${error.message}`);
      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "preparing",
        message: "Messen-Suche gestartet",
        meta: { user_prompt: userPrompt.slice(0, 200) },
      });
    });

    const settings = await step.run("load-settings", async () => {
      const s = await getSettingsServiceRole(supabase);
      if (!s) throw new NonRetriableError("no app_settings row found");
      return s;
    });

    const eff = effectiveShowDiscovery(settings);

    await step.run("log-prompt-prepared", async () => {
      await supabase
        .from("show_discovery_runs")
        .update({ current_phase: "preparing_prompt" })
        .eq("id", runId);
      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "preparing_prompt",
        message: `Settings geladen: model=${SHOW_DISCOVERY_MODEL}, max_tokens=${eff.max_tokens}, max_web_searches=${eff.max_web_searches}`,
        meta: {
          model: SHOW_DISCOVERY_MODEL,
          max_tokens: eff.max_tokens,
          max_web_searches: eff.max_web_searches,
          system_prompt_override: !!settings.show_discovery_system_prompt,
        },
      });
    });

    const result = await step.run("claude-research", async () => {
      await supabase
        .from("show_discovery_runs")
        .update({ current_phase: "claude_research" })
        .eq("id", runId);
      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "claude_research",
        message: `Claude Opus startet (max ${eff.max_web_searches} Web-Searches)`,
      });
      try {
        const r = await discoverShows({
          userPrompt,
          prioContext: settings.prio_context,
          systemPrompt: settings.show_discovery_system_prompt,
          maxTokens: eff.max_tokens,
          maxWebSearches: eff.max_web_searches,
        });
        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          phase: "claude_research",
          message: `Claude fertig: ${r.webSearchUses} Web-Search(es), ${r.output.items.length} Messen gefunden`,
          meta: {
            web_search_uses: r.webSearchUses,
            candidates_count: r.output.items.length,
            tokens_in: r.usage.tokens_in,
            tokens_out: r.usage.tokens_out,
            cache_creation_input_tokens: r.usage.cache_creation_input_tokens,
            cache_read_input_tokens: r.usage.cache_read_input_tokens,
          },
        });
        return r;
      } catch (e) {
        if (e instanceof DiscoveryNoSubmitError) {
          await tryAppendShowDiscoveryLog(supabase, runId, userId, {
            level: "error",
            phase: "claude_research",
            message: `Claude hat submit_show_discoveries nicht aufgerufen (stop_reason=${e.diagnostics.stop_reason}).`,
            meta: e.diagnostics,
          });
          throw new NonRetriableError(e.message, { cause: e });
        }
        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          level: "error",
          phase: "claude_research",
          message: `Claude-Call fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`,
          meta: { error_name: e instanceof Error ? e.name : "unknown" },
        });
        throw e;
      }
    });

    // Persist web_search queries in log for flowchart display.
    await step.run("log-web-searches", async () => {
      for (let i = 0; i < result.output.webSearchQueries.length; i++) {
        const q = result.output.webSearchQueries[i];
        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          phase: "web_search",
          message: `Q${String(i + 1).padStart(2, "0")} ${q.query}`,
          meta: {
            query_number: i + 1,
            query_text: q.query,
            result_count: q.result_count,
            result_titles: q.result_titles,
          },
        });
      }
      // Log Claude submit summary.
      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "claude_submit",
        message: `${result.output.items.length} Messen eingereicht`,
        meta: {
          candidates_count: result.output.items.length,
          web_search_total: result.webSearchUses,
          reasoning: result.output.reasoning.slice(0, 500),
        },
      });
    });

    const cancelledAfterClaude = await step.run("check-cancel-after-claude", async () => {
      const { data } = await supabase
        .from("show_discovery_runs")
        .select("status")
        .eq("id", runId)
        .maybeSingle();
      const cancelled = data?.status === "cancelled";
      if (cancelled) {
        await supabase
          .from("show_discovery_runs")
          .update({
            model: SHOW_DISCOVERY_MODEL,
            tokens_in: result.usage.tokens_in,
            tokens_out: result.usage.tokens_out,
            web_search_uses: result.webSearchUses,
            firecrawl_calls: 0,
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId);
        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          level: "warn",
          phase: "cancelled",
          message: `Lauf abgebrochen. Claude-Resultate (${result.output.items.length} Kandidaten) werden nicht persistiert, Fan-out uebersprungen.`,
          meta: { candidates_dropped: result.output.items.length },
        });
      }
      return cancelled;
    });

    if (cancelledAfterClaude) {
      return { runId, total: 0, to_validate: 0, cancelled: true };
    }

    const resultIds = await step.run("persist-candidates", async () => {
      await supabase
        .from("show_discovery_runs")
        .update({ current_phase: "persisting" })
        .eq("id", runId);
      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "persisting",
        message: `Persistiere ${result.output.items.length} Messen-Kandidaten`,
      });

      const rows = result.output.items.map((item) => ({
        run_id: runId,
        user_id: userId,
        name: item.name,
        website: item.website ?? null,
        location_city: item.location_city ?? null,
        location_country: item.location_country ?? null,
        dates_raw: item.dates_raw ?? null,
        focus_description: item.focus_description,
        target_audience: item.target_audience,
        isp_sector_match: item.isp_sector_match,
        relevance_score: item.relevance_score,
        relevance_reasoning: item.relevance_reasoning,
        evidence_urls: item.evidence_urls,
        is_recurring: item.is_recurring,
        recurrence_note: item.recurrence_note ?? null,
        exhibitor_list_url: item.exhibitor_list_url ?? null,
        exhibitor_list_available: item.has_exhibitor_list ?? null,
        firecrawl_status: item.website ? "pending" : "skipped",
      }));

      const { data: inserted, error } = await supabase
        .from("show_discovery_results")
        .insert(rows)
        .select("id, name, website, firecrawl_status");
      if (error) throw new Error(`persist-candidates: ${error.message}`);

      await supabase
        .from("show_discovery_runs")
        .update({ candidates_total: rows.length })
        .eq("id", runId);

      return (inserted ?? []) as Array<{ id: string; name: string; website: string | null; firecrawl_status: string }>;
    });

    // Cancel check before fan-out: persist already happened (results are saved
    // for the user to inspect), but skip the expensive Firecrawl validation.
    const cancelledBeforeFanout = await step.run("check-cancel-before-fanout", async () => {
      const { data } = await supabase
        .from("show_discovery_runs")
        .select("status")
        .eq("id", runId)
        .maybeSingle();
      const cancelled = data?.status === "cancelled";
      if (cancelled) {
        await supabase
          .from("show_discovery_runs")
          .update({
            model: SHOW_DISCOVERY_MODEL,
            tokens_in: result.usage.tokens_in,
            tokens_out: result.usage.tokens_out,
            web_search_uses: result.webSearchUses,
            firecrawl_calls: 0,
            candidates_validated: 0,
            finished_at: new Date().toISOString(),
          })
          .eq("id", runId);
        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          level: "warn",
          phase: "cancelled",
          message: `Lauf abgebrochen. Claude-Resultate sind gespeichert, Firecrawl-Validierung uebersprungen.`,
        });
      }
      return cancelled;
    });

    if (cancelledBeforeFanout) {
      return { runId, total: resultIds.length, to_validate: 0, cancelled: true };
    }

    // Fan-out: one Firecrawl validation event per candidate with a URL.
    const toValidate = resultIds.filter((r) => r.website && r.firecrawl_status === "pending");
    if (toValidate.length > 0) {
      await step.sendEvent(
        "fan-out-firecrawl",
        toValidate.map((r) => ({
          name: "show.result.firecrawl.requested" as const,
          data: { resultId: r.id, runId, userId, showName: r.name, website: r.website },
        })),
      );
    }

    await step.run("mark-claude-done", async () => {
      const skipped = resultIds.filter((r) => r.firecrawl_status === "skipped").length;
      await supabase
        .from("show_discovery_runs")
        .update({
          current_phase: toValidate.length > 0 ? "firecrawl_validation" : "done",
          status: toValidate.length > 0 ? "running" : "done",
          model: SHOW_DISCOVERY_MODEL,
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
          web_search_uses: result.webSearchUses,
          firecrawl_calls: 0,
          ...(toValidate.length === 0 && {
            finished_at: new Date().toISOString(),
            candidates_validated: skipped,
          }),
        })
        .eq("id", runId);
      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "firecrawl_validation",
        message: toValidate.length > 0
          ? `Firecrawl-Validierung gestartet fuer ${toValidate.length} URLs (${skipped} uebersprungen)`
          : `Fertig (keine URLs zu validieren, ${skipped} uebersprungen)`,
        meta: { to_validate: toValidate.length, skipped },
      });
    });

    return { runId, total: resultIds.length, to_validate: toValidate.length };
  },
);

export const showResultFirecrawl = inngest.createFunction(
  {
    id: "show-result-firecrawl",
    concurrency: { limit: 4 },
    throttle: { limit: 20, period: "1m" },
    retries: 1,
  },
  { event: "show.result.firecrawl.requested" },
  async ({ event, step }) => {
    const { resultId, runId, userId, showName, website } = event.data as {
      resultId: string;
      runId: string;
      userId: string;
      showName: string;
      website: string;
    };
    const supabase = createServiceRoleClient();

    const cancelled = await step.run("check-run-cancelled", async () => {
      const { data } = await supabase
        .from("show_discovery_runs")
        .select("status")
        .eq("id", runId)
        .maybeSingle();
      return data?.status === "cancelled";
    });

    if (cancelled) {
      await step.run("skip-cancelled", async () => {
        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          level: "warn",
          phase: "firecrawl_start",
          message: `Validierung uebersprungen (Lauf wurde gestoppt): ${showName}`,
          meta: { result_id: resultId },
        });
      });
      return;
    }

    await step.run("firecrawl-validate", async () => {
      // Mark running
      await supabase
        .from("show_discovery_results")
        .update({ firecrawl_status: "running" })
        .eq("id", resultId);
      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "firecrawl_start",
        message: `Validiere: ${showName}`,
        meta: { result_id: resultId, website },
      });

      // Firecrawl is best-effort: many show sites (Eurosatory, DSEI, etc.) block scrapers.
      // Claude already validated URLs via web search, so we always mark done.
      // Structured extraction (exhibitor count, venue) is a bonus when it works.
      const scraped = await scrapeShowSite(website);
      const extractedData: Record<string, unknown> | null = scraped
        ? (scraped.extracted as Record<string, unknown>)
        : null;
      const confirmedUrl: string = scraped?.confirmedUrl ?? website;
      const firecrawlStatus = "done" as const;

      const exhibitorCount = extractedData?.exhibitor_count as number | undefined;

      await supabase
        .from("show_discovery_results")
        .update({
          firecrawl_status: firecrawlStatus,
          firecrawl_confirmed_url: confirmedUrl,
          firecrawl_extracted: extractedData,
        })
        .eq("id", resultId);

      await tryAppendShowDiscoveryLog(supabase, runId, userId, {
        phase: "firecrawl_done",
        message: exhibitorCount
          ? `${showName} validiert (${exhibitorCount} Aussteller lt. Website)`
          : `${showName} validiert (kein Scraping moeglich, URL gespeichert)`,
        meta: {
          result_id: resultId,
          status: firecrawlStatus,
          exhibitor_count: exhibitorCount ?? null,
          confirmed_url: confirmedUrl,
        },
      });

      // Finalize run if all results are done.
      const { count } = await supabase
        .from("show_discovery_results")
        .select("*", { count: "exact", head: true })
        .eq("run_id", runId)
        .in("firecrawl_status", ["pending", "running"]);

      if (count === 0) {
        const { count: validatedCount } = await supabase
          .from("show_discovery_results")
          .select("*", { count: "exact", head: true })
          .eq("run_id", runId)
          .eq("firecrawl_status", "done");

        const { count: totalFirecrawlCalls } = await supabase
          .from("show_discovery_results")
          .select("*", { count: "exact", head: true })
          .eq("run_id", runId)
          .neq("firecrawl_status", "skipped");

        // Don't flip a cancelled run back to done — only finalize if still running.
        await supabase
          .from("show_discovery_runs")
          .update({
            status: "done",
            current_phase: "done",
            finished_at: new Date().toISOString(),
            candidates_validated: validatedCount ?? 0,
            firecrawl_calls: totalFirecrawlCalls ?? 0,
          })
          .eq("id", runId)
          .eq("status", "running");

        await tryAppendShowDiscoveryLog(supabase, runId, userId, {
          phase: "done",
          message: `Messen-Suche abgeschlossen: ${validatedCount ?? 0} URLs validiert`,
          meta: { validated: validatedCount ?? 0, firecrawl_calls: totalFirecrawlCalls ?? 0 },
        });
      }
    });
  },
);

/**
 * Listing-only pipeline — triggered by the orchestrator agent after in-stream discovery.
 * Requires trade_shows.crawl_plan to be set (validated CrawlPlan).
 * Skips the discovery step entirely and goes straight to listing + insert + finalize.
 */
export const crawlTradeShowListing = inngest.createFunction(
  {
    id: "crawl-trade-show-listing",
    retries: 2,
    onFailure: async ({ event, error }) => {
      const supabase = createServiceRoleClient();
      const data = (event.data as any).event?.data ?? event.data;
      const tradeShowId = data.tradeShowId;
      if (tradeShowId) {
        const msg = error instanceof Error ? error.message : String(error);
        await supabase
          .from("trade_shows")
          .update({ status: "failed", current_step: null, error_message: msg.slice(0, 500) })
          .eq("id", tradeShowId);
        await tryAppendLog(supabase, tradeShowId, {
          phase: "listing",
          level: "error",
          message: `Listing fehlgeschlagen: ${msg.slice(0, 500)}`,
        });
        await postToOrchestratorThread(
          supabase,
          tradeShowId,
          `Listing fehlgeschlagen: ${msg.slice(0, 200)}. Pruefe das Log oder probiere eine andere Engine.`,
        );
      }
    },
  },
  { event: "trade-show.listing-requested" },
  async ({ event, step }) => {
    const { tradeShowId } = event.data as { tradeShowId: string };
    const supabase = createServiceRoleClient();

    await step.run("mark-crawling", async () => {
      const { error } = await supabase
        .from("trade_shows")
        .update({ status: "crawling", current_step: "listing", error_message: null })
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

    const plan: CrawlPlan = await step.run("validate-plan", async () => {
      const parsed = CrawlPlanSchema.safeParse(show.crawl_plan);
      if (!parsed.success) {
        throw new NonRetriableError(
          `Kein gueltiger Crawl-Plan gespeichert. Bitte Discovery zuerst durchfuehren.`,
        );
      }
      await tryAppendLog(supabase, tradeShowId, {
        phase: "listing",
        message: `Plan geladen: ${parsed.data.strategy} · ${(parsed.data as any).engine ?? "firecrawl"}`,
      });
      return parsed.data;
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
      try {
        return await executeCrawlPlan(plan, async (sub, meta) => {
          await supabase
            .from("trade_shows")
            .update({ current_step: `listing:${plan.strategy}:${sub}` })
            .eq("id", tradeShowId);
          const message = (meta?.message as string | undefined) ?? sub;
          const interesting = !!meta || sub.includes("_done") || sub.includes("count_");
          if (interesting) {
            await tryAppendLog(supabase, tradeShowId, { phase: "listing", message, meta: meta ?? undefined });
          }
        });
      } catch (err) {
        // High-confidence API engines (algolia_api, dimedis_api,
        // mapyourshow_api, expofp_api) report failure via EngineApiError.
        // Retrying won't help — surface a friendly message to the orchestrator
        // and stop the run immediately.
        if (isEngineApiError(err)) {
          throw new NonRetriableError(err.userMessage);
        }
        throw err;
      }
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
          .update({ status: "failed", current_step: null, error_message: "Aussteller-Liste leer." })
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
      const { data: tsRow, error: tsErr } = await supabase
        .from("trade_shows")
        .select("user_id")
        .eq("id", tradeShowId)
        .single();
      if (tsErr || !tsRow) throw new Error(`load trade_show: ${tsErr?.message ?? "not found"}`);
      const userId = (tsRow as { user_id: string }).user_id;

      const rows: Array<Record<string, unknown>> = [];
      for (const e of listing) {
        const companyId = await ensureCompany(supabase, userId, e.name, e.website ?? null);
        rows.push({
          trade_show_id: tradeShowId,
          company_id: companyId,
          company_name: e.name,
          website: e.website,
          booth: e.booth,
          listing_raw: e as unknown as Record<string, unknown>,
          profile_url: e.profile_url ?? null,
          profile_data: e.profile_data ?? null,
          profile_enrich_status: e.profile_url ? "pending" : "idle",
          url_search_status: e.website ? "skipped" : "pending",
        });
      }
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
      await postToOrchestratorThread(
        supabase,
        tradeShowId,
        `Listing abgeschlossen: ${inserted.length} Aussteller gefunden${
          expected ? ` (${Math.round((inserted.length / expected) * 100)}% der erwarteten ${expected})` : ""
        }. Pre-Filter laeuft automatisch im Hintergrund. Danach kannst du den Short-Overview starten.`,
      );
    });

    await step.run("trigger-profile-enrich", async () => {
      const { count } = await supabase
        .from("exhibitors")
        .select("id", { count: "exact", head: true })
        .eq("trade_show_id", tradeShowId)
        .eq("profile_enrich_status", "pending");
      if ((count ?? 0) > 0) {
        await tryAppendLog(supabase, tradeShowId, {
          phase: "profile_enrich",
          message: `Profile-Enrich queued fuer ${count} Aussteller`,
        });
        await inngest.send({ name: "profile-enrich.bulk-requested", data: { tradeShowId } });
      }
    });

    await step.run("trigger-pre-filter", async () => {
      await inngest.send({
        name: "pre-filter.bulk-requested",
        data: { tradeShowId },
      });
      await tryAppendLog(supabase, tradeShowId, {
        phase: "pre_filter",
        message: "Pre-Filter gestartet (laeuft automatisch im Hintergrund)",
      });
    });

    return { exhibitors: inserted.length };
  },
);

// ---------- URL-Search: Bulk-Trigger ----------

export const urlSearchBulk = inngest.createFunction(
  { id: "url-search-bulk", retries: 1 },
  { event: "url-search.bulk-requested" },
  async ({ event, step }) => {
    const { tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    const targets = await step.run("collect-pending", async () => {
      const { data } = await supabase
        .from("exhibitors")
        .select("id")
        .eq("trade_show_id", tradeShowId)
        .eq("url_search_status", "pending");
      return data ?? [];
    });

    if (targets.length === 0) return { fanned_out: 0 };

    await tryAppendLog(supabase, tradeShowId, {
      phase: "short",
      message: `URL-Suche fuer ${targets.length} Aussteller ohne Website startet`,
    });

    await step.sendEvent(
      "fan-out-url-search",
      targets.map((row) => ({
        name: "exhibitor.url-search.requested" as const,
        data: { exhibitorId: row.id, tradeShowId },
      })),
    );

    return { fanned_out: targets.length };
  },
);

// ---------- URL-Search: Per-Aussteller ----------

export const exhibitorUrlSearch = inngest.createFunction(
  {
    id: "exhibitor-url-search",
    concurrency: { limit: 5 },
    throttle: { limit: 20, period: "1m" },
    retries: 2,
    onFailure: async ({ event, error }) => {
      const supabase = createServiceRoleClient();
      const data = (event.data as any).event?.data ?? event.data;
      const exhibitorId = data.exhibitorId;
      const tradeShowId = data.tradeShowId;
      if (exhibitorId) {
        await supabase
          .from("exhibitors")
          .update({ url_search_status: "failed" })
          .eq("id", exhibitorId);
        if (tradeShowId) {
          await tryAppendLog(supabase, tradeShowId, {
            phase: "short",
            message: `[URL-Suche] Fehler bei ${exhibitorId}: ${error.message}`,
          });
        }
      }
    },
  },
  { event: "exhibitor.url-search.requested" },
  async ({ event, step }) => {
    const { exhibitorId, tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    const exhibitor = await step.run("load-exhibitor", async () => {
      const { data, error } = await supabase
        .from("exhibitors")
        .select("id, company_name, booth, profile_data, website, company_id")
        .eq("id", exhibitorId)
        .single();
      if (error || !data) throw new NonRetriableError(`exhibitor not found: ${exhibitorId}`);
      return data;
    });

    // Guard: if a website already exists (e.g. set by profile-enrich in the meantime), skip search.
    if (exhibitor.website) {
      await step.run("mark-skipped", async () => {
        await supabase
          .from("exhibitors")
          .update({ url_search_status: "skipped" })
          .eq("id", exhibitorId);
      });
      await step.sendEvent("trigger-short", {
        name: "exhibitor.short.requested" as const,
        data: { exhibitorId, tradeShowId },
      });
      return { skipped: "already_has_website" };
    }

    await step.run("mark-running", async () => {
      await supabase
        .from("exhibitors")
        .update({ url_search_status: "running" })
        .eq("id", exhibitorId);
      await tryAppendLog(supabase, tradeShowId, {
        phase: "short",
        message: `[URL-Suche] ${exhibitor.company_name} — suche Website...`,
      });
    });

    const searchResult = await step.run("claude-url-search", async () => {
      return await searchCompanyUrl({
        companyName: exhibitor.company_name,
        profileData: exhibitor.profile_data as Record<string, unknown> | null,
        booth: exhibitor.booth,
      });
    });

    const { result, usage } = searchResult;

    if (!result.website_url) {
      await step.run("mark-not-found", async () => {
        await supabase
          .from("exhibitors")
          .update({ url_search_status: "url_not_found", short_status: "url_not_found" })
          .eq("id", exhibitorId);
        await tryAppendLog(supabase, tradeShowId, {
          phase: "short",
          message: `[URL-Suche] ${exhibitor.company_name} — keine Website gefunden (${usage.web_searches}x gesucht)`,
        });
      });
      return { url_not_found: true, web_searches: usage.web_searches };
    }

    await step.run("save-url", async () => {
      const updatedProfileData: Record<string, unknown> = {
        ...((exhibitor.profile_data as Record<string, unknown>) ?? {}),
        ...(result.search_description ? { search_description: result.search_description } : {}),
        ...(result.employee_estimate ? { employee_estimate: result.employee_estimate } : {}),
      };
      await supabase
        .from("exhibitors")
        .update({
          url_search_status: "done",
          website: result.website_url,
          linkedin_url: result.linkedin_url ?? null,
          profile_data: updatedProfileData,
        })
        .eq("id", exhibitorId);
      if ((exhibitor as any).company_id) {
        const { normalizeDomain } = await import("@/lib/companies");
        await supabase
          .from("companies")
          .update({ website: result.website_url, domain: normalizeDomain(result.website_url) })
          .eq("id", (exhibitor as any).company_id)
          .is("website", null);
      }
      await tryAppendLog(supabase, tradeShowId, {
        phase: "short",
        message: `[URL-Suche] ${exhibitor.company_name} — gefunden: ${result.website_url}${result.linkedin_url ? ` · LinkedIn: ${result.linkedin_url}` : ""}`,
      });
    });

    // Trigger Short analysis now that we have a URL.
    await step.sendEvent("trigger-short", {
      name: "exhibitor.short.requested" as const,
      data: { exhibitorId, tradeShowId },
    });

    return { found: result.website_url, web_searches: usage.web_searches };
  },
);

// ============================================================
// COMPETITOR SHORT (Phase 11) — Short-Analyse pro Konkurrent
// ============================================================

/**
 * Bulk-Trigger: laedt alle Konkurrenten mit short_status pending fuer den User
 * (oder eine explizite ID-Liste) und feuert pro Konkurrent ein individual-Event.
 */
export const competitorShortBulk = inngest.createFunction(
  { id: "competitor-short-bulk", retries: 1 },
  { event: "competitor.short.bulk-requested" },
  async ({ event, step }) => {
    const { userId, competitorIds } = event.data as {
      userId: string;
      competitorIds?: string[];
    };
    const supabase = createServiceRoleClient();

    const ids = await step.run("load-pending", async () => {
      if (competitorIds?.length) return competitorIds;
      const { data } = await supabase
        .from("competitors")
        .select("id")
        .eq("short_status", "pending");
      return (data ?? []).map((r: { id: string }) => r.id);
    });

    if (ids.length === 0) return { sent: 0 };

    await step.sendEvent(
      "send-short-events",
      ids.map((id: string) => ({
        name: "competitor.short.requested" as const,
        data: { competitorId: id, userId },
      })),
    );

    return { sent: ids.length };
  },
);

/**
 * Individual Short-Analyse: Firecrawl scrapt Website, Haiku analysiert,
 * Ergebnis in competitor_versions. Concurrency 5, Throttle 30/min.
 */
export const competitorShort = inngest.createFunction(
  {
    id: "competitor-short",
    concurrency: { limit: 5 },
    throttle: { limit: 30, period: "1m" },
    retries: 2,
    onFailure: async ({ event }) => {
      const supabase = createServiceRoleClient();
      const inner = (event as any).data?.event?.data ?? {};
      const competitorId = inner.competitorId as string | undefined;
      const userId = inner.userId as string | undefined;
      const errMsg = String((event as any).data?.error?.message ?? "unknown");
      if (!competitorId) return;
      await supabase
        .from("competitors")
        .update({ short_status: "failed" })
        .eq("id", competitorId);
      if (userId) {
        await tryAppendCompetitorLog(supabase, competitorId, userId, {
          level: "error",
          phase: "short_analysis",
          message: `Analyse fehlgeschlagen: ${errMsg}`,
        });
      }
    },
  },
  { event: "competitor.short.requested" },
  async ({ event, step }) => {
    const { competitorId, userId } = event.data as { competitorId: string; userId: string };
    const supabase = createServiceRoleClient();

    await step.run("mark-running", async () => {
      await supabase
        .from("competitors")
        .update({ short_status: "running" })
        .eq("id", competitorId);
      await tryAppendCompetitorLog(supabase, competitorId, userId, {
        phase: "short_analysis",
        message: "Short-Analyse gestartet",
      });
    });

    const competitor = await step.run("load-competitor", async () => {
      const { data, error } = await supabase
        .from("competitors")
        .select("id, display_name, website")
        .eq("id", competitorId)
        .single();
      if (error || !data) throw new NonRetriableError(`Competitor ${competitorId} not found`);
      if (!data.website) {
        await tryAppendCompetitorLog(supabase, competitorId, userId, {
          level: "error",
          phase: "short_analysis",
          message: `Keine Website hinterlegt, Analyse abgebrochen`,
        });
        throw new NonRetriableError(`Competitor ${competitorId} has no website`);
      }
      return data;
    });

    const settings = await step.run("load-settings", async () => {
      const s = await getSettingsServiceRole(supabase);
      if (!s) throw new NonRetriableError("no app_settings row");
      return s;
    });

    const scraped = await step.run("scrape-website", async () => {
      await tryAppendCompetitorLog(supabase, competitorId, userId, {
        phase: "short_analysis",
        message: `Website wird gecrawlt: ${competitor.website}`,
      });
      const content = await scrapeCompanySite(competitor.website!);
      await tryAppendCompetitorLog(supabase, competitorId, userId, {
        phase: "short_analysis",
        message: `Website gecrawlt: ${content.length} Zeichen`,
      });
      return content;
    });

    const { intel, usage } = await step.run("analyze-with-haiku", async () => {
      const model =
        (settings as any).competitor_short_model ??
        SHORT_MODEL_DEFAULT;
      await tryAppendCompetitorLog(supabase, competitorId, userId, {
        phase: "short_analysis",
        message: `Analyse mit ${model} gestartet`,
      });
      const result = await enrichCompetitorShort({
        websiteContent: scraped,
        competitorName: competitor.display_name,
        model,
      });
      await tryAppendCompetitorLog(supabase, competitorId, userId, {
        phase: "short_analysis",
        message: `Analyse fertig: threat=${result.intel.threat_level}, ${result.intel.isp_sector_match.length} Sektoren, ${result.usage.tokens_in + result.usage.tokens_out} Tokens`,
        meta: {
          threat_level: result.intel.threat_level,
          isp_sector_match: result.intel.isp_sector_match,
          tokens_in: result.usage.tokens_in,
          tokens_out: result.usage.tokens_out,
        },
      });
      return result;
    });

    await step.run("persist-version", async () => {
      // Compute next version_no (unique per competitor)
      const { data: maxRow } = await supabase
        .from("competitor_versions")
        .select("version_no")
        .eq("competitor_id", competitorId)
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersionNo = (maxRow?.version_no ?? 0) + 1;

      const { data: version, error: vErr } = await supabase
        .from("competitor_versions")
        .insert({
          competitor_id: competitorId,
          user_id: userId,
          version_no: nextVersionNo,
          scan_kind: "short",
          one_liner: intel.one_liner,
          positioning: intel.positioning,
          portfolio: intel.portfolio,
          isp_sector_match: intel.isp_sector_match,
          threat_level: intel.threat_level,
          growth_signals: intel.growth_signals,
          competitive_angles_vs_isp: intel.competitive_angles_vs_isp,
          tokens_in: usage.tokens_in,
          tokens_out: usage.tokens_out,
          model: (settings as any).competitor_short_model ?? SHORT_MODEL_DEFAULT,
          raw_snapshot: intel,
          firecrawl_credits: 1,
        })
        .select("id")
        .single();

      if (vErr || !version) throw new Error(`persist-version failed: ${vErr?.message}`);

      await supabase
        .from("competitors")
        .update({
          current_version_id: version.id,
          short_status: "done",
        })
        .eq("id", competitorId);

      await tryAppendCompetitorLog(supabase, competitorId, userId, {
        phase: "short_analysis",
        message: `Ergebnis gespeichert (Version ${version.id.slice(0, 8)})`,
      });
    });

    return { competitorId, threat_level: intel.threat_level };
  },
);

// ---------- Pre-Filter: Bulk-Fanout ----------

export const preFilterBulk = inngest.createFunction(
  { id: "pre-filter-bulk", retries: 1 },
  { event: "pre-filter.bulk-requested" },
  async ({ event, step }) => {
    const { tradeShowId } = event.data as { tradeShowId: string };
    const supabase = createServiceRoleClient();

    const pending = await step.run("collect-pending", async () => {
      const { data } = await supabase
        .from("exhibitors")
        .select("id")
        .eq("trade_show_id", tradeShowId)
        .eq("pre_filter_status", "pending");
      return (data ?? []).map((r: any) => r.id as string);
    });

    if (pending.length === 0) {
      return { skipped: true, reason: "no pending exhibitors" };
    }

    await step.run("mark-running", async () => {
      await supabase
        .from("exhibitors")
        .update({ pre_filter_status: "running" })
        .in("id", pending);
    });

    await tryAppendLog(supabase, tradeShowId, {
      phase: "pre_filter",
      message: `Pre-Filter: ${pending.length} Aussteller werden bewertet (${Math.ceil(pending.length / 25)} Batches)`,
    });

    const BATCH_SIZE = 25;
    const batches: string[][] = [];
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      batches.push(pending.slice(i, i + BATCH_SIZE));
    }

    await step.run("fan-out-batches", async () => {
      const events = batches.map((ids, idx) => ({
        name: "pre-filter.batch.requested" as const,
        data: { exhibitorIds: ids, tradeShowId, batchIndex: idx },
      }));
      await inngest.send(events as any);
    });

    return { batches: batches.length, total: pending.length };
  },
);

// ---------- Pre-Filter: Batch-Verarbeitung ----------

export const preFilterBatch = inngest.createFunction(
  {
    id: "pre-filter-batch",
    concurrency: { limit: 4 },
    throttle: { limit: 10, period: "1m" },
    retries: 2,
  },
  { event: "pre-filter.batch.requested" },
  async ({ event, step }) => {
    const { exhibitorIds, tradeShowId } = event.data as {
      exhibitorIds: string[];
      tradeShowId: string;
      batchIndex: number;
    };
    const supabase = createServiceRoleClient();

    const { preFilterExhibitors } = await import("@/lib/claude");

    const exhibitors = await step.run("load-exhibitors", async () => {
      const { data } = await supabase
        .from("exhibitors")
        .select("id, company_name, listing_raw, profile_data")
        .in("id", exhibitorIds);
      return data ?? [];
    });

    const inputs = exhibitors.map((e: any) => {
      const desc =
        e.profile_data?.description ||
        e.listing_raw?.description ||
        e.listing_raw?.category ||
        e.listing_raw?.hall ||
        null;
      return {
        id: e.id as string,
        company_name: e.company_name as string,
        description: desc ? String(desc).slice(0, 200) : null,
      };
    });

    const { results, usage } = await step.run("claude-pre-filter", async () => {
      return preFilterExhibitors(inputs);
    });

    await step.run("persist-results", async () => {
      for (const r of results) {
        await supabase
          .from("exhibitors")
          .update({
            pre_filter_status: r.fit ? "passed" : "filtered_out",
            pre_filter_reason: r.fit ? null : r.reason,
          })
          .eq("id", r.id);
      }
    });

    const filteredOut = results.filter((r) => !r.fit).length;

    await step.run("check-bulk-done", async () => {
      const { count } = await supabase
        .from("exhibitors")
        .select("id", { count: "exact", head: true })
        .eq("trade_show_id", tradeShowId)
        .in("pre_filter_status", ["pending", "running"]);

      if ((count ?? 0) === 0) {
        const { count: totalFiltered } = await supabase
          .from("exhibitors")
          .select("id", { count: "exact", head: true })
          .eq("trade_show_id", tradeShowId)
          .eq("pre_filter_status", "filtered_out");
        const { count: totalPassed } = await supabase
          .from("exhibitors")
          .select("id", { count: "exact", head: true })
          .eq("trade_show_id", tradeShowId)
          .eq("pre_filter_status", "passed");

        await postToOrchestratorThread(
          supabase,
          tradeShowId,
          `Pre-Filter abgeschlossen: ${totalPassed ?? 0} relevant, ${totalFiltered ?? 0} herausgefiltert. Jetzt kannst du den Short-Overview starten.`,
        );
        await tryAppendLog(supabase, tradeShowId, {
          phase: "pre_filter",
          message: `Pre-Filter fertig: ${totalPassed ?? 0} passed, ${totalFiltered ?? 0} filtered_out`,
        });
      }
    });

    return {
      processed: results.length,
      filtered_out: filteredOut,
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
    };
  },
);

export const functions = [
  crawlTradeShow,
  crawlTradeShowListing,
  shortOverviewBulk,
  urlSearchBulk,
  exhibitorUrlSearch,
  exhibitorShort,
  exhibitorDeep,
  profileEnrichBulk,
  exhibitorProfileEnrich,
  manualEnrichChain,
  competitorDiscovery,
  findExhibitorListUrl,
  showDiscovery,
  showResultFirecrawl,
  competitorShortBulk,
  competitorShort,
  preFilterBulk,
  preFilterBatch,
];
