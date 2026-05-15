# CLAUDE.md — Messe-Sales-Automation

Projekt-Memory für die Sales-Intelligence-Automation. Sub-Repo `git@github.com:LucasN-git/sales_automation.git`, eigenständig deploybar (Vercel + Supabase + Inngest), inhaltlich an die Brand-Bibel gekoppelt.

## Was dieses Projekt ist

Sales-Intelligence-Tool für ISP Power Systems. Vertriebler gibt eine Defense-/Industriemessen-URL ein, das System holt alle Aussteller, recherchiert pro Firma (Geschäftsfeld, Größe, Power-Bedarf), matcht gegen den ISP-Capability-Katalog und liefert pro Lead einen Pitch-Hook. Zusätzlich entdeckt das Tool relevante Messen (Show Discovery) und analysiert Wettbewerber (Competitors). Alle Unternehmenseinträge werden über Shows hinweg dedupliziert (Companies).

**Aktueller Stand:** V5 — AI Orchestrator + URL-Search + Profile-Enrich + Companies + Competitors (inkl. Short-Analyse + Chat) + Show Discovery + Kosten-Tracking. 29 Migrationen, 15 Inngest-Functions.

---

## Single Source of Truth

- **Brand-Bibel:** `../../ISP_Power_Systems_Brand.md`. Die App-UI muss brand-konform bleiben — Helvetica, 3 Farben, Single Gold Accent pro View, Right Angles, keine Em-Dashes, keine Superlative. Design-Details: Sektion "Design System" weiter unten.
- **Capability-Katalog:** `lib/isp-catalog.ts`. Gecachter System-Prompt-Block für alle Claude-Calls. Bei Sektor-Änderungen im Brand-Doc muss dieser mitziehen — sonst driftet das Matching.
- **Prio-Kontext:** `lib/settings.ts` `defaultPrioContext()`. User editiert in Show-Settings, persistiert in `app_settings.prio_context`. Wird als gecachter Block an jeden Match-Call (Short, Deep, Chat) geschickt.
- **Schema:** Migrationen in `supabase/migrations/0001_init.sql` bis `0029_chat_thread_scope.sql`. Neue Migrationen als `0030_*.sql` anlegen, nie alte editieren.

---

## Architektur-Entscheidungen

| Entscheidung | Grund |
|---|---|
| Inngest, nicht Vercel-Cron | Crawls dauern 30+ Min; Inngest gibt Retries, Concurrency-Limits, Observability. |
| Single-User, RLS vorbereitet | 1 Vertriebler im Scope. `user_id` auf allen Tabellen für spateres Multi-Team. |
| AI Orchestrator als Chat-Schicht | Der User steuert die Pipeline uber naturliche Sprache. Claude als dual-role: Pipeline-Controller + Gesprächspartner. Tool-use-Loop max 8 Iterationen. |
| Tier-System Short → Deep | Short (Haiku, bulk, ~0.02 EUR) filtert zuerst. Deep (Sonnet/Opus) nur auf explizite Anfrage. Spart 80-90 % Tokens. |
| URL-Search vor Short | Aussteller ohne Website bekommen zuerst einen Claude-web_search-Call. Findet URL + LinkedIn. Verhindert Short-Calls ohne jeglichen Content. |
| Profile-Enrich parallel nach Listing | Manche Listing-Seiten liefern pro Aussteller eine Detail-URL mit externem Website-Link. Firecrawl scrapt diese parallel, promoted `website`-Column. Kein LLM-Call. |
| Hardcoded Capability-Katalog | Editierbarer Catalog ware Feature-Creep. Brand-Änderungen gehören in einen Commit. |
| Tailwind v4 + `border-radius: 0 !important` global | Right-Angles ist Brand-Hard-Rule. Ein globaler Reset ist einfacher als jedes Component. |
| Polling statt Supabase Realtime | Realtime ist im Schema aktiviert (publication), UI nutzt `router.refresh()` alle 5 s. Wechsel wenn Frontend-Latenz stört. |
| Prompt-Caching (Anthropic ephemeral) | Alle stabilen System-Blöcke mit `cache_control: ephemeral`. Cache-Hit-Rate >70 % ab Aussteller 2. Spart deutlich Input-Tokens. |
| Confirmation-Widget fur destruktive Aktionen | delete_exhibitors, add_exhibitor, restart_pipeline geben `detail.confirmation_request` zuruck; das Chat-UI rendert ein Widget. Claude wartet auf Nutzer-Bestatigung, fuhrt nichts stillschweigend aus. |
| Companies-Modul cross-show | Global deduplizierte Firmen per `domain`- und `normalized_name`-Index. `companies_overview`-View aggregiert Metriken. |
| Competitors retries=0 | Web-Search-Calls kosten ~0.15-0.30 EUR pro Lauf. Ein Retry wurde still verdoppeln. Stattdessen: sichtbares Failure + manueller Retry. |
| 3-Spalten-Layout resizable | Links: Navigation + Kontext, Mitte: Content, Rechts: Orchestrator-Chat. Sidebars per localStorage kollabierbar + drag-resize. |

---

## Pipeline-Ablauf

### Übersicht (Happy Path)

