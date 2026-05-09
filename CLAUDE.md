# CLAUDE.md — Messe-Sales-Automation

Projekt-Memory speziell für die Sales-Intelligence-Automation. Liegt im Sub-Repo `git@github.com:LucasN-git/sales_automation.git` und ist eigenständig deploybar (Vercel + Supabase + Inngest), aber inhaltlich an die Brand-Bibel gekoppelt.

## Was dieses Projekt ist

Sales-Intelligence-Tool für ISP Power Systems. Vertriebler gibt eine Defense-/Industriemessen-URL ein, das System holt alle Aussteller, recherchiert pro Firma (Geschäftsfeld, Größe, Power-Bedarf), matcht gegen den ISP-Capability-Katalog und liefert pro Lead einen Pitch-Hook.

**Single-User V1 Scope:** ein Vertriebler, Magic-Link-Login, Lean-UI (Liste + Suche + Detail), Firecrawl + Claude (kein LinkedIn/Crunchbase).

Plan-Datei der Initial-Implementierung: `~/.claude/plans/ok-ich-m-chte-nun-gentle-frog.md`.

## Single Source of Truth

- **Brand-Bibel:** `../../ISP_Power_Systems_Brand.md` (im Brand-Ordner). Die App-UI muss brand-konform bleiben — Helvetica, 3 Farben, Single Gold Accent pro View, Right Angles, keine Em-Dashes, keine Superlative.
- **Capability-Katalog:** `lib/isp-catalog.ts`. Wird als gecachter System-Prompt-Block an Claude geschickt. Wenn das Brand-Doc geändert wird (Sektor-Liste, Lifecycle-Stufen, Differentiators), muss `isp-catalog.ts` mitziehen — sonst driftet das Matching.
- **Schema:** `supabase/migrations/0001_init.sql`. Drei Tabellen: `trade_shows`, `exhibitors`, `exhibitor_intel`. RLS via `trade_shows.user_id`.

## Architektur-Entscheidungen (warum so, nicht anders)

| Entscheidung | Grund |
|---|---|
| Inngest, nicht Vercel-Cron + Queue | Crawls dauern 30+ Min mit 50+ Aussteller × Firecrawl + Claude. Inngest Step-Functions geben Retries, Concurrency-Limits und gute Observability. Free-Tier reicht für V1. |
| Single-User, nicht Multi-Team | Nur 1 Vertriebler im V1-Scope. RLS-Policies sind so vorbereitet, dass Multi-Team später ohne Schema-Bruch ergänzt werden kann (`user_id` ist schon da). |
| Hardcoded Capability-Katalog (TS-Konstante) | Editierbarer Catalog wäre Feature-Creep. Brand-Doc-Änderungen sind selten und gehören in einen Commit, nicht in eine Admin-UI. |
| Tailwind v4 mit `border-radius: 0 !important` global | Right-Angles ist Brand-Hard-Rule. Statt jedes Component-Util zu überschreiben, ein globaler Reset. |
| Polling (5 s) statt Supabase Realtime im Frontend | Realtime ist im Schema aktiviert (publication), aber die UI nutzt vorerst `router.refresh()`-Polling — einfacher, eine Abhängigkeit weniger, reicht für 1 User. Wechsel auf Realtime wenn Frontend-Latenz stört. |
| Single Claude-Call pro Aussteller (`enrichAndMatch`) statt zwei | Weniger Round-Trips, gleicher Cache-Hit, ein konsolidiertes JSON-Schema. Trennung in 2 Calls war im Plan, hat sich bei Implementierung aber als unnötig erwiesen. |

## Was NICHT in V1 ist (V2-Roadmap)

- LinkedIn-/Crunchbase-Enrichment (war Premium-Option im Plan)
- Multi-User mit Notizen/Tags und CSV-Export für CRM
- Pitch-Deck-Auto-Generator (würde an pptx-Skill anknüpfen)
- Pipeline-Dashboard pro Messe
- Mobile/PWA-Optimierung

Bei V2-Anfrage: zuerst klären, welches Feature den meisten Vertriebsschmerz löst.

## Dev-Workflow

- 2 Terminals: `npm run inngest:dev` (Port 8288 UI) + `npm run dev` (Port 3000).
- Login per Magic-Link an `ALLOWED_EMAIL`. Zugang nur für diese Adresse, alles andere wird in `app/auth/callback/route.ts` rejected.
- Auto-Refresh-Polling läuft, solange `trade_shows.status` queued/crawling ist oder noch Aussteller pending/running.
- Bei Schema-Änderungen neue Migration `0002_*.sql` anlegen, nicht 0001 editieren.

## Tooling-Hinweise (projektspezifisch)

- **Vor Library-Updates** (Anthropic SDK, Inngest, Supabase, Firecrawl, Next.js): immer Context7 querchecken, alle vier sind aktiv weiterentwickelt.
- **Brand-Checkliste vor neuen UI-Komponenten:** ein Gold-Element, Helvetica, keine Rundung, keine Em-Dashes — siehe `../../CLAUDE.md` (Brand-Ordner).
- **Kosten-Sanity-Check nach jedem Echt-Lauf:** Anthropic-Console (Cache-Hit-Rate >70 % ab Aussteller 2), Firecrawl-Dashboard (Credits).

## Bekannte Schwachstellen / Watch-Outs

- **Listing-Pages mit JS-Lazy-Loading**: Firecrawl-`waitFor` ist auf 1500 ms gesetzt. Bei modernen Spa-Messeseiten kann das knapp werden. Workaround: `lib/firecrawl.ts` → `waitFor` erhöhen oder Aussteller manuell pflegen.
- **Claude-Output ohne JSON-Object**: `lib/claude.ts` hat einen Strip-Fences-Helper, aber bei kreativen Modell-Antworten kann er noch werfen. Falls häufig, System-Instruction schärfen oder zu Tool-Use umstellen.
- **`onFailure` in Inngest**: nutzt `event.data.event.data` (doppelt verschachtelt) — das ist die Inngest-API für Failure-Events. Nicht zu `event.data.exhibitorId` vereinfachen.
- **Inngest-Concurrency 5**: bewusst niedrig gewählt für Firecrawl-Free-Tier-Friendly. Bei Pro-Plänen auf 10–20 hochziehen.

## Repo & Deployment

- Repo: `git@github.com:LucasN-git/sales_automation.git` (Sub-Repo, **nicht** im Brand-Ordner-Repo enthalten).
- Vercel: separates Projekt, NICHT mit dem Brand-Material-Vercel verknüpft.
- Supabase: separates Projekt, RLS aktiv, Migrationen über `supabase db push` oder SQL-Editor.
- Inngest-Cloud: Sync-URL = `https://<vercel-domain>/api/inngest`, Keys in Vercel-Env.
