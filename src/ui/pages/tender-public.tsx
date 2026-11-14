/**
 * Offentlig side per anbud (/anbud/<id>, bare norsk). Alt kommer fra den offentlige kunngjøringen og ordsøket i
 * appen – merket «Fakta – står ordrett i kunngjøringen». Ingen AI, ingen anslag, ingen leverandørnavn.
 * Hovedknappen tar med seg anbudet gjennom registreringen, så kunden lander på vurderingen av akkurat dette anbudet.
 */
import { LuArrowRight, LuArrowUpRight, LuCalendarClock, LuMail, LuMapPin, LuScale } from 'react-icons/lu';
import type { PublicTender } from '@/domain/tenders/public-page';
import { industrySlugNb } from '@/domain/slugs';
import { compactNumber, fill, money } from '@/i18n/format';
import { StripChart } from '../charts';
import { cn } from '../components';
import { useUi } from '../context';
import { daysUntil, formatDate, formatDateTime } from '../format';
import { PublicLayout } from '../layouts';
import { NewsletterSignup } from '../newsletter';
import { Chip, KIND_TONE, Quote } from '../showcase';
import { SignalCta, Wrap } from '../site';
import { signupWith } from './public';

const SOURCE_NAME: Record<string, string> = { doffin: 'Doffin', ted: 'TED' };

function Fact() {
  return <span className="ml-1.5 inline-flex items-center rounded-full bg-ok-soft px-2 py-px text-[11px] font-semibold text-ok">Fakta – står ordrett i kunngjøringen</span>;
}

