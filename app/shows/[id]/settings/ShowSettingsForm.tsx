"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { loading } from "@/components/LoadingBar";
import { parseErrorJson } from "@/lib/fetch-json";
import { Hairline } from "@/components/brand/Hairline";
import type { CrawlPlan } from "@/lib/crawl-plan";
import { CrawlPlanOverride } from "../CrawlPlanOverride";

type Initial = {
  name: string;
  source_url: string;
  year: number | null;
  chat_context: string;
  expected_exhibitor_count: number | null;
  crawl_plan: CrawlPlan | null;
  crawl_plan_raw: Record<string, unknown> | null;
};

export function ShowSettingsForm({
  showId,
  initial,
}: {
  showId: string;
  initial: Initial;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Stammdaten
  const [name, setName] = useState(initial.name);
  const [sourceUrl, setSourceUrl] = useState(initial.source_url);
  const [year, setYear] = useState<string>(
    initial.year !== null ? String(initial.year) : "",
  );

  // Chat-Kontext
  const [chatContext, setChatContext] = useState(initial.chat_context);

  // Crawl-Plan editable fields (only some strategies have these)
  const initialPlan = initial.crawl_plan;
  const [maxShowMore, setMaxShowMore] = useState<string>(
    initialPlan?.strategy === "letter_loop"
      ? String(initialPlan.max_show_more_per_letter ?? 25)
      : initialPlan?.strategy === "show_more"
      ? String(initialPlan.max_clicks ?? 10)
      : "",
  );
  const [maxPages, setMaxPages] = useState<string>(
    initialPlan?.strategy === "pagination" ? String(initialPlan.max_pages) : "",
  );

  // ui state
  const [busy, setBusy] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(section: string, body: Record<string, unknown>) {
    setBusy(section);
    setError(null);
    try {
      const res = await fetch(`/api/trade-shows/${showId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        setError(j.error ?? "Speichern fehlgeschlagen");
        return null;
      }
      setSavedSection(section);
      const data = await res.json();
      startTransition(() => router.refresh());
      return data;
    } finally {
      setBusy(null);
    }
  }

  async function saveStammdaten() {
    await patch("stammdaten", {
      name,
      source_url: sourceUrl.trim() ? sourceUrl.trim() : null,
      year: year ? Number(year) : null,
    });
  }

  async function saveChatContext() {
    await patch("chat-kontext", { chat_context: chatContext });
  }

  async function saveCrawlPlan() {
    if (!initialPlan) return;
    let nextPlan: CrawlPlan;
    if (initialPlan.strategy === "letter_loop") {
      nextPlan = {
        ...initialPlan,
        max_show_more_per_letter: clampInt(maxShowMore, 0, 50, 25),
      };
    } else if (initialPlan.strategy === "show_more") {
      nextPlan = { ...initialPlan, max_clicks: clampInt(maxShowMore, 1, 30, 10) };
    } else if (initialPlan.strategy === "pagination") {
      nextPlan = { ...initialPlan, max_pages: clampInt(maxPages, 1, 100, 10) };
    } else {
      return;
    }
    await patch("crawl-plan", { crawl_plan: nextPlan });
  }

  async function deleteShow() {
    const ok = window.confirm(
      `Messe "${initial.name}" komplett loeschen?\n\nAlle Aussteller, Short/Deep-Daten, Chat-Threads und Logs gehen verloren. Nicht ruekgaengig zu machen.`,
    );
    if (!ok) return;
    setBusy("delete");
    setError(null);
    loading.start();
    const res = await fetch(`/api/trade-shows/${showId}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      const j = await parseErrorJson(res);
      setError(j.error ?? "Loeschen fehlgeschlagen");
      loading.stop();
      return;
    }
    // loading.stop() is handled by NavigationLoadingTrigger on pathname commit.
    router.push("/");
    router.refresh();
  }

  const stammdatenChanged =
    name !== initial.name ||
    (sourceUrl.trim() ? sourceUrl.trim() : "") !== (initial.source_url ?? "") ||
    (year ? Number(year) : null) !== initial.year;

  const chatContextChanged = chatContext !== initial.chat_context;

  return (
    <div className="py-8 space-y-12">
      {/* ---------- Stammdaten ---------- */}
      <Section label="stammdaten" savedHere={savedSection === "stammdaten"}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6">
            <FieldLabel>messe-name</FieldLabel>
            <TextInput value={name} onChange={setName} placeholder="AUSA Annual Meeting" />
          </div>
          <div className="md:col-span-4">
            <FieldLabel>url aussteller-liste</FieldLabel>
            <TextInput
              type="url"
              value={sourceUrl}
              onChange={setSourceUrl}
              placeholder="https://..."
            />
          </div>
          <div className="md:col-span-2">
            <FieldLabel>jahr</FieldLabel>
            <TextInput
              type="number"
              value={year}
              onChange={setYear}
              placeholder="2026"
              tabular
            />
          </div>
        </div>
        <ActionRow>
          <PrimaryButton
            onClick={saveStammdaten}
            disabled={busy === "stammdaten" || !stammdatenChanged || !name.trim()}
          >
            {busy === "stammdaten" ? "speichere" : "speichern"}
          </PrimaryButton>
          <SavedHint visible={savedSection === "stammdaten"} />
        </ActionRow>
      </Section>

      <Hairline />

      {/* ---------- Chat-Kontext ---------- */}
      <Section label="chat-kontext" savedHere={savedSection === "chat-kontext"}>
        <p className="mb-3 text-body-sm text-[var(--color-near-black)]/65 max-w-2xl">
          Wird zusaetzlich zum globalen Prio-Kontext bei jedem Chat dieser Messe als
          System-Block mitgeschickt. Nutze das fuer messe-spezifische Hinweise:
          Schwerpunkt der Messe, deine Ziele am Stand, besondere Kontakte oder
          Constraints.
        </p>
        <textarea
          value={chatContext}
          onChange={(e) => setChatContext(e.target.value)}
          rows={10}
          placeholder="z.b.: leitmesse fuer defense-uavs in europa. fokus dieses jahr: kontakte zu integratoren mit aktuellen battery-rfqs. wir haben donnerstag 14h einen termin mit firma X."
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md p-4 text-body focus:outline-none focus:border-[var(--color-near-black)]"
          spellCheck={false}
        />
        <ActionRow>
          <PrimaryButton
            onClick={saveChatContext}
            disabled={busy === "chat-kontext" || !chatContextChanged}
          >
            {busy === "chat-kontext" ? "speichere" : "speichern"}
          </PrimaryButton>
          <SavedHint visible={savedSection === "chat-kontext"} />
          {chatContext.length > 0 && (
            <span className="text-meta">{chatContext.length} zeichen</span>
          )}
        </ActionRow>
      </Section>

      <Hairline />

      {/* ---------- Crawl-Plan ---------- */}
      <Section label="crawl-plan" savedHere={savedSection === "crawl-plan"}>
        {!initialPlan ? (
          <p className="text-body-sm text-[var(--color-near-black)]/65">
            noch kein crawl-plan vorhanden. wird beim ersten discovery-lauf erzeugt.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-body-sm">
              <Row k="strategie" v={initialPlan.strategy} />
              <Row k="basis-url" v={initialPlan.base_url} />
              {initialPlan.strategy === "letter_loop" && (
                <>
                  <Row k="url-template" v={initialPlan.url_template} mono />
                  <Row k="buchstaben" v={`${initialPlan.letters.length} (${initialPlan.letters.slice(0, 6).join(", ")}${initialPlan.letters.length > 6 ? ", ..." : ""})`} />
                </>
              )}
              {initialPlan.strategy === "show_more" && (
                <Row k="show-more-selector" v={initialPlan.show_more_selector} mono />
              )}
              {initialPlan.strategy === "pagination" && (
                <Row k="page-template" v={initialPlan.page_url_template} mono />
              )}
            </div>

            {(initialPlan.strategy === "letter_loop" ||
              initialPlan.strategy === "show_more") && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div>
                  <FieldLabel>
                    {initialPlan.strategy === "letter_loop"
                      ? "max. show-more klicks pro buchstabe"
                      : "max. show-more klicks"}
                  </FieldLabel>
                  <TextInput
                    type="number"
                    value={maxShowMore}
                    onChange={setMaxShowMore}
                    tabular
                  />
                  <p className="mt-2 text-meta">
                    {initialPlan.strategy === "letter_loop"
                      ? "0–50, default 25. greift erst bei naechstem restart."
                      : "1–30, default 10. greift erst bei naechstem restart."}
                  </p>
                </div>
              </div>
            )}

            {initialPlan.strategy === "pagination" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                <div>
                  <FieldLabel>max. seiten</FieldLabel>
                  <TextInput
                    type="number"
                    value={maxPages}
                    onChange={setMaxPages}
                    tabular
                  />
                  <p className="mt-2 text-meta">
                    1–100. greift erst bei naechstem restart.
                  </p>
                </div>
              </div>
            )}

            {initialPlan.strategy !== "single_page" && (
              <ActionRow>
                <PrimaryButton onClick={saveCrawlPlan} disabled={busy === "crawl-plan"}>
                  {busy === "crawl-plan" ? "speichere" : "speichern"}
                </PrimaryButton>
                <SavedHint visible={savedSection === "crawl-plan"} />
              </ActionRow>
            )}
          </div>
        )}
      </Section>

      <Hairline />

      {/* ---------- Erweiterte Crawl-Einstellungen ---------- */}
      <Section label="erweiterte crawl einstellungen">
        {!initial.crawl_plan_raw ? (
          <p className="text-body-sm text-[var(--color-near-black)]/65">
            verfuegbar sobald ein crawl-plan existiert.
          </p>
        ) : (
          <details className="group">
            <summary className="cursor-pointer text-body-sm text-[var(--color-near-black)]/65 hover:text-[var(--color-near-black)] mb-4 list-none flex items-center gap-2 select-none">
              <span className="text-meta text-[var(--color-near-black)]/55 group-open:rotate-90 transition-transform inline-block w-3">
                ›
              </span>
              <span>
                strategy / engine ueberschreiben, plan neu von claude entscheiden lassen, json bearbeiten
              </span>
            </summary>
            <div className="pt-2">
              <CrawlPlanOverride showId={showId} plan={initial.crawl_plan_raw} />
            </div>
          </details>
        )}
      </Section>

      <Hairline />

      {/* ---------- Danger Zone ---------- */}
      <Section label="danger zone">
        <p className="mb-4 text-body-sm text-[var(--color-near-black)]/65 max-w-2xl">
          Loescht die Messe komplett inklusive aller Aussteller, Short/Deep-Daten,
          Chat-Threads und Logs. Nicht ruekgaengig zu machen.
        </p>
        <button
          onClick={deleteShow}
          disabled={busy === "delete"}
          className="inline-flex items-center gap-2 text-ui-sm px-3 py-1.5 border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] hover:scale-[1.05] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          {busy === "delete" ? "loesche" : "messe loeschen"}
        </button>
      </Section>

      {error && (
        <p className="text-body-sm text-[var(--color-near-black)]/70" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------- bits ----------

function Section({
  label,
  children,
  savedHere = false,
}: {
  label: string;
  children: React.ReactNode;
  savedHere?: boolean;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-meta-strong">{label}</span>
        {savedHere && <GoldDot size={5} />}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-meta mb-2">{children}</label>;
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  tabular = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "url" | "number";
  tabular?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)] ${
        tabular ? "tabular-nums" : ""
      }`}
    />
  );
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex items-center gap-3 flex-wrap">{children}</div>;
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 text-ui-sm px-3 py-1.5 border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] font-semibold hover:text-[var(--color-gold)] hover:scale-[1.05] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
    >
      <span>{children}</span>
      <GoldDot size={6} />
    </button>
  );
}

function SavedHint({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <span className="text-meta">gespeichert</span>;
}

function Row({ k, v, mono = false }: { k: string; v: string | null; mono?: boolean }) {
  return (
    <div className="py-1 border-b border-[var(--color-hairline-light)] last:border-b-0">
      <div className="text-meta">{k}</div>
      <div
        className={`text-body-sm break-all ${mono ? "font-mono text-[12px]" : ""}`}
      >
        {v ?? "—"}
      </div>
    </div>
  );
}

function clampInt(s: string, min: number, max: number, fallback: number): number {
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