```
User gibt Messe-URL ein
  │
  ├── Phase 0: Discovery
  │    Firecrawl scrapt Listing-URL → Claude wahlt Strategie + Engine
  │    Ergebnis: CrawlPlan in trade_shows.crawl_plan
  │
  ├── Phase 1: Listing
  │    Engine: algolia_api | browserbase | firecrawl
  │    Aussteller werden inserted, companies dedupliziert
  │    Auto-trigger: Profile-Enrich (parallel, fur Aussteller mit profile_url)
  │    Ergebnis: exhibitors-Rows mit short_status=pending
  │
  ├── Phase 2: Profile-Enrich (parallel, auto)
  │    Firecrawl scrapt exhibitor.profile_url (Messe-Detail-Seite)
  │    promoted website-Column falls noch keine vorhanden
  │    profile_enrich_status: pending → running → done | failed | idle
  │
  ├── Phase 3: URL-Search (nur fur Aussteller ohne website)
  │    Claude web_search findet Website + LinkedIn
  │    url_search_status: pending → running → done | url_not_found | failed
  │    Bei url_not_found: short_status = url_not_found (Terminal)
  │
  ├── Phase 4: Short-Overview (User triggert via Orchestrator-Chat)
  │    Haiku 4.5 · concurrency 5 · throttle 30/min
  │    Pro Aussteller: Firecrawl scrape → enrichShort → upsert exhibitor_short
  │    short_status: pending → running → done | failed | url_not_found
  │
  └── Phase 5: Deep-Dive (User triggert per Aussteller via Orchestrator)
       Sonnet 4.6 (default) · concurrency 3
       Pro Aussteller: Firecrawl scrape → enrichDeep (nutzt Short-Kontext) → upsert exhibitor_deep
       deep_status: pending → running → done | failed
```

### Status-Maschinen

**`trade_shows.status`**
```
queued → crawling → ready
                 → partial   (Aussteller inserted aber <95 % der erwarteten Zahl)
                 → paused    (paused_phase: discovery | listing | short)
                 → failed
```

**`exhibitors.short_status`**
```
pending → running → done
                 → failed
                 → url_not_found   (kein Website nach URL-Search, Terminal)
```

**`exhibitors.url_search_status`**
```
skipped          (hatte schon website aus Listing)
pending → running → done
                 → url_not_found   (Terminal, setzt auch short_status=url_not_found)
                 → failed          (Short lauft trotzdem, nur ohne Website-Scrape)
```

**`exhibitors.profile_enrich_status`**
```
idle             (kein profile_url)
pending → running → done | failed
```

**`exhibitors.deep_status`**
```
pending → running → done | failed
```

### Listing-Engines (Phase 1)

Claude wahlt im `crawl_plan.engine`:

| Engine | Wann | Wie |
|---|---|---|
| `algolia_api` | Algolia InstantSearch detected (`window.__ALGOLIA__`, `ais-`-Klassen, `algolia.net` im Network) | 1× Browserbase-Session lauscht auf Netzwerk-Requests, extrahiert appId + searchKey + indexName, dann `/1/indexes/<name>/browse` mit cursor-paginierung. ~30 s. |
| `browserbase` | Generische SPA (React/Vue/Angular) mit Show-more-Button | Cloud-Playwright, isTrusted=true Klicks pro Letter. Robust fur alles, was Firecrawl synthetisch nicht kann. |
| `firecrawl` | Statisch server-gerendertes HTML | V3-Codepfad: 1 Call pro Letter mit bis zu 80 click-Actions. Default-Fallback. |

**Watch-Outs Listing:**
- Network-Listener-Reihenfolge: `page.on("request", ...)` MUSS vor `page.goto()` registriert sein, sonst fehlen erste Algolia-Requests.
- Browserbase-Session immer mit `REQUEST_RELEASE` im finally-Block schließen, sonst lauft Auto-Idle-Timeout.
- `algolia.net`-Index-Name kommt nicht immer im URL-Pfad; bei multi-index-queries ist `creds.indexName === ""` → Fallback auf Browserbase.
- Browserbase Free-Tier 60 min/Monat; Pro nehmen wenn tagliche Crawls laufen.

---

## AI Orchestrator

Der Orchestrator ist der zentrale Einstiegspunkt fur den Vertriebler. Er hat zwei Rollen gleichzeitig:

1. **Pipeline-Controller:** Steuert Discovery, Listing, Short, Deep, Pause, Resume, Restart uber Tool-Calls.
2. **Gesprachspartner:** Erklart Fehler, schlagt nachste Schritte vor, beantwortet Fragen zur Messe.

### Implementierung

- **System-Prompt + Tool-Defs:** `lib/orchestrator.ts`
- **API-Route (SSE):** `app/api/shows/[id]/chat/route.ts`
- **Tool-use-Loop:** max 8 Iterationen pro User-Nachricht
- **Streaming:** Server-Sent Events. Event-Typen: `thread`, `text`, `search`, `pipeline_action`, `confirmation_request`, `tool_use`, `usage`, `done`, `error`

### System-Blöcke (alle mit `cache_control: ephemeral`)

