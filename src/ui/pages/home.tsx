/**
 * Forsiden. Mørk topp med en radar over Norge der punktene er åpne anbud per fylke akkurat nå,
 * og kort med de nyeste ekte anbudene. Deretter oppdragsgivere med åpne anbud (ekte), tre steg og
 * et vindu fra appen (merket «Eksempel»), bransjer med ekte antall og en avslutning med neste frist.
 * Ingen oppdiktede kunder, omtaler eller tall.
 */
import type { ReactNode } from 'react';
import { LuArrowRight, LuCheck } from 'react-icons/lu';
import { PAID_PLANS, PLANS } from '@/domain/billing/plans';
import type { MarketSnapshot } from '@/domain/tenders/market';
import type { Locale } from '@/i18n';
import { sourcesText } from '@/i18n';
import { clockTime, fill, int, osloDay, plural, pluralTemplate, rich, weekdayShort } from '@/i18n/format';
import { useUi } from '../context';
import { cn } from '../components';
import { PublicLayout } from '../layouts';
import { AnalysisMock, BuyerTicker, ExampleTag, FinalCta, H2, IndustryTiles, Kicker, MatchVisual, ProfileVisual, Radar, ReminderVisual, TenderPing, Wrap } from '../site';

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
function Hero({ market }: { market: MarketSnapshot }) {
  const { user, m, locale, lp, trialDays, liveSources } = useUi();
  const t = m.home;
  return (
    <section className="night relative overflow-hidden">
      <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_70%_40%,#000_20%,transparent_70%)]" aria-hidden />
      <Wrap className="relative grid grid-cols-1 items-center gap-14 pb-20 pt-14 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10 lg:pb-28 lg:pt-24">
        <div className="min-w-0">
          {market.open > 0 ? (
            <p className="glass slide-in inline-flex items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium text-white/90">
              <span className="live-dot" aria-hidden />
              {rich(pluralTemplate(locale, t.live, market.open), { n: <strong className="font-semibold text-white">{int(locale, market.open)}</strong> })}
            </p>
          ) : null}
          <h1 className="mt-7 text-[44px] font-[800] leading-[0.98] tracking-[-0.04em] text-white sm:text-[64px] lg:text-[76px]">
            <span className="block">{t.title1}</span>
            <span className="text-gradient-signal block pb-1">{t.title2}</span>
          </h1>
          <p className="mt-7 max-w-[34rem] text-[18px] leading-relaxed text-white/70 sm:text-[19px]">{fill(t.lead, { sources: sourcesText(m, liveSources) })}</p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a href={user ? '/app' : lp('/registrer')} className="btn-signal">
              {user ? m.nav.toApp : m.nav.start} <LuArrowRight className="size-4" aria-hidden />
            </a>
            <a href="#slik" className="btn-ghost-light">
              {t.how}
            </a>
          </div>
          {user ? null : (
            <p className="mt-5 flex items-center gap-2 text-[14px] text-white/55">
              <LuCheck className="size-4 text-signal" aria-hidden />
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

function Steps() {
  const { m } = useUi();
  const t = m.home.steps;
  const visuals = [<ProfileVisual key="p" />, <MatchVisual key="m" />, <ReminderVisual key="r" />];
  return (
    <section id="slik" className="scroll-mt-16 bg-white py-24 sm:py-32">
      <Wrap>
        <div className="reveal max-w-2xl">
          <Kicker>{t.eyebrow}</Kicker>
          <H2 className="mt-4">{t.title}</H2>
        </div>
        <ol className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {t.items.map((s, i) => (
            <li key={s.title} className={cn('reveal flex flex-col overflow-hidden rounded-3xl border border-line bg-cream', i === 1 && 'delay-1', i === 2 && 'delay-2')}>
              <div className="relative border-b border-line bg-[radial-gradient(circle_at_30%_20%,#fff,transparent_70%)] px-6 pb-6 pt-12">
                <span className="absolute right-4 top-4">
                  <ExampleTag>{t.example}</ExampleTag>
                </span>
                <div className="flex min-h-[11.5rem] flex-col justify-center">{visuals[i]}</div>
              </div>
              <div className="flex flex-1 flex-col p-6 sm:p-7">
                <span className="flex size-9 items-center justify-center rounded-full bg-night font-mono text-[14px] font-medium text-signal">{i + 1}</span>
                <h3 className="mt-4 text-[22px] font-[740] leading-tight tracking-[-0.02em] text-night">{s.title}</h3>
                <p className="mt-2 text-[16px] leading-relaxed text-muted">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Wrap>
    </section>
  );
}

function Product() {
  const { m, lp } = useUi();
  const t = m.home.product;
  return (
    <section className="night relative overflow-hidden py-24 sm:py-32">
      <Wrap className="relative grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
        <div className="reveal min-w-0">
          <Kicker dark>{t.eyebrow}</Kicker>
          <H2 dark className="mt-4">
            {t.title}
          </H2>
          <p className="mt-6 max-w-lg text-[18px] leading-relaxed text-white/70">{t.lead}</p>
          <ul className="mt-8 space-y-3.5">
            {t.points.map((x) => (
              <li key={x} className="flex items-center gap-3 text-[16px] text-white/90">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
                  <LuCheck className="size-3.5" aria-hidden strokeWidth={3} />
                </span>
                {x}
              </li>
            ))}
          </ul>
          <a href={lp('/funksjoner')} className="mt-9 inline-flex items-center gap-2 text-[16px] font-semibold text-signal no-underline hover:text-white">
            {t.more} <LuArrowRight className="size-4" aria-hidden />
          </a>
        </div>
        <div className="reveal delay-1 min-w-0">
          <div className="float-slow">
            <AnalysisMock />
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

export function HomePage({ market }: { market: MarketSnapshot }) {
  const from = Math.min(...PAID_PLANS.map((p) => PLANS[p].priceNok ?? Number.POSITIVE_INFINITY));
  return (
    <PublicLayout>
      <Hero market={market} />
      <BuyerTicker buyers={market.topBuyers} />
      <Steps />
      <Product />
      <Industries market={market} />
      <FinalCta next={market.board[0]?.deadlineAt ?? null} now={market.at} fromPrice={from} />
    </PublicLayout>
  );
}
