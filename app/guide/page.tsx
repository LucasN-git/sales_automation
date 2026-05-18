import Link from "next/link";
import type { Metadata } from "next";
import {
  ExternalLinkIcon,
  BuildingIcon,
  ActivityIcon,
  FlameIcon,
  ArrowRight,
  CompetitorsIcon,
  BriefcaseIcon,
  ChatIcon,
  DownloadIcon,
  SearchIcon,
  CostIcon,
  SettingsIcon,
  RefreshIcon,
} from "@/components/brand/Icons";

export const metadata: Metadata = {
  title: "Kurzanleitung | ISP Sales Intelligence",
};

// ─── Primitive components ────────────────────────────────────────────────────

type FlowStep = {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  auto?: boolean;
};

function ProcessFlow({
  steps,
  compact = false,
}: {
  steps: FlowStep[];
  compact?: boolean;
}) {
  const box = compact ? "w-9 h-9" : "w-10 h-10";
  const iconSize = compact ? 13 : 15;
  const minW = compact ? 62 : 78;

  return (
    <div className="flex items-start overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <div key={step.label} className="flex items-start shrink-0">
          <div
            className="flex flex-col items-center gap-1.5"
            style={{ minWidth: minW }}
          >
            <div
              className={`${box} flex items-center justify-center relative`}
              style={{
                border: step.auto
                  ? "1px dashed rgba(10,10,10,0.25)"
                  : "1px solid var(--border-color)",
                background: step.auto
                  ? "transparent"
                  : "var(--color-cream-sunken)",
              }}
            >
              <step.Icon size={iconSize} />
            </div>
            <p
              className="text-meta text-center leading-tight px-0.5"
              style={{
                color: step.auto
                  ? "rgba(10,10,10,0.30)"
                  : "rgba(10,10,10,0.45)",
              }}
            >
              {step.label}
            </p>
          </div>
          {i < steps.length - 1 && (
            <div className="shrink-0 mt-3.5 mx-0.5">
              <ArrowRight size={10} className="opacity-20" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GoldSquare() {
  return (
    <span
      className="shrink-0 inline-block"
      style={{
        width: 5,
        height: 5,
        background: "var(--color-gold)",
        marginTop: 7,
        flexShrink: 0,
      }}
    />
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <GoldSquare />
      <span className="text-body" style={{ color: "rgba(10,10,10,0.65)" }}>
        {children}
      </span>
    </li>
  );
}

function EyebrowLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-meta-strong mb-5"
      style={{ color: "rgba(10,10,10,0.35)", letterSpacing: "0.08em" }}
    >
      {children}
    </p>
  );
}

function Divider() {
  return <div className="border-t border-[var(--border-color-soft)] my-10" />;
}

// ─── Step card (Messe-Analyse) ────────────────────────────────────────────────

function StepCard({
  num,
  title,
  bullets,
}: {
  num: number;
  title: string;
  bullets: React.ReactNode[];
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[11px] font-semibold shrink-0"
          style={{ color: "var(--color-gold)" }}
        >
          0{num}.
        </span>
        <p className="text-subtitle">{title}</p>
      </div>
      <ul className="space-y-2 pl-5">
        {bullets.map((b, i) => (
          <Bullet key={i}>{b}</Bullet>
        ))}
      </ul>
    </div>
  );
}

// ─── Feature card (Weitere Bereiche) ─────────────────────────────────────────

function FeatureCard({
  Icon,
  title,
  href,
  bullets,
  children,
}: {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  href: string;
  bullets: React.ReactNode[];
  children?: React.ReactNode;
}) {
  return (
    <div>
      <Link href={href} className="flex items-center gap-2 mb-4 group">
        <Icon size={14} className="shrink-0 opacity-60" />
        <p className="text-subtitle group-hover:opacity-60 transition-opacity">
          {title}
        </p>
        <ArrowRight size={12} className="opacity-25 ml-0.5" />
      </Link>
      {children}
      <ul className="space-y-2">
        {bullets.map((b, i) => (
          <Bullet key={i}>{b}</Bullet>
        ))}
      </ul>
    </div>
  );
}

// ─── Hinweis-Box ──────────────────────────────────────────────────────────────

function HintBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-4 py-3 mb-6 text-body-sm"
      style={{
        border: "1px solid rgba(10,10,10,0.08)",
        background: "var(--color-cream-sunken)",
        color: "rgba(10,10,10,0.55)",
      }}
    >
      {children}
    </div>
  );
}

