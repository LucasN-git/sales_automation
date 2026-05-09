# Messe-Sales-Automation

Sales-Intelligence-Tool für ISP Power Systems. Eingabe: Messen-URL. Output: durchsuchbare Aussteller-Liste mit ISP-Capability-Match und Pitch-Hook pro Lead.

Stack: Next.js 15 (App Router), Supabase (Postgres + Auth), Inngest (Background-Jobs), Firecrawl (Web-Crawling), Anthropic Claude (Matching mit Prompt-Caching).

## Architektur

```
User legt Messe an
    ↓ POST /api/trade-shows
trade_shows row inserted (status=queued)
    ↓ inngest.send("trade-show.requested")
[Inngest] crawlTradeShow
    ├─ status → crawling
    ├─ Firecrawl /scrape mit json-Schema → Aussteller-Liste
    ├─ Bulk-Insert exhibitors
    └─ fan-out: N × "exhibitor.enrich.requested"
[Inngest] enrichExhibitor (concurrency=5, retries=3)
    ├─ Firecrawl Markdown der Firmen-Website
    ├─ Claude messages.create mit gecachtem System-Block (Catalog)
    ├─ JSON parse + Zod validate
    ├─ upsert exhibitor_intel
    └─ on last-done: trade_shows.status → ready/partial/failed
```

## Setup

### 1. Externe Accounts

Du brauchst:

- **Supabase**-Projekt: <https://supabase.com/dashboard> → New Project (eu-central-1).
  - Settings → API: `URL`, `anon key`, `service_role key`.
  - Settings → Auth → Email-Provider: Magic-Link aktivieren.
  - Settings → Auth → URL Configuration: `Site URL = http://localhost:3000` (lokal) oder Vercel-Domain.
- **Anthropic**-API-Key: <https://console.anthropic.com/settings/keys>.
- **Firecrawl**-API-Key: <https://www.firecrawl.dev/app/api-keys>.
- **Inngest**-Account (für Production): <https://app.inngest.com>. Lokal nicht zwingend.

### 2. Lokale Installation

```bash
cd "automations/messe_sales_automation"
cp .env.example .env.local
# .env.local mit Keys füllen, ALLOWED_EMAIL = die Mail des Vertrieblers

npm install
```

### 3. Datenbank-Migration

Option A — Supabase CLI:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Option B — manuell:

1. Supabase-Dashboard → SQL Editor.
2. Inhalt von `supabase/migrations/0001_init.sql` einfügen und ausführen.

### 4. Lokal starten (zwei Terminals)

```bash
# Terminal 1: Inngest Dev-Server (UI auf http://localhost:8288)
npm run inngest:dev

# Terminal 2: Next.js
npm run dev
```

App auf <http://localhost:3000>. Login per Magic-Link an `ALLOWED_EMAIL`.

### 5. Deployment auf Vercel

```bash
# Repo zu GitHub pushen, dann via Vercel Dashboard importieren
# Environment Variables aus .env.local in Vercel-Settings übernehmen.
# WICHTIG: NEXT_PUBLIC_APP_URL = https://<deine-domain>.vercel.app
```

Inngest-Cloud verbinden:

1. <https://app.inngest.com> → New App → Sync URL eingeben:  
   `https://<vercel-domain>/api/inngest`
2. `INNGEST_EVENT_KEY` und `INNGEST_SIGNING_KEY` aus dem Inngest-Dashboard zurück nach Vercel kopieren.
3. Re-Deploy.

Supabase Production-Auth:

- Auth → URL Configuration → `Site URL` und `Redirect URLs` auf die Vercel-Domain setzen.

## Brand-Konformität

Die App folgt der ISP-Brand-Bibel ([ISP_Power_Systems_Brand.md](../ISP_Power_Systems_Brand.md)):

- Drei Farben: Cream, Near-Black, Gold.
- **Genau ein Gold-Element pro View.** Aktuell:
  - Login → Submit-Button-Punkt
  - Dashboard → "Neue Messe"-Button-Punkt
  - Show-Detail → Status-Indikator-Punkt während Crawl
  - Exhibitor-Detail → Match-Confidence-Wert-Punkt
- Helvetica-Stack, keine Webfonts.
- Right-Angles only (`border-radius: 0` global enforced).
- Hairlines statt Borders.
- Keine Em-Dashes, keine Superlative.

