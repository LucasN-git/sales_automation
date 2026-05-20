"use client";

import { useState } from "react";
import { Hairline } from "@/components/brand/Hairline";
import { SourceBadge } from "@/components/SourceBadge";
import type { CompanyShortRow, SourceRef } from "@/lib/companies";

type Props = {
  shortIntel: CompanyShortRow;
};

export function CompanyProfileBlock({ shortIntel }: Props) {
  const sources = shortIntel.sources ?? {};
  const hasAnyProfileField =
    shortIntel.address ||
    shortIntel.email ||
    shortIntel.phone ||
    shortIntel.company_type ||
    shortIntel.slogan ||
    shortIntel.categories?.length ||
    shortIntel.products?.length ||
    shortIntel.contact_persons?.length ||
    shortIntel.co_exhibitors?.length ||
    shortIntel.company_description;

  if (!hasAnyProfileField) return null;

  return (
    <section className="py-7">
      <Hairline />
      <div className="pt-5">
        <div className="text-meta-strong mb-4">firmenprofil</div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
          {/* Left column: contact / stammdaten */}
          <div className="space-y-4">
            {shortIntel.address && (
              <ProfileField label="adresse" source={sources.address}>
                <AddressBlock address={shortIntel.address} />
              </ProfileField>
            )}

            {shortIntel.email && (
              <ProfileField label="e-mail" source={sources.email}>
                <a
                  href={`mailto:${shortIntel.email}`}
                  className="text-body-sm hover:text-[var(--color-gold)] transition-colors"
                >
                  {shortIntel.email}
                </a>
              </ProfileField>
            )}

            {shortIntel.phone && (
              <ProfileField label="telefon" source={sources.phone}>
                <span className="text-body-sm">{shortIntel.phone}</span>
              </ProfileField>
            )}

            {shortIntel.company_type && (
              <ProfileField label="typ" source={sources.company_type}>
                <span className="text-body-sm">{shortIntel.company_type}</span>
              </ProfileField>
            )}

            {shortIntel.slogan && (
              <ProfileField label="slogan" source={sources.slogan}>
                <span className="text-body-sm italic text-[var(--color-near-black)]/70">
                  {shortIntel.slogan}
                </span>
              </ProfileField>
            )}

            {shortIntel.employee_estimate && (
              <ProfileField label="mitarbeiter" source={sources.employee_estimate}>
                <span className="text-body-sm">{shortIntel.employee_estimate}</span>
              </ProfileField>
            )}

            {shortIntel.co_exhibitors && shortIntel.co_exhibitors.length > 0 && (
              <ProfileField label="co-aussteller" source={sources.co_exhibitors}>
                <div className="flex flex-wrap gap-1.5">
                  {shortIntel.co_exhibitors.map((c, i) => (
                    <span
                      key={i}
                      className="text-meta-strong px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </ProfileField>
            )}
          </div>

          {/* Right column: categories / products */}
          <div className="space-y-4">
            {shortIntel.categories && shortIntel.categories.length > 0 && (
              <ProfileField label="kategorien" source={sources.categories}>
                <div className="flex flex-wrap gap-1.5">
                  {shortIntel.categories.map((c, i) => (
                    <span
                      key={i}
                      className="text-meta px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </ProfileField>
            )}

            {shortIntel.products && shortIntel.products.length > 0 && (
              <ProfileField label="produkte / leistungen" source={sources.products}>
                <div className="flex flex-wrap gap-1.5">
                  {shortIntel.products.map((p, i) => (
                    <span
                      key={i}
                      className="text-meta px-2 py-0.5 border border-[var(--border-color-soft)] text-[var(--color-near-black)]/70"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </ProfileField>
            )}
          </div>
        </div>

        {/* Company description — full width */}
        {shortIntel.company_description && (
          <div className="mt-5">
            <ProfileField label="beschreibung" source={sources.company_description}>
              <p className="text-body-sm text-[var(--color-near-black)]/75 leading-relaxed">
                {shortIntel.company_description}
              </p>
            </ProfileField>
          </div>
        )}

        {/* Contact persons — accordion */}
        {shortIntel.contact_persons && shortIntel.contact_persons.length > 0 && (
          <div className="mt-5">
            <ContactPersonsBlock
              contacts={shortIntel.contact_persons}
              source={sources.contact_persons}
            />
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function ProfileField({
  label,
  source,
  children,
}: {
  label: string;
  source?: SourceRef;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-meta text-[var(--color-near-black)]/40 uppercase tracking-wider">
          {label}
        </span>
        {source && <SourceBadge source={source} />}
      </div>
      {children}
    </div>
  );
}

function AddressBlock({
  address,
}: {
  address: NonNullable<CompanyShortRow["address"]>;
}) {
  const lines = [
    address.street,
    [address.postcode, address.city].filter(Boolean).join(" "),
    address.country,
  ].filter(Boolean);

  if (lines.length === 0) return null;
  return (
    <div className="text-body-sm space-y-0.5">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  );
}

function ContactPersonsBlock({
  contacts,
  source,
}: {
  contacts: NonNullable<CompanyShortRow["contact_persons"]>;
  source?: SourceRef;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <span className="text-meta text-[var(--color-near-black)]/40 uppercase tracking-wider">
          ansprechpartner ({contacts.length})
        </span>
        {source && <SourceBadge source={source} />}
        <span className="text-meta text-[var(--color-near-black)]/30 ml-auto group-hover:text-[var(--color-near-black)]/60 transition-colors">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {contacts.map((c, i) => (
            <div
              key={i}
              className="flex items-start gap-4 px-3 py-2.5 border border-[var(--border-color-soft)] flex-wrap"
            >
              <div className="flex-1 min-w-0">
                {c.name && (
                  <div className="text-body-sm font-medium text-[var(--color-near-black)]">
                    {c.name}
                  </div>
                )}
                {c.title && (
                  <div className="text-meta text-[var(--color-near-black)]/60 mt-0.5">
                    {c.title}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 flex-wrap shrink-0">
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    className="text-meta text-[var(--color-near-black)]/50 hover:text-[var(--color-near-black)] transition-colors"
                  >
                    {c.email}
                  </a>
                )}
                {c.phone && (
                  <span className="text-meta text-[var(--color-near-black)]/50">
                    {c.phone}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