// ─── Flow definitions ────────────────────────────────────────────────────────

const MESSE_FLOW: FlowStep[] = [
  { Icon: ExternalLinkIcon, label: "URL eingeben" },
  { Icon: BriefcaseIcon, label: "Aussteller laden" },
  { Icon: RefreshIcon, label: "Vorbereitung", auto: true },
  { Icon: ActivityIcon, label: "Kurzanalyse" },
  { Icon: FlameIcon, label: "Deep Dive" },
  { Icon: DownloadIcon, label: "Export" },
];

const COMPETITOR_FLOW: FlowStep[] = [
  { Icon: SearchIcon, label: "Markt-Scan" },
  { Icon: CompetitorsIcon, label: "Profile" },
  { Icon: ActivityIcon, label: "Kurzprofil" },
  { Icon: BuildingIcon, label: "Kunden-Match" },
];

// ─── Page ────────────────────────────────────────────────────────────────────

export default function GuidePage() {
  return (
    <div className="max-w-2xl">
      <h1 className="text-display mb-2">Kurzanleitung.</h1>
      <p className="text-body mb-10" style={{ color: "rgba(10,10,10,0.45)" }}>
        Referenz für den Vertriebsalltag. Kein technisches Vorwissen nötig.
      </p>

      {/* ── Messe analysieren ── */}
      <section>
        <EyebrowLabel>MESSE ANALYSIEREN</EyebrowLabel>

        <div className="mb-3">
          <ProcessFlow steps={MESSE_FLOW} />
        </div>
        <p
          className="text-meta mb-8"
          style={{ color: "rgba(10,10,10,0.35)" }}
        >
          gestrichelter Rahmen = läuft automatisch im Hintergrund
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <StepCard
            num={1}
            title="Messe anlegen"
            bullets={[
              <>
                Zu{" "}
                <Link
                  href="/shows"
                  className="underline underline-offset-2 decoration-[var(--color-near-black)]/25 hover:decoration-[var(--color-near-black)] transition-colors"
                >
                  Messen
                </Link>{" "}
                gehen, auf "Neue Messe" klicken
              </>,
              "URL der Ausstellerseite einfügen",
              "Das Tool ermittelt die beste Lade-Strategie und holt alle Aussteller",
              "Dauer: 2 bis 30 Minuten je nach Messegröße",
            ]}
          />
          <StepCard
            num={2}
            title="Vorbereitung (automatisch)"
            bullets={[
              "Aussteller ohne Website: URL-Suche via Web-Search",
              "Aussteller mit Messe-Detailseite: Profil-Extraktion via Firecrawl",
              "Läuft automatisch nach dem Laden, kein Eingriff nötig",
            ]}
          />
          <StepCard
            num={3}
            title="Kurzanalyse"
            bullets={[
              'Assistenten schreiben: "Starte die Kurzanalyse"',
              "Tool besucht jede Website und bewertet den ISP-Fit",
              "Ergebnis: hoch / mittel / niedrig, 0.01 bis 0.04 Euro pro Aussteller",
            ]}
          />
          <StepCard
            num={4}
            title="Deep Dive"
            bullets={[
              "Nur für Aussteller mit hoher Priorität sinnvoll",
              "Liefert: Entscheidungsträger, Schmerzpunkte, Einstiegsfragen",
              "Start per Klick auf den Aussteller oder Assistenten-Eingabe",
            ]}
          />
          <StepCard
            num={5}
            title="Export"
            bullets={[
              "Excel-Datei, farbcodiert nach Priorität",
              "Download-Button auf der Messen-Detailseite",
              "Direkt in CRM oder per Mail nutzbar",
            ]}
          />
        </div>
      </section>

      <Divider />

      {/* ── Weitere Bereiche ── */}
      <section>
        <EyebrowLabel>WEITERE BEREICHE</EyebrowLabel>

        <div className="space-y-10">
          <FeatureCard
            Icon={BuildingIcon}
            title="Unternehmen"
            href="/companies"
            bullets={[
              "Alle Aussteller aus allen Messen konsolidiert in einer Ansicht",
              "Firma X auf 3 Messen: einmal angezeigt, alle Messen sichtbar",
              "Firmen auch manuell hinzufügen und automatisch analysieren lassen",
              "Beste Priorität und Sektoren werden show-übergreifend zusammengeführt",
            ]}
          />

          <FeatureCard
            Icon={SearchIcon}
            title="Messen entdecken"
            href="/shows/search"
            bullets={[
              'Freitext-Suche, z.B. "UAV-Messen Europa 2026 mit Ausstellerliste"',
              "Assistent recherchiert und schlägt passende Veranstaltungen vor",
              "Jede URL wird automatisch auf eine zugängliche Ausstellerliste geprüft",
              "Messe direkt in die eigene Liste übernehmen per Klick",
            ]}
          />

          <FeatureCard
            Icon={CompetitorsIcon}
            title="Konkurrenten"
            href="/competitors"
            bullets={[
              "Automatischer Markt-Scan: Claude + Web-Search findet ISP-Wettbewerber",
              "Kurzprofil pro Konkurrent: Positionierung, Portfolio, Bedrohungslevel",
              "Zeigt, bei welchen bekannten Firmen Konkurrenten präsent sind",
              "Status-Verwaltung: aktiv / vorgeschlagen / abgelehnt / archiviert",
              "Eigener Chat-Assistent auf der Konkurrenten-Seite für Analyse-Fragen",
            ]}
          >
            <div className="mb-4">
              <ProcessFlow steps={COMPETITOR_FLOW} compact />
            </div>
          </FeatureCard>

          <FeatureCard
            Icon={CostIcon}
            title="Kosten"
            href="/costs"
            bullets={[
              "Globale Übersicht aller API-Kosten: Claude, Firecrawl, Web-Search, Browserbase",
              "Aufschlüsselung nach Kategorie: Kurzanalyse, Deep Dive, Chat, Konkurrenten, Messen-Suche",
              "Firecrawl-Credits werden seit V5 pro Scrape-Call separat erfasst",
              "Kosten-Tab auch direkt auf jeder Messen-Detailseite",
            ]}
          />
        </div>
      </section>

      <Divider />

      {/* ── Der Assistent ── */}
      <section>
        <EyebrowLabel>DER ASSISTENT</EyebrowLabel>

        <div className="flex items-start gap-3 mb-5">
          <ChatIcon size={14} className="shrink-0 opacity-50 mt-0.5" />
          <p className="text-body" style={{ color: "rgba(10,10,10,0.60)" }}>
            Chat-Fenster rechts, verfügbar auf Messen-Seiten, der
            Konkurrenten-Seite und der Messen-Suche. Eingabe auf Deutsch, keine
            Vorkenntnisse nötig.
          </p>
        </div>

        <div
          className="border border-[var(--border-color-soft)] p-4 mb-4"
          style={{ background: "var(--color-cream-sunken)" }}
        >
          <p
            className="text-meta-strong mb-3"
            style={{ color: "rgba(10,10,10,0.30)", letterSpacing: "0.07em" }}
          >
            BEISPIELEINGABEN — MESSEN
          </p>
          <ul className="space-y-2.5 mb-5">
            {[
              "Starte die Kurzanalyse für alle Aussteller.",
              "Zeig mir alle Aussteller mit hoher Priorität.",
              "Mach einen Deep Dive für Müller Elektronik GmbH.",
              "Welche Aussteller haben einen Drohnenbezug?",
              "Lösch alle Aussteller ohne Website.",
              "Füge TechCorp GmbH manuell hinzu.",
            ].map((cmd) => (
              <li key={cmd} className="flex items-center gap-2.5">
                <span
                  className="shrink-0 inline-block"
                  style={{
                    width: 4,
                    height: 4,
                    background: "var(--color-near-black)",
                    opacity: 0.2,
                    flexShrink: 0,
                  }}
                />
                <span
                  className="text-body-sm"
                  style={{
                    fontFamily: "monospace",
                    color: "rgba(10,10,10,0.65)",
                  }}
                >
                  {cmd}
                </span>
              </li>
            ))}
          </ul>
          <p
            className="text-meta-strong mb-3"
            style={{ color: "rgba(10,10,10,0.30)", letterSpacing: "0.07em" }}
          >
            BEISPIELEINGABEN — KONKURRENTEN
          </p>
          <ul className="space-y-2.5">
            {[
              "Starte einen neuen Markt-Scan.",
              "Erstelle Kurzprofile für alle vorgeschlagenen Konkurrenten.",
              "Wie positioniert sich EnerTec im Vergleich zu ISP?",
              "Markiere BattCo als aktiv.",
            ].map((cmd) => (
              <li key={cmd} className="flex items-center gap-2.5">
                <span
                  className="shrink-0 inline-block"
                  style={{
                    width: 4,
                    height: 4,
                    background: "var(--color-near-black)",
                    opacity: 0.2,
                    flexShrink: 0,
                  }}
                />
                <span
                  className="text-body-sm"
                  style={{
                    fontFamily: "monospace",
                    color: "rgba(10,10,10,0.65)",
                  }}
                >
                  {cmd}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-body" style={{ color: "rgba(10,10,10,0.45)" }}>
          Aktionen, die Daten löschen oder verändern, brauchen eine explizite
          Bestätigung im Chat-Fenster per Button.
        </p>
      </section>

      <Divider />

      {/* ── Einstellungen ── */}
      <section>
        <EyebrowLabel>EINSTELLUNGEN</EyebrowLabel>

        <div className="flex items-start gap-3 mb-5">
          <SettingsIcon size={14} className="shrink-0 opacity-50 mt-0.5" />
          <p className="text-body" style={{ color: "rgba(10,10,10,0.60)" }}>
            Konto-Einstellungen öffnen: unten links im Sidebar auf den
            Account-Bereich klicken.
          </p>
        </div>

        <HintBox>
          Der wichtigste Schrauber: <strong>Prioritäts-Kontext</strong> unter dem
          Tab "Kontext". Hier steht, wonach ISP gerade sucht. Beeinflusst direkt
          die Bewertung in jeder Kurzanalyse.
        </HintBox>

        <ul className="space-y-2">
          <Bullet>
            <strong>Kontext:</strong> Prioritäts-Kontext editieren, z.B. "Fokus
            auf Defense, Mindestgröße 50 MA, EMEA"
          </Bullet>
          <Bullet>
            <strong>Modelle:</strong> Kurzanalyse- und Deep-Dive-Modell wählen
            (schneller vs. tiefer)
          </Bullet>
          <Bullet>
            <strong>Anleitung:</strong> internes Handbook, das dem Assistenten
            als Hintergrundinformation mitgegeben wird
          </Bullet>
          <Bullet>
            <strong>Short / Deep / Chat:</strong> System-Prompts und
            Vorlagen anpassen, falls das Analyse-Format geändert werden soll
          </Bullet>
        </ul>
      </section>

      <Divider />

      {/* ── Kosten ── */}
      <section className="mb-12">
        <EyebrowLabel>KOSTEN-ORIENTIERUNG</EyebrowLabel>
        <p className="text-body mb-4" style={{ color: "rgba(10,10,10,0.55)" }}>
          Alle Kosten auf einen Blick unter{" "}
          <Link
            href="/costs"
            className="underline underline-offset-2 decoration-[var(--color-near-black)]/25 hover:decoration-[var(--color-near-black)] transition-colors"
          >
            Kosten
          </Link>
          , oder pro Messe im Kosten-Tab der jeweiligen Messen-Seite.
        </p>
        <ul className="space-y-2">
          <Bullet>
            Kurzanalyse 200 Aussteller: etwa 2 bis 4 Euro (Claude + Firecrawl)
          </Bullet>
          <Bullet>
            Deep Dive pro Aussteller: 0.10 bis 0.40 Euro je nach
            Website-Länge
          </Bullet>
          <Bullet>
            Konkurrenten-Markt-Scan: 0.50 bis 1.50 Euro (Web-Search-abhängig)
          </Bullet>
          <Bullet>
            Messen-Suche: 0.30 bis 0.80 Euro pro Suchlauf inkl.
            Firecrawl-Validierung
          </Bullet>
          <Bullet>
            Firecrawl-Credits werden separat ausgewiesen (1 Credit = einfacher
            Scrape, 5 Credits = strukturierte Extraktion)
          </Bullet>
        </ul>
      </section>
    </div>
  );
}
