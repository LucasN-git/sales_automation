import { ISP_CATALOG } from "./isp-catalog";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AppSettings = {
  user_id: string;
  prio_context: string;
  short_model: string;
  deep_model: string;
  updated_at: string;
};

export const SHORT_MODEL_DEFAULT = "claude-haiku-4-5-20251001";
export const DEEP_MODEL_DEFAULT = "claude-sonnet-4-6";

/**
 * Auto-generated default Prio-Kontext from the brand bible.
 * Editable in /settings.
 */
export function defaultPrioContext(): string {
  const sectors = ISP_CATALOG.sectors
    .map((s) => `- ${s.name} (${s.id}): ${s.scope}`)
    .join("\n");
  const lifecycle = ISP_CATALOG.lifecycle
    .map((l) => `- ${l.step} ${l.name} (${l.id})`)
    .join("\n");
  const diffs = ISP_CATALOG.differentiators.map((d) => `- ${d}`).join("\n");

  return `# ISP Power Systems — Prio-Kontext

Diese Beschreibung steuert, wie Aussteller bewertet und gematcht werden.
Bearbeite freitext, was hier steht; Sektor-/Lifecycle-IDs in den eckigen Klammern sind kanonisch und sollten so bleiben.

## Positioning
${ISP_CATALOG.positioning}

## Zielsektoren (kanonische IDs)
${sectors}

## Lifecycle-Capabilities (kanonische IDs)
${lifecycle}

## Differentiators
${diffs}

## Hot-Signale (priority_label = "hot")
- Aussteller baut elektrische/batteriegetriebene Hardware in einem unserer Sektoren
- Custom-Battery-Pack-Bedarf erkennbar (eigene Plattform, eigenes Form-Faktor)
- Validation/Test-Bedarf erwaehnt (Climate, Abuse, Lifetime)
- Anwendung ist Defense, Aerospace, Mobile-Robotics, Space, Maritime, alternative Mobility

## Warm-Signale (priority_label = "warm")
- Aussteller in benachbartem Bereich (Robotik allgemein, Industrie-IoT, Logistik) mit potenziellem Power-Bedarf
- Reseller / Integrator von Batterie-Systemen (kein direkter Customer, aber Channel)
- Forschungseinrichtung mit Cell/Pack/Test-Themen

## Cold-Signale (priority_label = "cold")
- reine Software, Services, Consulting ohne Hardware-Bezug
- reine Munitions-/Waffen-Hersteller ohne elektrifizierte Plattform
- Textil/Bekleidung, Messe-Veranstalter selbst, Verbaende

## Disqualifier (match_confidence <= 10)
- Cybersecurity, IT-Services, Versicherungen
- Endkunden-Konsumprodukte ohne Industrial-Anwendung
- Themen die offensichtlich nichts mit Energy-Storage oder elektrifizierten Antrieben zu tun haben`;
}

export async function getSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as AppSettings;

  // Initialise with defaults on first read
  const seed = {
    user_id: userId,
    prio_context: defaultPrioContext(),
    short_model: SHORT_MODEL_DEFAULT,
    deep_model: DEEP_MODEL_DEFAULT,
  };
  const { data: created, error } = await supabase
    .from("app_settings")
    .insert(seed)
    .select("*")
    .single();
  if (error) throw new Error(`init settings failed: ${error.message}`);
  return created as AppSettings;
}

/**
 * Service-role variant: looks up the FIRST app_settings row (single-user app).
 * Used by Inngest workers that have no user-cookie.
 */
export async function getSettingsServiceRole(
  supabase: SupabaseClient,
): Promise<AppSettings | null> {
  const { data } = await supabase
    .from("app_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as AppSettings | null) ?? null;
}

export async function updatePrioContext(
  supabase: SupabaseClient,
  userId: string,
  prioContext: string,
): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .update({ prio_context: prioContext })
    .eq("user_id", userId);
  if (error) throw new Error(`update prio_context: ${error.message}`);
}

export async function updateModels(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<Pick<AppSettings, "short_model" | "deep_model">>,
): Promise<void> {
  const { error } = await supabase
    .from("app_settings")
    .update(patch)
    .eq("user_id", userId);
  if (error) throw new Error(`update models: ${error.message}`);
}
