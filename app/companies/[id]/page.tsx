import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PRIO_COLORS: Record<string, string> = {
  hoch: "border-[var(--color-near-black)] text-[var(--color-near-black)] font-bold",
  mittel: "border-[var(--color-near-black)]/60 text-[var(--color-near-black)]/80",
  niedrig: "border-[var(--color-hairline-light)] text-[var(--color-near-black)]/40",
};

type ShortRow = {
  one_liner: string | null;
  priority_label: string | null;
  match_confidence: number | null;
  isp_sector_match: string[] | null;
};

type DeepRow = {
  business_summary: string | null;
  decision_makers: string | null;
  technical_pain_points: string | null;
  opening_questions: string | null;
  isp_lifecycle_match: string[] | null;
};

type ShowMeta = { id: string; name: string; year: number | null };

type ParticipationRow = {
  id: string;
  booth: string | null;
  short_status: string;
  deep_status: string;
  trade_show_id: string;
  trade_shows: ShowMeta | ShowMeta[] | null;
  exhibitor_short: ShortRow | ShortRow[] | null;
  exhibitor_deep: DeepRow | DeepRow[] | null;
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

  const [{ data: company }, { data: rowsRaw }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, display_name, domain, website, created_at")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("exhibitors")
      .select(
        `id, booth, short_status, deep_status, trade_show_id,
         trade_shows(id, name, year),
         exhibitor_short(one_liner, priority_label, match_confidence, isp_sector_match),
         exhibitor_deep(business_summary, decision_makers, technical_pain_points, opening_questions, isp_lifecycle_match)`,
      )
      .eq("company_id", id),
  ]);

  if (!company) notFound();

  const rows = (rowsRaw ?? []) as unknown as ParticipationRow[];
  const participations = rows
    .map((r) => ({
      id: r.id,
      booth: r.booth,
      short_status: r.short_status,
      deep_status: r.deep_status,
      show: pickSingle<ShowMeta>(r.trade_shows),
      short: pickSingle<ShortRow>(r.exhibitor_short),
      deep: pickSingle<DeepRow>(r.exhibitor_deep),
    }))
    .sort((a, b) => (a.show?.name ?? "").localeCompare(b.show?.name ?? ""));

  return (
    <>
      <div className="mb-6 text-meta">
        <Link
          href="/companies"
          className="hover:text-[var(--color-near-black)] transition-colors"
        >
          ← Unternehmen
        </Link>
      </div>

      <header className="mb-10">
        <h1 className="text-display">
          {company.display_name}
          <span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
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
        {participations.length > 0 && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-meta mr-1">quell-messen</span>
            {participations.map(
              (p) =>
                p.show && (
                  <Link
                    key={p.id}
                    href={`/shows/${p.show.id}/exhibitors/${p.id}`}
                    className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] hover:text-[var(--color-gold)] hover:border-[var(--border-color)] transition-colors"
                  >
                    {p.show.name}
                    {p.show.year ? ` ${p.show.year}` : ""}
                  </Link>
                ),
            )}
          </div>
        )}
      </header>

      {participations.length === 0 ? (
        <div className="py-10 text-body text-[var(--color-near-black)]/50">
          Diese Firma ist noch keiner Messe zugeordnet.
        </div>
      ) : (
        <>
          <h2 className="text-meta-strong mb-4">cross-show-vergleich</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body-sm">
              <thead className="text-meta-strong">
                <tr className="border-b border-[var(--border-color-soft)]">
                  <th className="text-left px-3 py-3 font-normal">messe</th>
                  <th className="text-left px-3 py-3 font-normal">stand</th>
                  <th className="text-left px-3 py-3 font-normal">prio</th>
                  <th className="text-right px-3 py-3 font-normal">match</th>
                  <th className="text-left px-3 py-3 font-normal">sektoren</th>
                  <th className="text-left px-3 py-3 font-normal">one-liner</th>
                </tr>
              </thead>
              <tbody>
                {participations.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--border-color-soft)] align-top"
                  >
                    <td className="px-3 py-3">
                      {p.show ? (
                        <Link
                          href={`/shows/${p.show.id}/exhibitors/${p.id}`}
                          className="hover:text-[var(--color-gold)] transition-colors"
                        >
                          {p.show.name}
                          {p.show.year ? ` ${p.show.year}` : ""}
                        </Link>
                      ) : (
                        "?"
                      )}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{p.booth ?? "—"}</td>
                    <td className="px-3 py-3">
                      {p.short?.priority_label ? (
                        <span
                          className={`text-meta-strong px-2 py-0.5 border ${
                            PRIO_COLORS[p.short.priority_label] ?? ""
                          }`}
                        >
                          {p.short.priority_label}
                        </span>
                      ) : (
                        <span className="text-meta">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {p.short?.match_confidence ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(p.short?.isp_sector_match ?? []).map((s) => (
                          <span
                            key={s}
                            className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55"
                          >
                            {s.replace("_", " ")}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 max-w-xl">
                      {p.short?.one_liner ?? (
                        <span className="text-meta">
                          {p.short_status === "running"
                            ? "wird analysiert"
                            : "noch keine einschaetzung"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <DeepDiveSection participations={participations} />
        </>
      )}
    </>
  );
}

function DeepDiveSection({
  participations,
}: {
  participations: Array<{
    id: string;
    show: { id: string; name: string; year: number | null } | null;
    deep: DeepRow | null;
  }>;
}) {
  const withDeep = participations.filter((p) => p.deep);
  if (withDeep.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="text-meta-strong mb-4">deep dives</h2>
      <div className="space-y-8">
        {withDeep.map((p) => (
          <article key={p.id} className="box-line p-5">
            <header className="mb-4 flex items-baseline justify-between gap-4">
              <div className="text-subtitle">
                {p.show?.name}
                {p.show?.year ? ` ${p.show.year}` : ""}
              </div>
              {p.show && (
                <Link
                  href={`/shows/${p.show.id}/exhibitors/${p.id}`}
                  className="text-meta hover:text-[var(--color-gold)] transition-colors"
                >
                  detail ↗
                </Link>
              )}
            </header>
            <DeepField label="business" value={p.deep!.business_summary} />
            <DeepField label="entscheider" value={p.deep!.decision_makers} />
            <DeepField label="schmerzpunkte" value={p.deep!.technical_pain_points} />
            <DeepField label="oeffnungsfragen" value={p.deep!.opening_questions} />
            {(p.deep!.isp_lifecycle_match ?? []).length > 0 && (
              <div className="mt-4">
                <div className="text-meta-strong mb-2">isp-lifecycle</div>
                <div className="flex flex-wrap gap-1.5">
                  {(p.deep!.isp_lifecycle_match ?? []).map((l) => (
                    <span
                      key={l}
                      className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/55"
                    >
                      {l.replace("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function DeepField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="mb-3 last:mb-0">
      <div className="text-meta-strong mb-1">{label}</div>
      <div className="text-body whitespace-pre-wrap leading-[1.55]">{value}</div>
    </div>
  );
}
