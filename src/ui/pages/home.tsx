/**
 * Forsiden: «Ikke bare finn anbudet. Finn ut om det er verdt å vinne.»
 *
 * Enkel å forstå (docs/SPRAK.md): toppen med én kort setning, tre punkter og radaren over Norge (åpne anbud per fylke
 * akkurat nå); «Prøv uten konto»; slik fungerer det (seks steg – eksemplene med ekte data bak «Vis mer»); hva kunden
 * får og ikke får; bransjer; spørsmål og svar; avslutning. Fordelene i detalj og sammenligningen står på Funksjoner.
 * Ingen oppdiktede kunder, omtaler, tall eller skjermbilder. AI nevnes bare når ekte AI er slått på.
 */
import type { ReactNode } from 'react';
import { LuArrowRight, LuCalculator, LuCheck, LuMinus, LuShieldAlert, LuTarget } from 'react-icons/lu';
import { industrySlugNb } from '@/domain/slugs';
import { PAID_PLANS, PLANS } from '@/domain/billing/plans';
import type { MarketSnapshot } from '@/domain/tenders/market';
import type { Showcase } from '@/domain/tenders/showcase';
import type { Locale } from '@/i18n';
import { sourcesText } from '@/i18n';
import { clockTime, fill, int, osloDay, plural, pluralTemplate, rich, weekdayShort } from '@/i18n/format';
import { useUi } from '../context';
import { cn } from '../components';
import { PublicLayout } from '../layouts';
import { FinalCta, H2, More, Radar, TenderPing, Wrap } from '../site';
import { JOURNEY_VISUALS } from '../showcase';
import { FaqList, faqItems } from '../marketing';
import { TryBand } from './tools';

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
/**
 * De tre punktene øverst. Hvert lenker dit besøkende kan prøve det selv: rangerte anbud for egen bransje (#prov),
 * krav og risiko i det ekte eksempelet, og lønnsomhetssjekken. Uten verktøyene: samme del av eksempelet.
 */
const PILLAR_ICONS = [LuTarget, LuShieldAlert, LuCalculator];
const pillarLinks = (tools: boolean) => [tools ? '#prov' : '/eksempel#passer', '/eksempel#risiko', tools ? '/kalkulator' : '/eksempel#lonnsomhet'];

