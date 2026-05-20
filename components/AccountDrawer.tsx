"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { GoldDot } from "@/components/brand/GoldDot";
import { Hairline } from "@/components/brand/Hairline";
import { CloseIcon, LogoutIcon } from "@/components/brand/Icons";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import {
  PARAM_DEFAULTS,
  PARAM_BOUNDS,
  defaultHandbook,
  defaultShortSystemPrompt,
  defaultShortUserTemplate,
  defaultDeepSystemPrompt,
  defaultDeepUserTemplate,
  defaultChatSystemPrompt,
  type AppSettings,
} from "@/lib/settings";
import { SHOW_DISCOVERY_SYSTEM_DEFAULT, COMPETITOR_DISCOVERY_SYSTEM_DEFAULT, COMPETITOR_DISCOVERY_MODEL_DEFAULT } from "@/lib/claude";
import { COMPANY_SEARCH_SYSTEM_DEFAULT, COMPANY_SEARCH_MODEL } from "@/lib/claude-company-search";
import type { UserProfile } from "@/lib/profile";
import type { AccountDrawerTab } from "./OpenSettingsButton";

const SHORT_MODEL_OPTIONS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6"];
const DEEP_MODEL_OPTIONS = ["claude-sonnet-4-6", "claude-opus-4-7"];
const COMPETITOR_MODEL_OPTIONS = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7"];
const COMPANY_SEARCH_MODEL_OPTIONS = ["claude-sonnet-4-6", "claude-opus-4-7"];

const SHARED_PLACEHOLDERS = ["{{company_name}}", "{{profile_block}}", "{{scraped_content}}"];
const DEEP_PLACEHOLDERS = [...SHARED_PLACEHOLDERS, "{{short_intel}}"];

type Tab = AccountDrawerTab;

type ParamFieldKey = keyof typeof PARAM_DEFAULTS;