```
1. ORCHESTRATOR_SYSTEM_PROMPT    (lib/orchestrator.ts, ~700 Tokens, cached)
2. settings.prio_context         (User-editierbar, cached)
3. catalogAsPromptBlock()        (lib/isp-catalog.ts, cached)
4. Exhibitor-Liste (JSON)        (max 5000 Rows, cached wenn gleich)
5. [optional] focused exhibitor  (wenn exhibitor_focus gesetzt)
6. [optional] deepContext        (wenn with_deep_context=true)
7. [optional] crawlState         (aktueller Pipeline-Status)
```

### Orchestrator-Tools

| Tool | Funktion | Widget? |
|---|---|---|
| `run_discovery` | Firecrawl + Claude → CrawlPlan, ~30 s, inline im Chat | Nein |
| `trigger_listing` | Inngest-Event `trade-show.listing-requested` | Nein |
| `trigger_short_overview` | Inngest-Event `short-overview.bulk-requested` | Nein (Kostenschatzung vorher nennen) |
| `trigger_deep_dive` | Inngest-Event `exhibitor.deep.requested` fur 1 Aussteller | Nein |
| `pause_pipeline` | Status → paused + paused_phase | Nein |
| `resume_pipeline` | Status → crawling/ready + passenden Inngest-Event | Nein |
| `restart_pipeline` | Loscht alle exhibitors + startet Listing neu | Ja (confirmed=true) |
| `delete_exhibitors` | Loscht 1-N Aussteller (alle IDs in 1 Call) | Ja (confirmation_request widget) |
| `add_exhibitor` | Fugt manuellen Aussteller hinzu | Ja (confirmation_request widget) |
| `regenerate_short` | Setzt short_status=pending + triggert Short-Events sofort | Nein |

**Confirmation-Widget-Pattern:** Wenn das Tool `detail.confirmation_request` zuruckgibt, rendert das Chat-UI ein Widget. Claude weist den User auf das Widget hin und wartet. Das Widget sendet die eigentliche Ausfuhrung an die entsprechende REST-API. Nie umgehen.

**restart_pipeline vs. delete_exhibitors:** `restart_pipeline` loscht ALLES und startet Listing neu. `delete_exhibitors` loscht nur spezifische Aussteller. Bei "alle Aussteller loschen"-Request immer `delete_exhibitors` mit allen IDs verwenden, nie `restart_pipeline`.

### Client-Tool `update_exhibitor_intel`

Nur verfugbar wenn `exhibitor_focus` gesetzt. Claude kann damit Short- und Deep-Felder direkt schreiben (z.B. nach Web-Search-Recherche). User muss explizit bestatigen.

Editierbare Short-Felder: `one_liner`, `priority_label`, `match_confidence`, `isp_sector_match`, `reasoning_bullets`, `user_group`, `battery_need`, `drone_relevance`, `service_need`

Editierbare Deep-Felder: `business_summary`, `decision_makers`, `recent_news`, `technical_pain_points`, `opening_questions`, `competition_context`, `isp_lifecycle_match`, `isp_service_fit`, `full_reasoning`

---

## Inngest Functions

| Function ID | Event | Concurrency | Throttle | Retries |
|---|---|---|---|---|
| `crawl-trade-show` | `trade-show.requested` | — | — | 2 |
| `crawl-trade-show-listing` | `trade-show.listing-requested` | — | — | 2 |
| `short-overview-bulk` | `short-overview.bulk-requested` | — | — | 1 |
| `url-search-bulk` | `url-search.bulk-requested` | — | — | 1 |
| `exhibitor-url-search` | `exhibitor.url-search.requested` | 5 | 20/min | 2 |
| `exhibitor-short` | `exhibitor.short.requested` | 5 | 30/min | 4 |
| `exhibitor-deep` | `exhibitor.deep.requested` | 3 | — | 2 |
| `profile-enrich-bulk` | `profile-enrich.bulk-requested` | — | — | 1 |
| `exhibitor-profile-enrich` | `exhibitor.profile.enrich.requested` | 8 | 60/min | 2 |
| `manual-enrich-chain` | `exhibitor.manual.enrich.requested` | — | — | 1 |
| `competitor-discovery` | `competitor.discovery.requested` | 1 per userId | 5/min per userId | 0 |
| `competitor-short-bulk` | `competitor.short.bulk-requested` | — | — | 1 |
| `competitor-short` | `competitor.short.requested` | — | — | 2 |
| `show-discovery` | `show.discovery.requested` | 1 per userId | 3/min per userId | 0 |
| `show-result-firecrawl` | `show.result.firecrawl.requested` | 4 | 20/min | 1 |

**`onFailure`-Pattern:** Inngest Failure-Events kommen als `event.data.event.data` (doppelt verschachtelt). Nie zu `event.data.exhibitorId` vereinfachen.

---

## Module-Übersicht

### Companies (`/companies`, `app/api/companies/`, `lib/companies.ts`)

Cross-show-Deduplizierung aller Aussteller. `ensureCompany()` wird bei jedem Aussteller-Insert aufgerufen und matched per `domain` (normierter Hostname) oder `normalized_name`. `companies_overview`-View aggregiert `exhibitor_row_count`, `show_count`, `shows[]`, `best_match_confidence`, `best_priority`, `union_sectors`, `best_one_liner`.

Manuelle Firma hinzufugen (`POST /api/companies`) erstellt einen synthetischen "Manuelle Eintraege"-Show-Eintrag und triggert `exhibitor.manual.enrich.requested` (Short → Deep verkettet via `step.invoke`).

