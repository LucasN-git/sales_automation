/**
 * ExpoFP detection helpers.
 *
 * ExpoFP hosts each event under a vanity subdomain (e.g.
 * newyorkbuildexpo2026.expofp.com) and exposes the complete floor-plan +
 * exhibitor dataset as an unauthenticated `/data/data.json` blob (the same
 * file the in-browser floor-plan widget hydrates from). The blob carries
 * exhibitors, booths, categories — everything we need in one call.
 */

export type ExpoFpConfig = {
  /** Origin including protocol, no trailing slash. */
  origin: string;
  /** First subdomain segment. Useful as an event identifier in logs. */
  eventId: string;
};

export function looksLikeExpoFpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\.expofp\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

export function extractExpoFpConfigFromUrl(url: string): ExpoFpConfig | null {
  try {
    const u = new URL(url);
    if (!/\.expofp\.com$/i.test(u.hostname)) return null;
    if (/^(www|app|developer|help)\.expofp\.com$/i.test(u.hostname)) return null;
    const eventId = u.hostname.split(".")[0]!;
    if (!eventId) return null;
    return { origin: u.origin, eventId };
  } catch {
    return null;
  }
}