export function PublicTenderPage({ t, origin }: { t: PublicTender; origin: string }) {
  const { user, lp, m, locale, search } = useUi();
  const j = m.home.journey;
  // Kilden besøket kom fra (f.eks. ukesbrevet) følger med til registreringen, så Admin → Kundereise ser den.
  const utm = new URLSearchParams(search).get('utm_source');
  const keepSource = (href: string) => (utm && href.includes('/registrer') ? `${href}${href.includes('?') ? '&' : '?'}utm_source=${encodeURIComponent(utm)}` : href);
  const assessPath = `/app/anbud/${t.id}/intelligence`;
  const assess = user ? assessPath : keepSource(signupWith(lp, assessPath));
  const signup = keepSource(lp('/registrer'));
  const open = t.status === 'open';
  const days = daysUntil(t.deadlineAt);
  const source = t.sources.find((s) => s.url);
  const industry = t.industries[0] ?? null;
  const region = t.regions[0] ?? null;
  const pageUrl = `${origin}/anbud/${t.id}`;
  const kr = (v: number) => money(locale, v, t.market?.currency ?? t.currency);
  const findings = t.counts.rejection + t.counts.qualification + t.counts.siteVisit + t.counts.costlyTerms;
  const mail = `mailto:?subject=${encodeURIComponent(`Anbud: ${t.title}`)}&body=${encodeURIComponent(`${t.title}\n${t.buyerName ?? ''}\n\n${pageUrl}`)}`;
  return (
    <PublicLayout>
      <section className="night relative overflow-hidden">
        <div className="dot-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_70%_20%,#000_15%,transparent_70%)]" aria-hidden />
        <Wrap className="relative pb-14 pt-10 sm:pb-16 sm:pt-14">
          <nav aria-label="Brødsmuler" className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-white/60">
            <a href="/bransjer" className="text-white/70 no-underline hover:text-white">
              Bransjer
            </a>
            {industry ? (
              <>
                <span aria-hidden>/</span>
                <a href={`/bransjer/${industrySlugNb(industry.id)}`} className="text-white/70 no-underline hover:text-white">
                  {industry.name}
                </a>
              </>
            ) : null}
          </nav>
          <p className={cn('glass mt-5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-medium', open ? 'text-white/90' : 'text-white/70')}>
            {open ? <span className="live-dot" aria-hidden /> : null}
            {open ? 'Åpent anbud' : 'Fristen har gått ut'}
          </p>
          <h1 className="mt-4 max-w-4xl text-[30px] font-[800] leading-[1.06] tracking-[-0.03em] text-white [overflow-wrap:anywhere] sm:text-[44px]">{t.title}</h1>
          <dl className="mt-7 grid max-w-5xl grid-cols-1 gap-x-8 gap-y-4 text-[14.5px] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-white/55">Oppdragsgiver</dt>
              <dd className="mt-0.5 font-semibold text-white">{t.buyerName ?? 'Ikke oppgitt'}</dd>
            </div>
            <div>
              <dt className="text-white/55">Sted</dt>
              <dd className="mt-0.5 flex items-center gap-1.5 font-semibold text-white">
                <LuMapPin className="size-4 shrink-0 text-white/50" aria-hidden />
                {t.regions.length ? t.regions.map((r) => r.name).join(', ') : t.place || 'Ikke oppgitt'}
              </dd>
            </div>
            <div>
              <dt className="text-white/55">{t.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist'}</dt>
              <dd className="num mt-0.5 flex items-center gap-1.5 font-semibold text-white">
                <LuCalendarClock className="size-4 shrink-0 text-white/50" aria-hidden />
                {t.deadlineAt ? formatDateTime(t.deadlineAt, t.deadlineTimeKnown) : 'Ikke oppgitt'}
                {open && days !== null && days >= 0 ? <span className="font-normal text-white/60">({days === 0 ? 'i dag' : days === 1 ? '1 dag' : `${days} dager`})</span> : null}
              </dd>
            </div>
            <div>
              <dt className="text-white/55">Anslått verdi</dt>
              <dd className="num mt-0.5 font-semibold text-white">{t.estimatedValue ? kr(t.estimatedValue) : 'Ikke oppgitt'}</dd>
            </div>
          </dl>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {open ? (
              <a href={assess} className="btn-signal">
                Se om anbudet passer dere <LuArrowRight className="size-4" aria-hidden />
              </a>
            ) : (
              <a href={user ? '/app' : signup} className="btn-signal">
                Finn åpne anbud som passer dere <LuArrowRight className="size-4" aria-hidden />
              </a>
            )}
            {source?.url ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer" className="btn-ghost-light">
                Kunngjøringen hos {SOURCE_NAME[source.source] ?? source.source} <LuArrowUpRight className="size-4" aria-hidden />
              </a>
            ) : null}
          </div>
        </Wrap>
      </section>

      <section className="bg-cream py-12 sm:py-16">
        <Wrap className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <article className="rounded-3xl border border-line bg-surface p-6 sm:p-7">
              <h2 className="text-[20px] font-[740] tracking-[-0.015em] text-strong">Det vi fant i kunngjøringen</h2>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                Samme ordsøk som i appen: avvisningsgrunner, minstekrav, kvalifikasjonskrav, befaring og vilkår som kan koste penger. Ingen AI.
              </p>
              {t.requirements.length || t.terms.length ? (
                <ul className="mt-5 space-y-4">
                  {t.requirements.map((r) => (
                    <li key={r.kind} className="border-l-2 border-line-strong pl-3.5">
                      <Chip className={KIND_TONE[r.kind]}>{j.kinds[r.kind as keyof typeof j.kinds] ?? r.kind}</Chip>
                      <Fact />
                      <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink">
                        <Quote q={r} />
                      </p>
                    </li>
                  ))}
                  {t.terms.map((r) => (
                    <li key={r.kind} className="border-l-2 border-signal pl-3.5">
                      <Chip className="bg-marker-soft text-ink">
                        {j.costly}: {j.terms[r.kind as keyof typeof j.terms] ?? r.kind}
                      </Chip>
                      <Fact />
                      <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink">
                        <Quote q={r} />
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 rounded-xl border border-dashed border-line-strong bg-paper/40 px-4 py-4 text-[14px] text-muted">
                  Kunngjøringen nevner ingen krav eller vilkår med ordene vi ser etter. Konkurransegrunnlaget har som regel flere – i appen kan dere laste det opp og få alt sjekket.
                </p>
              )}
              {findings ? (
                <p className="mt-5 text-[13.5px] text-muted">
                  {[
                    t.counts.rejection ? `${t.counts.rejection} om avvisning og minstekrav` : null,
                    t.counts.qualification ? `${t.counts.qualification} om kvalifikasjon og dokumentasjon` : null,
                    t.counts.siteVisit ? `${t.counts.siteVisit} om befaring og frister` : null,
                    t.counts.costlyTerms ? `${t.counts.costlyTerms} typer kostbare vilkår` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}{' '}
                  i kunngjøringen. <a href={assess}>Se alle i appen</a>.
                </p>
              ) : null}
            </article>

            {t.market ? (
              <article className="rounded-3xl border border-line bg-surface p-6 sm:p-7">
                <h2 className="text-[20px] font-[740] tracking-[-0.015em] text-strong">Hva lignende kontrakter ble tildelt for</h2>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
                  {t.market.n} tidligere tildelinger med oppgitt verdi ({t.market.label}). Publiserte tall fra kunngjøringene – ikke et anslag for dette anbudet.
                </p>
                <div className="mt-5">
                  <StripChart
                    points={t.market.values.map((v) => ({ value: v, tip: kr(v) }))}
                    band={{ p25: t.market.p25, median: t.market.median, p75: t.market.p75 }}
                    markers={[]}
                    summary={`${fill(j.median, { value: kr(t.market.median) })}. ${fill(j.middle, { from: kr(t.market.p25), to: kr(t.market.p75) })}.`}
                    axisLabel={(v) => compactNumber(locale, v)}
                  />
                </div>
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-ink">
                  <span className="font-semibold">{fill(j.median, { value: kr(t.market.median) })}</span>
                  <span className="text-muted">{fill(j.middle, { from: kr(t.market.p25), to: kr(t.market.p75) })}</span>
                </p>
              </article>
            ) : null}

            {t.text ? (
              <article className="rounded-3xl border border-line bg-surface p-6 sm:p-7">
                <h2 className="text-[20px] font-[740] tracking-[-0.015em] text-strong">Fra kunngjøringen</h2>
                <p className="mt-1 text-[13px] text-muted">
                  {t.publishedAt ? `Publisert ${formatDate(t.publishedAt)}. ` : ''}E-postadresser og telefonnumre er skjult her – de står i originalen.
                </p>
                <div className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">{t.text}</div>
                {source?.url ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-[14px] font-semibold">
                    {t.textClipped ? 'Les hele kunngjøringen' : 'Kunngjøringen'} hos {SOURCE_NAME[source.source] ?? source.source} <LuArrowUpRight className="size-4" aria-hidden />
                  </a>
                ) : null}
              </article>
            ) : null}
          </div>

          <aside className="min-w-0 space-y-6">
            <div className="rounded-3xl bg-night p-6 text-white sm:p-7">
              <LuScale className="size-6 text-signal" aria-hidden />
              <h2 className="mt-3 text-[21px] font-[760] leading-tight tracking-[-0.02em] text-white">Passer det for dere?</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-white/70">
                AnbudRadar vurderer anbudet mot bedriften: treff mot det dere leverer, krav dere må oppfylle, risiko og om det lønner seg med deres kostnader.
              </p>
              <a href={open ? assess : user ? '/app' : signup} className="btn-signal mt-5 w-full justify-center">
                {open ? 'Se om anbudet passer dere' : 'Finn åpne anbud som passer'}
              </a>
              <a href="/eksempel" className="mt-3 block text-center text-[14px] font-semibold text-white/80 no-underline hover:text-white">
                Se et eksempel på en vurdering
              </a>
            </div>
            <NewsletterSignup industry={industry?.id ?? null} region={region?.code ?? null} sourcePath={`/anbud/${t.id}`} className="bg-surface" />
            <div className="rounded-3xl border border-line bg-surface p-5">
              <p className="text-[14px] font-semibold text-strong">Del anbudet</p>
              <p className="mt-1 break-all font-mono text-[12px] text-muted">{pageUrl}</p>
              <a href={mail} className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold">
                <LuMail className="size-4" aria-hidden /> Send til en kollega
              </a>
            </div>
          </aside>
        </Wrap>
      </section>

      <SignalCta
        title="Få bare anbudene som passer dere."
        lead="Rangert mot bedriften, med krav og risiko for hvert anbud. Ingen kort, og ingenting trekkes automatisk."
        primary={user ? { href: '/app', label: 'Til appen' } : { href: signup, label: 'Start gratis' }}
        secondary={{ href: '/eksempel', label: 'Se et ekte eksempel' }}
      />
    </PublicLayout>
  );
}
