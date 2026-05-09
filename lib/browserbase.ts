import { Browserbase } from "@browserbasehq/sdk";
import { chromium, type Browser, type Page } from "playwright-core";

let _bb: Browserbase | null = null;
function bb(): Browserbase {
  if (!_bb) {
    if (!process.env.BROWSERBASE_API_KEY) {
      throw new Error("BROWSERBASE_API_KEY missing — V4 listing engine requires Browserbase");
    }
    _bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
  }
  return _bb;
}

export type SessionResult<T> = {
  result: T;
  durationSec: number;
  sessionId: string;
};

/**
 * Best-effort cookie-consent dismissal for OneTrust / Cookiebot / Usercentrics
 * and generic accept-all buttons in EN/DE. Some Algolia sites only fire their
 * search bundle AFTER consent, so this often unblocks the listing entirely.
 */
export async function acceptCookies(page: Page): Promise<void> {
  const selectors = [
    "#onetrust-accept-btn-handler",
    "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    "#CybotCookiebotDialogBodyButtonAccept",
    "button#uc-btn-accept-banner",
    '[data-testid="uc-accept-all-button"]',
    'button[aria-label*="Accept all" i]',
    'button[aria-label*="Alle akzeptieren" i]',
    'button:has-text("Accept all")',
    'button:has-text("Alle akzeptieren")',
    'button:has-text("Akzeptieren")',
  ];
  for (const sel of selectors) {
    const clicked = await page
      .locator(sel)
      .first()
      .click({ timeout: 1_500 })
      .then(() => true)
      .catch(() => false);
    if (clicked) {
      await page.waitForTimeout(500);
      return;
    }
  }
}

/**
 * Run `fn` inside a managed Browserbase session. The Browserbase session is
 * created on entry, connected via Playwright over CDP, and explicitly released
 * on exit (success or failure) so we don't leak browser-minutes.
 *
 * Returns the user fn's result plus how many seconds the session lived (for
 * cost-tracking in the UI).
 */
export async function withSession<T>(
  fn: (page: Page) => Promise<T>,
  opts: { defaultTimeoutMs?: number } = {},
): Promise<SessionResult<T>> {
  if (!process.env.BROWSERBASE_PROJECT_ID) {
    throw new Error("BROWSERBASE_PROJECT_ID missing");
  }

  const session = await bb().sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID,
  });
  const start = Date.now();
  let browser: Browser | null = null;

  try {
    browser = await chromium.connectOverCDP(session.connectUrl);
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    page.setDefaultTimeout(opts.defaultTimeoutMs ?? 30_000);

    const result = await fn(page);
    return {
      result,
      durationSec: Math.round((Date.now() - start) / 1000),
      sessionId: session.id,
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore — we still want to release the upstream session
      }
    }
    try {
      await bb().sessions.update(session.id, { status: "REQUEST_RELEASE", projectId: process.env.BROWSERBASE_PROJECT_ID });
    } catch {
      // ignore — Browserbase auto-releases idle sessions anyway
    }
  }
}
