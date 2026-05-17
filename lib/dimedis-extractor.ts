/**
 * Detects DIMEDIS VIS pages and extracts the API root.
 *
 * DIMEDIS VIS is a German trade-show platform (Koelnmesse family). Every
 * listing page embeds a `<script id="finder-base-config" type="application/json">`
 * block with the JSON config the Vue/finder-frontend bundle hydrates from.
 * That block carries the `visDomain` and current `lang`, which is everything
 * we need to call the unauthenticated REST list endpoint
 * `{visDomain}/vis-api/vis/v2/{lang}/exhibitors` directly.
 *
 * The function works on the initial server-rendered HTML alone, no headless
 * browser required.
 */

export type DimedisConfig = {
  visDomain: string;
  lang: string;
};

const CONFIG_TAG_RE =
  /<script[^>]*id="finder-base-config"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i;

export function extractDimedisConfigFromHtml(html: string): DimedisConfig | null {
  if (!html) return null;
  const m = CONFIG_TAG_RE.exec(html);
  if (!m) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const visDomain = typeof obj.visDomain === "string" ? obj.visDomain : null;
  const lang = typeof obj.lang === "string" ? obj.lang : null;
  if (!visDomain || !lang) return null;
  if (!/^https?:\/\//i.test(visDomain)) return null;
  if (lang.length < 2 || lang.length > 5) return null;

  return { visDomain: visDomain.replace(/\/+$/, ""), lang };
}

/**
 * Quick sanity check whether a listing URL looks like a DIMEDIS VIS page.
 * Used as a cheap pre-flight before scraping for the config block.
 */
export function looksLikeDimedisUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /\/vis\/v\d+\/[a-z]{2,5}\/(directory|catalogue)/i.test(u.pathname);
  } catch {
    return false;
  }
}
