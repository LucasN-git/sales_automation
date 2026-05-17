import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName, normalizeDomain } from "../companies";
import type { CompetitorDiscoveryItem } from "./schemas";

/**
 * Find-or-create a competitor row for this user, dedupe per Domain (primary)
 * oder normalized_name (fallback). Race-safe ueber die partial-unique-Indices
 * uniq_competitors_user_domain / uniq_competitors_user_normname.
 *
 * Pattern entlehnt von ensureCompany() in lib/companies.ts.
 *
 * Returns: { id, created } - created=true wenn neu insertiert, false wenn matched.
 * Setzt status='suggested' bei Insert; bei Match wird der bestehende Status
 * NICHT ueberschrieben (User kann ja schon active gesetzt haben).
 */
export async function ensureCompetitor(
  supabase: SupabaseClient,
  userId: string,
  input: {
    displayName: string;
    website: string | null | undefined;
    hqCountry: string | null | undefined;
    sourceEvent: "auto_discovery" | "manual";
    discoveryRunId: string | null;
  },
): Promise<{ id: string; created: boolean }> {
  const domain = normalizeDomain(input.website);
  const normName = normalizeName(input.displayName);

  if (domain) {
    const { data } = await supabase
      .from("competitors")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();
    if (data) return { id: (data as { id: string }).id, created: false };
  }
  {
    const { data } = await supabase
      .from("competitors")
      .select("id")
      .eq("normalized_name", normName)
      .maybeSingle();
    if (data) return { id: (data as { id: string }).id, created: false };
  }

  const { data: ins, error } = await supabase
    .from("competitors")
    .insert({
      user_id: userId,
      display_name: input.displayName,
      normalized_name: normName,
      domain,
      website: input.website ?? null,
      hq_country: input.hqCountry ?? null,
      status: "suggested",
      source_event: input.sourceEvent,
      discovery_run_id: input.discoveryRunId,
    })
    .select("id")
    .single();
  if (!error && ins) return { id: (ins as { id: string }).id, created: true };

  // Race-Recovery: parallel worker hat parallel inserted, re-select.
  if (domain) {
    const { data } = await supabase
      .from("competitors")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();
    if (data) return { id: (data as { id: string }).id, created: false };
  }
  {
    const { data } = await supabase
      .from("competitors")
      .select("id")
      .eq("normalized_name", normName)
      .maybeSingle();
    if (data) return { id: (data as { id: string }).id, created: false };
  }
  throw new Error(
    `ensureCompetitor failed for "${input.displayName}": ${error?.message ?? "no row after insert"}`,
  );
}

export type PersistProgress =
  | { kind: "created"; displayName: string; competitorId: string }
  | { kind: "matched"; displayName: string; competitorId: string }
  | { kind: "failed"; displayName: string; error: string };

/**
 * Persistiert eine Discovery-Batch idempotent. Returnt Counts fuer Audit.
 * Optionaler `onProgress`-Callback wird pro Item aufgerufen, damit der Caller
 * (Inngest-Function) live-loggen kann. Best-effort: ein onProgress-Wurf wird
 * geschluckt, damit ein Logging-Bug den Batch nicht killt.
 */
export async function persistDiscoveryBatch(
  supabase: SupabaseClient,
  userId: string,
  items: CompetitorDiscoveryItem[],
  discoveryRunId: string,
  onProgress?: (event: PersistProgress) => Promise<void> | void,
): Promise<{ total: number; created: number; matched: number; failed: number }> {
  let created = 0;
  let matched = 0;
  let failed = 0;
  for (const item of items) {
    try {
      const result = await ensureCompetitor(supabase, userId, {
        displayName: item.display_name,
        website: item.website ?? null,
        hqCountry: item.hq_country ?? null,
        sourceEvent: "auto_discovery",
        discoveryRunId,
      });
      if (result.created) created++;
      else matched++;
      if (onProgress) {
        try {
          await onProgress({
            kind: result.created ? "created" : "matched",
            displayName: item.display_name,
            competitorId: result.id,
          });
        } catch {
          // ignore logging failures
        }
      }
    } catch (e) {
      failed++;
      console.error("persistDiscoveryBatch item failed:", item.display_name, e);
      if (onProgress) {
        try {
          await onProgress({
            kind: "failed",
            displayName: item.display_name,
            error: e instanceof Error ? e.message : String(e),
          });
        } catch {
          // ignore
        }
      }
    }
  }
  return { total: items.length, created, matched, failed };
}
