/**
 * MapYourShow detection helpers.
 *
 * MYS hosts each event on a dedicated subdomain (e.g. infocomm26.mapyourshow.com)
 * with a ColdFusion app rooted at `/8_0/`. The Vue/ajax frontend uses session
 * cookies (CFID + CFTOKEN), set by the initial gallery GET, to authorise the
 * downstream JSON proxy at `/8_0/ajax/remote-proxy.cfm`. No bearer tokens, no
 * headless browser needed.
 */

export type MapYourShowConfig = {
  appRoot: string;
  showCode: string;
};

export function looksLikeMapYourShowUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^[a-z0-9-]+\.mapyourshow\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Derive app-root and show-code purely from the URL. No HTTP call.
 *
 * Examples:
 *   https://infocomm26.mapyourshow.com/8_0/explore/exhibitor-gallery.cfm
 *     -> { appRoot: "https://infocomm26.mapyourshow.com/8_0", showCode: "INFOCOMM26" }
 *   https://ise2026.mapyourshow.com/8_0/index.cfm
 *     -> { appRoot: "https://ise2026.mapyourshow.com/8_0", showCode: "ISE2026" }
 */
export function extractMapYourShowConfigFromUrl(
  url: string,
): MapYourShowConfig | null {
  try {
    const u = new URL(url);
    if (!/^[a-z0-9-]+\.mapyourshow\.com$/i.test(u.hostname)) return null;
    const showCode = u.hostname.split(".")[0]!.toUpperCase();
    if (!showCode) return null;
    return {
      appRoot: `${u.origin}/8_0`,
      showCode,
    };
  } catch {
    return null;
  }
}
