/**
 * Forsiden: «Ikke bare finn anbudet. Finn ut om det er verdt å vinne.»
 *
 * Mørk topp med radaren over Norge (åpne anbud per fylke akkurat nå) og de nyeste ekte anbudene; hvorfor
 * AnbudRadar (sju fordeler, med planen hver finnes i); kundereisen i seks steg vist med ekte, offentlige data;
 * forskjellen fra søk og varsling; hva kunden får og ikke får; bransjer med ekte antall; avslutning.
 * Ingen oppdiktede kunder, omtaler, tall eller skjermbilder. AI nevnes bare når ekte AI er slått på.
 */
import type { ReactNode } from 'react';
import { LuArrowRight, LuCalculator, LuCalendarRange, LuChartColumn, LuCheck, LuGauge, LuGraduationCap, LuMinus, LuScale, LuShieldAlert, LuTarget } from 'react-icons/lu';
import { cheapestPlanWith, PAID_PLANS, PLANS, type Entitlements } from '@/domain/billing/plans';
import type { MarketSnapshot } from '@/domain/tenders/market';
import type { Showcase } from '@/domain/tenders/showcase';
import type { Locale } from '@/i18n';
import { sourcesText } from '@/i18n';
import { clockTime, fill, int, osloDay, plural, pluralTemplate, rich, weekdayShort } from '@/i18n/format';
import { useUi } from '../context';
import { cn } from '../components';
import { PublicLayout } from '../layouts';
import { BuyerTicker, FinalCta, H2, IndustryTiles, Kicker, Radar, TenderPing, Wrap } from '../site';
import { JOURNEY_VISUALS } from '../showcase';
import { FaqList, faqItems } from '../marketing';

/** Fristen kort: «I dag 12.00», «I morgen», «fre. 07.11» (brukes også i eksempelkunngjøringen). */
export function boardWhen(
  deadline: Date,
  timeKnown: boolean,
  now = new Date(),
  locale: Locale = 'nb',
  words = { today: 'I dag', tomorrow: 'I morgen' },
): { day: string; time: string | null } {
  const d = osloDay(deadline);
  const day = d === osloDay(now) ? words.today : d === osloDay(new Date(now.getTime() + 86_400_000)) ? words.tomorrow : weekdayShort(locale, deadline);
  return { day, time: timeKnown ? clockTime(locale, deadline) : null };
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[12px] font-medium uppercase tracking-[0.12em]', className)}>{children}</span>;
}

// ---------------------------------------------------------------------------
/** De tre budskapene øverst – hvert lenker til samme del av det ekte eksempelet (/eksempel). */
const PILLAR_ICONS = [LuTarget, LuShieldAlert, LuCalculator];
const PILLAR_ANCHORS = ['passer', 'risiko', 'lonnsomhet'];

