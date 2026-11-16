/**
 * Offentlig side per oppdragsgiver (/oppdragsgiver/<navn>-<orgnr>, bare norsk): åpne anbud, hva de kjøper mest og
 * kontrakter som trolig utløper. Ingen leverandørnavn og ingen tildelte verdier – hvem som vinner, står i appen.
 * Besøkende kan følge oppdragsgiveren på e-post uten konto (samme påmelding som ukesbrevet).
 */
import { LuArrowRight, LuBellRing, LuMail, LuTrophy } from 'react-icons/lu';
import type { PublicBuyer } from '@/domain/tenders/buyer-page';
import { useUi } from '../context';
import { PublicLayout } from '../layouts';
import { NewsletterSignup } from '../newsletter';
import { NightHero, Wrap } from '../site';
import { ExpiringContracts, SHOW_ROWS, signupWith, TenderRows } from './public';

/** «971278374» → «971 278 374». */
export const formatOrgNumber = (n: string) => n.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3');

export function BuyerPage({ b }: { b: PublicBuyer }) {
  const { user, lp, m } = useUi();
  // Søket i appen (der søket kan lagres og gi varsel) filtrerer på oppdragsgivernavnet.
  const search = `/app/anbud?oppdragsgiver=${encodeURIComponent(b.name)}`;
  // Hvem som vinner, er med i Bedrift. Besøkende sendes til prisene – ikke gjennom registreringen til en låst side.
  const winners = `/app/konkurrenter/oppdragsgiver/${b.id}`;
  return (
    <PublicLayout>
      <NightHero eyebrow="Oppdragsgiver" title={b.name} lead={`${b.city ? `${b.city} · ` : ''}org.nr. ${formatOrgNumber(b.orgNumber)}`}>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <span className="glass inline-flex items-center gap-2.5 rounded-full px-3.5 py-2 text-[14px] text-white/90">
            <span className="live-dot" aria-hidden />
            <span>
              <strong className="font-semibold text-white">{b.open.toLocaleString('nb-NO')}</strong> {b.open === 1 ? 'åpent anbud' : 'åpne anbud'} akkurat nå
            </span>
          </span>
          <a href={user ? search : signupWith(lp, search)} className="btn-signal">
            <LuBellRing className="size-4" aria-hidden /> Få varsel om nye anbud herfra
          </a>
          {/* Uten konto: følg oppdragsgiveren på e-post (skjemaet i høyre kolonne). */}
          {!user ? (
            <a href="#folg" className="btn-ghost-light">
              <LuMail className="size-4" aria-hidden /> Følg på e-post uten konto
            </a>
          ) : null}
        </div>
      </NightHero>
      <section className="bg-surface py-14 sm:py-20">
        <Wrap className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <h2 className="text-[22px] font-[740] tracking-[-0.02em] text-strong">Åpne anbud</h2>
            {b.rows.length ? (
              <TenderRows rows={b.rows} hideBuyer show={SHOW_ROWS} />
            ) : (
              <p className="mt-5 rounded-2xl border border-dashed border-line-strong p-6 text-[15px] text-muted">
                Ingen åpne anbud fra {b.name} akkurat nå. Med varsel får dere beskjed når neste kommer.
              </p>
            )}
            {b.open > b.rows.length ? (
              <p className="mt-4 text-[14px] text-muted">
                Viser de {b.rows.length} nærmeste fristene av {b.open.toLocaleString('nb-NO')}.
              </p>
            ) : null}
            {b.expiring.rows.length ? <ExpiringContracts expiring={b.expiring} hideBuyer /> : null}
            <p className="mt-10 text-[13px] leading-relaxed text-muted">
              Fra kunngjøringene i Doffin og TED, oppdateres flere ganger i døgnet. Navnet vises slik kunngjøringene skriver det.{' '}
              <a href="/metode" className="font-semibold">
                Slik regner vi
              </a>
            </p>
          </div>
          <aside className="h-fit space-y-4 lg:sticky lg:top-24">
            <NewsletterSignup id="folg" buyer={{ name: b.name, orgNumber: b.orgNumber }} sourcePath={b.path} className="bg-surface" />
            {b.divisions.length ? (
              <div className="rounded-3xl bg-cream p-6">
                <h2 className="text-[17px] font-semibold text-strong">Dette kjøper de mest</h2>
                <p className="mt-1 text-[13px] text-muted">{b.notices12m.toLocaleString('nb-NO')} anbud og tildelinger siste 12 måneder.</p>
                <ul className="mt-4 space-y-2.5">
                  {b.divisions.map((d) => (
                    <li key={d.code} className="flex items-baseline justify-between gap-3 text-[14.5px]">
                      <span className="min-w-0 text-ink">{d.label}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-strong">{d.n.toLocaleString('nb-NO')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="night rounded-3xl p-6">
              <LuTrophy className="size-6 text-signal" aria-hidden />
              <p className="mt-3 text-[18px] font-[720] leading-snug text-white">Hvem vinner hos {b.name}?</p>
              <p className="mt-2 text-[14px] leading-relaxed text-white/70">
                Tildelinger, vinnere og hva kontraktene ble tildelt for er med i {m.plans.business.name}-planen.
              </p>
              <a href={user ? winners : lp('/priser')} className="btn-signal mt-5 w-full justify-center">
                {user ? 'Se tildelingene' : 'Se planene'} <LuArrowRight className="size-4" aria-hidden />
              </a>
            </div>
          </aside>
        </Wrap>
      </section>
    </PublicLayout>
  );
}
