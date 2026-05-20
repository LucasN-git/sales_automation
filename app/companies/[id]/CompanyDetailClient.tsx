"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Hairline } from "@/components/brand/Hairline";
import { GoldDot } from "@/components/brand/GoldDot";
import { formatCost } from "@/lib/pricing";
import { loading } from "@/components/LoadingBar";
import { parseErrorJson } from "@/lib/fetch-json";
import {
  EditableCompanyIntelField,
  EditableCompanySelectField,
} from "./EditableCompanyIntelField";
import { USER_GROUP_VALUES, BATTERY_NEED_VALUES, DRONE_RELEVANCE_VALUES } from "@/lib/claude";
import type { CompanyShortRow, CompanyDeepRow } from "@/lib/companies";

const PRIO_LABELS: Record<string, string> = {
  hoch: "Hoch",
  mittel: "Mittel",
  niedrig: "Niedrig",
};

type Sector = { id: string; name: string };
type LifecycleItem = { id: string; name: string; step: string };

export type CompanyDetailClientProps = {
  companyId: string;
  company: {
    display_name: string;
    domain: string | null;
    website: string | null;
    short_status: string;
    deep_status: string;
  };
  shortIntel: CompanyShortRow | null;
  deepIntel: CompanyDeepRow | null;
  participations: Array<{
    exhibitorId: string;
    showId: string;
    showName: string;
    showYear: number | null;
    booth: string | null;
    profileUrl: string | null;
  }>;
  deepPerCallUsd: number;
  deepModel: string;
  sectors: Sector[];
  lifecycle: LifecycleItem[];
};

export function CompanyDetailClient({
  companyId,
  company,
  shortIntel,
  deepIntel,
  participations,
  deepPerCallUsd,
  deepModel,
  sectors,
  lifecycle,
}: CompanyDetailClientProps) {
  const router = useRouter();
  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  const lifecycleById = new Map(lifecycle.map((l) => [l.id, l]));

  return (
    <>
      <ShortBlock
        companyId={companyId}
        company={company}
        shortIntel={shortIntel}
        sectorById={sectorById}
        lifecycleById={lifecycleById}
        router={router}
      />

      <DeepBlock
        companyId={companyId}
        company={company}
        deepIntel={deepIntel}
        deepPerCallUsd={deepPerCallUsd}
        deepModel={deepModel}
        lifecycleById={lifecycleById}
      />

      <MessenBlock participations={participations} />
    </>
  );
}

// ─── Short Block ──────────────────────────────────────────────────────────────

