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
} from "@/components/brand/Icons";

export const metadata: Metadata = {
  title: "Kurzanleitung | ISP Sales Intelligence",
};

// ─── Primitive components ────────────────────────────────────────────────────

type FlowStep = {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
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
              className={`${box} flex items-center justify-center`}
              style={{
                border: "1px solid var(--border-color)",
                background: "var(--color-cream-sunken)",
              }}
            >
              <step.Icon size={iconSize} />
            </div>
            <p
              className="text-meta text-center leading-tight px-0.5"
              style={{ color: "rgba(10,10,10,0.45)" }}
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

// ─── Flow definitions ────────────────────────────────────────────────────────

const MESSE_FLOW: FlowStep[] = [
  { Icon: ExternalLinkIcon, label: "URL eingeben" },
  { Icon: BriefcaseIcon, label: "Aussteller laden" },
  { Icon: ActivityIcon, label: "Kurzanalyse" },
  { Icon: FlameIcon, label: "Deep Dive" },
  { Icon: DownloadIcon, label: "Export" },
];

const COMPETITOR_FLOW: FlowStep[] = [
  { Icon: SearchIcon, label: "Markt-Scan" },
  { Icon: CompetitorsIcon, label: "Profile" },
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

        <div className="mb-8">
          <ProcessFlow steps={MESSE_FLOW} />
        </div>

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
              "Dauer: 2 bis 30 Minuten je nach Messegröße",
            ]}
          />
          <StepCard
            num={2}
            title="Kurzanalyse"
            bullets={[
              'Assistenten schreiben: "Starte die Kurzanalyse"',
              "Tool besucht jede Website und bewertet den ISP-Fit",
              "Ergebnis: hoch / mittel / niedrig",
            ]}
          />
          <StepCard
            num={3}
            title="Deep Dive"
            bullets={[
              "Nur für Aussteller mit hoher Priorität sinnvoll",
              "Liefert: Entscheidungsträger, Schmerzpunkte, Einstiegsfragen",
              "Start per Klick auf den Aussteller oder Assistenten-Eingabe",
            ]}
          />
          <StepCard
            num={4}
            title="Export"
            bullets={[
              "Excel-Datei, farbcodiert nach Priorität",
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
              "Alle Aussteller aus allen Messen konsolidiert",
              "Firma X auf 3 Messen: einmal angezeigt, alle Messen sichtbar",
              "Firmen auch manuell hinzufügen und analysieren lassen",
            ]}
          />

          <FeatureCard
            Icon={BriefcaseIcon}
            title="Messen entdecken"
            href="/shows"
            bullets={[
              'Freitext-Suche, z.B. "UAV-Messen Europa 2025"',
              "Tool schlägt Veranstaltungen vor und prüft die Ausstellerliste",
              "Messe direkt in die eigene Liste übernehmen",
            ]}
          />

          <FeatureCard
            Icon={CompetitorsIcon}
            title="Konkurrenten"
            href="/competitors"
            bullets={[
              "Erkennt automatisch, welche Wettbewerber im ISP-Marktumfeld aktiv sind",
              "Zeigt, bei welchen Ihrer Kontakte Konkurrenten präsent sind",
              "Status: aktiv / inaktiv / abgelehnt, manuell verwaltbar",
            ]}
          >
            <div className="mb-4">
              <ProcessFlow steps={COMPETITOR_FLOW} compact />
            </div>
          </FeatureCard>
        </div>
      </section>

      <Divider />

      {/* ── Der Assistent ── */}
      <section>
        <EyebrowLabel>DER ASSISTENT</EyebrowLabel>

        <div className="flex items-start gap-3 mb-5">
          <ChatIcon size={14} className="shrink-0 opacity-50 mt-0.5" />
          <p className="text-body" style={{ color: "rgba(10,10,10,0.60)" }}>
            Chat-Fenster rechts auf jeder Messen-Seite. Eingabe auf Deutsch,
            keine Vorkenntnisse nötig.
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
            BEISPIELEINGABEN
          </p>
          <ul className="space-y-2.5">
            {[
              "Starte die Kurzanalyse für alle Aussteller.",
              "Zeig mir alle Aussteller mit hoher Priorität.",
              "Mach einen Deep Dive für Müller Elektronik GmbH.",
              "Welche Aussteller haben einen Drohnenbezug?",
              "Lösch alle Aussteller ohne Website.",
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
          Bestätigung im Chat.
        </p>
      </section>

      <Divider />

      {/* ── Kosten ── */}
      <section className="mb-12">
        <EyebrowLabel>KOSTEN</EyebrowLabel>
        <p className="text-body mb-4" style={{ color: "rgba(10,10,10,0.55)" }}>
          Kosten-Tab auf jeder Messen-Seite.
        </p>
        <ul className="space-y-2">
          <Bullet>Aufschlüsselung nach Kurzanalyse, Deep Dive und Chat</Bullet>
          <Bullet>
            Orientierung: Kurzanalyse für 200 Aussteller liegt bei etwa 2 bis 4
            Euro
          </Bullet>
        </ul>
      </section>
    </div>
  );
}