### Competitors (`/competitors`, `app/api/competitors/`, `lib/competitors/`, `lib/competitor-short.ts`, `lib/competitor-orchestrator.ts`, `lib/competitor-log.ts`)

Auto-Discovery von ISP-Wettbewerbern via Claude + Web-Search (`discoverCompetitors()` in `lib/claude.ts`). Phasen: preparing → preparing_prompt → claude_research → persisting → done. Versioned Snapshots: `competitor_versions`-Tabelle speichert jeden Scan-Stand. Customer-Link-Matching gegen `companies`-Tabelle per Domain > normalized_name > Trigram > manuell. Status-Maschine: `suggested` → `active` | `archived` | `rejected`. retries=0 (Web-Search-Kosten).

**Short-Analyse pro Konkurrent (`enrichCompetitorShort` in `lib/competitor-short.ts`):** Bulk-Event `competitor.short.bulk-requested` fanned out auf `competitor.short.requested` pro Konkurrent. Re-scannt einen Konkurrenten mit aktuellem Web-Search-Kontext (z.B. nach Status-Wechsel `suggested` → `active`) und schreibt eine neue Row in `competitor_versions` (scan_kind unterscheidet `discovery` vs. `short`). `competitors.short_status` (`pending|running|done|failed`) trackt den Lauf pro Konkurrent. Konfigurierbar via `app_settings.competitor_short_model` (Default Haiku 4.5).

**Competitor-Chat (`lib/competitor-orchestrator.ts`, `POST /api/competitors/chat`):** Eigener Orchestrator-Tool-Loop fuer Konkurrenten — Threads liegen in `chat_threads.competitor_focus` (uuid → competitors). System-Prompt `COMPETITOR_ORCHESTRATOR_SYSTEM_PROMPT` + Tool-Defs `COMPETITOR_TOOL_DEFS` (separater Tool-Satz, nicht die Show-Tools). Tool-Executor: `executeCompetitorTool()`.

**Event-Log (`competitor_discovery_log`, erweitert in 0026):** Trackt sowohl Run-Events (`run_id`-scoped) als auch per-Konkurrent-Events (`competitor_id`-scoped, `run_id` nullable). Helpers: `appendDiscoveryLog`, `appendCompetitorLog`, `loadCompetitorState` in `lib/competitor-log.ts`. UI-Feed via `GET /api/competitors/log`.

**threat_level enthaelt `critical`:** Der DB-Constraint in 0016 hat 'critical' vergessen — in 0028 nachgezogen. `lib/competitor-short.ts` und das Tool-Schema haben es schon immer geschrieben. Bei Code, der gegen das Enum prueft: alle vier Werte (`low|medium|high|critical`) zulassen.

**`started_at` auf `competitor_discovery_runs`:** Wurde im Code (ORDER BY started_at) erwartet, existierte aber bis 0028 nicht. Jetzt NOT NULL DEFAULT now(), Bestandsdaten via `created_at` backgefuellt.

### Show Discovery (`/shows/search`, `app/api/show-discovery/`)

User gibt natürlichsprachliche Suchanfrage ein. Claude Opus + Web-Search recherchiert Messen-Kandidaten, gibt strukturierte Liste mit Relevanz-Score (0-10), ISP-Sektor-Match, exhibitor_list_url, is_recurring zuruck. Danach Firecrawl-Validierung jeder URL (parallel, concurrency 4). Ergebnis-Actions: Kandidaten annehmen → `trade_shows` oder ablehnen.

---

## Datenbank-Schema

### Kern-Tabellen

**`trade_shows`**
`id, user_id, name, year, source_url, status, current_step, error_message, crawl_plan (jsonb), discovery_log (jsonb), expected_exhibitor_count, paused_phase, is_favorite, chat_context, browserbase_session_seconds, created_at, updated_at`

**`exhibitors`**
`id, trade_show_id, company_id (→companies), company_name, website, booth, listing_raw (jsonb), profile_url, profile_data (jsonb), profile_enrich_status, url_search_status, linkedin_url, short_status, deep_status, current_step, step_log (jsonb[])`

**`exhibitor_short`**
`exhibitor_id, one_liner, priority_label (hoch|mittel|niedrig), match_confidence (0-10), isp_sector_match (text[]), reasoning_bullets, user_group, battery_need, drone_relevance, service_need (text[]), tokens_in, tokens_out`

**`exhibitor_deep`**
`exhibitor_id, business_summary, decision_makers, recent_news, technical_pain_points, opening_questions, competition_context, isp_lifecycle_match (text[]), isp_service_fit, full_reasoning, tokens_in, tokens_out`

**`companies`**
`id, user_id, display_name, website, domain (normalized), normalized_name, created_at`

**`competitors`**
`id, user_id, display_name, normalized_name, domain, website, hq_country, status (suggested|active|archived|rejected), short_status (pending|running|done|failed), source_event, discovery_run_id, current_version_id, created_at, updated_at`

**`competitor_versions`**
`id, competitor_id, run_id, scan_kind (discovery|short), one_liner, positioning, portfolio (text[]), isp_sector_match (text[]), growth_signals (text[]), customers (text[]), threat_level (low|medium|high|critical), tokens_in, tokens_out, web_search_cost_usd, raw_snapshot (jsonb), created_at`

