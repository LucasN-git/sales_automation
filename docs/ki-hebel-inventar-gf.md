# KI bei ISP Power Systems — Hebel-Inventar für die GF

**Adressat:** Geschäftsführung (Dr. Tono Nasch, Michael König)
**Stand:** 2026-05-10
**Verfasser:** Lucas Nasch
**Format:** Use-Case-Inventar, kurz pro Hebel. Keine technische Roadmap, keine Priorisierung. Ziel: gemeinsamer Stand, welche KI-Hebel realistisch sind und in welche Richtungen ein Folgegespräch sinnvoll ist.

---

## 1. Ausgangslage

ISP arbeitet in vier Dimensionen, die alle KI-affin sind:

- **Engineering-getriebene Einzelprojekte** mit langen Sales-Zyklen, hoher Spezifikationsdichte, Defense-/Aero-Regulatorik.
- **Eigenes Test- und Validation-Center** mit drei Jahrzehnten Messdaten als ungehobener Daten-Asset.
- **Vertikal integrierte Wertschöpfung** (Cell-Selection bis Serie + Diagnostics), in der jede Stufe eigene Software-Reibung erzeugt.
- **Zwei Standorte** (Salzbergen, München) mit klassischem Mittelstands-Tooling (Mail, Office, ERP, evtl. CAD/PLM).

Dieser Mix ist KI-freundlicher als ein reiner Produkt- oder Plattform-Player, weil viele Hebel intern wirken (Effizienz, Wissen, Geschwindigkeit) und nicht erst extern abgesegnet werden müssen.

---

## 2. Sales & Markterschließung

### 2.1 Messe-Aussteller-Intelligence (laufend, V4)
Automatisierte Aussteller-Recherche pro Defense-/Industriemesse: Crawl der Aussteller-Liste, Matching gegen ISP-Capability-Katalog, Pitch-Hook pro Lead. Heute schon im Einsatz, perspektivisch auf weitere Messen-Quellen erweiterbar.

### 2.2 RFQ-/Lastenheft-Vorprüfung
Eingehende Anfragen (PDF, E-Mail, Lastenheft) werden automatisiert auf technische Plausibilität geprüft: passende Zellchemie, Performance-Fenster, Zertifizierungs-Anforderungen, geschätzter Engineering-Aufwand. Engineering bekommt einen vorqualifizierten Eingang statt Kaltstart.

### 2.3 Account-Mapping & Stakeholder-Recherche
Pro Ziel-OEM: Org-Struktur, Programmverantwortliche, Einkauf, technische Decision-Makers, laufende Projekte (öffentlich), Partner/Wettbewerber. Bisher manuell via LinkedIn/Web, künftig in einem Lauf pro Account.

### 2.4 CRM-Entlastung & Gesprächsnachbereitung
Sprach- oder Notiz-Diktat nach Kundenterminen wird automatisch in strukturierte CRM-Einträge, Follow-ups und To-dos überführt. Vertrieb verbringt weniger Zeit mit Doku, mehr mit Gespräch.

### 2.5 Angebots-Drafting
Wiederkehrende Angebotsteile (Scope-Beschreibung, Test-Programm, Liefer-Stufen) werden aus Vorgängerangeboten und Catalog-Bausteinen vorerstellt. Der Engineer prüft und passt an, statt jedes Mal neu zu formulieren.

### 2.6 Konkurrenz- & Marktbeobachtung
Wöchentlicher Briefing-Lauf zu relevanten Defense-/Aero-Programmen, Wettbewerbern, Förderprogrammen (EDF, BMVg, EU-Mil-Mob). Kuratiert in einem festen Format, das die GF in 5 Minuten scannen kann.

---

## 3. Engineering & Batterie-Entwicklung

### 3.1 Zell-Auswahl-Assistent
Aus dem Anforderungsprofil (Energie, Power, Temperatur-Fenster, Lebensdauer, Compliance) werden geeignete Zellkandidaten aus eigener Datenbank und öffentlicher Datenbasis vorgeschlagen, mit Begründung und Vergleichstabelle. Ersetzt nicht den Engineer, kürzt aber die Vorauswahl von Tagen auf Minuten.