function ShortBlock({
  companyId,
  company,
  shortIntel,
  sectorById,
  lifecycleById,
  router,
}: {
  companyId: string;
  company: CompanyDetailClientProps["company"];
  shortIntel: CompanyShortRow | null;
  sectorById: Map<string, Sector>;
  lifecycleById: Map<string, LifecycleItem>;
  router: ReturnType<typeof useRouter>;
}) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefreshShort() {
    setRefreshing(true);
    try {
      await fetch(`/api/companies/${companyId}/refresh-short`, { method: "POST" });
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Block label="erst-einschaetzung (short)">
      <div className="mb-5 flex items-center justify-between gap-4 flex-wrap">
        <span className="text-body-sm text-[var(--color-near-black)]/55">
          intel gilt unternehmensweit — alle messen teilen diese analyse.
        </span>
        <button
          onClick={handleRefreshShort}
          disabled={refreshing || company.short_status === "running"}
          className="text-body-sm border border-[var(--border-color)] px-3 py-1.5 hover:border-[var(--color-near-black)] transition-colors disabled:opacity-40 shrink-0"
        >
          {refreshing || company.short_status === "running" ? "startet…" : "neu analysieren"}
        </button>
      </div>

      {!shortIntel ? (
        <p className="text-body text-[var(--color-near-black)]/55">
          {company.short_status === "running"
            ? "wird gerade erstellt…"
            : "noch keine short-einschaetzung vorhanden."}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-baseline gap-5 flex-wrap">
            <span className="tabular-nums text-display leading-none">
              {shortIntel.match_confidence ?? 0}
              <span style={{ color: "var(--color-gold)" }}>.</span>
            </span>
            <span className="text-meta-strong">confidence</span>
            <EditableCompanySelectField
              companyId={companyId}
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

          <EditableCompanyIntelField
            companyId={companyId}
            table="short"
            field="one_liner"
            value={(shortIntel.one_liner as string) ?? ""}
            singleLine
          >
            {(v) => <p className="text-subtitle font-normal">{v}</p>}
          </EditableCompanyIntelField>

          <div className="flex flex-wrap gap-2 items-center">
            {shortIntel.user_group && (
              <EditableCompanySelectField
                companyId={companyId}
                table="short"
                field="user_group"
                value={shortIntel.user_group as string}
                options={USER_GROUP_VALUES.map((v) => ({ value: v, label: v }))}
                tagClassName="border-[var(--color-gold)] text-[var(--color-near-black)]"
              />
            )}
            {shortIntel.battery_need && (
              <EditableCompanySelectField
                companyId={companyId}
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
              <EditableCompanySelectField
                companyId={companyId}
                table="short"
                field="drone_relevance"
                value={shortIntel.drone_relevance as string}
                options={DRONE_RELEVANCE_VALUES.map((v) => ({ value: v, label: `UAV: ${v}` }))}
                displayLabel={(v) => `UAV: ${v}`}
                tagClassName="border-[var(--border-color-soft)]"
              />
            )}
          </div>

          {shortIntel.isp_sector_match && shortIntel.isp_sector_match.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {shortIntel.isp_sector_match.map((s) => (
                <span
                  key={s}
                  className="text-meta-strong px-2 py-1 border border-[var(--border-color-soft)]"
                >
                  {(sectorById.get(s)?.name ?? s).toLowerCase()}
                </span>
              ))}
            </div>
          )}

          {shortIntel.service_need && shortIntel.service_need.length > 0 && (
            <div>
              <div className="text-meta text-[var(--color-near-black)]/55 mb-1.5">ISP-Lifecycle-Bedarf</div>
              <div className="flex flex-wrap gap-2">
                {shortIntel.service_need.map((l) => {
                  const it = lifecycleById.get(l);
                  return (
                    <span
                      key={l}
                      className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70"
                    >
                      {it ? `${it.step} ${it.name}` : l}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {shortIntel.reasoning_bullets != null && (
            <div className="pt-4 border-t border-[var(--border-color-soft)]">
              <EditableCompanyIntelField
                companyId={companyId}
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
              </EditableCompanyIntelField>
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

// ─── Deep Block ───────────────────────────────────────────────────────────────

function DeepBlock({
  companyId,
  company,
  deepIntel,
  deepPerCallUsd,
  deepModel,
  lifecycleById,
}: {
  companyId: string;
  company: CompanyDetailClientProps["company"];
  deepIntel: CompanyDeepRow | null;
  deepPerCallUsd: number;
  deepModel: string;
  lifecycleById: Map<string, LifecycleItem>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const isWorking = company.deep_status === "pending" || company.deep_status === "running";
  const label = isWorking
    ? `deep laeuft (${company.deep_status})`
    : deepIntel
    ? "deep-dive neu erstellen"
    : "deep-dive anfordern";
  const tooltip = `Geschaetzt ~${formatCost(deepPerCallUsd)} pro Deep-Dive (${deepModel}).`;

  async function handleDeepDive() {
    if (deepIntel && !confirm("Deep-Dive bereits vorhanden. Neu erstellen?")) return;
    setBusy(true);
    setError(null);
    loading.start();
    try {
      const res = await fetch(`/api/companies/${companyId}/deep-dive`, { method: "POST" });
      if (!res.ok) {
        const j = await parseErrorJson(res);
        setError(j.error ?? "Aktion fehlgeschlagen");
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
      loading.stop();
    }
  }

  return (
    <>
      <Block label="deep-dive">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleDeepDive}
            disabled={busy || isWorking}
            title={tooltip}
            className="inline-flex items-center gap-2 px-5 py-3 text-ui font-semibold bg-transparent border border-[var(--color-near-black)] text-[var(--color-near-black)] hover:text-[var(--color-gold)] hover:scale-[1.03] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:text-[var(--color-near-black)] transition-all duration-150 origin-center"
          >
            <span>{busy ? "sende" : label}</span>
            <GoldDot size={6} />
          </button>
          {!isWorking && (
            <span className="text-meta text-[var(--color-near-black)]/55 tabular-nums" title={tooltip}>
              ~{formatCost(deepPerCallUsd)}
            </span>
          )}
          {error && <span className="text-meta">{error}</span>}
        </div>
        {!deepIntel && !isWorking && (
          <p className="mt-3 text-body-sm text-[var(--color-near-black)]/55">
            tiefenrecherche mit erweitertem kontext. gilt unternehmensweit.
          </p>
        )}
      </Block>

      {deepIntel && (
        <>
          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="business_summary"
            value={(deepIntel.business_summary as string) ?? ""}
            rows={5}
            label="geschaeftsfeld (deep)"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableCompanyIntelField>

          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="decision_makers"
            value={(deepIntel.decision_makers as string) ?? ""}
            rows={4}
            label="entscheider"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableCompanyIntelField>

          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="recent_news"
            value={(deepIntel.recent_news as string) ?? ""}
            rows={4}
            label="aktuelle news"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableCompanyIntelField>

          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="technical_pain_points"
            value={(deepIntel.technical_pain_points as string) ?? ""}
            rows={4}
            label="technische schmerzpunkte"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableCompanyIntelField>

          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="competition_context"
            value={(deepIntel.competition_context as string) ?? ""}
            rows={4}
            label="wettbewerbskontext"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableCompanyIntelField>

          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="opening_questions"
            value={(deepIntel.opening_questions as string) ?? ""}
            rows={4}
            label="oeffnungsfragen"
            asSection
          >
            {(v) =>
              v.trim() ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{ p: ({ children }) => <p className="text-body whitespace-pre-line">{children}</p> }}
                >
                  {v}
                </ReactMarkdown>
              ) : null
            }
          </EditableCompanyIntelField>

          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="isp_service_fit"
            value={(deepIntel.isp_service_fit as string) ?? ""}
            rows={4}
            label="isp service fit"
            asSection
          >
            {(v) => <p className="text-body whitespace-pre-line">{v}</p>}
          </EditableCompanyIntelField>

          {deepIntel.isp_lifecycle_match && deepIntel.isp_lifecycle_match.length > 0 && (
            <section className="py-7">
              <Hairline />
              <div className="pt-5">
                <div className="text-meta-strong mb-3">isp-lifecycle-match</div>
                <div className="flex flex-wrap gap-2">
                  {deepIntel.isp_lifecycle_match.map((l) => (
                    <span
                      key={l}
                      className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70"
                    >
                      {l.replace("_", " ")}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          )}

          <EditableCompanyIntelField
            companyId={companyId}
            table="deep"
            field="full_reasoning"
            value={(deepIntel.full_reasoning as string) ?? ""}
            rows={8}
            label="vollstaendige begruendung"
            asSection
          >
            {(v) => (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="text-body-sm whitespace-pre-wrap leading-relaxed mb-3">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-5 space-y-1 text-body-sm">{children}</ul>,
                }}
              >
                {v}
              </ReactMarkdown>
            )}
          </EditableCompanyIntelField>
        </>
      )}
    </>
  );
}

// ─── Messen Block ─────────────────────────────────────────────────────────────

function MessenBlock({
  participations,
}: {
  participations: CompanyDetailClientProps["participations"];
}) {
  if (participations.length === 0) return null;

  return (
    <section className="py-7">
      <Hairline />
      <div className="pt-5">
        <div className="text-meta-strong mb-4">messen ({participations.length})</div>
        <div className="space-y-2">
          {participations.map((p) => (
            <div
              key={p.exhibitorId}
              className="flex items-center justify-between gap-4 px-4 py-3 border border-[var(--border-color-soft)] hover:border-[var(--border-color)] transition-colors"
            >
              <div className="flex items-center gap-4 flex-wrap min-w-0">
                <Link
                  href={`/shows/${p.showId}`}
                  className="text-body-sm font-medium hover:text-[var(--color-gold)] transition-colors truncate"
                >
                  {p.showName}
                  {p.showYear ? ` ${p.showYear}` : ""}
                </Link>
                {p.booth && (
                  <span className="text-meta text-[var(--color-near-black)]/55 tabular-nums shrink-0">
                    stand {p.booth}
                  </span>
                )}
                {p.profileUrl && (
                  <a
                    href={p.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-meta text-[var(--color-near-black)]/40 hover:text-[var(--color-near-black)] transition-colors shrink-0"
                  >
                    profil ↗
                  </a>
                )}
              </div>
              <Link
                href={`/shows/${p.showId}/exhibitors/${p.exhibitorId}`}
                className="text-meta text-[var(--color-near-black)]/40 hover:text-[var(--color-gold)] transition-colors shrink-0"
              >
                messe-detail ↗
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="py-7">
      <Hairline />
      <div className="pt-5">
        <div className="text-meta-strong mb-4">{label}</div>
        {children}
      </div>
    </section>
  );
}

function ReasoningBullets({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
  return (
    <ul className="space-y-1.5 pl-3">
      {lines.map((l, i) => (
        <li key={i} className="text-body-sm text-[var(--color-near-black)]/80 flex gap-2">
          <span className="text-[var(--color-gold)] shrink-0 mt-0.5">·</span>
          <span>{l}</span>
        </li>
      ))}
    </ul>
  );
}