export function AccountDrawer({
  open,
  onClose,
  profile,
  settings,
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  settings: AppSettings;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "profile");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open && initialTab) setTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <button
        aria-label="schliessen"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--color-near-black)]/30"
      />
      <section
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-[860px] max-h-[88vh] bg-[var(--color-cream)] border border-[var(--border-color)] rounded-xl flex flex-col shadow-[0_8px_40px_rgba(10,10,10,0.18)]"
      >
        <header className="flex items-center justify-between px-8 pt-8 pb-4">
          <div className="text-subtitle">Konto</div>
          <button
            onClick={onClose}
            aria-label="schliessen"
            title="schliessen"
            className="w-8 h-8 inline-flex items-center justify-center text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <nav className="flex gap-1 px-8 pb-4 border-b border-[var(--border-color-soft)] flex-wrap">
          <DrawerTab active={tab === "profile"} onClick={() => setTab("profile")}>
            profil
          </DrawerTab>
          <DrawerTab active={tab === "context"} onClick={() => setTab("context")}>
            prio-kontext
          </DrawerTab>
          <DrawerTab active={tab === "anleitung"} onClick={() => setTab("anleitung")}>
            anleitung
          </DrawerTab>
          <DrawerTab active={tab === "short"} onClick={() => setTab("short")}>
            short
          </DrawerTab>
          <DrawerTab active={tab === "deep"} onClick={() => setTab("deep")}>
            deep
          </DrawerTab>
          <DrawerTab active={tab === "chat"} onClick={() => setTab("chat")}>
            chat
          </DrawerTab>
          <DrawerTab active={tab === "models"} onClick={() => setTab("models")}>
            modelle
          </DrawerTab>
          <DrawerTab active={tab === "messen"} onClick={() => setTab("messen")}>
            messen suchen
          </DrawerTab>
          <DrawerTab active={tab === "konkurrenten"} onClick={() => setTab("konkurrenten")}>
            konkurrenten
          </DrawerTab>
          <DrawerTab active={tab === "unternehmen"} onClick={() => setTab("unternehmen")}>
            unternehmen suchen
          </DrawerTab>
        </nav>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {tab === "profile" && <ProfileTab profile={profile} />}
          {tab === "context" && <ContextTab settings={settings} />}
          {tab === "anleitung" && <HandbookTab settings={settings} />}
          {tab === "short" && <PromptTab tier="short" settings={settings} />}
          {tab === "deep" && <PromptTab tier="deep" settings={settings} />}
          {tab === "chat" && <ChatTab settings={settings} />}
          {tab === "models" && <ModelsTab settings={settings} />}
          {tab === "messen" && <ShowDiscoveryTab settings={settings} />}
          {tab === "konkurrenten" && <CompetitorDiscoveryTab settings={settings} />}
          {tab === "unternehmen" && <CompanySearchTab settings={settings} />}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function DrawerTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-ui-sm px-2.5 py-1 border rounded-sm transition-colors ${
        active
          ? "border-[var(--color-near-black)] bg-[var(--color-near-black)]/[0.06] text-[var(--color-near-black)] font-semibold"
          : "border-transparent text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)]"
      }`}
    >
      {children}
    </button>
  );
}

function ProfileTab({ profile }: { profile: UserProfile }) {
  const router = useRouter();
  const [name, setName] = useState(profile.display_name);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: name }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Speichern fehlgeschlagen");
      return;
    }
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <label className="block text-meta mb-2">name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        />
      </div>

      <div>
        <label className="block text-meta mb-2">email</label>
        <div className="text-body py-2 border-b border-[var(--border-color-soft)] text-[var(--color-near-black)]/65">
          {profile.email}
        </div>
        <p className="mt-2 text-meta">aenderung der email-adresse aktuell nur ueber supabase-auth.</p>
      </div>

      <Hairline />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || name.trim() === profile.display_name}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>

      <Hairline />

      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className="inline-flex items-center gap-2 text-ui-sm text-[var(--color-near-black)]/55 hover:text-[var(--color-near-black)] transition-colors"
        >
          <LogoutIcon size={14} />
          abmelden
        </button>
      </form>
    </div>
  );
}

function ContextTab({ settings }: { settings: AppSettings }) {
  const [prioContext, setPrioContext] = useState(settings.prio_context);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Speichern fehlgeschlagen");
      return null;
    }
    const data = (await res.json()) as AppSettings;
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return data;
  }

  async function handleSave() {
    await save({ prio_context: prioContext });
  }

  async function handleReset() {
    if (!confirm("Prio-Kontext auf Default aus dem Brand-Doc zuruecksetzen?")) return;
    const fresh = await save({ reset_field: "prio_context" });
    if (fresh) setPrioContext(fresh.prio_context);
  }

  return (
    <div className="space-y-5">
      <p className="text-meta">
        Steuert wie Aussteller bewertet werden. Wird als System-Block bei Short, Deep und Chat mitgeschickt.
      </p>
      <MarkdownEditor
        value={prioContext}
        onChange={setPrioContext}
        rows={20}
        ariaLabel="Prio-Kontext"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || prioContext === settings.prio_context}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        <button
          onClick={handleReset}
          disabled={busy}
          className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] rounded-md text-[var(--color-near-black)]/60 hover:text-[var(--color-blue)] hover:border-[var(--color-blue)]/50 transition-colors"
        >
          default wiederherstellen
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}

function HandbookTab({ settings }: { settings: AppSettings }) {
  // Wenn nichts gespeichert ist, zeigen wir den Code-Default im Editor an, damit
  // der User sofort sehen kann was die Chats wissen wuerden. Beim Speichern
  // landet der Text in der DB; "Default wiederherstellen" schreibt den
  // aktuellen Code-Default rein (ueberschreibt User-Edits).
  const [handbook, setHandbook] = useState<string>(
    settings.handbook ?? defaultHandbook(),
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPersisted = settings.handbook !== null;
  const dirty = isPersisted
    ? handbook !== settings.handbook
    : handbook !== defaultHandbook();

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Speichern fehlgeschlagen");
      return null;
    }
    const data = (await res.json()) as AppSettings;
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return data;
  }

  async function handleSave() {
    const trimmed = handbook.trim();
    const fresh = await save({ handbook: trimmed.length === 0 ? null : trimmed });
    if (fresh) setHandbook(fresh.handbook ?? defaultHandbook());
  }

  async function handleReset() {
    if (!confirm("Anleitung auf den Code-Default zuruecksetzen? Aktuelle Aenderungen gehen verloren.")) return;
    const fresh = await save({ reset_field: "handbook" });
    if (fresh) setHandbook(fresh.handbook ?? defaultHandbook());
  }

  return (
    <div className="space-y-5">
      <p className="text-meta">
        Bedienungs-Anleitung fuer das Tool. Die Chat-Assistenten laden diesen
        Text per `read_handbook`-Tool nur auf Bedarf (z.B. wenn du fragst &quot;wie
        funktioniert X?&quot;), nicht in jeder Anfrage. Du kannst eigene Workflows
        und Notizen ergaenzen.
      </p>
      <MarkdownEditor
        value={handbook}
        onChange={setHandbook}
        rows={24}
        ariaLabel="Anleitung"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        <button
          onClick={handleReset}
          disabled={busy}
          className="text-ui-sm px-3 py-1 border border-[var(--border-color-soft)] rounded-md text-[var(--color-near-black)]/60 hover:text-[var(--color-blue)] hover:border-[var(--color-blue)]/50 transition-colors"
        >
          default wiederherstellen
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {!isPersisted && !savedAt && (
          <span className="text-meta">
            zeigt aktuell den Code-Default (noch nichts gespeichert).
          </span>
        )}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}

type Tier = "short" | "deep";

const TIER_INFO: Record<Tier, {
  title: string;
  intro: string;
  systemField: keyof Pick<AppSettings, "short_system_prompt" | "deep_system_prompt">;
  templateField: keyof Pick<AppSettings, "short_user_template" | "deep_user_template">;
  maxTokensField: ParamFieldKey;
  maxInputCharsField: ParamFieldKey;
  placeholders: string[];
  systemDefault: () => string;
  templateDefault: () => string;
}> = {
  short: {
    title: "Short-Overview",
    intro: "Kurze Erst-Einschaetzung pro Aussteller (Haiku 4.5 default). System-Prompt definiert Rolle und Regeln, User-Template wie die Aussteller-Daten an Claude geliefert werden.",
    systemField: "short_system_prompt",
    templateField: "short_user_template",
    maxTokensField: "short_max_tokens",
    maxInputCharsField: "short_max_input_chars",
    placeholders: SHARED_PLACEHOLDERS,
    systemDefault: defaultShortSystemPrompt,
    templateDefault: defaultShortUserTemplate,
  },
  deep: {
    title: "Deep-Dive",
    intro: "Tiefen-Recherche pro Aussteller (Sonnet 4.6 default). Bekommt zusaetzlich die Short-Einschaetzung als Kontext.",
    systemField: "deep_system_prompt",
    templateField: "deep_user_template",
    maxTokensField: "deep_max_tokens",
    maxInputCharsField: "deep_max_input_chars",
    placeholders: DEEP_PLACEHOLDERS,
    systemDefault: defaultDeepSystemPrompt,
    templateDefault: defaultDeepUserTemplate,
  },
};

function NumberField({
  label,
  hint,
  value,
  onChange,
  defaultValue,
  min,
  max,
  onReset,
  busy,
}: {
  label: string;
  hint?: string;
  value: number | "";
  onChange: (v: number | "") => void;
  defaultValue: number;
  min: number;
  max: number;
  onReset: () => void;
  busy: boolean;
}) {
  const isDefault = value === "" || value === defaultValue;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-meta-strong">{label}</label>
        <button
          type="button"
          onClick={onReset}
          disabled={busy}
          className="text-meta hover:text-[var(--color-near-black)] transition-colors"
        >
          default ({defaultValue.toLocaleString("de-DE")})
        </button>
      </div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange("");
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(Math.trunc(n));
        }}
        className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body tabular-nums focus:outline-none focus:border-[var(--color-near-black)]"
      />
      <div className="mt-1 text-meta">
        bereich {min.toLocaleString("de-DE")}-{max.toLocaleString("de-DE")}
        {hint ? ` · ${hint}` : ""}
        {typeof value === "number" && !isDefault ? " · weicht vom default ab" : ""}
      </div>
    </div>
  );
}

function PromptTab({ tier, settings }: { tier: Tier; settings: AppSettings }) {
  const info = TIER_INFO[tier];
  const initialSystem = settings[info.systemField] ?? info.systemDefault();
  const initialTemplate = settings[info.templateField] ?? info.templateDefault();
  const initialMaxTokens = settings[info.maxTokensField] as number | null;
  const initialMaxInputChars = settings[info.maxInputCharsField] as number | null;

  const [systemPrompt, setSystemPrompt] = useState(initialSystem);
  const [userTemplate, setUserTemplate] = useState(initialTemplate);
  const [maxTokens, setMaxTokens] = useState<number | "">(initialMaxTokens ?? "");
  const [maxInputChars, setMaxInputChars] = useState<number | "">(
    initialMaxInputChars ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Speichern fehlgeschlagen");
      return null;
    }
    const data = (await res.json()) as AppSettings;
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return data;
  }

  async function handleSave() {
    const patch: Record<string, unknown> = {};
    if (systemPrompt !== initialSystem) patch[info.systemField] = systemPrompt || null;
    if (userTemplate !== initialTemplate) patch[info.templateField] = userTemplate || null;
    if (maxTokens !== (initialMaxTokens ?? "")) {
      patch[info.maxTokensField] = maxTokens === "" ? null : maxTokens;
    }
    if (maxInputChars !== (initialMaxInputChars ?? "")) {
      patch[info.maxInputCharsField] = maxInputChars === "" ? null : maxInputChars;
    }
    if (Object.keys(patch).length === 0) return;
    await save(patch);
  }

  async function resetSystem() {
    if (!confirm(`${info.title}: System-Prompt auf Code-Default zuruecksetzen?`)) return;
    const fresh = await save({ reset_field: info.systemField });
    if (fresh) setSystemPrompt(fresh[info.systemField] ?? info.systemDefault());
  }

  async function resetTemplate() {
    if (!confirm(`${info.title}: User-Template auf Code-Default zuruecksetzen?`)) return;
    const fresh = await save({ reset_field: info.templateField });
    if (fresh) setUserTemplate(fresh[info.templateField] ?? info.templateDefault());
  }

  async function resetMaxTokens() {
    const fresh = await save({ reset_field: info.maxTokensField });
    if (fresh) setMaxTokens("");
  }

  async function resetMaxInputChars() {
    const fresh = await save({ reset_field: info.maxInputCharsField });
    if (fresh) setMaxInputChars("");
  }

  const dirty =
    systemPrompt !== initialSystem ||
    userTemplate !== initialTemplate ||
    maxTokens !== (initialMaxTokens ?? "") ||
    maxInputChars !== (initialMaxInputChars ?? "");
  const systemEmpty = systemPrompt.trim().length === 0;
  const templateEmpty = userTemplate.trim().length === 0;

  const maxTokensBounds = PARAM_BOUNDS[info.maxTokensField];
  const maxInputCharsBounds = PARAM_BOUNDS[info.maxInputCharsField];

  return (
    <div className="space-y-7">
      <p className="text-meta">{info.intro}</p>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-meta-strong">system-prompt</div>
          <button
            type="button"
            onClick={resetSystem}
            disabled={busy}
            className="text-meta hover:text-[var(--color-near-black)] transition-colors"
          >
            default wiederherstellen
          </button>
        </div>
        {systemEmpty && (
          <p className="text-meta text-[var(--color-near-black)]/55">
            Leer. Es wird der Code-Default aus lib/claude.ts verwendet. Klick &quot;default wiederherstellen&quot; um den Default in den Editor zu laden.
          </p>
        )}
        <MarkdownEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          rows={14}
          ariaLabel={`${info.title} System-Prompt`}
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-meta-strong">user-template (was an claude geht)</div>
          <button
            type="button"
            onClick={resetTemplate}
            disabled={busy}
            className="text-meta hover:text-[var(--color-near-black)] transition-colors"
          >
            default wiederherstellen
          </button>
        </div>
        {templateEmpty && (
          <p className="text-meta text-[var(--color-near-black)]/55">
            Leer. Es wird der Code-Default verwendet. Platzhalter werden zur Laufzeit ersetzt.
          </p>
        )}
        <MarkdownEditor
          value={userTemplate}
          onChange={setUserTemplate}
          rows={14}
          ariaLabel={`${info.title} User-Template`}
          placeholders={info.placeholders}
        />
      </section>

      <section className="space-y-3">
        <div className="text-meta-strong">parameter</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <NumberField
            label="max_tokens"
            hint="Output-Limit pro Antwort"
            value={maxTokens}
            onChange={setMaxTokens}
            defaultValue={PARAM_DEFAULTS[info.maxTokensField]}
            min={maxTokensBounds.min}
            max={maxTokensBounds.max}
            onReset={resetMaxTokens}
            busy={busy}
          />
          <NumberField
            label="max_input_chars"
            hint="Scrape-Content wird auf so viele Zeichen gekuerzt"
            value={maxInputChars}
            onChange={setMaxInputChars}
            defaultValue={PARAM_DEFAULTS[info.maxInputCharsField]}
            min={maxInputCharsBounds.min}
            max={maxInputCharsBounds.max}
            onReset={resetMaxInputChars}
            busy={busy}
          />
        </div>
      </section>

      <Hairline />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}

function ChatTab({ settings }: { settings: AppSettings }) {
  const initialSystem = settings.chat_system_prompt ?? defaultChatSystemPrompt();
  const initialMaxTokens = settings.chat_max_tokens;
  const initialWebSearchMaxUses = settings.chat_web_search_max_uses;

  const [systemPrompt, setSystemPrompt] = useState(initialSystem);
  const [maxTokens, setMaxTokens] = useState<number | "">(initialMaxTokens ?? "");
  const [webSearchMaxUses, setWebSearchMaxUses] = useState<number | "">(
    initialWebSearchMaxUses ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Speichern fehlgeschlagen");
      return null;
    }
    const data = (await res.json()) as AppSettings;
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return data;
  }

  async function handleSave() {
    const patch: Record<string, unknown> = {};
    if (systemPrompt !== initialSystem) patch.chat_system_prompt = systemPrompt || null;
    if (maxTokens !== (initialMaxTokens ?? "")) {
      patch.chat_max_tokens = maxTokens === "" ? null : maxTokens;
    }
    if (webSearchMaxUses !== (initialWebSearchMaxUses ?? "")) {
      patch.chat_web_search_max_uses = webSearchMaxUses === "" ? null : webSearchMaxUses;
    }
    if (Object.keys(patch).length === 0) return;
    await save(patch);
  }

  async function resetSystem() {
    if (!confirm("Chat: System-Prompt auf Code-Default zuruecksetzen?")) return;
    const fresh = await save({ reset_field: "chat_system_prompt" });
    if (fresh) setSystemPrompt(fresh.chat_system_prompt ?? defaultChatSystemPrompt());
  }

  const dirty =
    systemPrompt !== initialSystem ||
    maxTokens !== (initialMaxTokens ?? "") ||
    webSearchMaxUses !== (initialWebSearchMaxUses ?? "");
  const systemEmpty = systemPrompt.trim().length === 0;

  const maxTokensBounds = PARAM_BOUNDS.chat_max_tokens;
  const webSearchBounds = PARAM_BOUNDS.chat_web_search_max_uses;

  return (
    <div className="space-y-7">
      <p className="text-meta">
        Steuert den Chat (Show- und Companies-Scope). Prio-Kontext und Aussteller-Daten werden zusaetzlich automatisch im System-Block mitgeschickt.
      </p>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-meta-strong">system-prompt</div>
          <button
            type="button"
            onClick={resetSystem}
            disabled={busy}
            className="text-meta hover:text-[var(--color-near-black)] transition-colors"
          >
            default wiederherstellen
          </button>
        </div>
        {systemEmpty && (
          <p className="text-meta text-[var(--color-near-black)]/55">
            Leer. Es wird der Code-Default verwendet. Klick &quot;default wiederherstellen&quot; um den Default in den Editor zu laden.
          </p>
        )}
        <MarkdownEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          rows={14}
          ariaLabel="Chat System-Prompt"
        />
      </section>

      <section className="space-y-3">
        <div className="text-meta-strong">parameter</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <NumberField
            label="max_tokens"
            hint="Output-Limit pro Antwort"
            value={maxTokens}
            onChange={setMaxTokens}
            defaultValue={PARAM_DEFAULTS.chat_max_tokens}
            min={maxTokensBounds.min}
            max={maxTokensBounds.max}
            onReset={async () => {
              const fresh = await save({ reset_field: "chat_max_tokens" });
              if (fresh) setMaxTokens("");
            }}
            busy={busy}
          />
          <NumberField
            label="web_search_max_uses"
            hint="Wie oft Claude pro Frage suchen darf (0 = aus, wenn Toggle gesetzt)"
            value={webSearchMaxUses}
            onChange={setWebSearchMaxUses}
            defaultValue={PARAM_DEFAULTS.chat_web_search_max_uses}
            min={webSearchBounds.min}
            max={webSearchBounds.max}
            onReset={async () => {
              const fresh = await save({ reset_field: "chat_web_search_max_uses" });
              if (fresh) setWebSearchMaxUses("");
            }}
            busy={busy}
          />
        </div>
      </section>

      <Hairline />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}

function ShowDiscoveryTab({ settings }: { settings: AppSettings }) {
  const [systemPrompt, setSystemPrompt] = useState(
    settings.show_discovery_system_prompt ?? SHOW_DISCOVERY_SYSTEM_DEFAULT,
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const systemEmpty = systemPrompt.trim().length === 0;
  const dirty =
    systemPrompt !==
    (settings.show_discovery_system_prompt ?? SHOW_DISCOVERY_SYSTEM_DEFAULT);

  async function save(body: Record<string, unknown>): Promise<AppSettings | null> {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Fehler beim Speichern");
      return null;
    }
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return (await res.json()) as AppSettings;
  }

  async function handleSave() {
    await save({ show_discovery_system_prompt: systemPrompt.trim() || null });
  }

  async function resetSystem() {
    const fresh = await save({ reset_field: "show_discovery_system_prompt" });
    if (fresh) setSystemPrompt(fresh.show_discovery_system_prompt ?? SHOW_DISCOVERY_SYSTEM_DEFAULT);
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold mb-1">Messen suchen</h3>
        <p className="text-meta text-[var(--color-near-black)]/65">
          System-Prompt fuer die automatische Messe-Discovery. Beschreibt ISP-Profil,
          gewuenschte Sektoren und geografischen Fokus. Leer = Code-Default.
        </p>
        <p className="mt-1 text-meta text-[var(--color-near-black)]/50">
          Modell: Claude Opus 4.7 (fest, kein Override). Max 15 Web-Searches pro Lauf.
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-meta-strong">system-prompt</div>
          <button
            type="button"
            onClick={resetSystem}
            disabled={busy}
            className="text-meta hover:text-[var(--color-near-black)] transition-colors"
          >
            default wiederherstellen
          </button>
        </div>
        {systemEmpty && (
          <p className="text-meta text-[var(--color-near-black)]/55">
            Leer. Es wird der Code-Default verwendet. Klick &quot;default wiederherstellen&quot; um den Default in den Editor zu laden.
          </p>
        )}
        <MarkdownEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          rows={16}
          ariaLabel="Show Discovery System-Prompt"
        />
      </section>

      <Hairline />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}

function ModelsTab({ settings }: { settings: AppSettings }) {
  const [shortModel, setShortModel] = useState(settings.short_model);
  const [deepModel, setDeepModel] = useState(settings.deep_model);
  const [competitorModel, setCompetitorModel] = useState(
    settings.competitor_discovery_model ?? COMPETITOR_DISCOVERY_MODEL_DEFAULT,
  );
  const [companySearchModel, setCompanySearchModel] = useState(
    settings.company_search_model ?? COMPANY_SEARCH_MODEL,
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    shortModel !== settings.short_model ||
    deepModel !== settings.deep_model ||
    competitorModel !== (settings.competitor_discovery_model ?? COMPETITOR_DISCOVERY_MODEL_DEFAULT) ||
    companySearchModel !== (settings.company_search_model ?? COMPANY_SEARCH_MODEL);

  async function handleSave() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        short_model: shortModel,
        deep_model: deepModel,
        competitor_discovery_model: competitorModel,
        company_search_model: companySearchModel,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Speichern fehlgeschlagen");
      return;
    }
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
  }

  return (
    <div className="space-y-8">
      <div>
        <label className="block text-meta mb-2">short-overview</label>
        <select
          value={shortModel}
          onChange={(e) => setShortModel(e.target.value)}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        >
          {SHORT_MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <p className="mt-2 text-meta">empfehlung: haiku 4.5. schnell, billig, reicht fuer 1-satz-match.</p>
      </div>

      <div>
        <label className="block text-meta mb-2">deep-dive</label>
        <select
          value={deepModel}
          onChange={(e) => setDeepModel(e.target.value)}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        >
          {DEEP_MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <p className="mt-2 text-meta">empfehlung: sonnet 4.6 fuer alle recherchen. opus nur wenn besonders schwierig.</p>
      </div>

      <div>
        <label className="block text-meta mb-2">konkurrenten-analyse</label>
        <select
          value={competitorModel}
          onChange={(e) => setCompetitorModel(e.target.value)}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        >
          {COMPETITOR_MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <p className="mt-2 text-meta">standard: sonnet 4.6. nutzt web-search, hoeheres modell verbessert recherche-qualitaet.</p>
      </div>

      <div>
        <label className="block text-meta mb-2">unternehmen suchen</label>
        <select
          value={companySearchModel}
          onChange={(e) => setCompanySearchModel(e.target.value)}
          className="w-full bg-white border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body focus:outline-none focus:border-[var(--color-near-black)]"
        >
          {COMPANY_SEARCH_MODEL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <p className="mt-2 text-meta">standard: opus 4.7. teure web-suche, hohes modell empfohlen fuer bessere kandidaten-qualitaet.</p>
      </div>

      <div>
        <label className="block text-meta mb-2">messen suchen</label>
        <div className="w-full bg-[var(--color-cream-sunken)] border border-[var(--border-color-soft)] rounded-md px-3 py-2 text-body text-[var(--color-near-black)]/55">
          claude-opus-4-7 (fest)
        </div>
        <p className="mt-2 text-meta">modell ist fest auf opus 4.7 gesetzt, kein override vorgesehen.</p>
      </div>

      <Hairline />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}

function CompetitorDiscoveryTab({ settings }: { settings: AppSettings }) {
  const [systemPrompt, setSystemPrompt] = useState(
    settings.competitor_discovery_system_prompt ?? COMPETITOR_DISCOVERY_SYSTEM_DEFAULT,
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const systemEmpty = systemPrompt.trim().length === 0;
  const dirty =
    systemPrompt !==
    (settings.competitor_discovery_system_prompt ?? COMPETITOR_DISCOVERY_SYSTEM_DEFAULT);

  async function save(body: Record<string, unknown>): Promise<AppSettings | null> {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Fehler beim Speichern");
      return null;
    }
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return (await res.json()) as AppSettings;
  }

  async function handleSave() {
    await save({ competitor_discovery_system_prompt: systemPrompt.trim() || null });
  }

  async function resetSystem() {
    const fresh = await save({ reset_field: "competitor_discovery_system_prompt" });
    if (fresh)
      setSystemPrompt(fresh.competitor_discovery_system_prompt ?? COMPETITOR_DISCOVERY_SYSTEM_DEFAULT);
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold mb-1">Konkurrenten-Analyse</h3>
        <p className="text-meta text-[var(--color-near-black)]/65">
          System-Prompt fuer die automatische Wettbewerber-Discovery. Beschreibt ISP-Profil,
          relevante Sektoren und Kriterien fuer Konkurrenten-Identifikation. Leer = Code-Default.
        </p>
        <p className="mt-1 text-meta text-[var(--color-near-black)]/50">
          Modell einstellbar unter &quot;modelle&quot;. Default: claude-sonnet-4.6.
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-meta-strong">system-prompt</div>
          <button
            type="button"
            onClick={resetSystem}
            disabled={busy}
            className="text-meta hover:text-[var(--color-near-black)] transition-colors"
          >
            default wiederherstellen
          </button>
        </div>
        {systemEmpty && (
          <p className="text-meta text-[var(--color-near-black)]/55">
            Leer. Es wird der Code-Default verwendet. Klick &quot;default wiederherstellen&quot; um den Default in den Editor zu laden.
          </p>
        )}
        <MarkdownEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          rows={16}
          ariaLabel="Competitor Discovery System-Prompt"
        />
      </section>

      <Hairline />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}

function CompanySearchTab({ settings }: { settings: AppSettings }) {
  const [systemPrompt, setSystemPrompt] = useState(
    settings.company_search_system_prompt ?? COMPANY_SEARCH_SYSTEM_DEFAULT,
  );
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const systemEmpty = systemPrompt.trim().length === 0;
  const dirty =
    systemPrompt !==
    (settings.company_search_system_prompt ?? COMPANY_SEARCH_SYSTEM_DEFAULT);

  async function save(body: Record<string, unknown>): Promise<AppSettings | null> {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Fehler beim Speichern");
      return null;
    }
    setSavedAt(new Date().toLocaleTimeString("de-DE"));
    return (await res.json()) as AppSettings;
  }

  async function handleSave() {
    await save({ company_search_system_prompt: systemPrompt.trim() || null });
  }

  async function resetSystem() {
    const fresh = await save({ reset_field: "company_search_system_prompt" });
    if (fresh)
      setSystemPrompt(fresh.company_search_system_prompt ?? COMPANY_SEARCH_SYSTEM_DEFAULT);
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-body font-semibold mb-1">Unternehmen suchen</h3>
        <p className="text-meta text-[var(--color-near-black)]/65">
          System-Prompt fuer die KI-gestuetzte Kunden-Discovery. Definiert welche Firmen-Typen
          gesucht werden und nach welchen Kriterien sie bewertet werden. Leer = Code-Default.
        </p>
        <p className="mt-1 text-meta text-[var(--color-near-black)]/50">
          Modell einstellbar unter &quot;modelle&quot;. Default: claude-opus-4.7.
        </p>
      </div>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="text-meta-strong">system-prompt</div>
          <button
            type="button"
            onClick={resetSystem}
            disabled={busy}
            className="text-meta hover:text-[var(--color-near-black)] transition-colors"
          >
            default wiederherstellen
          </button>
        </div>
        {systemEmpty && (
          <p className="text-meta text-[var(--color-near-black)]/55">
            Leer. Es wird der Code-Default verwendet. Klick &quot;default wiederherstellen&quot; um den Default in den Editor zu laden.
          </p>
        )}
        <MarkdownEditor
          value={systemPrompt}
          onChange={setSystemPrompt}
          rows={16}
          ariaLabel="Company Search System-Prompt"
        />
      </section>

      <Hairline />

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={busy || !dirty}
          className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] rounded-md text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
        >
          <span>{busy ? "speichere" : "speichern"}</span>
          <GoldDot size={6} />
        </button>
        {savedAt && <span className="text-meta">gespeichert um {savedAt}</span>}
        {error && <span className="text-body-sm text-[var(--color-near-black)]/70">{error}</span>}
      </div>
    </div>
  );
}
