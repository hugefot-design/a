/**
 * Felles biter for de offentlige sidene: bransjeikoner, sideramme og spørsmål og svar.
 * Resten av uttrykket (radar, mørke flater, kort) ligger i src/ui/site.tsx.
 */
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import {
  LuBuilding2,
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
import { cn } from './components';
import type { Messages } from '@/i18n';
import { fill } from '@/i18n/format';

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

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-7xl px-4 sm:px-6', className)}>{children}</div>;
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

/**
 * Vanlige spørsmål – samme svar overalt, så de aldri spriker. Svarene om AI og betaling følger det som faktisk er slått
 * på – siden lover aldri AI-analyse eller kortbetaling som ikke virker. Spørsmålet om appens språk vises bare på andre
 * språk enn norsk. Ren tekst, så de samme svarene kan gå i strukturerte data (faqJsonLd).
 */
export function faqItems(m: Messages, o: { days: string; sources: string; aiReal: boolean; paymentsOpen: boolean }): [string, string][] {
  const vars = { days: o.days, sources: o.sources };
  const items = m.faq.items.map((x): [string, string] => [x.q, fill(x.a, vars)]);
  const accuracy = o.aiReal ? m.faq.accuracy.ai : m.faq.accuracy.plain;
  const payment = o.paymentsOpen ? m.faq.payment.open : m.faq.payment.notOpen;
  const all: [string, string][] = [...items, [accuracy.q, accuracy.a], [payment.q, payment.a]];
  if (o.aiReal) all.push([m.faq.ai.q, m.faq.ai.a]);
  return m.faq.app.q ? [...all, [m.faq.app.q, m.faq.app.a]] : all;
}

/** Strukturerte data for spørsmål og svar (schema.org FAQPage) – nøyaktig de samme som vises på siden. */
export function faqJsonLd(items: [string, string][]): unknown {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
}
