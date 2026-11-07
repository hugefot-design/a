/**
 * Handlingsplan for ett anbud: konkrete steg i den rekkefølgen de bør gjøres, med dato når den finnes.
 * Datoer fra kunngjøringen (tilbudsfrist, spørsmålsfrist, frist for å be om å delta) er fakta; intern
 * godkjenning er et forslag regnet fra fristen (to dager før). Hvert steg lenker til verktøyet som løser det,
 * og steg som allerede er gjort (sjekklisten fullført, tilbudet levert) merkes som gjort.
 */
import { fmtKr, fmtNumber } from '@/domain/profit/calculator';
import type { FitSection, PlanStep, ProfitSection, RiskSection, Verdict } from './types';

const DAY = 86_400_000;

export interface PlanInputs {
  now: Date;
  tenderId: string;
  tender: {
    deadlineAt: Date | null;
    questionsDeadlineAt: Date | null;
    participationDeadlineAt: Date | null;
    deadlineKind: 'tender' | 'participation' | null;
    documentsUrl: string | null;
    submissionUrl: string | null;
  };
  verdict: Verdict;
  risk: RiskSection;
  fit: FitSection;
  profit: ProfitSection;
  pricing: { medianDiffPct: number; n: number } | null;
  bid: { id: string; status: string; checklistTotal: number; checklistDone: number } | null;
  /** Status på det lagrede anbudet (watching, preparing, submitted, won, lost, declined) eller null. */
  bookmarkStatus: string | null;
  entitlements: { bidAssistant: boolean; documentUpload: boolean; partnerSearch: boolean; profitCalculator: boolean };
}

type Draft = Omit<PlanStep, 'detail' | 'due' | 'dueBasis' | 'href' | 'hrefLabel' | 'done' | 'source'> & Partial<PlanStep>;

const step = (d: Draft): PlanStep => ({
  detail: null,
  due: null,
  dueBasis: null,
  href: null,
  hrefLabel: null,
  done: false,
  source: null,
  ...d,
});

