import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CrawlPlanSchema } from "@/lib/crawl-plan";
import { Hairline } from "@/components/brand/Hairline";
import { ShowSettingsForm } from "./ShowSettingsForm";

export const dynamic = "force-dynamic";

export default async function ShowSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: show } = await supabase
    .from("trade_shows")
    .select(
      "id, name, source_url, year, chat_context, crawl_plan, expected_exhibitor_count, status",
    )
    .eq("id", id)
    .single();
  if (!show) notFound();

  const crawlPlanParsed = show.crawl_plan
    ? CrawlPlanSchema.safeParse(show.crawl_plan)
    : null;
  const crawlPlan = crawlPlanParsed?.success ? crawlPlanParsed.data : null;

  return (
    <>
      <div className="mb-6 text-meta">
        <Link
          href={`/shows/${id}`}
          className="hover:text-[var(--color-near-black)] transition-colors"
        >
          ← {show.name}
        </Link>
      </div>

      <header className="mb-10">
        <h1 className="text-display">
          Einstellungen<span style={{ color: "var(--color-gold)" }}>.</span>
        </h1>
        <p className="mt-3 text-body text-[var(--color-near-black)]/65 max-w-2xl">
          Stammdaten, Chat-Kontext und Crawl-Plan dieser Messe. Stammdaten- und
          Kontext-Aenderungen wirken sofort. Crawl-Plan-Aenderungen erst beim
          naechsten neu starten.
        </p>
      </header>

      <Hairline />

      <ShowSettingsForm
        showId={id}
        initial={{
          name: show.name,
          source_url: show.source_url ?? "",
          year: show.year ?? null,
          chat_context: show.chat_context ?? "",
          expected_exhibitor_count: show.expected_exhibitor_count ?? null,
          crawl_plan: crawlPlan,
        }}
      />
    </>
  );
}
