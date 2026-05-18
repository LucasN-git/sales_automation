"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Hairline } from "@/components/brand/Hairline";
import { DeepDiveButton } from "./DeepDiveButton";
import { EditableIntelField, EditableSelectField } from "./EditableIntelField";
import { USER_GROUP_VALUES, BATTERY_NEED_VALUES, DRONE_RELEVANCE_VALUES } from "@/lib/claude";

const PRIO_LABELS: Record<string, string> = {
  hoch: "Hoch",
  mittel: "Mittel",
  niedrig: "Niedrig",
};

type Sector = { id: string; name: string };
type LifecycleItem = { id: string; name: string; step: string };

export type ExhibitorDetailClientProps = {
  showId: string;
  exId: string;
  showName: string | null;
  exhibitor: {
    company_name: string;
    website: string | null;
    booth: string | null;
    short_status: string;
    deep_status: string;
    profile_url: string | null;
    profile_data: Record<string, unknown> | null;
    profile_enrich_status: string | null;
    pre_filter_status: string | null;
    pre_filter_reason: string | null;
  };
  shortIntel: {
    one_liner: string | null;
    priority_label: string | null;
    match_confidence: number | null;
    isp_sector_match: string[] | null;
    reasoning_bullets: string | null;
    user_group: string | null;
    battery_need: string | null;
    drone_relevance: string | null;
    service_need: string[] | null;
  } | null;
  deepIntel: {
    business_summary: string | null;
    decision_makers: string | null;
    recent_news: string | null;
    technical_pain_points: string | null;
    opening_questions: string | null;
    competition_context: string | null;
    isp_lifecycle_match: string[] | null;
    isp_service_fit: string | null;
    full_reasoning: string | null;
  } | null;
  borrowedFromShowName?: string | null;
  deepPerCallUsd: number;
  deepEstimateHistorical: boolean;
  deepModel: string;
  sectors: Sector[];
  lifecycle: LifecycleItem[];
};

