import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Hairline } from "@/components/brand/Hairline";
import { ISP_CATALOG } from "@/lib/isp-catalog";

export const dynamic = "force-dynamic";

export default async function ExhibitorDetailPage({
  params,
}: {
  params: Promise<{ id: string; exId: string }>;
}) {
  const { id: showId, exId } = await params;
  const supabase = await createClient();

  const { data: exhibitor } = await supabase
    .from("exhibitors")
    .select("id, company_name, website, booth, enrichment_status, trade_show_id")
    .eq("id", exId)
    .single();

  if (!exhibitor) notFound();

  const { data: show } = await supabase
    .from("trade_shows")
    .select("id, name")
    .eq("id", exhibitor.trade_show_id)
    .single();

  const { data: intel } = await supabase
    .from("exhibitor_intel")
    .select(
      "business_field, estimated_size, power_needs_hypothesis, isp_sector_match, isp_lifecycle_match, match_confidence, pitch_hook, reasoning, updated_at",
    )
    .eq("exhibitor_id", exId)
    .maybeSingle();

  const sectorById = new Map(ISP_CATALOG.sectors.map((s) => [s.id, s]));
  const lifecycleById = new Map(ISP_CATALOG.lifecycle.map((l) => [l.id, l]));

  return (
    <main className="min-h-screen px-8 py-12 max-w-3xl mx-auto">
      <div className="mb-8 text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/50">
        <Link href={`/shows/${showId}`} className="hover:text-[var(--color-near-black)]">
          ← {show?.name ?? "Messe"}
        </Link>
      </div>

      <header className="mb-12">
        <h1 className="text-[48px] leading-[1.05] font-extrabold tracking-[-0.02em]">
          {exhibitor.company_name}
        </h1>
        <div className="mt-3 flex items-center gap-4 text-[15px] text-[var(--color-near-black)]/70">
          {exhibitor.website && (
            <a
              href={exhibitor.website}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 hover:text-[var(--color-near-black)]"
            >
              {new URL(exhibitor.website).hostname.replace(/^www\./, "")}
            </a>
          )}
          {exhibitor.booth && <span>Stand {exhibitor.booth}</span>}
          <span className="uppercase tracking-[0.06em] text-[13px]">
            {exhibitor.enrichment_status}
          </span>
        </div>
      </header>

      {!intel ? (
        <div className="py-12 text-[17px] text-[var(--color-near-black)]/50">
          Noch keine Recherche-Daten. {exhibitor.enrichment_status === "running" && "Crawl läuft."}
        </div>
      ) : (
        <div>
          <Block label="Geschäftsfeld">
            <p className="text-[18px] leading-[1.5]">{intel.business_field}</p>
            {intel.estimated_size && (
              <p className="mt-3 text-[15px] text-[var(--color-near-black)]/60">
                Größe (Schätzung): {intel.estimated_size}
              </p>
            )}
          </Block>

          <Block label="Power-Bedarf-Hypothese">
            <p className="text-[18px] leading-[1.5]">{intel.power_needs_hypothesis}</p>
          </Block>

          <Block label="ISP-Match">
            <div className="flex items-baseline gap-6 mb-4">
              <span className="tabular-nums text-[56px] font-extrabold leading-none">
                {intel.match_confidence ?? 0}
                <span style={{ color: "var(--color-gold)" }}>.</span>
              </span>
              <span className="text-[15px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/60">
                Confidence
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/50 mb-2">
                  Sektoren
                </div>
                <ul className="space-y-1">
                  {(intel.isp_sector_match ?? []).map((s: string) => (
                    <li key={s} className="text-[17px]">
                      {sectorById.get(s)?.name ?? s}
                    </li>
                  ))}
                  {(!intel.isp_sector_match || intel.isp_sector_match.length === 0) && (
                    <li className="text-[15px] text-[var(--color-near-black)]/40">—</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/50 mb-2">
                  Lifecycle
                </div>
                <ul className="space-y-1">
                  {(intel.isp_lifecycle_match ?? []).map((l: string) => {
                    const it = lifecycleById.get(l);
                    return (
                      <li key={l} className="text-[17px] flex items-baseline gap-2">
                        {it && (
                          <span className="tabular-nums text-[13px] text-[var(--color-near-black)]/50">
                            {it.step}
                          </span>
                        )}
                        <span>{it?.name ?? l}</span>
                      </li>
                    );
                  })}
                  {(!intel.isp_lifecycle_match || intel.isp_lifecycle_match.length === 0) && (
                    <li className="text-[15px] text-[var(--color-near-black)]/40">—</li>
                  )}
                </ul>
              </div>
            </div>
          </Block>

          <Block label="Darauf ansprechen">
            <p className="text-[20px] leading-[1.4] font-bold">{intel.pitch_hook}</p>
          </Block>

          {intel.reasoning && (
            <Block label="Begründung">
              <p className="text-[15px] leading-[1.6] text-[var(--color-near-black)]/75 whitespace-pre-line">
                {intel.reasoning}
              </p>
            </Block>
          )}
        </div>
      )}
    </main>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="py-8">
      <Hairline />
      <div className="pt-6">
        <div className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/50 mb-3">
          {label}
        </div>
        {children}
      </div>
    </section>
  );
}
