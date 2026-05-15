import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Liste der Competitors. Filter optional: ?status=suggested|active|archived|rejected.
 * RLS scoped via auth.uid().
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  let q = supabase
    .from("competitors_overview")
    .select(
      "id, display_name, domain, website, hq_country, status, source_event, current_version_id, created_at, updated_at, latest_scan_kind, one_liner, positioning, isp_sector_match, threat_level, latest_version_at, version_count, customer_link_count, matched_customer_count, show_link_count",
    )
    .order("created_at", { ascending: false })
    .limit(2000);

  if (status && ["suggested", "active", "archived", "rejected"].includes(status)) {
    q = q.eq("status", status);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}