export function ExhibitorDetailClient({
  showId,
  exId,
  showName,
  exhibitor,
  borrowedFromShowName,
  shortIntel,
  deepIntel,
  deepPerCallUsd,
  deepEstimateHistorical,
  deepModel,
  sectors,
  lifecycle,
}: ExhibitorDetailClientProps) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  const lifecycleById = new Map(lifecycle.map((l) => [l.id, l]));

  async function handleRefreshShort() {
    setRefreshing(true);
    try {
      await fetch(`/api/exhibitors/${exId}/refresh-short`, { method: "POST" });
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePreFilterOverride() {
    setOverriding(true);
    try {
      await fetch(`/api/exhibitors/${exId}/pre-filter-override`, { method: "POST" });
      router.refresh();
    } finally {
      setOverriding(false);
    }
  }

  return (
    <>
      <div className="mb-6 text-meta">
        <Link
          href={`/shows/${showId}`}
          className="hover:text-[var(--color-gold)] transition-colors"
        >
          ← {showName ?? "Messe"}
        </Link>
      </div>

      <header className="mb-8">
        <h1 className="text-display">{exhibitor.company_name}</h1>
        <div className="mt-3 flex items-center gap-4 text-body-sm text-[var(--color-near-black)]/65 flex-wrap">
          {exhibitor.booth && <span>stand {exhibitor.booth}</span>}
          <span>short: {exhibitor.short_status}</span>
          {exhibitor.deep_status !== "none" && (
            <span>deep: {exhibitor.deep_status}</span>
          )}
        </div>
      </header>

      {exhibitor.pre_filter_status === "filtered_out" && (
        <div className="mb-6 px-4 py-3 border border-[var(--border-color-soft)] border-l-2 border-l-[var(--color-near-black)]/40 bg-[var(--color-near-black)]/[0.02] flex items-center justify-between gap-4 flex-wrap">
          <span className="text-body-sm text-[var(--color-near-black)]/65">
            vor-filtert: <span className="font-medium text-[var(--color-near-black)]">{exhibitor.pre_filter_reason ?? "kein ISP-fit erkannt"}</span>
          </span>
          <button
            onClick={handlePreFilterOverride}
            disabled={overriding}
            className="text-body-sm border border-[var(--border-color)] px-3 py-1.5 hover:border-[var(--color-near-black)] transition-colors disabled:opacity-40 shrink-0"
          >
            {overriding ? "startet…" : "trotzdem analysieren"}
          </button>
        </div>
      )}

      <Block label="kontakt & stammdaten">
        <ProfileBlock
          website={exhibitor.website}
          profileUrl={exhibitor.profile_url}
          profileData={exhibitor.profile_data}
          profileEnrichStatus={exhibitor.profile_enrich_status}
        />
      </Block>

      <Block label="erst-einschaetzung (short)">
        {borrowedFromShowName && (
          <div className="mb-5 px-4 py-3 border border-[var(--border-color-soft)] border-l-2 border-l-[var(--color-near-black)]/40 bg-[var(--color-near-black)]/[0.02] flex items-center justify-between gap-4 flex-wrap">
            <span className="text-body-sm text-[var(--color-near-black)]/65">
              short overview uebernommen von: <span className="font-medium text-[var(--color-near-black)]">{borrowedFromShowName}</span>
            </span>
            <button
              onClick={handleRefreshShort}
              disabled={refreshing}
              className="text-body-sm border border-[var(--border-color)] px-3 py-1.5 hover:border-[var(--color-near-black)] transition-colors disabled:opacity-40"
            >
              {refreshing ? "startet…" : "neu erstellen"}
            </button>
          </div>
        )}
        {!shortIntel ? (
          <p className="text-body text-[var(--color-near-black)]/55">
            {exhibitor.short_status === "running"
              ? "wird gerade erstellt…"
              : "noch keine short-einschaetzung. klicke in der show-detail-ansicht 'short-overviews starten'."}
          </p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-baseline gap-5 flex-wrap">
              <span className="tabular-nums text-display leading-none">
                {shortIntel.match_confidence ?? 0}
                <span style={{ color: "var(--color-gold)" }}>.</span>
              </span>
              <span className="text-meta-strong">confidence</span>
              {/* Priority tag — pencil appears inside the chip border on hover */}
              <EditableSelectField
                exhibitorId={exId}
                table="short"
                field="priority_label"
                value={(shortIntel.priority_label as string) ?? "niedrig"}
                options={[
                  { value: "hoch", label: "Hoch" },
                  { value: "mittel", label: "Mittel" },
                  { value: "niedrig", label: "Niedrig" },
                ]}
                displayLabel={(v) => PRIO_LABELS[v] ?? v}
                tagClassName="border-[var(--color-near-black)]"
              />
            </div>

            <EditableIntelField
              exhibitorId={exId}
              table="short"
              field="one_liner"
              value={(shortIntel.one_liner as string) ?? ""}
              singleLine
            >
              {(v) => <p className="text-subtitle font-normal">{v}</p>}
            </EditableIntelField>

            <div className="flex flex-wrap gap-2 items-center">
              {shortIntel.user_group && (
                <EditableSelectField
                  exhibitorId={exId}
                  table="short"
                  field="user_group"
                  value={shortIntel.user_group as string}
                  options={USER_GROUP_VALUES.map((v) => ({ value: v, label: v }))}
                  tagClassName="border-[var(--color-gold)] text-[var(--color-near-black)]"
                />
              )}
              {shortIntel.battery_need && (
                <EditableSelectField
                  exhibitorId={exId}
                  table="short"
                  field="battery_need"
                  value={shortIntel.battery_need as string}
                  options={BATTERY_NEED_VALUES.map((v) => ({ value: v, label: `Batterie: ${v}` }))}
                  displayLabel={(v) => `Batterie: ${v}`}
                  tagClassName=""
                  tagStyle={(v) => ({
                    borderColor:
                      v === "sehr_hoch"
                        ? "var(--color-gold)"
                        : v === "hoch"
                        ? "rgba(10,10,10,0.4)"
                        : "var(--border-color-soft)",
                    color: v === "sehr_hoch" ? "var(--color-gold)" : undefined,
                  })}
                />
              )}
              {shortIntel.drone_relevance && (
                <EditableSelectField
                  exhibitorId={exId}
                  table="short"
                  field="drone_relevance"
                  value={shortIntel.drone_relevance as string}
                  options={DRONE_RELEVANCE_VALUES.map((v) => ({ value: v, label: `UAV: ${v}` }))}
                  displayLabel={(v) => `UAV: ${v}`}
                  tagClassName="border-[var(--border-color-soft)]"
                />
              )}
            </div>

            {shortIntel.isp_sector_match && (shortIntel.isp_sector_match as string[]).length > 0 && (
              <div className="flex flex-wrap gap-2">
                {(shortIntel.isp_sector_match as string[]).map((s) => (
                  <span
                    key={s}
                    className="text-meta-strong px-2 py-1 border border-[var(--border-color-soft)]"
                  >
                    {(sectorById.get(s)?.name ?? s).toLowerCase()}
                  </span>
                ))}
              </div>
            )}

            {shortIntel.service_need && (shortIntel.service_need as string[]).length > 0 && (
              <div>
                <div className="text-meta text-[var(--color-near-black)]/55 mb-1.5">ISP-Lifecycle-Bedarf</div>
                <div className="flex flex-wrap gap-2">
                  {(shortIntel.service_need as string[]).map((l) => {
                    const it = lifecycleById.get(l);
                    return (
                      <span key={l} className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70">
                        {it ? `${it.step} ${it.name}` : l}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {shortIntel.reasoning_bullets != null && (
              <div className="pt-4 border-t border-[var(--border-color-soft)]">
                {/* label rendered inside EditableIntelField — pencil sits next to "begruendung" */}
                <EditableIntelField
                  exhibitorId={exId}
                  table="short"
                  field="reasoning_bullets"
                  value={(shortIntel.reasoning_bullets as string) ?? ""}
                  rows={5}
                  label="begruendung"
                >
                  {(v) =>
                    v.trim().length > 0 ? (
                      <ReasoningBullets text={v} />
                    ) : (
                      <span className="text-[var(--color-near-black)]/35 text-body-sm">leer</span>
                    )
                  }
                </EditableIntelField>
              </div>
            )}
          </div>
        )}
      </Block>

      <Block label="deep-dive">
        <DeepDiveButton
          exhibitorId={exId}
          status={exhibitor.deep_status}
          hasDeep={!!deepIntel}
          perCallUsd={deepPerCallUsd}
          estimateHistorical={deepEstimateHistorical}
          model={deepModel}
        />
        {!deepIntel && exhibitor.deep_status !== "running" && exhibitor.deep_status !== "pending" && (
          <p className="mt-3 text-body-sm text-[var(--color-near-black)]/55">
            tiefenrecherche mit erweitertem kontext. dauert ~30-60 s, kostet
            spuerbar mehr tokens als short. nur fuer aussteller anfordern, die
            den stand-besuch wert sind.
          </p>
        )}
      </Block>

      {deepIntel && (
        <>
          {/* Deep blocks: each wraps a single EditableIntelField with asSection —
              the component renders the hairline + label + pencil itself. */}
          <EditableIntelField
            exhibitorId={exId}
            table="deep"
            field="business_summary"
            value={(deepIntel.business_summary as string) ?? ""}
            rows={5}
            label="geschaeftsfeld (deep)"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableIntelField>

          <EditableIntelField
            exhibitorId={exId}
            table="deep"
            field="decision_makers"
            value={(deepIntel.decision_makers as string) ?? ""}
            rows={3}
            label="ansprechpartner"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableIntelField>

          <EditableIntelField
            exhibitorId={exId}
            table="deep"
            field="recent_news"
            value={(deepIntel.recent_news as string) ?? ""}
            rows={3}
            label="aktuelle entwicklungen"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableIntelField>

          <EditableIntelField
            exhibitorId={exId}
            table="deep"
            field="technical_pain_points"
            value={(deepIntel.technical_pain_points as string) ?? ""}
            rows={4}
            label="technische schmerzpunkte"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableIntelField>

          <EditableIntelField
            exhibitorId={exId}
            table="deep"
            field="competition_context"
            value={(deepIntel.competition_context as string) ?? ""}
            rows={3}
            label="wettbewerb"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableIntelField>

          <EditableIntelField
            exhibitorId={exId}
            table="deep"
            field="opening_questions"
            value={(deepIntel.opening_questions as string) ?? ""}
            rows={5}
            label="fragen am stand"
            asSection
          >
            {(v) => <p className="text-subtitle whitespace-pre-line">{v}</p>}
          </EditableIntelField>

          {deepIntel.isp_service_fit && (
            <EditableIntelField
              exhibitorId={exId}
              table="deep"
              field="isp_service_fit"
              value={(deepIntel.isp_service_fit as string) ?? ""}
              rows={3}
              label="isp-service-fit"
              asSection
            >
              {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
            </EditableIntelField>
          )}

          <Block label="isp-lifecycle-match">
            <ul className="space-y-1">
              {(deepIntel.isp_lifecycle_match as string[] ?? []).map((l) => {
                const it = lifecycleById.get(l);
                return (
                  <li key={l} className="text-body flex items-baseline gap-2">
                    {it && <span className="tabular-nums text-meta">{it.step}</span>}
                    <span>{it?.name ?? l}</span>
                  </li>
                );
              })}
            </ul>
          </Block>

          <EditableIntelField
            exhibitorId={exId}
            table="deep"
            field="full_reasoning"
            value={(deepIntel.full_reasoning as string) ?? ""}
            rows={6}
            label="begruendung"
            asSection
          >
            {(v) => <p className="text-body-sm text-[var(--color-near-black)]/70 whitespace-pre-line">{v}</p>}
          </EditableIntelField>
        </>
      )}
    </>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="py-7">
      <Hairline />
      <div className="pt-5">
        <div className="text-meta-strong mb-3">{label}</div>
        {children}
      </div>
    </section>
  );
}

function ProfileBlock({
  website,
  profileUrl,
  profileData,
  profileEnrichStatus,
}: {
  website: string | null;
  profileUrl: string | null;
  profileData: Record<string, unknown> | null;
  profileEnrichStatus: string | null;
}) {
  const pd = profileData ?? {};
  const addr = pd.address as
    | { street?: string; postcode?: string; city?: string; country?: string }
    | undefined;
  const cats = Array.isArray(pd.categories) ? (pd.categories as string[]) : [];
  const co = Array.isArray(pd.coExhibitors) ? (pd.coExhibitors as string[]) : [];
  const products = Array.isArray(pd.products_scraped)
    ? (pd.products_scraped as string[])
    : Array.isArray(pd.products)
    ? (pd.products as string[])
    : [];
  const contacts = Array.isArray(pd.contact_persons)
    ? (pd.contact_persons as string[])
    : [];
  const description =
    (pd.description_long as string | undefined) ??
    (pd.companyDescription as string | undefined) ??
    null;

  const hasAnyData =
    !!website || !!profileUrl || !!addr || !!pd.email || !!pd.phone ||
    cats.length > 0 || co.length > 0 || products.length > 0 || contacts.length > 0 ||
    !!description || !!pd.slogan || !!pd.companyType;

  if (!hasAnyData) {
    return (
      <p className="text-body text-[var(--color-near-black)]/45">
        keine stammdaten hinterlegt
        {profileEnrichStatus === "running" ? " — profil-scrape laeuft…" : ""}
        {profileEnrichStatus === "pending" ? " — profil-scrape geplant" : ""}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-4 text-body">
      <div className="space-y-2">
        {website ? (
          <Field label="website">
            <a href={website} target="_blank" rel="noreferrer" className="underline underline-offset-4 break-all hover:text-[var(--color-gold)] transition-colors">
              {website}
            </a>
          </Field>
        ) : profileEnrichStatus === "pending" || profileEnrichStatus === "running" ? (
          <Field label="website">
            <span className="text-[var(--color-near-black)]/45">wird aus profil-seite gezogen…</span>
          </Field>
        ) : null}
        {profileUrl && (
          <Field label="messe-profil">
            <a href={profileUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4 break-all hover:text-[var(--color-gold)] transition-colors">
              {profileUrl}
            </a>
          </Field>
        )}
        {addr && (
          <Field label="adresse">
            <span className="whitespace-pre-line">
              {[addr.street, [addr.postcode, addr.city].filter(Boolean).join(" "), addr.country].filter(Boolean).join("\n")}
            </span>
          </Field>
        )}
        {typeof pd.email === "string" && (
          <Field label="email">
            <a href={`mailto:${pd.email}`} className="underline underline-offset-4 break-all hover:text-[var(--color-gold)] transition-colors">
              {pd.email as string}
            </a>
          </Field>
        )}
        {typeof pd.phone === "string" && (
          <Field label="telefon">
            <a href={`tel:${(pd.phone as string).replace(/\s+/g, "")}`} className="underline underline-offset-4 hover:text-[var(--color-gold)] transition-colors">
              {pd.phone as string}
            </a>
          </Field>
        )}
        {typeof pd.companyType === "string" && <Field label="typ">{pd.companyType as string}</Field>}
        {typeof pd.slogan === "string" && <Field label="slogan">{pd.slogan as string}</Field>}
      </div>

      <div className="space-y-3">
        {cats.length > 0 && (
          <Field label="kategorien (vom veranstalter)">
            <div className="flex flex-wrap gap-1.5">
              {cats.map((c) => (
                <span key={c} className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70">{c}</span>
              ))}
            </div>
          </Field>
        )}
        {co.length > 0 && (
          <Field label="co-aussteller">
            <ul className="list-none space-y-0.5">{co.map((name) => <li key={name}>{name}</li>)}</ul>
          </Field>
        )}
        {contacts.length > 0 && (
          <Field label="ansprechpartner">
            <ul className="list-none space-y-0.5">{contacts.map((p) => <li key={p}>{p}</li>)}</ul>
          </Field>
        )}
        {products.length > 0 && (
          <Field label="produkte/leistungen">
            <div className="flex flex-wrap gap-1.5">
              {products.slice(0, 12).map((p) => (
                <span key={p} className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/65">{p}</span>
              ))}
              {products.length > 12 && (
                <span className="text-meta text-[var(--color-near-black)]/45">+{products.length - 12} weitere</span>
              )}
            </div>
          </Field>
        )}
        {description && (
          <Field label="beschreibung">
            <p className="text-body-sm whitespace-pre-line">{description}</p>
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-meta uppercase tracking-wider text-[var(--color-near-black)]/55 mb-1">{label}</div>
      <div className="text-body">{children}</div>
    </div>
  );
}

function ReasoningBullets({ text }: { text: string }) {
  const items = text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((l) => l.length > 0);
  if (items.length === 0) {
    return <div className="text-body"><InlineMarkdown text={text} /></div>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="text-body flex gap-2">
          <span className="text-[var(--color-near-black)]/45 select-none">-</span>
          <span><InlineMarkdown text={item} /></span>
        </li>
      ))}
    </ul>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <>{children}</>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-[var(--color-gold)] transition-colors">
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="font-mono text-[12.5px] px-1 py-0.5 bg-[var(--color-near-black)]/[0.06]">{children}</code>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
