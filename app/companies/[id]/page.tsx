import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCachedCompanyIntel } from "@/lib/show-cache";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import { getSettings, DEEP_MODEL_DEFAULT } from "@/lib/settings";
import { estimatePerCallUsd } from "@/lib/cost-estimate";
import { CompanyDetailClient } from "./CompanyDetailClient";

export const dynamic = "force-dynamic";

type ShowMeta = { id: string; name: string; year: number | null };
type ParticipationRaw = {
  id: string;
  booth: string | null;
  profile_url: string | null;
  trade_shows: ShowMeta | ShowMeta[] | null;
};

function pickSingle<T>(v: T | T[] | null): T | null {
  if (v === null || v === undefined) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const [{ company, shortIntel, deepIntel }, rawParticipations, settings] = await Promise.all([
    getCachedCompanyIntel(id),
    supabase
      .from("exhibitors")
      .select("id, booth, profile_url, trade_shows(id, name, year)")
      .eq("company_id", id)
      .order("created_at", { ascending: false }),
    getSettings(supabase, user.id),
  ]);

  if (!company) notFound();

  const participations = ((rawParticipations.data ?? []) as unknown as ParticipationRaw[])
    .map((r) => {
      const show = pickSingle<ShowMeta>(r.trade_shows);
      return {
        exhibitorId: r.id,
        showId: show?.id ?? "",
        showName: show?.name ?? "?",
        showYear: show?.year ?? null,
        booth: r.booth,
        profileUrl: r.profile_url,
      };
    })
    .filter((p) => p.showId);

  const deepModel = settings?.deep_model ?? DEEP_MODEL_DEFAULT;
  const deepPerCallUsd = estimatePerCallUsd("deep", deepModel, null);

  const scoreColor =
    shortIntel?.match_confidence == null
      ? null
      : shortIntel.match_confidence >= 8
        ? "var(--color-success)"
        : shortIntel.match_confidence >= 5
          ? "var(--color-gold)"
          : "rgba(10,10,10,0.35)";

  return (
    <>
      <div className="mb-6 text-meta">
        <Link href="/companies" className="hover:text-[var(--color-near-black)] transition-colors">
          ← Unternehmen
        </Link>
      </div>

      <header className="mb-10">
        <div className="flex items-start justify-between gap-6">
          <h1 className="text-display">
            {company.display_name}
            <span style={{ color: "var(--color-gold)" }}>.</span>
          </h1>
          {shortIntel?.match_confidence != null && (
            <span
              className="text-title tabular-nums shrink-0 mt-1"
              style={{ color: scoreColor ?? undefined }}
            >
              {shortIntel.match_confidence}
              <span style={{ color: "var(--color-gold)" }}>.</span>
            </span>
          )}
        </div>

        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          {company.domain && (
            <a
              href={`https://${company.domain}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-[var(--color-gold)] transition-colors"
            >
              {company.domain}
            </a>
          )}
          <span className="tabular-nums">{participations.length} messe-teilnahmen</span>
        </div>
      </header>

      <CompanyDetailClient
        companyId={id}
        company={company}
        shortIntel={shortIntel}
        deepIntel={deepIntel}
        participations={participations}
        deepPerCallUsd={deepPerCallUsd}
        deepModel={deepModel}
        sectors={ISP_CATALOG.sectors.map((s) => ({ id: s.id, name: s.name }))}
        lifecycle={ISP_CATALOG.lifecycle.map((l) => ({ id: l.id, name: l.name, step: l.step }))}
      />
    </>
  );
}