**`competitor_customer_links`**
`id, competitor_id, version_id, company_id, customer_name_raw, evidence_url, match_method (domain|normname|trigram|manual), match_score, manual_confirmed, manual_rejected`

**`competitor_show_links`** — `id, user_id, competitor_id, trade_show_id, created_at` — Many-to-many zwischen Konkurrenten und Messen (z.B. wenn ein Konkurrent als Aussteller auftritt).

**`competitor_discovery_runs`**
`id, user_id, status, current_phase, candidates_total, candidates_kept, model, tokens_in, tokens_out, web_search_uses, web_search_cost_usd, error_message, created_at, started_at, finished_at`
(Hinweis: `started_at` wurde in 0028 nachgetragen — vorher nur `created_at`. NOT NULL DEFAULT now(), Bestand via created_at backgefuellt.)

**`competitor_discovery_log`**
`id, user_id, run_id (nullable seit 0026), competitor_id (seit 0026, nullable), level (info|warn|error), phase, message, meta (jsonb), created_at` — kombiniert Run-Events (run_id-scoped) und per-Konkurrent-Events (competitor_id-scoped).

**`show_discovery_runs`**
`id, user_id, user_prompt, status, current_phase, candidates_total, candidates_validated, candidates_added, model, tokens_in, tokens_out, web_search_uses, firecrawl_calls, error_message, started_at, finished_at`

**`show_discovery_results`**
`id, run_id, user_id, name, website, location_city, location_country, dates_raw, focus_description, target_audience, isp_sector_match (text[]), relevance_score (0-10), relevance_reasoning, evidence_urls (text[]), is_recurring, recurrence_note, exhibitor_list_url, exhibitor_list_available, firecrawl_status, firecrawl_confirmed_url, firecrawl_extracted (jsonb), dismissed, added_trade_show_id`

**`chat_threads`**
`id, trade_show_id (nullable), user_id, title, exhibitor_focus, company_focus, competitor_focus (uuid → competitors, seit 0025), last_message_at, created_at`

**`chat_messages`**
`id, trade_show_id, user_id, thread_id, role, content, tokens_in, tokens_out, model, with_deep_context, with_web_search, pipeline_action (jsonb), created_at`

**`app_settings`** (1 Row pro User)
`user_id, prio_context, short_model, deep_model, short_system_prompt, short_user_template, short_max_tokens, short_max_input_chars, deep_system_prompt, deep_user_template, deep_max_tokens, deep_max_input_chars, chat_max_tokens, chat_web_search_max_uses, competitor_discovery_system_prompt, competitor_discovery_user_template, competitor_discovery_model, competitor_discovery_max_tokens, competitor_discovery_max_web_searches, show_discovery_system_prompt, show_discovery_max_tokens, show_discovery_max_web_searches`

**`user_profiles`** — `id (→auth.users), display_name, avatar_url`

**`crawl_log`** — `id, trade_show_id, level (info|warn|error), phase, message, meta (jsonb), created_at`

### Views & RPCs

- `companies_overview` — security_invoker, aggregiert Metriken per company
- `competitors_overview` — latest_version + counts per competitor
- `get_token_stats(p_trade_show_id uuid)` — Token-Aggregate per Short/Deep/Chat fur eine Messe
- `get_global_token_stats(p_user_id uuid)` — Globale Token-Aggregate + browserbase_seconds

### Wichtige Indexes

- `idx_exhibitors_url_search_status ON exhibitors (trade_show_id, url_search_status)`
- `idx_exhibitors_short_status ON exhibitors (trade_show_id, short_status)`
- Partial Unique: `companies (domain)` WHERE domain IS NOT NULL
- Partial Unique: `companies (normalized_name, user_id)` WHERE normalized_name IS NOT NULL
- GIN Trigram: `companies (normalized_name)`, `companies (display_name)`

---

## Design System

Das Design System ist direkt aus der Brand-Bibel abgeleitet und in `app/globals.css` als CSS-Variablen kodiert. Alle neuen Komponenten mussen es verwenden.

### Farben

```css
--color-cream:        #FFFFFF     /* Primarer Hintergrund (Seiten, Karten) */
--color-cream-sunken: #F5F6F8     /* Sidebar, Chat-Hintergrund, Inputs */
--color-near-black:   #0A0A0A     /* Primarer Text */
--color-gold:         #D4A843     /* Einziger Akzent — 1x pro View/Page */
--color-blue:         #2563EB     /* Sekundare Aktionen (mittel-Priority) */
--color-success:      #16A34A     /* Done-States, confidence >= 8 */
--color-error:        #DC2626     /* Fehler-States */

/* Borders (Hairlines) */
--border-color-soft:   rgba(10,10,10,0.10)   /* Sehr subtile Trenner */
--border-color:        rgba(10,10,10,0.22)   /* Standard */
--border-color-strong: rgba(10,10,10,0.80)   /* Aktive Elemente */
```

**Gold-Regel:** Genau ein goldenes Element pro Seite/View. Typischerweise: aktiver Status-Punkt, Hover-State auf dem primaren Button, oder eine Headline-Highlight-Klasse. Nie zwei gleichzeitig.

### Typografie

