import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getExhibitorList, scrapeCompanySite } from "@/lib/firecrawl";
import { enrichAndMatch } from "@/lib/claude";

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
        .update({ status: "crawling", error_message: null })
        .eq("id", tradeShowId);
      if (error) throw new Error(`update status: ${error.message}`);
    });

    const show = await step.run("load-show", async () => {
      const { data, error } = await supabase
        .from("trade_shows")
        .select("id, name, source_url")
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
            error_message: "Keine Aussteller-URL hinterlegt — Aussteller manuell pflegen.",
          })
          .eq("id", tradeShowId);
      });
      return { exhibitors: 0, reason: "no source_url" };
    }

    const listing = await step.run("fetch-exhibitor-list", async () => {
      return await getExhibitorList(show.source_url!);
    });

    if (listing.length === 0) {
      await step.run("mark-empty", async () => {
        await supabase
          .from("trade_shows")
          .update({
            status: "failed",
            error_message: "Aussteller-Liste konnte nicht extrahiert werden.",
          })
          .eq("id", tradeShowId);
      });
      return { exhibitors: 0, reason: "empty listing" };
    }

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

    await step.sendEvent(
      "fan-out-enrichment",
      inserted.map((row) => ({
        name: "exhibitor.enrich.requested" as const,
        data: { exhibitorId: row.id, tradeShowId },
      })),
    );

    return { exhibitors: inserted.length };
  },
);

/**
 * Per-exhibitor enrichment: scrape website, ask Claude for intel + ISP match,
 * upsert the result. Concurrency-limited to be friendly with Firecrawl + Anthropic.
 */
export const enrichExhibitor = inngest.createFunction(
  {
    id: "enrich-exhibitor",
    concurrency: { limit: 5 },
    retries: 3,
    onFailure: async ({ event, error }) => {
      const supabase = createServiceRoleClient();
      const exhibitorId = (event.data.event.data as { exhibitorId: string }).exhibitorId;
      await supabase
        .from("exhibitors")
        .update({ enrichment_status: "failed", enrichment_error: error.message })
        .eq("id", exhibitorId);
      await maybeFinaliseShow(
        supabase,
        (event.data.event.data as { tradeShowId: string }).tradeShowId,
      );
    },
  },
  { event: "exhibitor.enrich.requested" },
  async ({ event, step }) => {
    const { exhibitorId, tradeShowId } = event.data;
    const supabase = createServiceRoleClient();

    const exhibitor = await step.run("load-exhibitor", async () => {
      const { data, error } = await supabase
        .from("exhibitors")
        .select("id, company_name, website")
        .eq("id", exhibitorId)
        .single();
      if (error || !data) throw new NonRetriableError(`exhibitor not found: ${exhibitorId}`);
      return data;
    });

    await step.run("mark-running", async () => {
      await supabase
        .from("exhibitors")
        .update({ enrichment_status: "running", enrichment_error: null })
        .eq("id", exhibitorId);
    });

    const markdown = await step.run("scrape-company-site", async () => {
      if (!exhibitor.website) return "";
      return await scrapeCompanySite(exhibitor.website);
    });

    const { intel, raw } = await step.run("claude-enrich-and-match", async () => {
      return await enrichAndMatch({
        companyName: exhibitor.company_name,
        website: exhibitor.website,
        scrapedMarkdown: markdown,
      });
    });

    await step.run("upsert-intel", async () => {
      const { error: intelError } = await supabase.from("exhibitor_intel").upsert(
        {
          exhibitor_id: exhibitorId,
          business_field: intel.business_field,
          estimated_size: intel.estimated_size,
          power_needs_hypothesis: intel.power_needs_hypothesis,
          isp_sector_match: intel.isp_sector_match,
          isp_lifecycle_match: intel.isp_lifecycle_match,
          match_confidence: intel.match_confidence,
          pitch_hook: intel.pitch_hook,
          reasoning: intel.reasoning,
          raw_response: raw as unknown as Record<string, unknown>,
        },
        { onConflict: "exhibitor_id" },
      );
      if (intelError) throw new Error(`upsert intel: ${intelError.message}`);

      const { error: exError } = await supabase
        .from("exhibitors")
        .update({ enrichment_status: "done", enrichment_error: null })
        .eq("id", exhibitorId);
      if (exError) throw new Error(`update exhibitor: ${exError.message}`);
    });

    await step.run("maybe-finalise-show", async () => {
      await maybeFinaliseShow(supabase, tradeShowId);
    });

    return { ok: true, confidence: intel.match_confidence };
  },
);

async function maybeFinaliseShow(
  supabase: ReturnType<typeof createServiceRoleClient>,
  tradeShowId: string,
) {
  const { data: rows } = await supabase
    .from("exhibitors")
    .select("enrichment_status")
    .eq("trade_show_id", tradeShowId);

  if (!rows || rows.length === 0) return;

  const pending = rows.filter(
    (r) => r.enrichment_status === "pending" || r.enrichment_status === "running",
  ).length;
  if (pending > 0) return;

  const failed = rows.filter((r) => r.enrichment_status === "failed").length;
  const status = failed === rows.length ? "failed" : failed > 0 ? "partial" : "ready";
  await supabase.from("trade_shows").update({ status }).eq("id", tradeShowId);
}

export const functions = [crawlTradeShow, enrichExhibitor];
