# Loading Times — Debugging Report

Gemessen mit Playwright (Chromium, lokaler Dev-Server) am 2026-05-13.

## Gemessene Ladezeiten

| Route | TTFB | FCP | Load Complete | Transfer |
|---|---|---|---|---|
| `/shows` | **1213 ms** | 1364 ms | 2636 ms | 41 KB |
| `/shows/[id]` (Eurosatory 2026) | **2363 ms** | 2548 ms | 4323 ms | 44 KB |

---

## Problem 1: Permanentes RSC-Polling (Hauptkostentreiber)

`Eurosatory 2026` hat in der DB Status `crawling`. Damit ist `anyActive = true` in `app/shows/page.tsx:97-99` → `<AutoRefresh intervalMs={6000} />` läuft dauerhaft. Gleichzeitig feuert der Show-Detail-Layout-AutoRefresh mit 5000ms (weil `isActivelyCrawling = true`).

**Symptom im Netzwerk:** Alle 5-6 Sekunden kommen 2 parallele RSC-Requests à ~1200ms gegen `/shows?_rsc=` — der Server ist fast durchgehend mit Supabase-Queries beschäftigt.

Warum **zwei gleichzeitige Requests** statt einem? In Next.js Dev mit React StrictMode wird `useEffect` doppelt gemountet (mount → unmount → remount). Der Cleanup via `clearInterval` greift, aber die zwei `router.refresh()`-Aufrufe nutzen unterschiedliche RSC-Hashes (`Bkivr4mTmEOGFei7` vs `WSvqpuE-mQYsJfts`) — ein Hinweis auf zwei verschiedene Router-Instanzen. Das ist ein **AutoRefresh-Leak bei Dev/HMR**.

**Fix:**
```tsx
// components/AutoRefresh.tsx
useEffect(() => {
  let active = true;
  const t = setInterval(() => { if (active) router.refresh(); }, intervalMs);
  return () => { active = false; clearInterval(t); };
}, [router, intervalMs]);
```

---

## Problem 2: TTFB 2300ms auf Show-Detail

Der Layout-Handler `app/shows/[id]/layout.tsx:17-43` macht 3 Supabase-Calls:

1. `trade_shows` (single row) — **sequenziell** vor den anderen
2. `getShowExhibitorStatus` (alle Exhibitors des Shows) — danach parallel...
3. `exhibitor_deep` (alle Deep-Rows) — ...mit diesem

Jeder Remote-Supabase-Round-Trip kostet ~300-500ms. Da Call 1 sequenziell vor 2+3 liegt, summiert sich das auf 2300ms+.

**Fix:** Alle drei in ein `Promise.all` ziehen und danach `notFound()` prüfen:
```ts
const [{ data: show }, statusRows, { data: deepRowsRaw }] = await Promise.all([
  supabase.from("trade_shows").select("id, status").eq("id", id).single(),
  getShowExhibitorStatus(id),
  supabase.from("exhibitor_deep")
    .select("exhibitor_id, exhibitors!inner(trade_show_id)")
    .eq("exhibitors.trade_show_id", id),
]);
if (!show) notFound();
```

---

## Problem 3: HTTP 500 auf `/shows?_rsc=` während Polling

Bei ~28-30 Sekunden nach dem Seitenladen treten 2× HTTP 500 auf:

```
[ERROR] Failed to load resource: 500 Internal Server Error @ /shows?_rsc=Bkivr4mTmEOGFei7
```

Der Fehler tritt **während des dauerhaften Pollings** auf. Wahrscheinlichste Ursachen:
- Supabase-Connection-Pool-Erschöpfung durch zu viele parallele Requests
- Race-Condition im Server-Component-Rendering unter Last

Direkt mit dem Polling-Problem verknüpft — sobald Problem 1 behoben ist, sollten diese 500er verschwinden.

---

## Problem 4: Zweites Polling-System im Chat-Panel

Neben dem RSC-Polling laufen noch:
- `GET /api/companies/chat?threads=1`
- `GET /api/companies/chat?thread=<uuid>`

Das Chat-Panel hat ein eigenes Polling-System. Unter Last treffen beide Polling-Systeme gleichzeitig auf den Server.

---

## Sofortmaßnahmen (Priorität)

1. **Stuck-Status fixen:** `Eurosatory 2026` ist auf `crawling` festgefahren ohne aktiven Inngest-Job. Status auf `paused` oder `failed` setzen → Polling stoppt sofort, Server entlastet.

2. **AutoRefresh StrictMode-Fix** (s. Problem 1): `active`-Flag in useEffect ergänzen.

3. **Show-Detail-Layout:** alle 3 DB-Calls in `Promise.all` parallelisieren (s. Problem 2).

4. **Langfristig:** Supabase Realtime statt Polling einsetzen, wenn die TTFB-Last im Produktionsbetrieb relevant wird.