Font-Stack: `"Helvetica Neue", "Helvetica", "Arial", sans-serif`. Keine Webfonts, kein Inter, kein Serif.

| Klasse | Grosse | Weight | Letter-Spacing | Verwendung |
|---|---|---|---|---|
| `.text-display` | 44px (mobile: 32px) | 600 | -0.02em | Seiten-H1 (Dashboard, Messen, etc.) |
| `.text-title` | 22px | 600 | — | Section-Titles, Show-Name in Detail |
| `.text-subtitle` | 16px | 500 | — | Card-Titles, Aussteller-Name in Liste |
| `.text-body` | 14px | 400 | — | Fließtext, Beschreibungen |
| `.text-body-sm` | 13px | 400 | — | Kompaktere Body-Copy |
| `.text-ui` | 13px | 500 | — | Button-Labels, Tabs, Controls |
| `.text-meta` | 11px | 400 | — | Sekundare Info, rgba(10,10,10,0.45) |
| `.text-meta-strong` | 11px | 600 | — | Betonte Meta-Info |

### Spacing (4px Basis)

`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 px`

Tailwind: `p-1=4px, p-2=8px, p-3=12px, p-4=16px, p-6=24px, p-8=32px`

### Layout: 3 Spalten

```
Desktop (>= 1024px):
┌──────────────────┬──────────────────────────────┬──────────────────────┐
│  AppSidebar      │  main content                │  ChatColumnShell     │
│  252px default   │  flex-1, max-w-5xl           │  620px default       │
│  200-400px range │  centered padding            │  360-960px range     │
│  collapsible     │                              │  collapsible         │
└──────────────────┴──────────────────────────────┴──────────────────────┘

Mobile (< 1024px):
┌──────────────────────────────────────────────────────────────────┐
│  MobileTopBar (hamburger links + chat icon rechts)               │
│  main content (full width)                                       │
│  MobileNavDrawer (overlay, von links)                            │
│  MobileChatDrawer (overlay, von rechts)                          │
└──────────────────────────────────────────────────────────────────┘
```

Sidebar-Persistenz: localStorage-Keys `app-sidebar-collapsed`, `app-sidebar-width`, `global-chat-collapsed`, `global-chat-width`.

Drag-Handle: 1.5px breite vertikale Linie, Gold bei Hover. Resize via `mousedown/mousemove/mouseup` auf `document`.

### AppSidebar-Aufbau

```
Logo + "ISP Sales Intelligence"
SidebarTopNav
  Dashboard       (DashboardIcon)
  Unternehmen     (BuildingIcon) → /companies
  Messen          (BriefcaseIcon) → /shows
  Konkurrenten    (CompetitorsIcon) → /competitors
SidebarFavorites  (gepinnte Shows)
SidebarContextSection  (dynamischer Kontext je nach aktiver Route)
AccountCard  (User-Profil + Settings, am unteren Rand)
```

Aktiver Nav-Punkt: 2px gold left-border + leicht erhohter Hintergrund (`rgba(10,10,10,0.04)`).

### Komponenten-Muster

**ButtonPrimary** — fur alle primaren Aktionen:
```css
border: 1px solid rgba(10,10,10,0.80);
background: transparent;
color: #0A0A0A;
padding: 8px 16px;
font-size: 13px; font-weight: 500;
/* hover */ border-color: #D4A843;
/* active */ transform: scale(1.06);
transition: 120ms ease;
```
Kein `bg-near-black`, kein `text-white` auf Buttons. Immer border-only, nie gefullt.

**Icon-Buttons** (sekundare Aktionen, collapse, settings):
```css
width: 32px; height: 32px;
border: none; background: transparent;
/* hover */ background: rgba(10,10,10,0.06);
```

**Status-Badges:**
```
crawling/queued: gold dot (8px) + "laeuft"
ready:           green dot + "fertig"
partial:         orange dot + "teilweise"
failed:          red dot + "fehler"
paused:          gray dot + "pausiert"
```

**Priority-Pills (ExhibitorList):**
```
hoch:    border 1px gold(40%), bg gold(10%), text near-black, weight 600
mittel:  border 1px blue(40%), bg blue(5%), text near-black(80%)
niedrig: border 1px rgba(10,10,10,0.10), text near-black(40%)
```

**Confidence-Score-Farben:**
```
>= 8:  var(--color-success)   [grün]
>= 5:  var(--color-gold)      [gold]
< 5:   rgba(10,10,10,0.35)    [gedimmt]
```

**Card Surface:**
```css
.card-surface {
  background: white;
  box-shadow: 0 1px 3px rgba(10,10,10,0.08), 0 0 0 1px rgba(10,10,10,0.06);
  transition: box-shadow 120ms ease;
}
.card-surface:hover {
  box-shadow: 0 4px 14px rgba(10,10,10,0.12), 0 0 0 1px rgba(10,10,10,0.10);
}
```

**EditableIntelField** (Aussteller-Detail-Seite):
- Hover: Stift-Icon erscheint (opacity 0 → 1, transition 120ms)
- Click: Input oder Textarea offnet sich inline
- Save via PATCH `/api/exhibitors/[id]/fields` mit `{ table, field, value }`
- States: normal | editing | saving ("speichert...") | error
- Kein Modal, kein Drawer — alles inline, kein Layout-Shift