export function buildPlan(i: PlanInputs): PlanStep[] {
  const { now, tender: t, risk, profit } = i;
  const steps: PlanStep[] = [];
  const delivered = ['submitted', 'won', 'lost'].includes(i.bookmarkStatus ?? '') || i.bid?.status === 'submitted';
  const deadlinePassed = t.deadlineAt !== null && t.deadlineAt.getTime() < now.getTime();
  const resultStep = step({
    key: 'result',
    title: 'Registrer resultatet når tildelingen kommer',
    detail: 'Vunnet eller ikke, pris og hvem som vant. Da lærer neste vurdering av det.',
    priority: 'lav',
    basis: 'fact',
    href: `/app/anbud/${i.tenderId}#resultat`,
    hrefLabel: 'Status for dere',
    done: i.bookmarkStatus === 'won' || i.bookmarkStatus === 'lost',
  });

  if (deadlinePassed) return delivered ? [resultStep] : [];
  if (i.verdict === 'no_go') {
    steps.push(
      step({
        key: 'decline',
        title: 'Velg bort anbudet',
        detail: 'Sett status «Valgt bort», så forsvinner det fra arbeidslistene. Grunnene står over.',
        priority: 'middels',
        basis: 'calculation',
        href: `/app/anbud/${i.tenderId}#resultat`,
        hrefLabel: 'Status for dere',
        done: i.bookmarkStatus === 'declined',
      }),
    );
  }

  if (risk.read.noticeOnly) {
    steps.push(
      step({
        key: 'documents',
        title: 'Hent og les konkurransegrunnlaget',
        detail: i.entitlements.documentUpload
          ? 'Last opp dokumentene her etterpå, så leser AnbudRadar alle krav, frister og vilkår med sidetall.'
          : 'Kunngjøringen har sjelden alle krav og vilkår.',
        priority: 'høy',
        basis: 'fact',
        href: t.documentsUrl ?? (i.entitlements.documentUpload ? `/app/anbud/${i.tenderId}#dokumenter-for-analyse` : null),
        hrefLabel: t.documentsUrl ? 'Konkurransedokumentene' : 'Last opp dokumenter',
      }),
    );
  }

  if (t.participationDeadlineAt && t.participationDeadlineAt.getTime() > now.getTime()) {
    steps.push(
      step({
        key: 'participation',
        title: 'Be om å delta',
        detail: 'Konkurransen har en egen frist for å be om å delta (kvalifisering) før tilbudsfristen.',
        due: t.participationDeadlineAt,
        dueBasis: 'fact',
        priority: 'høy',
        basis: 'fact',
        href: t.submissionUrl,
        hrefLabel: t.submissionUrl ? 'Oppdragsgivers system' : null,
      }),
    );
  }

  for (const q of i.fit.qualifications.filter((x) => !x.have).sort((a, b) => Number(b.legal) - Number(a.legal))) {
    steps.push(
      step({
        key: `qualification:${q.label}`,
        title: q.legal ? `Skaff ${q.label}` : `Dokumenter ${q.label}`,
        detail: q.legal
          ? 'Lovpålagt for denne typen oppdrag – uten den kan dere ikke levere.'
          : `Står ikke i profilen eller bemanningen. Har dere den, legg den inn i profilen${i.entitlements.partnerSearch ? '; ellers kan en partner dekke kravet' : ''}.`,
        priority: q.legal ? 'høy' : 'middels',
        basis: 'fact',
        href: '/app/profil',
        hrefLabel: 'Profilen',
      }),
    );
  }

  if (t.questionsDeadlineAt && t.questionsDeadlineAt.getTime() > now.getTime()) {
    const unclear = i.fit.uncertainty?.reasons[0] ?? null;
    steps.push(
      step({
        key: 'questions',
        title: 'Send spørsmål om det som er uklart',
        detail: unclear ? `For eksempel: ${unclear.charAt(0).toLowerCase()}${unclear.slice(1)}` : 'Spørsmål etter fristen blir ofte ikke besvart.',
        due: t.questionsDeadlineAt,
        dueBasis: 'fact',
        priority: 'middels',
        basis: 'fact',
        href: t.submissionUrl,
        hrefLabel: t.submissionUrl ? 'Oppdragsgivers system' : null,
      }),
    );
  }

  const visit = risk.factors.find((f) => f.key === 'site_visit');
  if (visit) {
    steps.push(
      step({
        key: 'site_visit',
        title: 'Meld dere på den obligatoriske befaringen',
        detail: visit.sources[0]?.quote ?? null,
        priority: 'høy',
        basis: 'fact',
        source: visit.sources[0] ?? null,
      }),
    );
  }

  if (i.entitlements.profitCalculator) {
    if (profit.availability === 'no_costs') {
      steps.push(
        step({
          key: 'costs',
          title: 'Legg inn kostnadene og sett målpris',
          detail: 'Timer, materialer, utstyr og transport – da regner vi ut selvkost, minstepris og margin.',
          priority: 'høy',
          basis: 'calculation',
          href: `/app/anbud/${i.tenderId}/lonnsomhet`,
          hrefLabel: 'Lønnsomhet',
        }),
      );
    } else if (profit.availability === 'ok') {
      const target = profit.market?.positions.find((p) => p.key === 'malpris');
      const parts = [
        target ? `Målprisen er lavere enn ${fmtNumber(target.cheaperThanPct)} % av ${profit.market!.n} lignende tildelinger.` : null,
        i.pricing ? `Tidligere lå prisen deres i median ${fmtNumber(Math.abs(i.pricing.medianDiffPct))} % ${i.pricing.medianDiffPct >= 0 ? 'over' : 'under'} vinneren.` : null,
        profit.calc?.targetPrice ? `Målpris nå: ${fmtKr(profit.calc.targetPrice)}.` : null,
      ].filter(Boolean);
      steps.push(
        step({
          key: 'price',
          title: 'Kontroller prisen mot markedet før dere låser den',
          detail: parts.join(' ') || 'Sammenlign målprisen med tidligere tildelinger.',
          priority: i.pricing && i.pricing.medianDiffPct > 5 ? 'høy' : 'middels',
          basis: 'calculation',
          href: `/app/anbud/${i.tenderId}/lonnsomhet`,
          hrefLabel: 'Lønnsomhet',
        }),
      );
    }
  }

  const terms = risk.factors.find((f) => f.key === 'costly_terms');
  if (terms) {
    steps.push(
      step({
        key: 'terms',
        title: 'Ta med kostbare vilkår i prisen',
        detail: terms.explanation,
        priority: 'middels',
        basis: 'fact',
        source: terms.sources[0] ?? null,
        href: i.entitlements.profitCalculator ? `/app/anbud/${i.tenderId}/lonnsomhet` : null,
        hrefLabel: i.entitlements.profitCalculator ? 'Lønnsomhet' : null,
      }),
    );
  }

  const capacity = risk.factors.find((f) => f.key === 'capacity' && f.severity !== 'lav');
  if (capacity) {
    steps.push(
      step({
        key: 'capacity',
        title: 'Dekk kapasiteten som mangler',
        detail: `${capacity.explanation} Vurder underleverandør eller partner.`,
        priority: capacity.severity === 'høy' ? 'høy' : 'middels',
        basis: 'calculation',
        href: i.entitlements.partnerSearch ? '/app/partnere' : '/app/kapasitet',
        hrefLabel: i.entitlements.partnerSearch ? 'Finn partner' : 'Kapasitet',
      }),
    );
  }

  const requirementCount = risk.counts.avvisning + risk.counts.minstekrav + risk.counts.kvalifikasjon + risk.counts.befaring + risk.counts.innlevering;
  if (i.bid) {
    const { checklistDone: done, checklistTotal: total } = i.bid;
    steps.push(
      step({
        key: 'checklist',
        title: 'Gå gjennom sjekklisten',
        detail: total ? `${done} av ${total} punkter er gjort.` : 'Sjekklisten er tom – legg inn kravene fra anbudet.',
        priority: 'høy',
        basis: 'fact',
        href: `/app/tilbud/${i.bid.id}`,
        hrefLabel: 'Tilbudsarbeid',
        done: total > 0 && done === total,
      }),
    );
  } else {
    steps.push(
      step({
        key: 'checklist',
        title: i.entitlements.bidAssistant ? 'Start tilbudsarbeid og legg kravene i sjekklisten' : 'Lag en sjekkliste over kravene',
        detail: requirementCount ? `${requirementCount} kravsetninger er funnet, med kilde og side.` : 'Kravene står i konkurransegrunnlaget.',
        priority: 'høy',
        basis: 'fact',
        href: `/app/anbud/${i.tenderId}#krav`,
        hrefLabel: 'Kravene',
      }),
    );
  }

  if (t.deadlineAt) {
    const approval = new Date(t.deadlineAt.getTime() - 2 * DAY);
    const approved = i.bid?.status === 'approved' || i.bid?.status === 'submitted';
    steps.push(
      step({
        key: 'approval',
        title: 'Intern godkjenning av tilbudet',
        detail: approval.getTime() > now.getTime() ? 'Foreslått to dager før fristen, så det er tid til å rette feil.' : 'Fristen er nær – godkjenn så snart som mulig.',
        due: approval.getTime() > now.getTime() ? approval : null,
        dueBasis: approval.getTime() > now.getTime() ? 'calculation' : null,
        priority: 'middels',
        basis: 'calculation',
        href: i.bid ? `/app/tilbud/${i.bid.id}` : null,
        hrefLabel: i.bid ? 'Tilbudsarbeid' : null,
        done: approved || delivered,
      }),
    );
    steps.push(
      step({
        key: 'submit',
        title: t.deadlineKind === 'participation' ? 'Lever forespørselen om å delta' : 'Lever tilbudet',
        detail: null,
        due: t.deadlineAt,
        dueBasis: 'fact',
        priority: 'høy',
        basis: 'fact',
        href: t.submissionUrl,
        hrefLabel: t.submissionUrl ? 'Oppdragsgivers system' : null,
        done: delivered,
      }),
    );
  }
  steps.push(resultStep);
  return steps;
}
