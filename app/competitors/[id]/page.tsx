import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { ChevronLeft } from "@/components/brand/Icons";
import { AutoRefresh } from "@/components/AutoRefresh";
import { HelpRequestButton } from "@/components/HelpRequestButton";
import { CompetitorRescanShortButton } from "./CompetitorRescanShortButton";
import { CompetitorSettingsView } from "./CompetitorSettingsView";

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

type DetailView = "informationen" | "verlauf" | "kunden" | "einstellungen";
const VIEWS: DetailView[] = ["informationen", "verlauf", "kunden", "einstellungen"];
function parseView(v: string | undefined): DetailView {
  if (v === "intel") return "informationen";
  return v && (VIEWS as string[]).includes(v) ? (v as DetailView) : "informationen";
}

export default async function CompetitorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const view = parseView(sp.view);
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
  const shortRunning = competitor.short_status === "running";
  const shortPending = competitor.short_status === "pending";
  const shortActive = shortRunning || shortPending;
  const hasAnalysis = !!latestVersion;

  return (
    <>
      {shortActive && <AutoRefresh intervalMs={4000} />}

      {/* Back navigation */}
      <div className="mb-6">
        <Link
          href="/competitors"
          className="inline-flex items-center gap-1.5 text-body-sm text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
        >
          <ChevronLeft size={14} />
          Konkurrenten
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-display">
          {competitor.display_name}
          <span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>

        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          <span>{statusLabel}</span>
          {threatLevel && (
            <span className={THREAT_COLORS[threatLevel] ?? ""}>
              Bedrohung: {THREAT_LABELS[threatLevel] ?? threatLevel}
            </span>
          )}
          {competitor.hq_country && (
            <span className="text-[var(--color-near-black)]/55">{competitor.hq_country}</span>
          )}
          {competitor.website && (
            <a
              href={competitor.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] transition-colors"
            >
              {competitor.domain ?? competitor.website}
            </a>
          )}
          {shortRunning && (
            <span className="inline-flex items-center gap-1.5">
              <GoldDot size={6} />
              <span>Analyse laeuft</span>
            </span>
          )}
          {shortPending && !shortRunning && (
            <span className="text-[var(--color-near-black)]/45">Analyse steht an</span>
          )}
        </div>

        <div className="mt-5 flex items-center gap-3 flex-wrap">
          <CompetitorRescanShortButton
            competitorId={competitor.id}
            shortStatus={competitor.short_status}
            hasAnalysis={hasAnalysis}
          />
          <HelpRequestButton
            source="competitors"
            label="Konkurrent"
            context={`Name: ${competitor.display_name}\nStatus: ${competitor.status}\nShort: ${competitor.short_status}\nView: ${view}`}
          />
        </div>
      </header>

      {/* Tab navigation */}
      <nav className="flex gap-0 mb-8 border-b border-[var(--border-color-soft)]">
        {VIEWS.map((v) => {
          const active = view === v;
          const label = v === "informationen" ? "Informationen" : v === "verlauf" ? "Verlauf" : v === "kunden" ? "Kunden" : "Einstellungen";
          return (
            <Link
              key={v}
              href={`?view=${v}`}
              className={`px-4 py-2.5 text-ui relative transition-colors ${
                active
                  ? "text-[var(--color-near-black)] font-semibold"
                  : "text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)]"
              }`}
            >
              {label}
              {active && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-px"
                  style={{ background: "var(--color-near-black)" }}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {view === "informationen" && <InformationenView latestVersion={latestVersion} shortStatus={competitor.short_status} competitorId={competitor.id} hasAnalysis={hasAnalysis} />}
      {view === "verlauf" && <VerlaufView versions={versions ?? []} />}
      {view === "kunden" && <KundenView customerLinks={customerLinks ?? []} />}
      {view === "einstellungen" && (
        <CompetitorSettingsView
          competitorId={competitor.id}
          currentStatus={competitor.status as "suggested" | "active" | "archived" | "rejected"}
        />
      )}
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InformationenView({ latestVersion, shortStatus, competitorId, hasAnalysis }: { latestVersion: any; shortStatus: string | null; competitorId: string; hasAnalysis: boolean }) {
  if (!latestVersion) {
    return (
      <section>
        <div className="card-surface p-6">
          <p className="text-body text-[var(--color-near-black)]/50 mb-4">
            Noch keine Informationen vorhanden.
            {shortStatus === "running" || shortStatus === "pending"
              ? " Analyse laeuft, Seite neu laden wenn abgeschlossen."
              : " Starte eine Analyse mit dem Button oben."}
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="mb-10">
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
                {(latestVersion.growth_signals as string[]).map((s: string, i: number) => (
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
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function VerlaufView({ versions }: { versions: any[] }) {
  if (versions.length === 0) {
    return (
      <section>
        <div className="card-surface p-6 text-body text-[var(--color-near-black)]/50">
          Noch keine Analysen vorhanden.
        </div>
      </section>
    );
  }
  return (
    <section className="mb-10">
      <div className="space-y-2">
        {versions.map((v) => (
          <div
            key={v.id}
            className="card-surface px-5 py-3 flex items-center justify-between gap-4"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-body-sm tabular-nums">
                {new Date(v.created_at).toLocaleDateString("de-DE")}
              </span>
              {v.threat_level && (
                <span className={`text-meta ${THREAT_COLORS[v.threat_level] ?? ""}`}>
                  Bedrohung: {THREAT_LABELS[v.threat_level] ?? v.threat_level}
                </span>
              )}
              {v.one_liner && (
                <span className="text-body-sm text-[var(--color-near-black)]/65">
                  {v.one_liner}
                </span>
              )}
            </div>
            <span className="text-meta text-[var(--color-near-black)]/40 shrink-0">
              {v.model ?? ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function KundenView({ customerLinks }: { customerLinks: any[] }) {
  if (customerLinks.length === 0) {
    return (
      <section>
        <div className="card-surface p-6 text-body text-[var(--color-near-black)]/50">
          Noch keine Kunden-Ueberschneidungen erkannt.
        </div>
      </section>
    );
  }
  return (
    <section className="mb-10">
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
            {customerLinks.map((link) => (
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
  );
}
