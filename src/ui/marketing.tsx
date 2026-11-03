/**
 * Byggeklosser for de offentlige sidene (forside, funksjoner, priser, bransjer …).
 * Stilen: norsk grotesk, mono for etiketter og tall, hårfine linjer i stedet for kort med skygge.
 * Ingen dekor som ikke betyr noe – ingen ikonbokser, radarsirkler eller mørke bånd.
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
  return <Icon className={cn('size-6 shrink-0 text-navy-700', className)} aria-hidden strokeWidth={1.6} />;
}

/** Prislisten: tre kolonner med hårfine skillelinjer. `maxFeatures` korter ned listen (forsiden). */
export function PlanCards({ maxFeatures, ctaHref = '/registrer', showFeatures = true }: { maxFeatures?: number; ctaHref?: string; showFeatures?: boolean }) {
  return (
    <div className="grid grid-cols-1 border-y border-line md:grid-cols-3">
      {PAID_PLANS.map((id, i) => {
        const p = PLANS[id];
        const featured = id === 'professional';
        return (
          <section
            key={id}
            className={cn(
              'relative flex flex-col py-8 md:px-8',
              i > 0 && 'border-t border-line md:border-l md:border-t-0',
              i === 0 && 'md:pl-0',
              i === PAID_PLANS.length - 1 && 'md:pr-0',
            )}
          >
            {featured ? <span className="absolute inset-x-0 top-0 h-1 bg-marker md:inset-x-8" aria-hidden /> : null}
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[20px] font-[740] tracking-[-0.015em] text-navy-950">{p.name}</h3>
              {featured ? <span className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-navy-700">Med i prøveperioden</span> : null}
            </div>
            <p className="mt-1 text-[14px] text-muted">{p.tagline}</p>
            <p className="mt-6 flex items-baseline gap-2">
              <span className="text-[52px] font-[780] leading-none tracking-[-0.04em] text-navy-950">{p.priceNok}</span>
              <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">kr/mnd eks. mva.</span>
            </p>
            {showFeatures ? (
              <CheckList className="mt-6 flex-1 text-[14px] text-ink" items={maxFeatures ? p.features.slice(0, maxFeatures) : p.features} />
            ) : (
              <span className="flex-1" />
            )}
            <a href={ctaHref} className={buttonVariants({ variant: featured ? 'primary' : 'secondary', className: 'mt-7 w-full' })}>
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
  return <p className={cn('font-mono text-[12px] font-medium uppercase tracking-[0.12em]', dark ? 'text-marker' : 'text-navy-600')}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  children,
  lead,
  dark = false,
}: {
  eyebrow?: ReactNode;
  children: ReactNode;
  lead?: ReactNode;
  /** Beholdt for kompatibilitet – overskrifter er alltid venstrestilt. */
  center?: boolean;
  dark?: boolean;
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? <Eyebrow dark={dark}>{eyebrow}</Eyebrow> : null}
      <h2 className={cn('mt-3 text-[30px] font-[760] leading-[1.05] tracking-[-0.028em] sm:text-[42px]', dark ? 'text-white' : 'text-navy-950')}>{children}</h2>
      {lead ? <p className={cn('mt-4 text-[17px] leading-relaxed', dark ? 'text-navy-200' : 'text-muted')}>{lead}</p> : null}
    </div>
  );
}

/** Toppseksjon for undersider: stor, venstrestilt tittel og hårfin linje under. */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-b border-line">
      <Container className="py-14 sm:py-20">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className={cn('max-w-4xl text-[40px] font-[780] leading-[1] tracking-[-0.035em] text-navy-950 sm:text-[60px]', eyebrow && 'mt-4')}>{title}</h1>
        {lead ? <p className="mt-6 max-w-2xl text-[18px] leading-relaxed text-ink">{lead}</p> : null}
        {children}
      </Container>
    </section>
  );
}

export function CheckList({ items, className, dark = false, inline = false }: { items: ReactNode[]; className?: string; dark?: boolean; inline?: boolean }) {
  return (
    <ul className={cn(inline ? 'flex flex-wrap gap-x-6 gap-y-2' : 'space-y-2.5', className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <LuCheck className={cn('mt-[3px] size-4 shrink-0', dark ? 'text-marker' : 'text-navy-700')} aria-hidden strokeWidth={2.5} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function FaqList({ items }: { items: [string, ReactNode][] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map(([q, a]) => (
        <details key={q} className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold text-navy-950 [&::-webkit-details-marker]:hidden">
            {q}
            <LuChevronDown className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-2 max-w-3xl text-[15px] leading-relaxed text-muted">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Avsluttende oppfordring: en tydelig setning og knappene, uten dekor. */
export function CtaBand({ title, lead, primary, secondary }: { title: ReactNode; lead: ReactNode; primary: { href: string; label: string }; secondary?: { href: string; label: string } }) {
  return (
    <section>
      <Container className="flex flex-col items-start gap-8 py-16 sm:py-24 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h2 className="text-[32px] font-[760] leading-[1.04] tracking-[-0.03em] text-navy-950 sm:text-[48px]">{title}</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">{lead}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a href={primary.href} className={buttonVariants({ size: 'lg' })}>
            {primary.label}
          </a>
          {secondary ? (
            <a href={secondary.href} className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
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
