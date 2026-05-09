import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Hairline } from "@/components/brand/Hairline";
import { ISP_CATALOG } from "@/lib/isp-catalog";
import { DeepDiveButton } from "./DeepDiveButton";

export const dynamic = "force-dynamic";

const PRIO_LABELS: Record<string, string> = {
  hot: "Hot",
  warm: "Warm",
  cold: "Cold",
};

export default async function ExhibitorDetailPage({
  params,
}: {
  params: Promise<{ id: string; exId: string }>;
}) {
  const { id: showId, exId } = await params;
  const supabase = await createClient();

  const [
    { data: exhibitor },
    { data: show },
    { data: shortIntel },
    { data: deepIntel },
  ] = await Promise.all([
    supabase
      .from("exhibitors")
      .select(
        "id, company_name, website, booth, short_status, deep_status, current_step, trade_show_id",
      )
      .eq("id", exId)
      .single(),
    supabase
      .from("trade_shows")
      .select("id, name")
      .eq("id", showId)
      .single(),
    supabase
      .from("exhibitor_short")
      .select("one_liner, priority_label, match_confidence, isp_sector_match, updated_at")
      .eq("exhibitor_id", exId)
      .maybeSingle(),
    supabase
      .from("exhibitor_deep")
      .select(
        "business_summary, decision_makers, recent_news, technical_pain_points, opening_questions, competition_context, isp_lifecycle_match, full_reasoning, updated_at",
      )
      .eq("exhibitor_id", exId)
      .maybeSingle(),
  ]);

  if (!exhibitor) notFound();

  const sectorById = new Map<string, (typeof ISP_CATALOG.sectors)[number]>(
    ISP_CATALOG.sectors.map((s) => [s.id, s]),
  );
  const lifecycleById = new Map<string, (typeof ISP_CATALOG.lifecycle)[number]>(
    ISP_CATALOG.lifecycle.map((l) => [l.id, l]),
  );

  return (
    <>
      <div className="mb-6 text-meta">
        <Link
          href={`/shows/${showId}`}
          className="hover:text-[var(--color-gold)] transition-colors"
        >
          ← {show?.name ?? "Messe"}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-display">{exhibitor.company_name}</h1>
        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          {exhibitor.booth && <span>stand {exhibitor.booth}</span>}
          <span>short: {exhibitor.short_status}</span>
          {exhibitor.deep_status !== "none" && (
            <span>deep: {exhibitor.deep_status}</span>
          )}
        </div>
      </header>

      <Block label="website">
        {exhibitor.website ? (
          <a
            href={exhibitor.website}
            target="_blank"
            rel="noreferrer"
            className="text-subtitle underline underline-offset-4 break-all hover:text-[var(--color-gold)] transition-colors"
          >
            {exhibitor.website}
          </a>
        ) : (
          <p className="text-body text-[var(--color-near-black)]/45">
            keine website hinterlegt
          </p>
        )}
      </Block>

      <Block label="erst-einschaetzung (short)">
        {!shortIntel ? (
          <p className="text-body text-[var(--color-near-black)]/55">
            {exhibitor.short_status === "running"
              ? "wird gerade erstellt…"
              : "noch keine short-einschaetzung. klicke in der show-detail-ansicht 'short-overviews starten'."}
          </p>
        ) : (
          <div>
            <div className="flex items-baseline gap-5 mb-3 flex-wrap">
              <span className="tabular-nums text-display leading-none">
                {shortIntel.match_confidence ?? 0}
                <span style={{ color: "var(--color-gold)" }}>.</span>
              </span>
              <span className="text-meta-strong">confidence</span>
              {shortIntel.priority_label && (
                <span className="text-meta-strong px-2 py-1 border border-[var(--color-near-black)]">
                  {PRIO_LABELS[shortIntel.priority_label] ?? shortIntel.priority_label}
                </span>
              )}
            </div>
            <p className="text-subtitle font-normal">{shortIntel.one_liner}</p>
            {shortIntel.isp_sector_match && shortIntel.isp_sector_match.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(shortIntel.isp_sector_match as string[]).map((s) => (
                  <span
                    key={s}
                    className="text-meta-strong px-2 py-1 border border-[var(--border-color-soft)]"
                  >
                    {(sectorById.get(s)?.name ?? s).toLowerCase()}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Block>

      {/* Deep-Dive Trigger */}
      <Block label="deep-dive">
        <DeepDiveButton
          exhibitorId={exId}
          status={exhibitor.deep_status}
          hasDeep={!!deepIntel}
        />
        {!deepIntel && exhibitor.deep_status !== "running" && exhibitor.deep_status !== "pending" && (
          <p className="mt-3 text-body-sm text-[var(--color-near-black)]/55">
            tiefenrecherche mit erweitertem kontext. dauert ~30-60 s, kostet
            spuerbar mehr tokens als short. nur fuer aussteller anfordern, die
            den stand-besuch wert sind.
          </p>
        )}
      </Block>

      {deepIntel && (
        <>
          <Block label="geschaeftsfeld (deep)">
            <p className="text-body whitespace-pre-line">
              {deepIntel.business_summary}
            </p>
          </Block>

          <Block label="ansprechpartner">
            <p className="text-body whitespace-pre-line">
              {deepIntel.decision_makers}
            </p>
          </Block>

          <Block label="aktuelle entwicklungen">
            <p className="text-body whitespace-pre-line">
              {deepIntel.recent_news}
            </p>
          </Block>

          <Block label="technische schmerzpunkte">
            <p className="text-body whitespace-pre-line">
              {deepIntel.technical_pain_points}
            </p>
          </Block>

          <Block label="wettbewerb">
            <p className="text-body whitespace-pre-line">
              {deepIntel.competition_context}
            </p>
          </Block>

          <Block label="fragen am stand">
            <p className="text-subtitle whitespace-pre-line">
              {deepIntel.opening_questions}
            </p>
          </Block>

          <Block label="isp-lifecycle-match">
            <ul className="space-y-1">
              {(deepIntel.isp_lifecycle_match as string[] ?? []).map((l) => {
                const it = lifecycleById.get(l);
                return (
                  <li key={l} className="text-body flex items-baseline gap-2">
                    {it && (
                      <span className="tabular-nums text-meta">{it.step}</span>
                    )}
                    <span>{it?.name ?? l}</span>
                  </li>
                );
              })}
            </ul>
          </Block>

          <Block label="begruendung">
            <p className="text-body-sm text-[var(--color-near-black)]/70 whitespace-pre-line">
              {deepIntel.full_reasoning}
            </p>
          </Block>
        </>
      )}
    </>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="py-7">
      <Hairline />
      <div className="pt-5">
        <div className="text-meta-strong mb-3">{label}</div>
        {children}
      </div>
    </section>
  );
}
