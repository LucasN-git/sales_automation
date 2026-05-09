# CLAUDE.md — Messe-Sales-Automation

Projekt-Memory speziell für die Sales-Intelligence-Automation. Liegt im Sub-Repo `git@github.com:LucasN-git/sales_automation.git` und ist eigenständig deploybar (Vercel + Supabase + Inngest), aber inhaltlich an die Brand-Bibel gekoppelt.

## Was dieses Projekt ist

Sales-Intelligence-Tool für ISP Power Systems. Vertriebler gibt eine Defense-/Industriemessen-URL ein, das System holt alle Aussteller, recherchiert pro Firma (Geschäftsfeld, Größe, Power-Bedarf), matcht gegen den ISP-Capability-Katalog und liefert pro Lead einen Pitch-Hook.

**Aktueller Stand: V4** (siehe Sektion "V4-Architektur" unten). V1 = Initial-Bootstrap, V2 = Tier-System + Settings + Chat, V3 = Show-more-Fix + Rate-Limit + Chat-Threads + Web-Search + 3-Spalten-Layout, V4 = Hybrid-Listing-Engine (Browserbase + Algolia-Direct-API für SPAs).

Plan-Datei: `~/.claude/plans/ok-ich-m-chte-nun-gentle-frog.md` (wird bei jedem neuen Major-Plan überschrieben).

## Single Source of Truth

- **Brand-Bibel:** `../../ISP_Power_Systems_Brand.md` (im Brand-Ordner). Die App-UI muss brand-konform bleiben — Helvetica, 3 Farben, Single Gold Accent pro View, Right Angles, keine Em-Dashes, keine Superlative.
- **Capability-Katalog:** `lib/isp-catalog.ts`. Wird als gecachter System-Prompt-Block an Claude geschickt. Wenn das Brand-Doc geändert wird (Sektor-Liste, Lifecycle-Stufen, Differentiators), muss `isp-catalog.ts` mitziehen — sonst driftet das Matching.
- **Prio-Kontext (V2+):** `lib/settings.ts` defaultPrioContext() generiert aus dem Catalog, der User editiert in `/settings`, persistiert in `app_settings.prio_context`. Wird in jeden Match-Call (Short, Deep, Chat) als gecachter System-Prompt-Block geschickt.
- **Schema:** Migrationen in `supabase/migrations/000{1..5}*.sql`. Aktuelle Tabellen: `trade_shows`, `exhibitors`, `exhibitor_short`, `exhibitor_deep`, `chat_threads`, `chat_messages`, `crawl_log`, `app_settings`. RLS via `trade_shows.user_id`.

## Architektur-Entscheidungen (warum so, nicht anders)

| Entscheidung | Grund |
|---|---|
| Inngest, nicht Vercel-Cron + Queue | Crawls dauern 30+ Min mit 50+ Aussteller × Firecrawl + Claude. Inngest Step-Functions geben Retries, Concurrency-Limits und gute Observability. Free-Tier reicht für V1. |
| Single-User, nicht Multi-Team | Nur 1 Vertriebler im V1-Scope. RLS-Policies sind so vorbereitet, dass Multi-Team später ohne Schema-Bruch ergänzt werden kann (`user_id` ist schon da). |
| Hardcoded Capability-Katalog (TS-Konstante) | Editierbarer Catalog wäre Feature-Creep. Brand-Doc-Änderungen sind selten und gehören in einen Commit, nicht in eine Admin-UI. |
| Tailwind v4 mit `border-radius: 0 !important` global | Right-Angles ist Brand-Hard-Rule. Statt jedes Component-Util zu überschreiben, ein globaler Reset. |
| Polling (5 s) statt Supabase Realtime im Frontend | Realtime ist im Schema aktiviert (publication), aber die UI nutzt vorerst `router.refresh()`-Polling — einfacher, eine Abhängigkeit weniger, reicht für 1 User. Wechsel auf Realtime wenn Frontend-Latenz stört. |
| Single Claude-Call pro Aussteller (V1) | Wurde in V2 ersetzt durch Tier-System (Short/Deep). Begründung siehe V2-Sektion. |
| Tier-System (V2): Short → Deep | Listing macht keinen LLM-Call mehr. User triggert Bulk-Short (Haiku 4.5, klein/billig) für alle. Deep nur für ausgewählte Aussteller (Sonnet 4.6 oder Opus 4.7). Spart 80–90 % Tokens, weil 90 % der Aussteller eh kein ISP-Match sind. |
| Show-more 1-Call (V3) | Statt iterativem Reload-Loop ein einziger Firecrawl-Call pro Letter mit bis zu 80 click-Actions in derselben Browser-Session. Schneller, deterministischer. |
| Web-Search via Anthropic Native Tool | `web_search_20250305` als Tool im Chat. Anthropic kümmert sich um die Suche, wir registrieren nur das Tool. Per-Search-Pricing extra. |

## Dev-Workflow

