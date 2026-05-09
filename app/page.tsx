import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Hairline } from "@/components/brand/Hairline";
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
      <header className="flex items-end justify-between mb-16">
        <div>
          <h1 className="text-[56px] leading-[1.02] font-extrabold tracking-[-0.02em]">
            Sales Intelligence<span style={{ color: "var(--color-gold)" }}>.</span>
          </h1>
          <p className="mt-4 text-[17px] text-[var(--color-near-black)]/70 max-w-xl">
            Messen scannen, Aussteller anreichern, ISP-Capability-Match pro Lead. Vorbereitete Pitches statt Kaltstart am Stand.
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)]"
          >
            {user?.email ? `${user.email} · Logout` : "Logout"}
          </button>
        </form>
      </header>

      <NewShowForm />

      <section className="mt-16">
        <h2 className="text-[15px] uppercase tracking-[0.08em] mb-6 text-[var(--color-near-black)]/60">
          Messen
        </h2>
        <Hairline />

        {rows.length === 0 ? (
          <div className="py-12 text-[17px] text-[var(--color-near-black)]/50">
            Noch keine Messen erfasst.
          </div>
        ) : (
          <ul>
            {rows.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/shows/${s.id}`}
                  className="block py-5 hover:bg-[var(--color-near-black)]/[0.02]"
                >
                  <div className="flex items-baseline justify-between gap-6">
                    <div className="flex items-baseline gap-4 min-w-0">
                      <span className="text-[13px] tabular-nums text-[var(--color-near-black)]/40 shrink-0">
                        {new Date(s.created_at).toLocaleDateString("de-DE")}
                      </span>
                      <span className="text-[20px] font-bold truncate">{s.name}</span>
                      {s.year && (
                        <span className="text-[15px] text-[var(--color-near-black)]/50">
                          {s.year}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      <span className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-near-black)]/60">
                        {s.exhibitor_count} Aussteller
                      </span>
                      <StatusBadge status={s.status} />
                    </div>
                  </div>
                </Link>
                <Hairline />
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
    queued: "Wartet",
    crawling: "Läuft",
    ready: "Fertig",
    partial: "Teilweise",
    failed: "Fehler",
  };
  const isActive = status === "crawling";
  return (
    <span className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.06em]">
      {isActive && <GoldDot size={6} />}
      {labels[status] ?? status}
    </span>
  );
}