**ExhibitorList** (virtualisiert mit `react-window`):
- FixedSizeList, row height 120px desktop / 160px mobile
- Filter: Name-Search (debounced 200ms), Sektor (Multi-Select), Priority, Battery-Need
- Sort: match_confidence DESC (default) | name ASC
- Desktop-Grid: 12 Spalten (Firma+One-Liner: 5, Badges: 4, Confidence: 2, Stand: 1)
- Mobile: vertikaler Stack (Name, One-Liner, Badges, Confidence)

**Animationen:**
```css
.isp-loading-stripe   /* Seiten-Navigation-Balken oben, gold/white sliding */
.isp-typing-dots      /* Chat-Typing, 3x 5px pulsing squares, near-black */
.isp-list-scroll      /* 6px Scrollbar, near-black thumb */
```

### Seitenstruktur

| Route | H1 | Inhalt |
|---|---|---|
| `/` | Dashboard. | 4 Stat-Cards, 3 Quick-Links, letzte 8 Shows, Token-Stats |
| `/companies` | Unternehmen. | Deduplizierte Firmen-Liste, Filter, Stat-Bar |
| `/shows` | Messen. | 2 Sections: manuell erfasst (Grid) + entdeckt (Liste) |
| `/shows/[id]` | Show-Name | Toolbar + 5 View-Tabs: aussteller, prozess, log, kosten, progress |
| `/shows/[id]/exhibitors/[exId]` | Firmen-Name | Stammdaten + Short-Block + Deep-Block, EditableIntelFields |
| `/competitors` | Konkurrenten. | Competitor-Liste mit Status-Tabs |
| `/shows/search` | Messen suchen. | Show-Discovery-Dialog + Ergebnis-Liste |
| `/costs` | Kosten. | Globale API-Kosten: Kategorie-Tabelle, pro Messe, Konkurrenzanalysen, Messen-Suche. RPC: `get_full_cost_stats` |

**Show-Detail-Tabs (?view=):**
- `aussteller` (default) — ExhibitorList mit Filtern
- `prozess` — PhasesView (Orchestrator-Phasen, Step-Progression)
- `log` — LogView (letzte 50 Log-Einträge, suchbar)
- `kosten` — CostView (Token-Breakdown, USD-Kosten per Modell)
- `progress` — ProgressView (per-Aussteller-Status-Balken)

### Design Hard-Rules (nie verletzen)

- **Kein `border-radius`** — `border-radius: 0 !important` ist global gesetzt. Ausnahme: Avatare (50% oder 9999px).
- **Keine Webfonts** — nur Helvetica-Stack, kein `@import`, kein `<link>` zu externen Fonts.
- **Keine Em-Dashes** (`—`) in sichtbarem Text — Punkt, Komma oder Klammer stattdessen.
- **Single Gold Accent** — nie zwei goldene Elemente gleichzeitig auf einem Viewport.
- **Keine gefullten Buttons** — immer border-only, transparent background.
- **Keine Superlative** in UI-Copy — sachlich, präzise, kurze Satze.
- **Sektor-Bilder:** `filter: grayscale(0.15) contrast(1.02)`.
- **Keine `border` um Cards** — nur `box-shadow` fur Elevation.

---

## API-Struktur

### Trade Shows & Exhibitors

| Methode | Pfad | Funktion |
|---|---|---|
| `POST/GET` | `/api/trade-shows` | Create / List shows |
| `GET/PATCH` | `/api/trade-shows/[id]` | Get / Update show |
| `POST` | `/api/trade-shows/[id]/pause` | Pause pipeline |
| `POST` | `/api/trade-shows/[id]/resume` | Resume pipeline |
| `POST` | `/api/trade-shows/[id]/re-listing` | Re-fetch Aussteller-Liste |
| `DELETE` | `/api/exhibitors/[id]` | Delete exhibitor (cascades) |
| `PATCH` | `/api/exhibitors/[id]/fields` | Edit Short/Deep-Felder inline |
| `POST` | `/api/exhibitors/[id]/deep-dive` | Trigger Deep-Dive |
| `POST` | `/api/shows/[id]/exhibitors` | Add exhibitor manually |
| `POST` | `/api/shows/[id]/exhibitors/bulk-delete` | Bulk-delete exhibitors |

### Chat / Orchestrator

| Methode | Pfad | Funktion |
|---|---|---|
| `POST` | `/api/shows/[id]/chat` | SSE-Stream, Orchestrator-Tool-Loop |
| `GET` | `/api/shows/[id]/chat?threads=true` | List threads |
| `GET` | `/api/shows/[id]/chat?thread=[id]` | Get thread messages |
| `DELETE` | `/api/shows/[id]/chat?thread=[id]` | Delete one thread |
| `DELETE` | `/api/shows/[id]/chat` | Delete all threads |

### Export, Companies, Competitors, Show Discovery

