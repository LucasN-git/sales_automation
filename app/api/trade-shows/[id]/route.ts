import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CrawlPlanSchema } from "@/lib/crawl-plan";
import { showExhibitorsTag } from "@/lib/show-cache";

const PatchBody = z.object({
  name: z.string().min(2).max(200).optional(),
  source_url: z.string().url().nullable().optional(),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  chat_context: z.string().max(8000).nullable().optional(),
  crawl_plan: z.unknown().optional(),
  is_favorite: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if ("name" in body) update.name = body.name;
  if ("source_url" in body) {
    update.source_url = body.source_url;
    // Wenn der User die URL manuell setzt, ist die automatische Suche abgeschlossen.
    if (body.source_url) update.url_search_status = "done";
  }
  if ("year" in body) update.year = body.year;
  if ("chat_context" in body) {
    const trimmed = typeof body.chat_context === "string" ? body.chat_context.trim() : null;
    update.chat_context = trimmed && trimmed.length > 0 ? trimmed : null;
  }
  if ("is_favorite" in body) update.is_favorite = body.is_favorite;
  if ("crawl_plan" in body) {
    if (body.crawl_plan === null) {
      update.crawl_plan = null;
    } else {
      const parsed = CrawlPlanSchema.safeParse(body.crawl_plan);
      if (!parsed.success) {
        return NextResponse.json(
          { error: `invalid crawl_plan: ${parsed.error.message}` },
          { status: 400 },
        );
      }
      update.crawl_plan = parsed.data;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("trade_shows")
    .update(update)
    .eq("id", id)
    .select(
      "id, name, source_url, year, chat_context, crawl_plan, expected_exhibitor_count, is_favorite",
    )
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "update failed" }, { status: 500 });
  }

  revalidateTag(showExhibitorsTag(id));

  return NextResponse.json({ show: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { error } = await supabase.from("trade_shows").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