### 3.2 Thermal- und Electrical-Modeling-Vorlauf
KI-gestützte Parameter-Vorschläge für CFD- und elektrische Simulationen (Initial-Werte, sinnvolle Sweep-Bereiche), abgeleitet aus früheren Projekten ähnlicher Topologie. Reduziert Simulationszyklen und Setup-Aufwand.

### 3.3 BMS-Firmware-Code-Assistenz
Code-Generation und -Review für BMS-Logik unter Constraints (funktionale Sicherheit, Safety-Goals). Wichtig: KI generiert Vorschlag, der Sicherheitsverantwortliche signiert ab. Nichts geht ungeprüft auf einen Akku.

### 3.4 Failure-Mode-Datenbank
Frühere Test-Auffälligkeiten, Field-Returns und Reparaturen werden in einer durchsuchbaren Wissensbasis verdichtet. Bei neuem Design: "Welche Failure-Modes traten bei vergleichbarer Topologie auf?" Antwortzeit Sekunden statt Erfahrungs-Lottoschein.

### 3.5 Patent- und Norm-Monitoring
Laufender Abgleich relevanter Patente, IEC-/SAE-/MIL-Norm-Updates, Fachliteratur. Engineering bekommt strukturierte Wochen-Briefings, statt manuell zu googeln.

---

## 4. Testing & Validation Center

### 4.1 Anomaly-Detection in Test-Läufen
Klimakammer-, Abuse- und Cycling-Daten werden live auf Auffälligkeiten geprüft (Temperatur-Spikes, Spannungs-Drift, Impedanz-Sprünge). Tester sehen Probleme im laufenden Test, nicht erst in der Auswertung.

### 4.2 Test-Report-Automatisierung
Aus Rohdaten wird ein strukturierter Test-Report mit Plots, Pass-/Fail-Bewertung pro Kriterium und Zusammenfassung erzeugt. Ingenieur prüft und unterschreibt, schreibt nicht mehr selbst.

### 4.3 Lebensdauer-Vorhersage
Zell- und Pack-Daten aus laufenden Cycling-Tests werden auf Restlebensdauer-Modelle geführt. Ergibt belastbarere Garantie-Aussagen gegenüber Kunden und bessere Second-Life-Bewertung.

### 4.4 Test-Protokoll-Generator
Aus Anforderung plus Norm-Set (IEC 62660, UN 38.3, MIL-STD-810 etc.) wird ein Test-Plan-Entwurf erzeugt. Standardisiert und beschleunigt die Programm-Definition.

---

## 5. Produktion & Lieferkette

### 5.1 Supply-Chain-Risiko-Scoring
Zell-Lieferanten, Komponenten und Sub-Tier-Werke werden auf Geopolitik, Produktions-Standort, Allokations-Risiko, Force-Majeure-Historie überwacht. Frühwarnung vor Engpässen, besonders für Defense-Kunden mit Domestic-Supply-Anforderung.

### 5.2 Pilot-zu-Serie-Kennzahlen
Pro Pilotlauf werden Defekt-Raten, Cycle-Time-Ausreißer und Yield-Trends automatisch analysiert. Industrialisierungs-Entscheidung basiert auf Daten statt auf Bauchgefühl.

### 5.3 Eingangskontrolle automatisiert
Wareneingangsprüfung (Zell-Datenblätter, Zertifikate, Messprotokolle) wird KI-gestützt mit Soll-Spezifikation abgeglichen. Schreibt Abweichungen ins QM-System, statt sie zu übersehen.

### 5.4 Repair- und Second-Life-Diagnostik
Rückläufer aus dem Feld werden anhand BMS-Logs automatisch klassifiziert: reparierbar, Second-Life-tauglich, Recycling. Beschleunigt den Service-Loop und verlängert die Ertragskurve pro Pack.

---

## 6. Organisation & Verwaltung

### 6.1 Internes Wissens-RAG
Alle internen Dokumente (Specs, Reports, Mails, Meeting-Notes) werden durchsuchbar mit Quellenangabe. Onboarding-Zeit für neue Engineers sinkt deutlich, "Wer wusste das nochmal?"-Verluste auch.

