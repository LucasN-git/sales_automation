import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const THREAT_LABELS: Record<string, string> = {
  low: "Gering",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
};

const THREAT_COLORS: Record<string, string> = {
  low: "text-[var(--color-near-black)]/40",
  medium: "text-[var(--color-near-black)]/70",
  high: "text-[var(--color-gold)]",
  critical: "text-[var(--color-error)]",
};

const STATUS_LABELS: Record<string, string> = {
  suggested: "Vorgeschlagen",
  active: "Aktiv",
  archived: "Archiviert",
  rejected: "Abgelehnt",
};

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: competitor }, { data: versions }, { data: customerLinks }] = await Promise.all([
    supabase
      .from("competitors")
      .select("id, display_name, website, domain, hq_country, status, short_status, created_at")
      .eq("id", id)
      .single(),
    supabase
      .from("competitor_versions")
      .select(
        "id, one_liner, positioning, portfolio, isp_sector_match, threat_level, growth_signals, customers, competitive_angles_vs_isp, recent_news, tokens_in, tokens_out, web_search_cost_usd, model, created_at",
      )
      .eq("competitor_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("competitor_customer_links")
      .select("id, customer_name_raw, evidence_url, match_method, match_score, companies(display_name)")
      .eq("competitor_id", id)
      .limit(20),
  ]);

  if (!competitor) notFound();

  const latestVersion = versions?.[0] ?? null;
  const threatLevel = latestVersion?.threat_level ?? null;
  const statusLabel = STATUS_LABELS[competitor.status] ?? competitor.status;

  return (
    <>
      <div className="mb-6 text-meta">
        <Link href="/competitors" className="hover:text-[var(--color-near-black)] transition-colors">
          ← Konkurrenten
        </Link>
      </div>

      <header className="mb-10">
        <div className="flex items-start gap-4 flex-wrap">
          <h1 className="text-display flex-1">
            {competitor.display_name}
            <span style={{ color: "var(--color-gold)" }}>.</span>
          </h1>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-meta">
          <span className="px-2 py-0.5 border border-[var(--border-color-soft)]">
            {statusLabel}
          </span>
          {threatLevel && (
            <span className={`px-2 py-0.5 border border-[var(--border-color-soft)] ${THREAT_COLORS[threatLevel]}`}>
              Bedrohung: {THREAT_LABELS[threatLevel] ?? threatLevel}
            </span>
          )}
          {competitor.hq_country && (
            <span className="text-[var(--color-near-black)]/50">{competitor.hq_country}</span>
          )}
          {competitor.website && (
            <a
              href={competitor.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)] transition-colors"
            >
              {competitor.domain ?? competitor.website}
            </a>
          )}
          <span className="text-[var(--color-near-black)]/40">
            Short: {competitor.short_status}
          </span>
        </div>

        <p className="mt-4 text-body text-[var(--color-near-black)]/60 max-w-xl">
          Starte eine Short-Analyse oder stelle Fragen im Chat rechts.
          Claude kann diese Seite als Kontext nutzen und Intel direkt aktualisieren.
        </p>
      </header>

      {/* Latest version intel */}
      {latestVersion ? (
        <section className="mb-10">
          <h2 className="text-title mb-6">Intel</h2>

          <div className="grid gap-4">
            {latestVersion.one_liner && (
              <div className="card-surface p-5">
                <p className="text-meta uppercase tracking-wider mb-1 text-[var(--color-near-black)]/40">
                  Zusammenfassung
                </p>
                <p className="text-body">{latestVersion.one_liner}</p>
              </div>
            )}

            {latestVersion.positioning && (
              <div className="card-surface p-5">
                <p className="text-meta uppercase tracking-wider mb-1 text-[var(--color-near-black)]/40">
                  Positionierung
                </p>
                <p className="text-body">{latestVersion.positioning}</p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {latestVersion.portfolio && (latestVersion.portfolio as string[]).length > 0 && (
                <div className="card-surface p-5">
                  <p className="text-meta uppercase tracking-wider mb-2 text-[var(--color-near-black)]/40">
                    Portfolio
                  </p>
                  <ul className="space-y-1">
                    {(latestVersion.portfolio as string[]).map((item, i) => (
                      <li key={i} className="text-body-sm text-[var(--color-near-black)]/80">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {latestVersion.isp_sector_match && (latestVersion.isp_sector_match as string[]).length > 0 && (
                <div className="card-surface p-5">
                  <p className="text-meta uppercase tracking-wider mb-2 text-[var(--color-near-black)]/40">
                    ISP-Sektor-Match
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {(latestVersion.isp_sector_match as string[]).map((s) => (
                      <span
                        key={s}
                        className="px-2 py-0.5 text-meta border border-[var(--border-color-soft)]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {latestVersion.growth_signals && (latestVersion.growth_signals as string[]).length > 0 && (
                <div className="card-surface p-5">
                  <p className="text-meta uppercase tracking-wider mb-2 text-[var(--color-near-black)]/40">
                    Wachstumssignale
                  </p>
                  <ul className="space-y-1">
                    {(latestVersion.growth_signals as string[]).map((s, i) => (
                      <li key={i} className="text-body-sm text-[var(--color-near-black)]/80">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {latestVersion.competitive_angles_vs_isp && (
                <div className="card-surface p-5">
                  <p className="text-meta uppercase tracking-wider mb-1 text-[var(--color-near-black)]/40">
                    Wettbewerbsposition gg. ISP
                  </p>
                  <p className="text-body-sm">{latestVersion.competitive_angles_vs_isp as string}</p>
                </div>
              )}
            </div>

            {latestVersion.recent_news && (
              <div className="card-surface p-5">
                <p className="text-meta uppercase tracking-wider mb-1 text-[var(--color-near-black)]/40">
                  Aktuelle Neuigkeiten
                </p>
                <p className="text-body-sm">{latestVersion.recent_news as string}</p>
              </div>
            )}
          </div>

          <p className="mt-3 text-meta text-[var(--color-near-black)]/40">
            Analysiert{" "}
            {new Date(latestVersion.created_at).toLocaleDateString("de-DE", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            })}{" "}
            mit {latestVersion.model ?? "unbekanntem Modell"}
          </p>
        </section>
      ) : (
        <section className="mb-10">
          <div className="card-surface p-6 text-body text-[var(--color-near-black)]/50">
            Noch keine Intel verfuegbar. Starte eine Short-Analyse im Chat.
          </div>
        </section>
      )}

      {/* Customer links */}
      {customerLinks && customerLinks.length > 0 && (
        <section className="mb-10">
          <h2 className="text-title mb-4">Kunden-Ueberschneidungen</h2>
          <div className="card-surface overflow-hidden">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border-color-soft)]">
                  <th className="text-left px-4 py-2.5 text-meta text-[var(--color-near-black)]/40 font-normal">
                    Kundenname
                  </th>
                  <th className="text-left px-4 py-2.5 text-meta text-[var(--color-near-black)]/40 font-normal hidden md:table-cell">
                    Match
                  </th>
                  <th className="text-left px-4 py-2.5 text-meta text-[var(--color-near-black)]/40 font-normal hidden md:table-cell">
                    Quelle
                  </th>
                </tr>
              </thead>
              <tbody>
                {customerLinks.map((link: any) => (
                  <tr
                    key={link.id}
                    className="border-b border-[var(--border-color-soft)] last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      {link.companies?.display_name ?? link.customer_name_raw}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--color-near-black)]/50 hidden md:table-cell">
                      {link.match_method}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      {link.evidence_url ? (
                        <a
                          href={link.evidence_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)] transition-colors"
                        >
                          Link
                        </a>
                      ) : (
                        <span className="text-[var(--color-near-black)]/30">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Version history */}
      {versions && versions.length > 1 && (
        <section className="mb-10">
          <h2 className="text-title mb-4">Analyse-Verlauf</h2>
          <div className="space-y-2">
            {versions.slice(1).map((v) => (
              <div
                key={v.id}
                className="card-surface px-5 py-3 flex items-center justify-between"
              >
                <div>
                  <span className="text-body-sm">
                    {new Date(v.created_at).toLocaleDateString("de-DE")}
                  </span>
                  {v.threat_level && (
                    <span className="ml-3 text-meta text-[var(--color-near-black)]/50">
                      Bedrohung: {THREAT_LABELS[v.threat_level] ?? v.threat_level}
                    </span>
                  )}
                </div>
                <span className="text-meta text-[var(--color-near-black)]/40">
                  {v.model ?? ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