function Hero({ market }: { market: MarketSnapshot }) {
  const { user, m, locale, lp, trialDays, liveSources } = useUi();
  const t = m.home;
  return (
    <section className="night relative overflow-hidden">
      <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_70%_40%,#000_20%,transparent_70%)]" aria-hidden />
      <Wrap className="relative grid grid-cols-1 items-center gap-14 pb-20 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:pb-24 lg:pt-14">
        <div className="min-w-0">
          {market.open > 0 ? (
            <p className="glass slide-in inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium text-white/90">
              <span className="live-dot" aria-hidden />
              {rich(pluralTemplate(locale, t.live, market.open), { n: <strong className="font-semibold text-white">{int(locale, market.open)}</strong> })}
            </p>
          ) : null}
          <h1 className="mt-6 text-[40px] font-[800] leading-[1.02] tracking-[-0.04em] text-white sm:text-[56px] lg:text-[60px]">
            <span className="block">{t.title1}</span>
            <span className="text-gradient-signal block pb-1">{t.title2}</span>
          </h1>
          <p className="mt-6 max-w-[36rem] text-[18px] leading-relaxed text-white/70 sm:text-[19px]">{fill(t.lead, { sources: sourcesText(m, liveSources) })}</p>
          <ul className="mt-7 max-w-[36rem] space-y-3">
            {t.pillars.map((p, i) => {
              const Icon = PILLAR_ICONS[i]!;
              return (
                <li key={p.title}>
                  <a href={`/eksempel#${PILLAR_ANCHORS[i]}`} className="group flex items-start gap-3 no-underline">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-signal">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[16.5px] font-semibold leading-snug text-white group-hover:underline">{p.title}</span>
                      <span className="mt-0.5 block text-[14.5px] leading-snug text-white/60">{p.text}</span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={user ? '/app' : lp('/registrer')} className="btn-signal">
              {user ? m.nav.toApp : m.nav.start} <LuArrowRight className="size-4" aria-hidden />
            </a>
            <a href={lp('/eksempel')} className="btn-ghost-light">
              {t.example}
            </a>
          </div>
          {user ? null : (
            <p className="mt-5 flex items-center gap-2 text-[14px] text-white/55">
              <LuCheck className="size-4 shrink-0 text-signal" aria-hidden />
              {fill(t.note, { days: plural(locale, m.units.days, trialDays) })}
            </p>
          )}
        </div>
        <div className="relative mx-auto w-full max-w-[540px] lg:mr-0">
          <Radar regions={market.regions} className="mx-auto w-full max-w-[340px] sm:max-w-none" />
          {market.latest.length ? (
            <div className="relative mt-6 space-y-3 sm:px-8 lg:absolute lg:-bottom-8 lg:-right-10 lg:mt-0 lg:w-[290px] lg:px-0">
              {market.latest.map((row, i) => (
                <TenderPing key={row.id} t={row} delay={350 + i * 260} className={cn(i === 1 && 'lg:-translate-x-6', i === 2 && 'lg:-translate-x-2')} />
              ))}
            </div>
          ) : null}
        </div>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Hvorfor AnbudRadar: sju fordeler, med planen hver finnes i (regnes ut fra planene, så teksten alltid stemmer).
// ---------------------------------------------------------------------------
type BoolFeature = { [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never }[keyof Entitlements];
// Samme rekkefølge som fordelene i tekstene: det som skiller AnbudRadar ut først.
const WHY_ICONS = [LuGauge, LuCalculator, LuScale, LuShieldAlert, LuCalendarRange, LuGraduationCap, LuTarget, LuChartColumn];
const WHY_FEATURES: (BoolFeature | null)[] = [null, 'profitCalculator', 'profitCalculator', null, 'profitCalculator', null, 'matching', 'competitorIntel'];

function Why() {
  const { m, lp } = useUi();
  const t = m.home.why;
  const included = (f: BoolFeature | null) => {
    const plan = f ? cheapestPlanWith(f) : 'free';
    return fill(t.included, { plans: !plan || plan === 'free' ? t.allPlans : fill(t.andUp, { plan: m.plans[plan].name }) });
  };
  return (
    <section className="bg-surface py-24 sm:py-32">
      <Wrap>
        <div className="reveal max-w-3xl">
          <Kicker>{t.eyebrow}</Kicker>
          <H2 className="mt-4">{t.title}</H2>
          <p className="mt-5 text-[18px] leading-relaxed text-muted">{t.lead}</p>
        </div>
        <ul className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {t.items.map((item, i) => {
            const Icon = WHY_ICONS[i]!;
            return (
              <li key={item.title} className={cn('reveal flex flex-col rounded-3xl border border-line bg-cream p-6', i % 4 === 1 && 'delay-1', i % 4 === 2 && 'delay-2', i % 4 === 3 && 'delay-3')}>
                <span className="flex size-11 items-center justify-center rounded-2xl bg-night text-signal">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 text-[19px] font-[740] leading-tight tracking-[-0.015em] text-strong">{item.title}</h3>
                <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted">{item.text}</p>
                <p className="mt-5 text-[12.5px] font-semibold text-navy-700">{included(WHY_FEATURES[i] ?? null)}</p>
              </li>
            );
          })}
          <li className="reveal delay-3 flex flex-col justify-between rounded-3xl bg-night p-6 text-white">
            <p className="text-[15px] leading-relaxed text-white/70">{t.moreText}</p>
            <a href={lp('/funksjoner')} className="mt-6 inline-flex items-center gap-2 text-[16px] font-semibold text-signal no-underline hover:text-white">
              {t.more} <LuArrowRight className="size-4" aria-hidden />
            </a>
          </li>
        </ul>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Kundereisen i seks steg – med ekte data (src/ui/showcase.tsx).
// ---------------------------------------------------------------------------
function Journey({ showcase }: { showcase: Showcase | null }) {
  const { m } = useUi();
  const t = m.home.journey;
  return (
    <section id="slik" className="scroll-mt-16 bg-cream py-24 sm:py-32">
      <Wrap>
        <div className="reveal max-w-3xl">
          <Kicker>{t.eyebrow}</Kicker>
          <H2 className="mt-4">{t.title}</H2>
          {showcase ? <p className="mt-5 text-[18px] leading-relaxed text-muted">{t.lead}</p> : null}
        </div>
        <ol className="reveal mt-10 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" aria-label={t.eyebrow}>
          {t.steps.map((s, i) => (
            <li key={s.title} className="flex">
              <a href={`#steg-${i + 1}`} className="flex min-h-11 flex-1 items-center gap-2 rounded-2xl border border-line-strong bg-surface px-3 py-2 text-[13.5px] font-semibold leading-snug text-strong no-underline hover:border-strong">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-night font-mono text-[11.5px] text-signal">{i + 1}</span>
                <span className="min-w-0">{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
        <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {t.steps.map((s, i) => {
            const Visual = JOURNEY_VISUALS[i]!;
            return (
              <article id={`steg-${i + 1}`} key={s.title} className="reveal flex scroll-mt-24 flex-col rounded-3xl border border-line bg-surface p-5 sm:p-7">
                <div className="flex items-start gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-night font-mono text-[14px] font-medium text-signal">{i + 1}</span>
                  <div className="min-w-0">
                    <h3 className="text-[21px] font-[740] leading-tight tracking-[-0.02em] text-strong">{s.title}</h3>
                    <p className="mt-1.5 text-[15.5px] leading-relaxed text-muted">{s.text}</p>
                  </div>
                </div>
                {showcase ? <div className="mt-6">{<Visual s={showcase} />}</div> : null}
              </article>
            );
          })}
        </div>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Forskjellen fra søk og varsling – bare funksjoner vi har. Sier ingenting om andre tjenester.
// ---------------------------------------------------------------------------
const SEARCH_HAS = 2; // De to første radene er det søk og varsling som funksjon dekker.

function Compare() {
  const { m } = useUi();
  const t = m.home.compare;
  const mark = (yes: boolean) =>
    yes ? (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-ok-soft text-ok">
        <LuCheck className="size-4" strokeWidth={3} aria-hidden />
        <span className="sr-only">{t.yes}</span>
      </span>
    ) : (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-paper text-muted">
        <LuMinus className="size-4" aria-hidden />
        <span className="sr-only">{t.no}</span>
      </span>
    );
  return (
    <section className="bg-surface py-24 sm:py-32">
      <Wrap>
        <div className="reveal max-w-3xl">
          <Kicker>{t.eyebrow}</Kicker>
          <H2 className="mt-4">{t.title}</H2>
          <p className="mt-5 text-[18px] leading-relaxed text-muted">{t.lead}</p>
        </div>
        <div className="reveal mt-12 overflow-hidden rounded-3xl border border-line">
          <table className="w-full border-collapse text-left [font-variant-numeric:normal]">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-4 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted sm:px-6">
                  <span className="sr-only">{t.eyebrow}</span>
                </th>
                <th scope="col" className="w-[24%] px-2 py-4 text-center text-[13px] font-semibold text-muted sm:w-[20%] sm:text-[14px]">
                  {t.colSearch}
                </th>
                <th scope="col" className="night w-[24%] px-2 py-4 text-center text-[13px] font-semibold text-white sm:w-[20%] sm:text-[14px]">
                  {t.colUs}
                </th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, i) => (
                <tr key={row} className="border-b border-line last:border-b-0">
                  <th scope="row" className="px-4 py-3.5 text-[14.5px] font-medium leading-snug text-ink sm:px-6 sm:text-[15.5px]">
                    {row}
                  </th>
                  <td className="px-2 py-3.5 text-center">{mark(i < SEARCH_HAS)}</td>
                  <td className="bg-navy-50/60 px-2 py-3.5 text-center">{mark(true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-muted">{t.note}</p>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Åpenhet: hva kunden får, og hva vi ikke gjør (ennå). AI-linjen vises så lenge ekte AI ikke er slått på.
// ---------------------------------------------------------------------------
function Openness() {
  const { m, locale, lp, trialDays, liveSources, aiConfigured, aiIsMock } = useUi();
  const t = m.home.open;
  const days = plural(locale, m.units.days, trialDays);
  const notItems = [...t.notItems, ...(t.notApp ? [t.notApp] : []), ...(aiConfigured && !aiIsMock ? [] : [t.notAi])];
  return (
    <section className="night relative overflow-hidden py-24 sm:py-32">
      <div className="dot-grid absolute inset-0 opacity-40" aria-hidden />
      <Wrap className="relative">
        <div className="reveal max-w-3xl">
          <Kicker dark>{t.eyebrow}</Kicker>
          <H2 dark className="mt-4">
            {t.title}
          </H2>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="reveal glass rounded-3xl p-6 sm:p-8">
            <h3 className="text-[18px] font-[720] text-white">{t.get}</h3>
            <ul className="mt-5 space-y-4">
              {t.getItems.map((x) => (
                <li key={x} className="flex items-start gap-3 text-[15.5px] leading-relaxed text-white/85">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
                    <LuCheck className="size-3.5" strokeWidth={3} aria-hidden />
                  </span>
                  {fill(x, { sources: sourcesText(m, liveSources), days })}
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal delay-1 rounded-3xl border border-white/10 p-6 sm:p-8">
            <h3 className="text-[18px] font-[720] text-white">{t.not}</h3>
            <ul className="mt-5 space-y-4">
              {notItems.map((x) => (
                <li key={x} className="flex items-start gap-3 text-[15.5px] leading-relaxed text-white/70">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60">
                    <LuMinus className="size-3.5" aria-hidden />
                  </span>
                  {x}
                </li>
              ))}
            </ul>
            <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
              <a href={lp('/underleverandorer')} className="inline-flex min-h-6 items-center gap-1 font-semibold text-signal no-underline hover:text-white">
                {t.links} <LuArrowRight className="size-3.5" aria-hidden />
              </a>
              <a href={lp('/personvern')} className="inline-flex min-h-6 items-center gap-1 font-semibold text-signal no-underline hover:text-white">
                {t.privacy} <LuArrowRight className="size-3.5" aria-hidden />
              </a>
            </p>
          </div>
        </div>
      </Wrap>
    </section>
  );
}

function Industries({ market }: { market: MarketSnapshot }) {
  const { m, lp } = useUi();
  const t = m.home.industries;
  if (!market.industries.length) return null;
  return (
    <section className="bg-cream py-24 sm:py-32">
      <Wrap>
        <div className="reveal flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <Kicker>{t.eyebrow}</Kicker>
            <H2 className="mt-4">{t.title}</H2>
            <p className="mt-4 text-[18px] text-muted">{t.lead}</p>
          </div>
          <a href={lp('/bransjer')} className="btn-outline-dark">
            {t.all} <LuArrowRight className="size-4" aria-hidden />
          </a>
        </div>
        <div className="mt-12">
          <IndustryTiles industries={market.industries} limit={9} />
        </div>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Spørsmål og svar – de samme som på prissiden (og i strukturerte data, se routes/public.tsx).
// ---------------------------------------------------------------------------
function HomeFaq() {
  const { m, lp, locale, trialDays, liveSources, aiConfigured, aiIsMock, paymentsOpen } = useUi();
  const t = m.pricing;
  const items = faqItems(m, { days: plural(locale, m.units.days, trialDays), sources: sourcesText(m, liveSources, true), aiReal: aiConfigured && !aiIsMock, paymentsOpen });
  return (
    <section className="border-t border-line bg-surface py-20 sm:py-24">
      <Wrap className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="reveal">
          <Kicker>{t.faqEyebrow}</Kicker>
          <H2 className="mt-4">{t.faqTitle}</H2>
          <p className="mt-4 text-[17px] text-muted">{rich(t.faqLead, { contact: <a href={lp('/kontakt')}>{t.contactUs}</a> })}</p>
        </div>
        <FaqList items={items} />
      </Wrap>
    </section>
  );
}

export function HomePage({ market, showcase }: { market: MarketSnapshot; showcase: Showcase | null }) {
  const from = Math.min(...PAID_PLANS.map((p) => PLANS[p].priceNok ?? Number.POSITIVE_INFINITY));
  return (
    <PublicLayout>
      <Hero market={market} />
      <BuyerTicker buyers={market.topBuyers} />
      <Why />
      <Journey showcase={showcase} />
      <Compare />
      <Openness />
      <Industries market={market} />
      <HomeFaq />
      <FinalCta next={market.board[0]?.deadlineAt ?? null} now={market.at} fromPrice={from} />
    </PublicLayout>
  );
}