function Hero({ market }: { market: MarketSnapshot }) {
  const { user, m, locale, lp, trialDays, liveSources, publicTools } = useUi();
  const t = m.home;
  const links = pillarLinks(publicTools);
  return (
    <section className="night relative overflow-hidden">
      <div className="dot-grid absolute inset-0 opacity-50 [mask-image:radial-gradient(ellipse_at_70%_40%,#000_20%,transparent_70%)]" aria-hidden />
      <Wrap className="relative grid grid-cols-1 items-center gap-12 pb-16 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:pb-24 lg:pt-14">
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
          <p className="mt-5 max-w-[34rem] text-[18px] leading-relaxed text-white/75 sm:text-[19px]">{fill(t.lead, { sources: sourcesText(m, liveSources) })}</p>
          <ul className="mt-6 space-y-2.5">
            {t.pillars.map((title, i) => {
              const Icon = PILLAR_ICONS[i]!;
              return (
                <li key={title}>
                  <a href={links[i]} className="group inline-flex min-h-9 items-center gap-3 no-underline">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-signal">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="text-[16.5px] font-semibold leading-snug text-white group-hover:underline">{title}</span>
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
          <Radar regions={market.regions} className="mx-auto w-full max-w-[280px] sm:max-w-none" />
          {market.latest.length ? (
            <div className="relative mt-6 space-y-3 sm:px-8 lg:absolute lg:-bottom-8 lg:-right-10 lg:mt-0 lg:w-[290px] lg:px-0">
              {market.latest.map((row, i) => (
                // På mobil vises bare det nyeste anbudet – resten står på bransjesidene.
                <div key={row.id} className={cn(i > 0 && 'hidden sm:block')}>
                  <TenderPing t={row} delay={350 + i * 260} className={cn(i === 1 && 'lg:-translate-x-6', i === 2 && 'lg:-translate-x-2')} />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Slik fungerer det: seks korte steg. Eksemplene med ekte data (src/ui/showcase.tsx) ligger bak «Vis mer».
// ---------------------------------------------------------------------------
function Journey({ showcase }: { showcase: Showcase | null }) {
  const { m } = useUi();
  const t = m.home.journey;
  return (
    <section id="slik" className="scroll-mt-16 bg-cream py-16 sm:py-24">
      <Wrap>
        <H2>{t.title}</H2>
        <ol className="mt-8 grid grid-cols-2 gap-2 lg:grid-cols-3" aria-label={t.title}>
          {t.steps.map((s, i) => (
            <li key={s.title} className="flex">
              <a href={`#steg-${i + 1}`} className="flex min-h-11 flex-1 items-center gap-2.5 rounded-2xl border border-line-strong bg-surface px-3 py-2.5 text-[14.5px] font-semibold leading-snug text-strong no-underline hover:border-strong sm:text-[15.5px]">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-night font-mono text-[12px] text-signal">{i + 1}</span>
                <span className="min-w-0">{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
        <More label={showcase ? t.examples : t.details} className="mt-5">
          {showcase ? <p className="max-w-3xl text-[16px] leading-relaxed text-muted">{t.lead}</p> : null}
          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {t.steps.map((s, i) => {
              const Visual = JOURNEY_VISUALS[i]!;
              return (
                <article id={`steg-${i + 1}`} key={s.title} className="flex scroll-mt-24 flex-col rounded-3xl border border-line bg-surface p-5 sm:p-7">
                  <div className="flex items-start gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-night font-mono text-[14px] font-medium text-signal">{i + 1}</span>
                    <div className="min-w-0">
                      <h3 className="text-[20px] font-[740] leading-tight tracking-[-0.02em] text-strong">{s.title}</h3>
                      <p className="mt-1.5 text-[15.5px] leading-relaxed text-muted">{s.text}</p>
                    </div>
                  </div>
                  {showcase ? <div className="mt-6">{<Visual s={showcase} />}</div> : null}
                </article>
              );
            })}
          </div>
        </More>
      </Wrap>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Åpenhet: hva kunden får, og hva vi ikke gjør (ennå) bak «Vis mer». AI-linjen er med så lenge ekte AI ikke er slått på.
// ---------------------------------------------------------------------------
function Openness() {
  const { m, locale, lp, trialDays, liveSources, aiConfigured, aiIsMock } = useUi();
  const t = m.home.open;
  const days = plural(locale, m.units.days, trialDays);
  const notItems = [...t.notItems, ...(t.notApp ? [t.notApp] : []), ...(aiConfigured && !aiIsMock ? [] : [t.notAi])];
  return (
    <section className="night relative overflow-hidden py-16 sm:py-24">
      <div className="dot-grid absolute inset-0 opacity-40" aria-hidden />
      <Wrap className="relative">
        <H2 dark>{t.title}</H2>
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {t.getItems.map((x) => (
            <li key={x} className="flex items-start gap-3 text-[16px] leading-relaxed text-white/85">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-signal/15 text-signal">
                <LuCheck className="size-3.5" strokeWidth={3} aria-hidden />
              </span>
              {fill(x, { sources: sourcesText(m, liveSources), days })}
            </li>
          ))}
        </ul>
        <More dark label={t.not} className="mt-6">
          <ul className="space-y-3">
            {notItems.map((x) => (
              <li key={x} className="flex items-start gap-3 text-[15.5px] leading-relaxed text-white/70">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/60">
                  <LuMinus className="size-3.5" aria-hidden />
                </span>
                {x}
              </li>
            ))}
          </ul>
          <p className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
            <a href={lp('/underleverandorer')} className="inline-flex min-h-6 items-center gap-1 font-semibold text-signal no-underline hover:text-white">
              {t.links} <LuArrowRight className="size-3.5" aria-hidden />
            </a>
            <a href={lp('/personvern')} className="inline-flex min-h-6 items-center gap-1 font-semibold text-signal no-underline hover:text-white">
              {t.privacy} <LuArrowRight className="size-3.5" aria-hidden />
            </a>
          </p>
        </More>
      </Wrap>
    </section>
  );
}

/** Bransjene som små knapper med antall åpne anbud – flere på Bransjer. */
function Industries({ market }: { market: MarketSnapshot }) {
  const { m, lp, locale } = useUi();
  const t = m.home.industries;
  if (!market.industries.length) return null;
  return (
    <section className="bg-cream py-16 sm:py-24">
      <Wrap>
        <H2>{t.title}</H2>
        <ul className="mt-8 flex flex-wrap gap-2">
          {market.industries.slice(0, 9).map((i) => (
            <li key={i.id}>
              <a
                href={lp(`/bransjer/${industrySlugNb(i.id)}`)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2 text-[15px] font-semibold text-strong no-underline hover:border-strong"
                aria-label={`${m.industries.names[i.id]?.name ?? i.name}: ${plural(locale, t.open, i.n)}`}
              >
                {m.industries.names[i.id]?.name ?? i.name}
                <span className="num rounded-full bg-strong/5 px-2 py-0.5 text-[13px] font-semibold text-muted">{int(locale, i.n)}</span>
              </a>
            </li>
          ))}
          <li>
            <a href={lp('/bransjer')} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2 text-[15px] font-semibold">
              {t.all} <LuArrowRight className="size-4" aria-hidden />
            </a>
          </li>
        </ul>
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
    <section className="border-t border-line bg-surface py-16 sm:py-24">
      <Wrap className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <H2>{t.faqTitle}</H2>
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
      <TryBand />
      <Journey showcase={showcase} />
      <Openness />
      <Industries market={market} />
      <HomeFaq />
      <FinalCta next={market.board[0]?.deadlineAt ?? null} now={market.at} fromPrice={from} />
    </PublicLayout>
  );
}