- 2 Terminals: `npm run inngest:dev` (Port 8288 UI) + `npm run dev` (Port 3000).
- Login per Magic-Link an `ALLOWED_EMAIL`. Zugang nur für diese Adresse, alles andere wird in `app/auth/callback/route.ts` rejected.
- Auto-Refresh-Polling läuft, solange `trade_shows.status` queued/crawling ist oder noch Aussteller pending/running.
- Bei Schema-Änderungen neue Migration `0002_*.sql` anlegen, nicht 0001 editieren.

## Tooling-Hinweise (projektspezifisch)

- **Vor Library-Updates** (Anthropic SDK, Inngest, Supabase, Firecrawl, Next.js): immer Context7 querchecken, alle vier sind aktiv weiterentwickelt.
- **Brand-Checkliste vor neuen UI-Komponenten:** ein Gold-Element, Helvetica, keine Rundung, keine Em-Dashes — siehe `../../CLAUDE.md` (Brand-Ordner).
- **Kosten-Sanity-Check nach jedem Echt-Lauf:** Anthropic-Console (Cache-Hit-Rate >70 % ab Aussteller 2), Firecrawl-Dashboard (Credits).

## V4-Architektur (aktuell): Hybrid-Listing-Engine

V3 scheiterte an React/Algolia-SPAs (Enforce Tac etc.): Firecrawl-Click-Actions navigieren weg, synthetic events sind isTrusted=false. Ergebnis 270 von 1850 Ausstellern. V4 bringt zwei zusätzliche Listing-Engines, die auf solchen Seiten greifen.

### Engine-Auswahl (Discovery)
Claude wählt im `crawl_plan.engine`:
- **`algolia_api`** — Algolia InstantSearch detected (`window.__ALGOLIA__`, `aa-Input`, `ais-`-Klassen, `algolia.net`). Schnellster Weg: ~30 s + 1 Browserbase-Session, dann direkt /browse REST-Endpoint paginieren.
- **`browserbase`** — generische SPA, echte Klicks via Cloud-Playwright. Per-Letter eine Browserbase-Session, isTrusted=true Klicks bis Show-more verschwindet. Robust für jede React/Vue/Angular-Listing.
- **`firecrawl`** — V3-Code-Pfad für statische Server-Render-Seiten. Default-Fallback.

### Browserbase-Setup
Externe Dependency. `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` in `.env.local`. Free-Tier: 60 Browser-Min/Monat. Pro: $29 für 5 Std. Eine 1500er-Messe verbraucht 5–15 Min, eine 1× Algolia-Extraction nur ~30 s.

### Algolia-Direct-API
1× Browserbase-Session öffnet die Seite, lauscht auf algolia.net-Requests, extrahiert appId + searchKey + indexName via Network-Listener. Dann fetch-Loop gegen `/1/indexes/<name>/browse` mit cursor-pagination — alle Hits in unter 30 s, unabhängig von Letter-Filter. Falls Index protected oder Index-Name nicht erkennbar: automatischer Fallback zur Browserbase-Letter-Loop.

### Cost-Tracking
- `trade_shows.browserbase_session_seconds` — gesamte Browser-Zeit pro Show.
- ProcessSidebar > kosten zeigt Browser-Zeile mit Sekunden + USD-Schätzung (0.17 $/min).

### V4-spezifische Watch-Outs
- **Network-Listener-Reihenfolge:** `page.on("request", ...)` MUSS vor `page.goto()` registriert sein. Sonst werden die ersten Algolia-Requests nicht gesehen.
- **Browserbase-Session-Lifecycle:** wir rufen `sessions.update(id, { status: "REQUEST_RELEASE" })` im finally-Block. Sonst läuft die Session bis Browserbase-Auto-Idle-Timeout — kostet Min ohne Nutzen.
- **Algolia-Index-Name** kommt nicht immer im URL-Pfad — manche Sites nutzen multi-index queries-Endpoint mit Index im Body. Dann ist `creds.indexName === ""` und wir fallen auf Browserbase zurück.
- **Browserbase Free-Tier 60 min/Monat** ist eng — Pro nehmen wenn täglich Crawls laufen.

---

## V3-Architektur (vorherige Version)

### Listing
- **Show-more-Loop:** 1 Firecrawl-Call pro Letter mit bis zu 80 click-Actions in einer Browser-Session (statt mehreren Reload-Calls). Cap im `crawl_plan.max_show_more_per_letter` (Default 80, max 150). Implementation in `lib/strategies/shared.ts:scrapeWithShowMoreLoop`.
- **Total-Count-Verifikation:** Claude liest in Discovery die "X exhibitors"-Zahl von der Listing-Seite (wenn vorhanden) und speichert sie in `trade_shows.expected_exhibitor_count`. Nach Listing wird verglichen, Mismatch >5 % als `warn` in `crawl_log`.
- **Live-Log akkumulativ:** pro Letter-Done eine Log-Zeile `Buchstabe X — N gefunden (gesamt M)` mit `meta.added`, `meta.total`. Sidebar > LogView zeigt Stream chronologisch mit Auto-Scroll.

