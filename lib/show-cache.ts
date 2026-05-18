import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "./supabase/server";

// ─── Tag helpers ──────────────────────────────────────────────────────────────
// Single source of truth for cache tags so callers and revalidators stay in sync.

export const showExhibitorsTag = (showId: string) => `show-${showId}-exhibitors`;
export const exhibitorIntelTag = (exId: string) => `exhibitor-${exId}-intel`;

// ─── Types ────────────────────────────────────────────────────────────────────

export type CachedExhibitorRow = {
  id: string;
  company_name: string;
  website: string | null;
  booth: string | null;
  short_status: string;
  deep_status: string;
  current_step: string | null;
  pre_filter_status: string | null;
  pre_filter_reason: string | null;
  exhibitor_short: {
    one_liner: string | null;
    priority_label: string | null;
    match_confidence: number | null;
    isp_sector_match: string[] | null;
    user_group: string | null;
    battery_need: string | null;
  } | null;
};

export type CachedExhibitorIntel = {
  exhibitor: {
    id: string;
    company_name: string;
    website: string | null;
    booth: string | null;
    short_status: string;
    deep_status: string;
    current_step: string | null;
    trade_show_id: string;
    profile_url: string | null;
    profile_data: Record<string, unknown> | null;
    profile_enrich_status: string | null;
    borrowed_short_from_exhibitor_id: string | null;
    pre_filter_status: string | null;
    pre_filter_reason: string | null;
  } | null;
  shortIntel: {
    one_liner: string | null;
    priority_label: string | null;
    match_confidence: number | null;
    isp_sector_match: string[] | null;
    reasoning_bullets: string | null;
    user_group: string | null;
    battery_need: string | null;
    drone_relevance: string | null;
    service_need: string[] | null;
    updated_at: string | null;
    borrowed_from_show_name: string | null;
  } | null;
  deepIntel: {
    business_summary: string | null;
    decision_makers: string | null;
    recent_news: string | null;
    technical_pain_points: string | null;
    opening_questions: string | null;
    competition_context: string | null;
    isp_lifecycle_match: string[] | null;
    isp_service_fit: string | null;
    full_reasoning: string | null;
    updated_at: string | null;
  } | null;
};

// ─── Cached queries ───────────────────────────────────────────────────────────

/**
 * All exhibitors for a show with their short intel — the big joined query.
 * Cached 60 s with tag show-${showId}-exhibitors so revalidateTag() can
 * bust it when short analysis completes. Filtering + sorting happens in JS
 * on the caller side to maximise cache hit rate (one entry per show, not per
 * filter combination).
 *
 * Uses the service role client because unstable_cache runs outside the
 * request context and cannot access cookies() / the user session.
 * Single-user app → no multi-tenant data leakage risk.
 */
export function getCachedExhibitorList(showId: string): Promise<CachedExhibitorRow[]> {
  return unstable_cache(
    async () => {
      const supabase = createServiceRoleClient();
      const { data } = await supabase
        .from("exhibitors")
        .select(
          "id, company_name, website, booth, short_status, deep_status, current_step, pre_filter_status, pre_filter_reason, exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match, user_group, battery_need)",
        )
        .eq("trade_show_id", showId)
        .order("company_name", { ascending: true });
      return (data ?? []) as unknown as CachedExhibitorRow[];
    },
    ["exhibitor-list", showId],
    { revalidate: 60, tags: [showExhibitorsTag(showId)] },
  )();
}

/**
 * Single exhibitor + short intel + deep intel for the detail page.
 * Cached 120 s. Tagged with both the show-level exhibitors tag (busted on any
 * short completion for the show) and the exhibitor-specific intel tag (busted
 * on that exhibitor's deep completion).
 */
export function getCachedExhibitorIntel(
  showId: string,
  exId: string,
): Promise<CachedExhibitorIntel> {
  return unstable_cache(
    async () => {
      const supabase = createServiceRoleClient();
      const [
        { data: exhibitor },
        { data: shortIntel },
        { data: deepIntel },
      ] = await Promise.all([
        supabase
          .from("exhibitors")
          .select(
            "id, company_name, website, booth, short_status, deep_status, current_step, trade_show_id, profile_url, profile_data, profile_enrich_status, borrowed_short_from_exhibitor_id, pre_filter_status, pre_filter_reason",
          )
          .eq("id", exId)
          .single(),
        supabase
          .from("exhibitor_short")
          .select(
            "one_liner, priority_label, match_confidence, isp_sector_match, reasoning_bullets, user_group, battery_need, drone_relevance, service_need, updated_at, borrowed_from_show_name",
          )
          .eq("exhibitor_id", exId)
          .maybeSingle(),
        supabase
          .from("exhibitor_deep")
          .select(
            "business_summary, decision_makers, recent_news, technical_pain_points, opening_questions, competition_context, isp_lifecycle_match, isp_service_fit, full_reasoning, updated_at",
          )
          .eq("exhibitor_id", exId)
          .maybeSingle(),
      ]);
      return {
        exhibitor: exhibitor as CachedExhibitorIntel["exhibitor"],
        shortIntel: shortIntel as CachedExhibitorIntel["shortIntel"],
        deepIntel: deepIntel as CachedExhibitorIntel["deepIntel"],
      };
    },
    ["exhibitor-intel", exId],
    {
      revalidate: 120,
      tags: [showExhibitorsTag(showId), exhibitorIntelTag(exId)],
    },
  )();
}
