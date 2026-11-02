/**
 * Byggeklosser for de offentlige markedssidene (forside, funksjoner, priser, bransjer …).
 * Ren HTML/CSS/SVG – ingen bilder og ingen JavaScript. Dekor er skjult for skjermlesere.
 */
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  LuBuilding2,
  LuCheck,
  LuChevronDown,
  LuCpu,
  LuFactory,
  LuHeartPulse,
  LuLeaf,
  LuLightbulb,
  LuRadioTower,
  LuShield,
  LuShieldCheck,
  LuSprayCan,
  LuTruck,
  LuWrench,
  LuZap,
} from 'react-icons/lu';
import { PAID_PLANS, PLANS } from '@/domain/billing/plans';
import { buttonVariants, cn } from './components';

export const INDUSTRY_ICONS: Record<string, IconType> = {
  construction: LuBuilding2,
  it: LuCpu,
  cybersecurity: LuShieldCheck,
  healthcare: LuHeartPulse,
  cleaning: LuSprayCan,
  security: LuShield,
  transport: LuTruck,
  consulting: LuLightbulb,
  energy: LuZap,
  environmental: LuLeaf,
  manufacturing: LuFactory,
  maintenance: LuWrench,
  telecom: LuRadioTower,
};

export function IconChip({ icon: Icon, className }: { icon: IconType; className?: string }) {
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy-50 text-navy-700', className)}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}

/** Planene med pris. `maxFeatures` korter ned listen (forsiden). */
export function PlanCards({ maxFeatures, ctaHref = '/registrer' }: { maxFeatures?: number; ctaHref?: string }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {PAID_PLANS.map((id) => {
        const p = PLANS[id];
        const featured = id === 'professional';
        return (
          <section
            key={id}
            className={cn(
              'lift relative flex flex-col rounded-2xl border p-6',
              featured ? 'border-navy-900 bg-navy-950 text-white shadow-[0_30px_60px_-30px_rgba(15,35,64,0.8)]' : 'border-line bg-white',
            )}
          >
            {featured ? <span className="absolute -top-3 left-6 rounded-full bg-marker px-2.5 py-0.5 text-[12px] font-semibold text-ink">Med i prøveperioden</span> : null}
            <h3 className={cn('text-[18px] font-semibold', featured ? 'text-white' : 'text-navy-900')}>{p.name}</h3>
            <p className={cn('mt-1 text-[14px]', featured ? 'text-navy-200' : 'text-muted')}>{p.tagline}</p>
            <p className="mt-5">
              <span className={cn('num font-serif text-[44px] font-semibold leading-none', featured ? 'text-white' : 'text-navy-900')}>{p.priceNok}</span>
              <span className={cn('text-[15px]', featured ? 'text-navy-200' : 'text-muted')}> kr/mnd</span>
            </p>
            <CheckList
              dark={featured}
              className={cn('mt-6 flex-1 text-[14px]', featured ? 'text-navy-100' : 'text-ink')}
              items={maxFeatures ? p.features.slice(0, maxFeatures) : p.features}
            />
            <a href={ctaHref} className={buttonVariants({ variant: featured ? 'inverse' : 'secondary', className: 'mt-7 w-full' })}>
              Start prøveperiode
            </a>
          </section>
        );
      })}
    </div>
  );
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6', className)}>{children}</div>;
}

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <p className={cn('text-[13px] font-semibold uppercase tracking-[0.12em]', dark ? 'text-marker' : 'text-navy-600')}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  children,
  lead,
  center = false,
  dark = false,
}: {
  eyebrow?: ReactNode;
  children: ReactNode;
  lead?: ReactNode;
  center?: boolean;
  dark?: boolean;
}) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      {eyebrow ? <Eyebrow dark={dark}>{eyebrow}</Eyebrow> : null}
      <h2 className={cn('mt-2 font-serif text-[30px] font-semibold leading-[1.12] tracking-[-0.01em] sm:text-[40px]', dark ? 'text-white' : 'text-navy-900')}>
        {children}
      </h2>
      {lead ? <p className={cn('mt-4 text-[17px] leading-relaxed', dark ? 'text-navy-200' : 'text-muted')}>{lead}</p> : null}
    </div>
  );
}

/** Lys toppseksjon for undersider, med svakt rutenett. */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden border-b border-line bg-paper">
      <div aria-hidden className="paper-grid absolute inset-0 -z-10" />
      <Container className="py-14 sm:py-20">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className={cn('max-w-3xl font-serif text-[36px] font-semibold leading-[1.08] tracking-[-0.015em] text-navy-900 sm:text-[48px]', eyebrow && 'mt-2')}>{title}</h1>
        {lead ? <p className="mt-5 max-w-2xl text-[18px] leading-relaxed text-muted">{lead}</p> : null}
        {children}
      </Container>
    </section>
  );
}