### Tier-Workflow
- **Listing:** kein LLM. Aussteller-Liste via Firecrawl-Extraction.
- **Short:** bulk-getriggert (Button auf Show-Detail), Haiku 4.5 (override in Settings), 4 Felder (one_liner, priority_label, match_confidence, isp_sector_match). Inngest-Function `exhibitor-short` mit `concurrency: 5, throttle: { limit: 30, period: "1m" }, retries: 4` gegen Anthropic-Rate-Limits.
- **Deep:** per-Aussteller-getriggert (Button auf Detail-Page), Sonnet 4.6 default, optional Opus 4.7 in Settings. 8 Felder inkl. decision_makers, opening_questions, recent_news. concurrency=3, kein Throttle (User-getriggert, selten).

### Chat
- **Mehrere Threads pro Messe** (`chat_threads`). Jeder Thread kann optional `exhibitor_focus` haben.
- **Aussteller-Detail-Page** zeigt nur Threads mit dieser Firma als Focus + erlaubt neue mit dem Focus.
- **Modell-Dropdown** im Header: Haiku/Sonnet/Opus.
- **Web-Search-Toggle** im Header: aktiviert Anthropic Native `web_search_20250305` Tool. Claude darf eigenständig bis zu 5 Web-Searches pro Frage. Pro Search extra Kosten.
- **Deep-Toggle** sichtbar nur bei Aussteller-Focus + vorhandenen Deep-Daten — fügt deep_intel als zusätzlichen System-Block hinzu.
- **3-Dots-Menu** im Header: "Diesen Verlauf loeschen" / "Alle Verlaeufe loeschen". X-Icon zum Schliessen.

### Layout (V3)
- `app/shows/[id]/layout.tsx` ist Shared Layout über Show-Detail + Exhibitor-Detail.
- 3 Spalten: links ProcessSidebar (collapsible), Mitte Page-Content, rechts ChatPanel (collapsible). State persistiert in `localStorage` (`process-collapsed`, `chat-collapsed`).
- ChatPanel-Instanz bleibt beim Wechsel Show-Detail ↔ Exhibitor-Detail bestehen, reagiert auf URL-Wechsel mit Thread-Filter.

### Settings
- `/settings`-Page: editierbarer Prio-Kontext (Default aus Brand-Doc generiert), Modell-Wahl Short + Deep.
- `app_settings`-Tabelle, eine Row pro User.

### Pause / Resume
- `trade_shows.status = 'paused'` setzt Pipeline zwischen den Steps an. `paused_phase` speichert Phase. Inngest-Functions checken vor jedem step.run; wenn paused → return early.
- Resume triggert frisches Event entsprechend `paused_phase` (discovery/listing → `trade-show.requested`, short → `short-overview.bulk-requested`).

## Bekannte Schwachstellen / Watch-Outs

- **Anthropic-Rate-Limit (Haiku 4.5):** 50k input-tokens/min auf Free-Tier. Throttle 30/min ist konservativ; bei Pro-Tier auf 100/min hochziehen. Bei einer 1500er-Messe dauert Bulk-Short dann ~50 Min — User triggert einmal, kommt wieder.
- **Firecrawl Show-more-Cap 80** ist auf den Worst-Case Letter "M" oder "S" gerechnet. Pricing pro Call (nicht pro Click) — bei kleinen Messen verschwendet Cap nichts.
- **Listing-Pages mit JS-Lazy-Loading:** Firecrawl-`waitFor` 3000 ms in Discovery, 800 ms zwischen Show-more-Klicks. Bei sehr langsamen Sites in `lib/strategies/shared.ts` erhöhen.
- **`onFailure` in Inngest:** nutzt `event.data.event.data` (doppelt verschachtelt) — das ist die Inngest-API für Failure-Events. Nicht zu `event.data.exhibitorId` vereinfachen.
- **Web-Search-Cost:** Anthropic-Native-Web-Search kostet pro Search. Bei einem aktiven Vertriebler mit ~10 Fragen/Tag und Web-Toggle an können das schnell 1–2 €/Tag werden. Cost-Tracking ist in `tokenStats.chat_cost_usd` aktuell NUR Token-basiert — Web-Search-Cost wird nicht separat erfasst (V4-Feature).
- **Realtime nicht aktiv:** `supabase_realtime` Publication ist im Schema, aber UI nutzt `router.refresh()`-Polling alle 5 s. Wechsel auf Realtime-Channel wenn Latenz stört.
- **Tier-Schema-Migration:** wenn V1-Daten existieren (alte exhibitor_intel), läuft 0004-Migration sie auf exhibitor_short-Schema um (Felder gedroppt, neue addiert). Nicht doppelt ausführen ohne idempotency-Check.

## Repo & Deployment

- Repo: `git@github.com:LucasN-git/sales_automation.git` (Sub-Repo, **nicht** im Brand-Ordner-Repo enthalten).
- Vercel: separates Projekt, NICHT mit dem Brand-Material-Vercel verknüpft.
- Supabase: separates Projekt, RLS aktiv, Migrationen über `supabase db push` oder SQL-Editor.
- Inngest-Cloud: Sync-URL = `https://<vercel-domain>/api/inngest`, Keys in Vercel-Env.
