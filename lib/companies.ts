import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyChatContext } from "./claude";

// Legal-Entity-Suffixe, die wir beim Vergleich strippen, damit
// "Bosch GmbH" und "Bosch" als dieselbe Firma matchen.
// Muss in Sync gehalten werden mit der Migration 0010_companies.sql
// (gleiches Regex im _normalize_company_name Helper).
const LEGAL_SUFFIX_RE =
  /\s+(gmbh|ag|ltd|inc|corp\.?|llc|co\.?|s\.?a\.?|s\.?r\.?l\.?|kg|ohg|ug|se|plc|pty|bv|nv|oy|ab)$/i;

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(LEGAL_SUFFIX_RE, "").trim();
}

export function normalizeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Find-or-create a company row for this user.
 * Match priority:
 *   1. By domain (if website resolves to a host)
 *   2. By normalized_name fallback
 *
 * Race-safe: parallel inserts with the same key fail at the partial-unique
 * indices uniq_companies_user_domain / uniq_companies_user_normname,
 * the recovery SELECT picks up whichever worker won.
 */
export async function ensureCompany(
  supabase: SupabaseClient,
  userId: string,
  name: string,
  website: string | null | undefined,
): Promise<string> {
  const domain = normalizeDomain(website);
  const normName = normalizeName(name);

  if (domain) {
    const { data } = await supabase
      .from("companies")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  {
    const { data } = await supabase
      .from("companies")
      .select("id")
      .eq("normalized_name", normName)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }

  const { data: ins, error } = await supabase
    .from("companies")
    .insert({
      user_id: userId,
      display_name: name,
      normalized_name: normName,
      domain,
      website: website ?? null,
    })
    .select("id")
    .single();
  if (!error && ins) return (ins as { id: string }).id;

  // Race recovery: parallel worker won, re-select.
  if (domain) {
    const { data } = await supabase
      .from("companies")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  {
    const { data } = await supabase
      .from("companies")
      .select("id")
      .eq("normalized_name", normName)
      .maybeSingle();
    if (data) return (data as { id: string }).id;
  }
  throw new Error(`ensureCompany failed for "${name}": ${error?.message ?? "no row after insert"}`);
}

// Vollstaendige Firmen-Directory fuer den globalen Companies-Chat-Kontext.
// Liest aus companies_overview (RLS scoped via security_invoker). Sortiert
// nach best_match_confidence DESC NULLS LAST, damit Claude bei "Top X" direkt
// von oben durch die Liste gehen kann. Begrenzt auf 5000 Rows als Soft-Cap.
// Returnt [] bei Error — der Chat fuehrt dann via search_companies-Tool weiter.
export async function loadCompanyDirectory(
  supabase: SupabaseClient,
): Promise<CompanyChatContext[]> {
  const { data, error } = await supabase
    .from("companies_overview")
    .select(
      "id, display_name, domain, website, best_priority, best_match_confidence, best_one_liner, union_sectors, shows",
    )
    .order("best_match_confidence", { ascending: false, nullsFirst: false })
    .range(0, 4999);
  if (error || !data) return [];

  return (data as Array<{
    id: string;
    display_name: string;
    domain: string | null;
    website: string | null;
    best_priority: "hoch" | "mittel" | "niedrig" | null;
    best_match_confidence: number | null;
    best_one_liner: string | null;
    union_sectors: string[] | null;
    shows: Array<{ id: string; name: string }> | null;
  }>).map((r) => ({
    id: r.id,
    display_name: r.display_name,
    domain: r.domain,
    website: r.website,
    best_priority: r.best_priority,
    best_match_confidence: r.best_match_confidence,
    best_one_liner: r.best_one_liner,
    union_sectors: r.union_sectors ?? [],
    shows: (r.shows ?? []).map((s) => s.name),
  }));
}