/** Radarringer med roterende sveip og et par «treff» (ren dekor). */
export function RadarDecor({ className, blips = true }: { className?: string; blips?: boolean }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute aspect-square', className)}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        {[49.5, 39, 28.5, 18].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / 0.10)" strokeWidth="0.25" />
        ))}
        <line x1="50" y1="0.5" x2="50" y2="99.5" stroke="rgb(255 255 255 / 0.06)" strokeWidth="0.2" />
        <line x1="0.5" y1="50" x2="99.5" y2="50" stroke="rgb(255 255 255 / 0.06)" strokeWidth="0.2" />
      </svg>
      <div className="radar-sweep absolute inset-[0.5%]" />
      {blips
        ? [
            ['24%', '30%', '0s'],
            ['70%', '22%', '1.4s'],
            ['78%', '64%', '2.6s'],
          ].map(([left, top, delay]) => (
            <span key={`${left}${top}`} className="absolute size-2" style={{ left, top }}>
              <span className="radar-blip absolute inset-0 rounded-full bg-marker" style={{ animationDelay: delay }} />
              <span className="absolute inset-[25%] rounded-full bg-marker" />
            </span>
          ))
        : null}
    </div>
  );
}

export function CheckList({ items, className, dark = false, inline = false }: { items: ReactNode[]; className?: string; dark?: boolean; inline?: boolean }) {
  return (
    <ul className={cn(inline ? 'flex flex-wrap gap-x-6 gap-y-2' : 'space-y-2.5', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', dark ? 'bg-white/10 text-marker' : 'bg-ok-soft text-ok')}>
            <LuCheck className="size-3.5" aria-hidden strokeWidth={3} />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Relevans 0–100 som ring (eksempler på forsiden). */
export function ScoreRing({ value, size = 44, label = 'Relevans' }: { value: number; size?: number; label?: string }) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const tone = value >= 80 ? 'var(--color-ok)' : value >= 60 ? 'var(--color-navy-600)' : 'var(--color-faint)';
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${label} ${value} av 100`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 size-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--color-line)" strokeWidth="3" />
        <circle cx="18" cy="18" r={r} fill="none" stroke={tone} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} />
      </svg>
      <span className="num relative font-semibold text-navy-900" style={{ fontSize: size * 0.3 }}>
        {value}
      </span>
    </span>
  );
}

export function FaqList({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="divide-y divide-line rounded-2xl border border-line bg-white">
      {items.map(([q, a]) => (
        <details key={q} className="group px-5 py-4 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
            {q}
            <LuChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Avsluttende oppfordring på mørk bakgrunn. */
export function CtaBand({ title, lead, primary, secondary }: { title: ReactNode; lead: ReactNode; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <section className="relative isolate overflow-hidden bg-navy-950 text-white">
      <div aria-hidden className="hero-grid absolute inset-0 -z-10" />
      <RadarDecor className="-right-56 top-1/2 -z-10 w-[560px] -translate-y-1/2 opacity-80" />
      <Container className="flex flex-col items-start gap-8 py-20 sm:py-24 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <h2 className="font-serif text-[32px] font-semibold leading-tight text-white sm:text-[40px]">{title}</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-navy-200">{lead}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={primary.href} className={buttonVariants({ variant: 'inverse', size: 'lg' })}>
            {primary.label}
          </a>
          {secondary ? (
            <a href={secondary.href} className={buttonVariants({ variant: 'ghost', size: 'lg', className: 'text-white hover:bg-white/10' })}>
              {secondary.label}
            </a>
          ) : null}
        </div>
      </Container>
    </section>
  );
}

/** Vanlige spørsmål – samme svar på forsiden og prissiden, så de aldri spriker. */
export function faqItems(o: { trialDays: number; sources: string }): [string, ReactNode][] {
  return [
    ['Hvor kommer anbudene fra?', `Fra ${o.sources}. Hver kunngjøring lenker til originalen, så dere alltid kan sjekke kilden.`],
    [
      'Hva skjer etter prøveperioden?',
      `Prøveperioden varer i ${o.trialDays} dager med alt i Profesjonell. Etterpå går kontoen over til gratisnivået med søk og inntil 5 lagrede anbud. Dere velger selv om dere vil betale – ingenting trekkes automatisk.`,
    ],
    ['Kan vi si opp når som helst?', 'Ja. Abonnementet løper ut perioden dere har betalt for, og fornyes ikke etter det.'],
    ['Er AI-analysen alltid riktig?', 'Nei. Den er et hjelpemiddel. Hver opplysning har kilde, og konkurransegrunnlaget gjelder alltid ved avvik.'],
    ['Sender dere inn tilbudet for oss?', 'Nei. AnbudRadar hjelper dere å finne, forstå og forberede. Tilbudet leverer dere selv i oppdragsgivers system.'],
    ['Hvordan betaler vi?', 'Med kort via Stripe. Kvittering og faktura finner dere under Abonnement.'],
  ];
}
