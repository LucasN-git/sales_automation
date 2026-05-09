import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { GoldDot } from "@/components/brand/GoldDot";
import { AutoRefresh } from "@/components/AutoRefresh";
import { NewShowForm } from "./NewShowForm";

export const dynamic = "force-dynamic";

type TradeShowRow = {
  id: string;
  name: string;
  source_url: string | null;
  year: number | null;
  status: string;
  created_at: string;
  exhibitor_count: number;
};

export default async function Dashboard() {
  const supabase = await createClient();

  const { data: shows } = await supabase
    .from("trade_shows")
    .select("id, name, source_url, year, status, created_at, exhibitors(count)")
    .order("created_at", { ascending: false });

  const rows: TradeShowRow[] = (shows ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    source_url: s.source_url,
    year: s.year,
    status: s.status,
    created_at: s.created_at,
    exhibitor_count: s.exhibitors?.[0]?.count ?? 0,
  }));

  const { data: { user } } = await supabase.auth.getUser();
  const anyActive = rows.some((r) => r.status === "queued" || r.status === "crawling");

  return (
    <main className="min-h-screen px-8 py-12 max-w-6xl mx-auto">
      {anyActive && <AutoRefresh intervalMs={6000} />}
      <header className="flex items-end justify-between mb-14 gap-6 flex-wrap">
        <div>
          <h1 className="text-display">
            Sales Intelligence<span style={{ color: "var(--color-gold)" }}>.</span>
          </h1>
          <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-xl">
            Messen scannen, Aussteller anreichern, ISP-Capability-Match pro Lead. Vorbereitete Pitches statt Kaltstart am Stand.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <Link
            href="/settings"
            className="text-ui text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] transition-colors"
          >
            einstellungen
          </Link>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="text-ui text-[var(--color-near-black)]/55 hover:text-[var(--color-gold)] transition-colors"
            >
              {user?.email ? `${user.email} · logout` : "logout"}
            </button>
          </form>
        </div>
      </header>

      <NewShowForm />

      <section className="mt-14">
        <h2 className="text-meta-strong mb-4">messen</h2>

        {rows.length === 0 ? (
          <div className="py-10 text-body text-[var(--color-near-black)]/50 box-line px-5">
            noch keine messen erfasst
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/shows/${s.id}`}
                  className="block px-5 py-4 box-line hover:bg-[var(--color-near-black)]/[0.02] transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-6">
                    <div className="flex items-baseline gap-4 min-w-0">
                      <span className="text-meta tabular-nums shrink-0">
                        {new Date(s.created_at).toLocaleDateString("de-DE")}
                      </span>
                      <span className="text-title truncate">{s.name}</span>
                      {s.year && (
                        <span className="text-body text-[var(--color-near-black)]/50">
                          {s.year}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <span className="text-meta-strong">
                        {s.exhibitor_count} aussteller
                      </span>
                      <StatusBadge status={s.status} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    queued: "wartet",
    crawling: "laeuft",
    paused: "pausiert",
    ready: "fertig",
    partial: "teilweise",
    failed: "fehler",
  };
  const isActive = status === "crawling";
  return (
    <span className="inline-flex items-center gap-2 text-meta-strong">
      {isActive && <GoldDot size={6} />}
      {labels[status] ?? status}
    </span>
  );
}
