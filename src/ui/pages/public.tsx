/**
 * Undersidene: funksjoner, priser, bransjer (oversikt og én side per bransje), om oss og kontakt.
 * Samme uttrykk som forsiden: mørk topp, lyse seksjoner med luft, gul handling.
 */
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  LuArrowRight,
  LuBellRing,
  LuCalculator,
  LuCalendarRange,
  LuChartColumn,
  LuCheck,
  LuDatabase,
  LuEye,
  LuFileSearch,
  LuGauge,
  LuHandshake,
  LuListChecks,
  LuMail,
  LuMapPin,
  LuRadar,
  LuSearch,
  LuShieldCheck,
  LuSparkles,
  LuScale,
  LuTelescope,
  LuTrophy,
} from 'react-icons/lu';
import { INDUSTRIES, REGION_BY_CODE } from '@/domain/reference';
import { industryRegionPath, industrySlugNb, regionPath } from '@/domain/slugs';
import { PLANS, type PlanId } from '@/domain/billing/plans';
import type { BoardRow, IndustryListing, MarketSnapshot, NoticeSpecimen } from '@/domain/tenders/market';
import { companyConfigured } from '@/domain/legal/legal';
import { useUi } from '../context';
import { Alert, Button, cn, Field, Input, PostForm, Textarea } from '../components';
import { PublicLayout } from '../layouts';
import { NewsletterSignup } from '../newsletter';
import { sourcesText, type Locale, type Messages } from '@/i18n';
import { clockTime, dayOfMonth, fill, int, money, monthShort, plural, pluralTemplate, rich } from '@/i18n/format';
import { FaqList, faqItems, INDUSTRY_ICONS } from '../marketing';
import { H2, IndustryTiles, Kicker, NightHero, SignalCta, Wrap } from '../site';
import { NoticeExample } from './notice-example';

export { HomePage } from './home';
export { CookiesPage, DpaPage, PrivacyPage, SecurityPage, SubprocessorsPage, TermsPage } from './legal';

function Check({ dark = false }: { dark?: boolean }) {
  return (
    <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', dark ? 'bg-signal/15 text-signal' : 'bg-night text-signal')}>
      <LuCheck className="size-3" aria-hidden strokeWidth={3} />
    </span>
  );
}