Beim Erweitern der UI: vor jedem neuen Element gegen [CLAUDE.md](../../CLAUDE.md) Brand-Checkliste querlesen.

## Capability-Katalog

Single Source: [`lib/isp-catalog.ts`](lib/isp-catalog.ts). Aus dem Brand-Doc abgeleitet (§1 Positioning, §2 Sectors, §3 Lifecycle, §4 Differentiators).

Wenn das Brand-Doc geändert wird (z.B. neuer Sektor), muss `isp-catalog.ts` mitziehen — der Katalog wird als gecachter System-Prompt-Block an Claude geschickt und bestimmt die kanonischen Match-IDs.

## Kosten-Monitoring

Erwartete Kosten pro Messe (~50 Aussteller):

- **Firecrawl:** ~50 Scrapes (1× Listing + 49× Firmen-Sites) ≈ 50 Credits ≈ 2–5 €.
- **Claude:** ~50 Calls × ~1500 Input-Tokens (uncached: 1500, cached ab Call 2: ~150). Output ~600 Tokens. Mit Caching ≈ 1–3 € pro Messe (Sonnet 4.6).

Beobachten:

- Anthropic-Console → Cache-Hit-Rate sollte ab Aussteller 2 >70 % sein.
- Firecrawl-Dashboard → Credit-Verbrauch.

## Troubleshooting

| Symptom | Ursache | Fix |
|---|---|---|
| Login-Mail kommt nicht | Site URL falsch | Supabase → Auth → URL Configuration prüfen. |
| `not_allowed`-Redirect nach Login | E-Mail ≠ `ALLOWED_EMAIL` | `.env.local` korrigieren, neu starten. |
| Inngest-Run hängt im "scrape-company-site" | Firecrawl-Credit aufgebraucht oder Rate-Limit | Firecrawl-Dashboard → Plan-Limit prüfen. |
| Claude wirft `No JSON object found` | Modell hat Prosa zurückgegeben | `lib/claude.ts` → `SYSTEM_INSTRUCTION` schärfen oder `max_tokens` erhöhen. |
| Aussteller-Liste leer | Listing-Page nutzt JS-Lazy-Loading | `lib/firecrawl.ts` → `waitFor` erhöhen. Notfalls Aussteller manuell pflegen (V2-Feature). |

## Verzeichnisstruktur

```
automations/messe_sales_automation/
├── app/                            Next.js App-Router
│   ├── layout.tsx                  Helvetica + Cream-BG
│   ├── page.tsx                    Dashboard
│   ├── NewShowForm.tsx             Client-Form für neue Messe
│   ├── login/page.tsx              Magic-Link
│   ├── auth/callback/route.ts      Code-Exchange + Allowlist-Check
│   ├── auth/signout/route.ts
│   ├── api/inngest/route.ts        Inngest Webhook
│   ├── api/trade-shows/route.ts    POST createTradeShow + send Inngest event
│   └── shows/[id]/...              Show-Detail + Exhibitor-Detail
├── components/
│   ├── brand/                      Hairline, GoldDot, Numeral, ButtonPrimary
│   └── AutoRefresh.tsx             Pollt while crawling läuft
├── lib/
│   ├── isp-catalog.ts              Capability-Catalog (Single Source)
│   ├── firecrawl.ts                getExhibitorList, scrapeCompanySite
│   ├── claude.ts                   enrichAndMatch mit Prompt-Caching
│   ├── inngest/client.ts           typed Inngest client
│   ├── inngest/functions.ts        crawlTradeShow + enrichExhibitor
│   └── supabase/                   server.ts, client.ts, middleware.ts
├── supabase/migrations/0001_init.sql   Schema + RLS + Realtime
├── middleware.ts                   Auth-Gate (excl. /login, /auth, /api/inngest)
├── package.json
├── next.config.ts
├── tsconfig.json
├── postcss.config.mjs              Tailwind v4
└── app/globals.css                 Brand-Tokens, force-zero-radius
```

## Roadmap (V2+, nicht in V1)

- LinkedIn + Crunchbase-Enrichment
- Multi-User mit Notizen/Tags
- CSV-Export für CRM
- Pitch-Deck-Generator (knüpft an pptx-Skill an)
- Pipeline-Dashboard pro Messe
