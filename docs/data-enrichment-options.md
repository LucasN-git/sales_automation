# D

'_Öata-Enrichment-Optionen für die Messe-Sales-Automation

Stand: 2026-05-10. Externe Datenquellen, die als optionale Enrichment-Schicht zwischen Listing und Short-Tier ergänzt werden könnten. Sortiert nach Mehrwert für den ISP-Use-Case (Defense / Industry / Mobile Robotics, DACH-Schwerpunkt, Power-Systems-Match).

## Hoher Mehrwert

| Datenfeld                                                                        | Anbieter                                                                            | Kosten (ca.)                                             | Mehrwert für ISP                                                                                                                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision-Makers (Name, Titel, LinkedIn, verifizierte Mail/Phone)                 | **Apollo.io**                                                                 | 49–149 €/Mo + Credits (API)                            | Ersetzt das ungenaue Claude-`decision_makers`-Feld im Deep-Tier. Direkter Pitch-Adressat statt Recherche-Aufwand.                                     |
| Decision-Makers DACH (GDPR-clean Phones, manuell verifiziert)                    | **Cognism**                                                                   | ~1.500 €/Mo Enterprise                                  | Nur sinnvoll, wenn DACH-Cold-Calling skaliert wird. Sonst Apollo.                                                                                       |
| Decision-Makers, günstige Einzel-Lookups                                        | **Lusha**                                                                     | ~30–80 €/Mo                                            | Lightweight-Alternative für gelegentliche Lookups.                                                                                                     |
| Firmographics (MA-Zahl, Umsatz, Standorte, Tochterges., Gründungsjahr)          | **Apollo.io** / **Clearbit (HubSpot Breeze)**                           | im Apollo-Tarif enthalten                                | Claude schätzt aktuell aus der Webseite, oft falsch bei Mittelständlern. Direkter Einfluss auf Power-Bedarf-Schätzung.                               |
| Hiring-Signals (offene Stellen, neue Rollen)                                     | **Apollo Job Postings** / **TheirStack** / **LinkedIn Sales Nav** | Apollo: inkl., TheirStack: ~50 €/Mo, LSN: 99 €/Mo/User | Stärkstes Buy-Signal überhaupt. Beispiel-Trigger: "Power Systems Engineer", "Test Lab Manager", "HMI-Specialist". Im aktuellen System komplett blind. |
| Deutsche Firmenstruktur (HR-Auszug, GF, Gesellschafter, Beteiligungen, Bonität) | **North Data**                                                                | ~50–200 €/Mo nach Volume                               | DACH-spezifisch deutlich präziser als Apollo. Wichtig für Approach-Strategie (Konzern-Tochter vs. eigenständig).                                     |

## Mittlerer Mehrwert

| Datenfeld                                                | Anbieter                                    | Kosten (ca.)                                              | Mehrwert für ISP                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Funding-Rounds, M&A, Investoren                          | **Crunchbase** / **PitchBook**  | Crunchbase: ~49 €/Mo, PitchBook: Enterprise (~25k+/Jahr) | Defense-Startups (BlueHalo, Helsing, Arx Robotics) mappen direkt auf Lifecycle 04/05. Bei reinem Industrie-Mittelstand weniger relevant. |
| Tech-Stack (Server, Test-Equipment, SCADA, Industrie-IT) | **HG Insights** / **BuiltWith** | HG: Enterprise (~20k+/Jahr), BuiltWith: ~295 $/Mo         | Theoretisch sehr passend, praktisch software-lastig. ROI nur bei großen Accounts mit klarer IT-Profilierung.                            |

## Kein / geringer Mehrwert

| Datenfeld                          | Anbieter             | Warum nicht                                                                                     |
| ---------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| Software-Intent-Daten              | Bombora, 6sense      | Trackt SaaS-Research-Signals, keine Hardware-Käufe.                                            |
| User-Reviews                       | G2                   | Keine Hardware-Reviews.                                                                         |
| Generische Industry-Classification | NAICS / SIC-Provider | ISP-Sektoren (Military, Air, Mobile Robotics, …) sind kustom, mappen nicht auf Standard-Codes. |

## Architektur-Skizze für Integration

```
Listing → [Enrichment-Layer] → Short-Tier → Deep-Tier
              ↓
         Apollo + NorthData + Hiring-Signals
              ↓
         exhibitor_enrichment-Tabelle
              ↓
         Felder fließen als System-Block in Short-Prompt
```

Konkrete Felder, die geschrieben werden sollten:

- `employee_count` (int)
- `annual_revenue_eur` (int, optional)
- `legal_form`, `parent_company` (DACH via NorthData)
- `decision_makers[]` (Array: name, title, linkedin, email, phone)
- `recent_hiring_signals[]` (Array: title, posted_at, location, source_url)
- `funding_stage`, `last_funding_round_eur`, `last_funding_date`
- `enrichment_sources[]` (Array für Cost-Tracking)
- `enrichment_cost_usd`, `enriched_at`

Per-Show-Toggle in Settings: "Enrichment an/aus" (bei kleinen oder unwichtigen Messen abschaltbar). Cache pro Aussteller über mehrere Shows hinweg, damit dieselbe Firma nicht zweimal angereichert wird (Hash über Domain).

## Empfohlene Einstiegs-Stack

1. **Apollo.io API** als Primary (Decision-Makers, Firmographics, Hiring) — ~99 €/Mo Starter
2. **North Data API** als DACH-Ergänzung — ~50–100 €/Mo
3. Crunchbase / Cognism / HG Insights nur wenn Volumen oder Use-Case es klar rechtfertigt.

Erwarteter Effekt auf `match_confidence`: von ~60–70 % (Claude rät) auf ~85–90 % (Claude bekommt verifizierte Fakten). Damit wird die Tier-Sortierung vertrauenswürdig genug, dass Vertrieb nicht jeden Lead nachprüfen muss.

## Watch-Outs

- **Pricing-Modelle** sind teils credit-basiert (Apollo: pro Match), teils flat. Bei hochfrequenten Crawls Credits einplanen.
- **DSGVO**: Apollo-Daten sind US-stark, EU-Daten teils ohne explizite Einwilligung (Legitimate-Interest-basiert). Cognism ist sauberer für EU-Cold-Outreach. North Data ist HR-Auszug, also unkritisch.
- **API-Rate-Limits**: Apollo Starter ~600 Calls/Min, bei 1500er-Messe also kein Bottleneck. North Data eher konservativ, ggf. Throttling im Inngest-Step nötig.
- **Cache-Invalidation**: Hiring-Signals veralten in Tagen, Firmographics in Monaten, HR-Daten in Jahren. Pro Feld eigene TTL definieren.