function Points({ items, dark = false, className }: { items: string[]; dark?: boolean; className?: string }) {
  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((x) => (
        <li key={x} className={cn('flex gap-2.5 text-[15px] leading-snug', dark ? 'text-white/85' : 'text-ink')}>
          <Check dark={dark} />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Funksjoner
// ---------------------------------------------------------------------------
/** Ikonene til funksjonene, i samme rekkefølge som m.features.items. */
// Samme rekkefølge som m.features.items. AI-kortet (LuSparkles) vises bare når ekte AI er slått på.
const FEATURE_ICONS: IconType[] = [LuScale, LuSearch, LuGauge, LuFileSearch, LuCalculator, LuCalendarRange, LuChartColumn, LuTrophy, LuListChecks, LuHandshake, LuSparkles];

export function FeaturesPage({ specimen }: { specimen: NoticeSpecimen | null }) {
  const { user, m, lp, aiConfigured, aiIsMock } = useUi();
  const t = m.features;
  // Simulert AI markedsføres aldri som ekte: AI-kortet vises bare når en ekte leverandør er satt opp.
  const items = aiConfigured && !aiIsMock ? [...t.items, t.aiItem] : t.items;
  return (
    <PublicLayout>
      <NightHero eyebrow={t.eyebrow} title={t.title} lead={t.lead}>
        <div className="mt-9 flex flex-wrap gap-3">
          <a href={user ? '/app' : lp('/registrer')} className="btn-signal">
            {user ? m.nav.toApp : m.nav.start} <LuArrowRight className="size-4" aria-hidden />
          </a>
          <a href={lp('/priser')} className="btn-ghost-light">
            {m.home.seePrices}
          </a>
        </div>
      </NightHero>
      <section className="bg-surface py-24 sm:py-28">
        <Wrap>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((f, i) => {
              const Icon = FEATURE_ICONS[i] ?? LuRadar;
              return (
                <li key={f.title} className={cn('reveal card-lift flex flex-col rounded-3xl border border-line bg-surface p-6', i % 4 === 1 && 'delay-1', i % 4 === 2 && 'delay-2', i % 4 === 3 && 'delay-3')}>
                  <span className="flex size-11 items-center justify-center rounded-xl bg-night text-signal">
                    <Icon className="size-5" aria-hidden strokeWidth={1.8} />
                  </span>
                  <h2 className="mt-5 text-[19px] font-[720] leading-tight tracking-[-0.015em] text-strong">{f.title}</h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.text}</p>
                  <Points items={f.points} className="mt-5" />
                </li>
              );
            })}
          </ul>
        </Wrap>
      </section>
      {specimen ? <NoticeExample s={specimen} /> : null}
      <section className="night relative overflow-hidden py-20 sm:py-24">
        <Wrap className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_auto]">
          <div className="reveal max-w-2xl">
            <Kicker dark>{t.enterpriseEyebrow}</Kicker>
            <H2 dark className="mt-4">
              {t.enterpriseTitle}
            </H2>
            <p className="mt-5 text-[18px] leading-relaxed text-white/70">{t.enterpriseText}</p>
          </div>
          <a href={`${lp('/priser')}#enterprise`} className="btn-ghost-light reveal delay-1 justify-self-start">
            <LuTelescope className="size-4" aria-hidden /> {t.enterpriseCta}
          </a>
        </Wrap>
      </section>
      <SignalCta
        title={t.ctaTitle}
        lead={t.ctaLead}
        primary={user ? { href: '/app', label: m.nav.toApp } : { href: lp('/registrer'), label: m.nav.start }}
        secondary={{ href: lp('/priser'), label: m.home.seePrices }}
      />
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
// Priser
// ---------------------------------------------------------------------------
type Ent = (typeof PLANS)['starter']['entitlements'];
type MatrixKey = keyof Messages['pricing']['matrix'];
const UNLIMITED = 1_000_000;
const MATRIX: [MatrixKey, (e: Ent, m: Messages, l: Locale) => ReactNode][] = [
  ['realTenders', () => '✓'],
  ['searchesPerDay', (e, m, l) => (e.searchesPerDay >= UNLIMITED ? m.pricing.unlimited : int(l, e.searchesPerDay))],
  ['filters', () => '✓'],
  ['advancedSearch', (e) => (e.advancedSearch ? '✓' : '–')],
  ['bookmarks', (e, m, l) => (e.maxBookmarks >= UNLIMITED ? m.pricing.unlimited : int(l, e.maxBookmarks))],
  ['alerts', (e) => (e.alerts === 'none' ? '–' : '✓')],
  ['savedSearches', (e, m, l) => (e.maxSavedSearches >= UNLIMITED ? m.pricing.unlimited : e.maxSavedSearches ? int(l, e.maxSavedSearches) : '–')],
  ['deadlineAlerts', (e) => (e.alerts === 'full' ? '✓' : '–')],
  ['aiAnalyses', (e, _m, l) => int(l, e.aiAnalysesPerMonth)],
  ['fullAnalysis', (e, m) => (e.aiFullAnalysis ? '✓' : m.pricing.shortSummary)],
  ['matching', (e) => (e.matching ? '✓' : '–')],
  ['bidAssistant', (e, m, l) => (e.bidAssistant ? fill(m.pricing.draftsPerMonth, { n: int(l, e.aiBidDraftsPerMonth) }) : '–')],
  ['competitorIntel', (e) => (e.competitorIntel ? '✓' : '–')],
  ['profitCalculator', (e) => (e.profitCalculator ? '✓' : '–')],
  ['profitAI', (e) => (e.profitAI ? '✓' : '–')],
  ['partnerListing', (e) => (e.partnerListing ? '✓' : '–')],
  ['partnerSearch', (e) => (e.partnerSearch ? '✓' : '–')],
  ['futureOpportunities', (e) => (e.futureOpportunities ? '✓' : '–')],
  ['members', (e, _m, l) => int(l, e.maxMembers)],
];
const CARD_PLANS: PlanId[] = ['free', 'starter', 'professional', 'business'];
const COMPARE: PlanId[] = ['free', 'starter', 'professional', 'business', 'enterprise'];

function PlanCard({ id }: { id: PlanId }) {
  const { m, lp, locale } = useUi();
  const plan = PLANS[id];
  const text = m.plans[id];
  const featured = id === 'professional';
  return (
    <article
      className={cn(
        'relative flex flex-col rounded-3xl p-7',
        featured ? 'night text-white shadow-[0_40px_90px_-40px_rgba(6,14,27,0.9)] ring-1 ring-signal/40' : 'border border-line bg-surface text-strong shadow-[0_24px_60px_-45px_rgba(6,14,27,0.5)]',
      )}
    >
      {featured ? <span className="absolute right-6 top-6 rounded-full bg-signal px-2.5 py-1 text-[12px] font-bold text-night">{m.pricing.recommended}</span> : null}
      <h2 className={cn('text-[20px] font-[740] tracking-[-0.015em]', featured ? 'text-white' : 'text-strong')}>{text.name}</h2>
      <p className={cn('mt-1 min-h-[2.75rem] text-[14px] leading-snug', featured ? 'text-white/65' : 'text-muted')}>{text.tagline}</p>
      <p className="mt-6 flex items-baseline gap-1.5">
        <span className={cn('text-[52px] font-[800] leading-none tracking-[-0.045em]', featured ? 'text-white' : 'text-strong')}>{int(locale, plan.priceNok ?? 0)}</span>
        <span className={cn('text-[15px] font-semibold', featured ? 'text-white/80' : 'text-strong')}>{m.pricing.perMonth}</span>
      </p>
      <p className={cn('mt-1 text-[12.5px]', featured ? 'text-white/50' : 'text-muted')}>{m.pricing.exVat}</p>
      <a href={lp('/registrer')} className={cn('mt-6 w-full', featured ? 'btn-signal' : id === 'free' ? 'btn-outline-dark' : 'btn-dark')}>
        {id === 'free' ? m.pricing.startFree : m.pricing.startTrial}
      </a>
      <Points items={text.features} dark={featured} className="mt-7" />
    </article>
  );
}

export function PricingPage() {
  const { user, liveSources, trialDays, m, locale, lp, aiConfigured, aiIsMock } = useUi();
  const aiReal = aiConfigured && !aiIsMock;
  const t = m.pricing;
  const days = plural(locale, m.units.days, trialDays);
  const ent = m.plans.enterprise;
  return (
    <PublicLayout>
      <NightHero eyebrow={t.eyebrow} title={t.title} lead={t.lead}>
        <p className="mt-6 inline-flex items-center gap-2 text-[15px] text-white/70">
          <LuCheck className="size-4 text-signal" aria-hidden /> {fill(t.trial, { days })}
        </p>
      </NightHero>
      <section className="relative bg-cream pb-20">
        <Wrap className="relative -top-10">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {CARD_PLANS.map((id) => (
              <PlanCard key={id} id={id} />
            ))}
          </div>
          {aiReal ? null : (
            <p className="mt-4 flex items-start gap-2 rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14px] leading-relaxed text-ink">
              <LuSparkles className="mt-0.5 size-4 shrink-0 text-navy-600" aria-hidden />
              {t.aiNote}
            </p>
          )}
          <article id="enterprise" className="night mt-4 grid scroll-mt-24 grid-cols-1 gap-8 rounded-3xl p-7 text-white sm:p-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] lg:items-center">
            <div>
              <Kicker dark>{ent.name}</Kicker>
              <h2 className="mt-3 text-[26px] font-[760] leading-tight tracking-[-0.025em] text-white">{m.features.enterpriseTitle}</h2>
              <p className="mt-2 text-[15px] text-white/65">{ent.tagline}</p>
            </div>
            <Points items={ent.features} dark />
            <div className="lg:text-right">
              <p className="text-[14px] text-white/60">{t.enterpriseFrom}</p>
              <p className="flex items-baseline gap-1.5 lg:justify-end">
                <span className="text-[44px] font-[800] leading-none tracking-[-0.04em]">{int(locale, PLANS.enterprise.priceNok ?? 0)}</span>
                <span className="text-[15px] font-semibold text-white/80">{t.perMonth}</span>
              </p>
              <p className="mt-1 text-[12.5px] text-white/50">{t.exVat}</p>
              <a href={lp('/kontakt')} className="btn-signal mt-5">
                {t.contactUs}
              </a>
            </div>
          </article>
        </Wrap>
      </section>
      <section className="bg-surface py-20 sm:py-24">
        <Wrap>
          <div className="reveal">
            <Kicker>{t.compareEyebrow}</Kicker>
            <H2 className="mt-4">{t.compareTitle}</H2>
          </div>
          <p className="mt-6 text-[13px] text-muted md:hidden">{t.swipe}</p>
          <div className="scroll-x mt-4 overflow-hidden rounded-3xl border border-line bg-surface md:mt-10">
            <table className="w-full min-w-[820px] text-[14px]">
              <thead>
                <tr className="border-b border-line bg-cream text-left">
                  <th className="sticky left-0 z-10 bg-cream px-5 py-4 font-semibold text-strong">{t.feature}</th>
                  {COMPARE.map((id) => (
                    <th key={id} className={cn('px-4 py-4 text-center font-semibold', id === 'professional' ? 'bg-night text-white' : 'text-strong')}>
                      {m.plans[id].name}
                      <span className={cn('num block text-[12px] font-normal', id === 'professional' ? 'text-white/60' : 'text-muted')}>
                        {PLANS[id].priceNok ? fill(t.priceMonthly, { price: int(locale, PLANS[id].priceNok!) }) : t.priceFree}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX.map(([key, fn]) => (
                  <tr key={key} className="border-b border-line last:border-0">
                    <td className="sticky left-0 z-10 max-w-[11rem] bg-surface px-5 py-3.5 text-ink shadow-[1px_0_0_var(--color-line)] sm:max-w-none">{t.matrix[key]}</td>
                    {COMPARE.map((id) => (
                      <td key={id} className={cn('num px-4 py-3.5 text-center text-strong', id === 'professional' && 'bg-signal/[0.07] font-semibold')}>
                        {fn(PLANS[id].entitlements, m, locale)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Wrap>
      </section>
      <section className="border-t border-line bg-cream py-20 sm:py-24">
        <Wrap className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="reveal">
            <Kicker>{t.faqEyebrow}</Kicker>
            <H2 className="mt-4">{t.faqTitle}</H2>
            <p className="mt-4 text-[17px] text-muted">{rich(t.faqLead, { contact: <a href={lp('/kontakt')}>{t.contactUs}</a> })}</p>
          </div>
          <FaqList items={[...faqItems(m, { days, sources: sourcesText(m, liveSources, true) }), ...(aiReal ? [[m.faq.ai.q, m.faq.ai.a] as [string, string]] : [])]} />
        </Wrap>
      </section>
      <SignalCta
        title={fill(t.ctaTitle, { days })}
        lead={t.ctaLead}
        primary={user ? { href: '/app', label: m.nav.toApp } : { href: lp('/registrer'), label: m.nav.start }}
        secondary={{ href: lp('/funksjoner'), label: t.ctaFeatures }}
      />
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
// Bransjer
// ---------------------------------------------------------------------------
export function IndustriesPage({ counts, regions }: { counts: Record<string, number>; regions: MarketSnapshot['regions'] }) {
  const { user, m, lp, locale } = useUi();
  const t = m.industries;
  const all = INDUSTRIES.map((i) => ({ id: i.id, name: i.name, n: counts[i.id] ?? 0 })).sort((a, b) => b.n - a.n);
  return (
    <PublicLayout>
      <NightHero eyebrow={t.eyebrow} title={t.title} lead={t.lead} />
      <section className="bg-cream py-20 sm:py-24">
        <Wrap>
          <IndustryTiles industries={all} />
        </Wrap>
      </section>
      {/* Fylkessidene finnes bare på norsk. */}
      {locale === 'nb' ? (
        <section className="bg-surface py-16 sm:py-20">
          <Wrap>
            <H2>Anbud per fylke</H2>
            <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-muted">Se åpne anbud der dere holder til – fordelt på bransjer, med frister og oppdragsgivere.</p>
            <CountyGrid regions={regions} />
          </Wrap>
        </section>
      ) : null}
      <SignalCta
        title={t.ctaTitle}
        lead={t.ctaLead}
        primary={user ? { href: '/app', label: m.nav.toApp } : { href: lp('/registrer'), label: m.nav.start }}
      />
    </PublicLayout>
  );
}

/** Registrering som sender brukeren videre med bransje og fylke ferdig utfylt i profilen. */
export function signupWith(lp: (href: string) => string, next: string): string {
  return lp(`/registrer?neste=${encodeURIComponent(next)}`);
}

/** Alle 15 fylker med antall åpne anbud, som lenker til fylkessidene (bare norsk). */
export function CountyGrid({ regions }: { regions: MarketSnapshot['regions'] }) {
  return (
    <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {regions.map((r) => (
        <li key={r.code}>
          <a
            href={regionPath(r.code)}
            className="card-lift group flex items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-strong no-underline sm:p-5"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-night text-signal">
              <LuMapPin className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-semibold">{r.name}</span>
              <span className="block text-[14px] text-muted">{r.n === 1 ? '1 åpent anbud' : `${r.n.toLocaleString('nb-NO')} åpne anbud`}</span>
            </span>
            <LuArrowRight className="size-5 shrink-0 text-muted transition-transform group-hover:translate-x-1 group-hover:text-strong" aria-hidden />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Liste over åpne anbud med frist, oppdragsgiver og sted (bransje- og fylkessidene). */
export function TenderRows({ rows }: { rows: (BoardRow & { estimatedValue?: number | null; currency?: string | null })[] }) {
  const { user, m, lp, locale } = useUi();
  const t = m.industries;
  return (
    <ol className="mt-5 space-y-3">
      {rows.map((r) => (
        <li key={r.id}>
          <a
            href={user ? `/app/anbud/${r.id}` : signupWith(lp, `/app/anbud/${r.id}`)}
            className="card-lift group grid grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-strong no-underline sm:grid-cols-[4.25rem_minmax(0,1fr)_auto] sm:p-5"
          >
            <span className="flex flex-col items-center justify-center rounded-xl bg-cream py-2 text-center">
              <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{monthShort(locale, r.deadlineAt)}</span>
              <span className="text-[22px] font-[780] leading-none">{dayOfMonth(r.deadlineAt)}</span>
              {r.deadlineTimeKnown ? <span className="mt-0.5 font-mono text-[11px] text-muted">{clockTime(locale, r.deadlineAt)}</span> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[16px] font-semibold leading-snug group-hover:underline">{r.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13.5px] text-muted">
                {r.buyerName ? <span className="truncate">{r.buyerName}</span> : null}
                {r.place ? (
                  <span className="inline-flex items-center gap-1">
                    <LuMapPin className="size-3.5" aria-hidden />
                    {r.place}
                  </span>
                ) : null}
                {r.estimatedValue ? <span>{fill(t.value, { value: money(locale, r.estimatedValue, r.currency ?? null) })}</span> : null}
              </span>
            </span>
            <span className="hidden items-center gap-1 text-[14px] font-semibold text-strong sm:inline-flex">
              {t.see} <LuArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function IndustryPage({ industryId, region, listing }: { industryId: string; region: string | null; listing: IndustryListing }) {
  const { user, m, lp, locale } = useUi();
  const t = m.industries;
  const ref = INDUSTRIES.find((i) => i.id === industryId)!;
  const name = t.names[industryId]?.name ?? ref.name;
  const Icon = INDUSTRY_ICONS[industryId] ?? LuRadar;
  const q = new URLSearchParams({ bransje: industryId, ...(region ? { fylke: region } : {}) });
  const alertHref = user ? '/app/onboarding' : signupWith(lp, `/app/onboarding?${q}`);
  const base = lp(`/bransjer/${industrySlugNb(industryId)}`);
  // Norsk: egne sider per fylke (/bransjer/renhold/trondelag). Andre språk: filter i adressen.
  const regionHref = (code: string) => (locale === 'nb' ? industryRegionPath(industryId, code) : `${base}?fylke=${code}`);
  const county = region ? REGION_BY_CODE.get(region)?.name : null;
  return (
    <PublicLayout>
      <NightHero
        eyebrow={
          <a href={lp('/bransjer')} className="text-signal no-underline hover:text-white">
            {t.back}
          </a>
        }
        title={
          <span className="flex items-center gap-4">
            <span className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-signal text-night sm:flex">
              <Icon className="size-7" aria-hidden strokeWidth={1.8} />
            </span>
            {county ? (locale === 'nb' ? `${name} i ${county}` : `${name} – ${county}`) : name}
          </span>
        }
        lead={t.names[industryId]?.description ?? ref.description}
      >
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <span className="glass inline-flex items-center gap-2.5 rounded-full px-3.5 py-2 text-[14px] text-white/90">
            <span className="live-dot" aria-hidden />
            {rich(pluralTemplate(locale, t.open, listing.open), { n: <strong className="font-semibold text-white">{int(locale, listing.open)}</strong> })}
          </span>
          <a href={alertHref} className="btn-signal">
            <LuBellRing className="size-4" aria-hidden /> {t.alert}
          </a>
        </div>
      </NightHero>
      <section className="bg-surface py-14 sm:py-20">
        <Wrap className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <nav aria-label={m.home.radar} className="flex flex-wrap gap-2">
              <a
                href={base}
                className={cn('rounded-full border px-3.5 py-1.5 text-[14px] font-semibold no-underline', !region ? 'border-strong bg-strong text-surface' : 'border-line bg-surface text-strong hover:border-strong')}
              >
                {t.allRegions}
              </a>
              {listing.regions.map((r) => (
                <a
                  key={r.code}
                  href={regionHref(r.code)}
                  className={cn(
                    'rounded-full border px-3.5 py-1.5 text-[14px] font-semibold no-underline',
                    region === r.code ? 'border-strong bg-strong text-surface' : 'border-line bg-surface text-strong hover:border-strong',
                  )}
                >
                  {r.name} <span className={cn('font-normal', region === r.code ? 'text-white/60' : 'text-muted')}>{int(locale, r.n)}</span>
                </a>
              ))}
            </nav>
            <h2 className="mt-10 text-[22px] font-[740] tracking-[-0.02em] text-strong">{t.listTitle}</h2>
            {listing.rows.length ? (
              <TenderRows rows={listing.rows} />
            ) : (
              <p className="mt-5 rounded-2xl border border-dashed border-line-strong p-6 text-[15px] text-muted">{t.none}</p>
            )}
            {county && region && locale === 'nb' ? (
              <p className="mt-8 text-[15px]">
                <a href={regionPath(region)} className="inline-flex items-center gap-1.5 font-semibold">
                  Alle offentlige anbud i {county} <LuArrowRight className="size-4" aria-hidden />
                </a>
              </p>
            ) : null}
          </div>
          <aside className="h-fit space-y-4 lg:sticky lg:top-24">
            <div className="rounded-3xl bg-cream p-6">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{t.cpvGroups}</p>
              <p className="mt-2 font-mono text-[15px] text-strong">{ref.cpvPrefixes.join(' · ')}</p>
              <p className="mt-5 text-[14px] leading-relaxed text-muted">{fill(t.keywords, { words: ref.keywords.slice(0, 8).join(', ') })}</p>
            </div>
            <div className="night rounded-3xl p-6">
              <p className="text-[18px] font-[720] leading-snug text-white">{t.ctaTitle}</p>
              <a href={alertHref} className="btn-signal mt-5 w-full">
                {t.alert}
              </a>
            </div>
            {/* Ukesbrevet er på norsk. */}
            {locale === 'nb' ? (
              <NewsletterSignup industry={industryId} region={region} sourcePath={region ? industryRegionPath(industryId, region) : `/bransjer/${industrySlugNb(industryId)}`} />
            ) : null}
          </aside>
        </Wrap>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------------------
// Om oss og kontakt
// ---------------------------------------------------------------------------
const VALUE_ICONS: IconType[] = [LuEye, LuShieldCheck, LuGauge, LuDatabase];

export function AboutPage({ company }: { company: { name: string; orgNumber: string; address: string; email: string } }) {
  const { liveSources, m, lp, user } = useUi();
  const t = m.about;
  return (
    <PublicLayout>
      <NightHero eyebrow={t.eyebrow} title={t.title} lead={t.lead} />
      <section className="bg-surface py-20 sm:py-24">
        <Wrap className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
          <div className="reveal space-y-6 text-[20px] leading-relaxed text-ink sm:text-[22px]">
            <p>{t.p1}</p>
            <p>{fill(t.p2, { sources: sourcesText(m, liveSources) })}</p>
          </div>
          <aside className="reveal delay-1 h-fit rounded-3xl bg-cream p-7">
            <h2 className="text-[17px] font-semibold text-strong">{t.companyTitle}</h2>
            {companyConfigured(company) ? (
              <>
                <p className="mt-3 text-[15px] leading-relaxed text-ink">
                  {fill(t.companyLine, { name: company.name, orgNumber: company.orgNumber })}
                  <br />
                  {company.address}
                </p>
                <a href={`mailto:${company.email}`} className="mt-4 inline-flex items-center gap-2 text-[15px] font-semibold">
                  <LuMail className="size-4" aria-hidden /> {company.email}
                </a>
              </>
            ) : (
              // Firmaopplysningene (COMPANY_*) er ikke lagt inn ennå – vis ikke plassholdere som ekte opplysninger.
              <a href={lp('/kontakt')} className="btn-dark mt-5">
                <LuMail className="size-4" aria-hidden /> {m.pricing.contactUs}
              </a>
            )}
          </aside>
        </Wrap>
      </section>
      <section className="bg-cream py-20 sm:py-24">
        <Wrap>
          <H2 className="reveal">{t.valuesTitle}</H2>
          <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.values.map((v, i) => {
              const Icon = VALUE_ICONS[i] ?? LuEye;
              return (
                <li key={v.title} className={cn('reveal rounded-3xl border border-line bg-surface p-6', i === 1 && 'delay-1', i === 2 && 'delay-2', i === 3 && 'delay-3')}>
                  <span className="flex size-11 items-center justify-center rounded-xl bg-night text-signal">
                    <Icon className="size-5" aria-hidden strokeWidth={1.8} />
                  </span>
                  <h3 className="mt-5 text-[18px] font-[720] text-strong">{v.title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted">{v.text}</p>
                </li>
              );
            })}
          </ul>
        </Wrap>
      </section>
      <SignalCta title={m.features.ctaTitle} lead={m.features.ctaLead} primary={user ? { href: '/app', label: m.nav.toApp } : { href: lp('/registrer'), label: m.nav.start }} />
    </PublicLayout>
  );
}

export function ContactPage({ sent = false, errors = {}, values = {} }: { sent?: boolean; errors?: Record<string, string>; values?: Record<string, string> }) {
  const { m, lp } = useUi();
  const t = m.contact;
  return (
    <PublicLayout>
      <NightHero eyebrow={t.eyebrow} title={t.title} lead={t.lead} />
      <section className="bg-cream pb-24">
        <Wrap className="relative -top-10 max-w-2xl">
          {sent ? (
            <Alert tone="ok" title={t.thanksTitle}>
              {t.thanksText}
            </Alert>
          ) : (
            <PostForm action={lp('/kontakt')} className="space-y-4 rounded-3xl border border-line bg-surface p-6 shadow-[0_30px_70px_-45px_rgba(6,14,27,0.6)] sm:p-9">
              <div className="hidden" aria-hidden>
                <label htmlFor="website">{t.honeypot}</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>
              {t.replyLanguage ? <p className="text-[14px] text-muted">{t.replyLanguage}</p> : null}
              <Field label={t.name} htmlFor="c-name" error={errors.name}>
                <Input id="c-name" name="name" required maxLength={120} defaultValue={values.name} autoComplete="name" />
              </Field>
              <Field label={t.email} htmlFor="c-email" error={errors.email}>
                <Input id="c-email" name="email" type="email" required maxLength={254} defaultValue={values.email} autoComplete="email" />
              </Field>
              <Field label={t.message} htmlFor="c-msg" error={errors.message}>
                <Textarea id="c-msg" name="message" rows={6} required maxLength={5000} defaultValue={values.message} />
              </Field>
              <p className="text-[13px] text-muted">{rich(t.privacy, { link: <a href="/personvern">{t.privacyLink}</a> })}</p>
              <Button type="submit" size="lg">
                {t.send}
              </Button>
            </PostForm>
          )}
        </Wrap>
      </section>
    </PublicLayout>
  );
}