### 6.2 Mail- und Meeting-Triage
Eingangs-Mail wird priorisiert, kategorisiert, mit Antwort-Entwurf versehen. Meeting-Notizen werden automatisch zu Action-Items + Follow-ups. Spart pro Wissensarbeiter realistisch 30 bis 60 Minuten am Tag.

### 6.3 Personal: Bewerber-Vorqualifizierung
Eingehende Bewerbungen werden gegen Stellenprofil und Team-Bedarf vorsortiert (nicht entschieden). HR und Hiring-Manager sehen relevante Kandidaten priorisiert, statt jeden CV manuell zu lesen.

### 6.4 Compliance- & Vertrags-Review
NDA-, Liefer- und Förderverträge werden auf kritische Klauseln geprüft (Haftung, IP, Audit-Rechte, ITAR/EAR-Auflagen). Recht/GF bekommen einen Risiko-Diff statt 30-Seiten-PDF.

### 6.5 Förder- und Ausschreibungs-Radar
EU-, Bund- und Land-Förderprogramme (EDF, KMU-innovativ, Hightech-Strategie) werden laufend gescreent. ISP bekommt passende Calls vorgelegt, statt sie zu verpassen.

### 6.6 Buchhaltung und Reporting
Belegerfassung, Rechnungs-Plausibilität, Kostenstellen-Zuordnung, Monats-Reporting werden zunehmend KI-gestützt. Buchhaltung wird produktiver, GF-Reports kommen schneller und konsistenter.

---

## 7. Querschnitt: Daten und Compliance

Drei Themen, die für jeden der oben genannten Hebel gleichzeitig gelöst werden müssen, sonst bleibt KI bei ISP Spielzeug:

- **Datenfundament:** Test-, Engineering-, Sales- und ERP-Daten liegen heute verteilt. Eine konsolidierte Daten-Schicht (auch klein gestartet) ist der Multiplikator für alle Use Cases.
- **Defense-/Export-Compliance:** Bei Defense- und Aero-Kunden gelten ITAR-, EAR- und BAFA-Regeln. KI-Tools dürfen sensitive technische Daten nicht in unkontrollierte Cloud-Umgebungen geben. Modelle entweder europäisch gehostet, on-prem oder mit dezidierten Datenresidenz-Zusagen.
- **Verantwortung & Sign-off:** Engineering-, Test- und Sicherheits-Entscheidungen bleiben beim Menschen. KI ist Vorbereiter und Reviewer, nicht Entscheider. Das muss in Prozessen und Tooling verankert sein, sonst entsteht Haftungsrisiko.

---

## 8. Risiken und Hürden

- **Kompetenz-Aufbau:** Ohne mindestens eine Person mit klarem KI-/Daten-Mandat bleiben die Hebel Insellösungen.
- **Tool-Wildwuchs:** Wenn jeder Engineer sein eigenes ChatGPT nutzt, gehen Daten verloren und es entsteht Compliance-Risiko. Ein gesetzter, freigegebener Tool-Stack ist Pflicht.
- **Nutzen-Beweis:** Erste Use Cases müssen einen sichtbaren, belegbaren Wert liefern (Stunden gespart, Leads gewonnen, Test-Zeit verkürzt). Sonst stirbt das Thema im Mittelmanagement.
- **Datenqualität:** Viele Hebel funktionieren nur, wenn die Quelldaten sauber sind. Datenarbeit ist 70 Prozent des Aufwands, nicht das Modell.

---

## 9. Empfehlung für das Folgegespräch

Drei Fragen, die in einem 60-Minuten-Termin mit der GF entschieden werden sollten:

1. **Welche zwei bis drei Hebel** aus der Liste haben für ISP in den nächsten 12 Monaten den höchsten erwarteten Wert (Sales, Engineering, Operations)?
2. **Wer ist intern verantwortlich** für KI-Themen? Eigene Rolle, Teil-Mandat in IT, externer Partner?
3. **Welche Daten-/Compliance-Leitplanken** wollen wir setzen, bevor Tools breiter ausgerollt werden? (Hosting, Datenklassifizierung, Genehmigungsprozess.)

Die Antworten auf 1 bis 3 entscheiden, ob KI bei ISP punktuelles Tool oder strategischer Hebel wird.