| Methode | Pfad | Funktion |
|---|---|---|
| `GET` | `/api/shows/[id]/export` | Excel-Export (ExcelJS), farbcodiert nach Priority |
| `GET/POST` | `/api/companies` | List / Hand-add company |
| `POST` | `/api/companies/chat` | Global companies chat |
| `GET` | `/api/competitors` | List competitors_overview |
| `POST` | `/api/competitors/discovery` | Trigger auto-discovery |
| `POST` | `/api/competitors/[id]/curate` | Curator-Aktionen (Status, Short-Rescan, manuelle Links) |
| `POST` | `/api/competitors/chat` | SSE-Stream, Competitor-Orchestrator-Tool-Loop |
| `GET` | `/api/competitors/log` | Per-User Event-Feed (Run- + Competitor-Events) |
| `POST` | `/api/competitors/bulk-delete` | Bulk-delete Konkurrenten |
| `POST/GET` | `/api/show-discovery` | Trigger Messen-Suche / List runs |
| `GET` | `/api/show-discovery/[runId]/results` | List candidates |
| `PATCH` | `/api/show-discovery/[runId]/results/[id]` | Dismiss / add to trade_shows |
| `GET/PATCH` | `/api/settings` | Get/update app_settings |
| `GET/PATCH` | `/api/profile` | Get/update user_profiles |

---

## Dev-Workflow

**2 Terminals:**
```bash
npm run inngest:dev   # Port 8288 — Inngest UI + Worker
npm run dev           # Port 3000 — Next.js
```

Login per Magic-Link an `ALLOWED_EMAIL`. Alle anderen Adressen werden in `app/auth/callback/route.ts` rejected.

Auto-Refresh: Polling alle 5 s, solange `trade_shows.status` IN (queued, crawling) oder Aussteller mit pending/running-Status vorhanden.

Schema-Änderungen: Neue Migration `0030_*.sql` anlegen, idempotent schreiben (`IF NOT EXISTS`). Nie bestehende Migrationen editieren.

Kosten-Check nach Echt-Lauf:
- Anthropic-Console: Cache-Hit-Rate >70 % ab Aussteller 2 erwarten
- Firecrawl-Dashboard: Credits
- Browserbase-Dashboard: Session-Minuten

---

## Bekannte Schwachstellen / Watch-Outs

- **Anthropic Rate-Limit (Haiku 4.5):** 50k input-tokens/min auf Free-Tier. Throttle 30/min ist konservativ; bei Pro-Tier auf 100/min erhöhen. 1500-Aussteller-Messe = ~50 Min.
- **Firecrawl Show-more-Cap 80** gilt fur den Worst-Case-Letter. Pricing per Call, nicht per Click.
- **Listing-Pages mit JS-Lazy-Load:** Firecrawl `waitFor` 3000 ms in Discovery, 800 ms zwischen Show-more-Clicks. Bei langsamen Sites in `lib/strategies/shared.ts` erhohen.
- **`onFailure` doppelt verschachtelt:** Inngest Failure-Events kommen als `event.data.event.data`. Nie zu `event.data.exhibitorId` vereinfachen.
- **Web-Search-Cost im Chat:** Nur Token-basierte Chat-Kosten getrackt. Anthropic Native Web-Search (~$0.01/Search) fehlt in Cost-View.
- **Profile-Enrich promoted website:** Wenn `scrape.external_website` gefunden und `exhibitor.website` leer, wird `website`-Column uberschrieben. URL-Search pruft danach, ob `website` inzwischen gesetzt ist (guard im exhibitor-url-search function).
- **Confirmation-Widget darf nicht umgangen werden:** `delete_exhibitors` und `add_exhibitor` geben erst `detail.confirmation_request` zuruck. Claude weist auf Widget hin, fuhrt aber nichts selbst aus.
- **Competitors retries=0:** Bewusst. Web-Search-Costs bei Retry verdoppeln sich. Bei Failure: UI-sichtbarer Fehler, User triggert manuell.
- **Realtime nicht aktiv:** Supabase Realtime Publication ist im Schema, UI nutzt polling. Wechsel auf Realtime wenn Latenz stört.

---

## Repo & Deployment

- **Repo:** `git@github.com:LucasN-git/sales_automation.git` (Sub-Repo, nicht im Brand-Ordner-Repo)
- **Vercel:** separates Projekt, nicht mit Brand-Material-Vercel verknupft
- **Supabase:** separates Projekt, RLS aktiv, Migrationen uber `supabase db push` oder SQL-Editor
- **Inngest-Cloud:** Sync-URL = `https://<vercel-domain>/api/inngest`, Keys in Vercel-Env
- **Env-Vars:** `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `FIRECRAWL_API_KEY`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `ALLOWED_EMAIL`

---

## Tooling-Hinweise

- **Vor Library-Updates** (Anthropic SDK, Inngest, Supabase, Firecrawl, Next.js, Browserbase): immer Context7 querchecken — alle sind aktiv weiterentwickelt.
- **Brand-Checkliste vor neuen UI-Komponenten:** ein Gold-Element, Helvetica, keine Rundung, keine Em-Dashes, keine gefullten Buttons.
- **Neue Inngest-Function:** in `lib/inngest/functions.ts` anlegen + in `functions`-Array am Ende eintragen. Event-Name-Konvention: `<domain>.<action>.<modifier>` (z.B. `exhibitor.short.requested`).
- **Neue API-Route mit Supabase:** `createClient()` (User-scoped, RLS) fur User-Routes. `createServiceRoleClient()` (Admin, bypasses RLS) nur in Inngest-Functions.
- **Neue Migrationen:** Nummerierung streng aufsteigend, idempotent schreiben.
