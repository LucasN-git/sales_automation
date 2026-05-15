import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedExhibitorIntel } from "@/lib/show-cache";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import { getSettings, DEEP_MODEL_DEFAULT } from "@/lib/settings";
import { estimatePerCallUsd, estimateIsHistorical } from "@/lib/cost-estimate";
import { ExhibitorDetailClient } from "./ExhibitorDetailClient";

export const dynamic = "force-dynamic";

export default async function ExhibitorDetailPage({
  params,
}: {
  params: Promise<{ id: string; exId: string }>;
}) {
  const { id: showId, exId } = await params;
  const supabase = await createClient();

  // Cached: exhibitor + short + deep intel (120 s, invalidated on analysis completion).
  // Non-cached: show name, token stats, user settings (fast single-row queries).
  const [
    { exhibitor, shortIntel, deepIntel },
    { data: show },
    { data: tokenStatsData },
    {
      data: { user },
    },
  ] = await Promise.all([
    getCachedExhibitorIntel(showId, exId),
    supabase.from("trade_shows").select("id, name").eq("id", showId).single(),
    supabase.rpc("get_token_stats", { p_trade_show_id: showId }),
    supabase.auth.getUser(),
  ]);

  if (!exhibitor) notFound();

  const settings = user ? await getSettings(supabase, user.id) : null;
  const deepModel = settings?.deep_model ?? DEEP_MODEL_DEFAULT;
  type Stats = { tin: number; tout: number; cnt: number };
  const deepStats = (tokenStatsData as { deep?: Stats } | null)?.deep ?? null;
  const deepPerCallUsd = estimatePerCallUsd("deep", deepModel, deepStats);
  const deepEstimateHistorical = estimateIsHistorical(deepStats);

  return (
    <ExhibitorDetailClient
      showId={showId}
      exId={exId}
      showName={show?.name ?? null}
      exhibitor={{
        company_name: exhibitor.company_name,
        website: exhibitor.website,
        booth: exhibitor.booth,
        short_status: exhibitor.short_status,
        deep_status: exhibitor.deep_status,
        profile_url: exhibitor.profile_url,
        profile_data: exhibitor.profile_data as Record<string, unknown> | null,
        profile_enrich_status: exhibitor.profile_enrich_status,
      }}
      shortIntel={
        shortIntel
          ? {
              one_liner: shortIntel.one_liner as string | null,
              priority_label: shortIntel.priority_label as string | null,
              match_confidence: shortIntel.match_confidence as number | null,
              isp_sector_match: shortIntel.isp_sector_match as string[] | null,
              reasoning_bullets: shortIntel.reasoning_bullets as string | null,
              user_group: shortIntel.user_group as string | null,
              battery_need: shortIntel.battery_need as string | null,
              drone_relevance: shortIntel.drone_relevance as string | null,
              service_need: shortIntel.service_need as string[] | null,
            }
          : null
      }
      deepIntel={
        deepIntel
          ? {
              business_summary: deepIntel.business_summary as string | null,
              decision_makers: deepIntel.decision_makers as string | null,
              recent_news: deepIntel.recent_news as string | null,
              technical_pain_points: deepIntel.technical_pain_points as string | null,
              opening_questions: deepIntel.opening_questions as string | null,
              competition_context: deepIntel.competition_context as string | null,
              isp_lifecycle_match: deepIntel.isp_lifecycle_match as string[] | null,
              isp_service_fit: deepIntel.isp_service_fit as string | null,
              full_reasoning: deepIntel.full_reasoning as string | null,
            }
          : null
      }
      deepPerCallUsd={deepPerCallUsd}
      deepEstimateHistorical={deepEstimateHistorical}
      deepModel={deepModel}
      sectors={ISP_CATALOG.sectors.map((s) => ({ id: s.id, name: s.name }))}
      lifecycle={ISP_CATALOG.lifecycle.map((l) => ({ id: l.id, name: l.name, step: l.step }))}
    />
  );
}
