import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "./supabase/server";

export type WebhookEvent = "company_short.upserted" | "company_deep.upserted";

export type WebhookPayload = {
  event: WebhookEvent;
  data: Record<string, unknown>;
};

async function sign(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function fireWebhooks(
  userId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const supabase = createServiceRoleClient() as SupabaseClient;

  const { data: endpoints } = await supabase
    .from("webhook_endpoints")
    .select("id, url, secret")
    .eq("user_id", userId)
    .eq("active", true)
    .contains("events", [event]);

  if (!endpoints || endpoints.length === 0) return;

  const body = JSON.stringify({ event, data });

  await Promise.allSettled(
    endpoints.map(async (ep: { id: string; url: string; secret: string | null }) => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-ISP-Event": event,
      };
      if (ep.secret) {
        headers["X-ISP-Signature"] = await sign(ep.secret, body);
      }
      try {
        await fetch(ep.url, { method: "POST", headers, body });
      } catch {
        // Fire-and-forget: webhook delivery failures never block the pipeline.
      }
    }),
  );
}
