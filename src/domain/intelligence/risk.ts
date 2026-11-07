/**
 * Risikoscore 0–100 for ett anbud: summen av navngitte faktorer, hver med poeng, forklaring, grunnlag og kilde.
 * Bevisst enkel og etterprøvbar – en sjekkliste med vekter, ikke en sannsynlighet. Faktorene bygger på det de
 * andre modulene allerede har funnet:
 *   frist og profil  → forhåndsvurderingen (screening.ts)
 *   kvalifikasjoner  → assessQualifications (profit/service.ts)
 *   krav og befaring → kravsjekken (documents/requirements.ts)
 *   vilkår           → vilkårssøket (profit/terms-scan.ts) og AI-funnene i Lønnsomhet (med kontrollerte sitater)
 *   kapasitet, margin → kapasitetsanalysen og kalkylen
 *   læring           → deres egne resultater hos oppdragsgiveren (bare med nok avgjorte)
 * Nivå: under 25 lav, 25–49 middels, 50+ høy. En faktor som er en hindring (blocker) gir alltid høy.
 */
import type { RequirementHit, RequirementScan } from '@/domain/documents/requirements';
import type { Uncertainty } from '@/domain/matching/engine';
import type { Screening, ScreeningKey } from '@/domain/matching/screening';
import type { CalcResult } from '@/domain/profit/calculator';
import { fmtKr, fmtNumber } from '@/domain/profit/calculator';
import type { CapacityResult } from '@/domain/profit/capacity';
import type { QualificationView, RiskFinding } from '@/domain/profit/service';
import { TERM_LABELS, type TermCategory, type TermHit, type TermScan } from '@/domain/profit/terms-scan';
import type { Level, RiskFactor, SourceRef } from './types';

export const RISK_LEVELS = { middels: 25, høy: 50 } as const;
/** Vilkår som ofte koster penger hvis de overses (samme utvalg som forhåndsvurderingen, pluss forsikring). */
export const COSTLY_TERMS: TermCategory[] = ['dagbot', 'garanti', 'erstatningsansvar', 'forsikring'];
const MANDATORY = /obligatorisk|påkrevd|skal delta|må delta|må gjennomføres|mandatory|compulsory/i;

export interface RiskInputs {
  screening: Screening;
  requirements: RequirementScan;
  terms: TermScan;
  qualifications: QualificationView | null;
  /** Kontraktsrisiko fra AI-analysen i Lønnsomhet (tom uten analyse). */
  aiFindings: RiskFinding[];
  capacity: CapacityResult | null;
  calc: CalcResult | null;
  targetMarginPct: number | null;
  documentsRead: number;
  matchUncertainty: Uncertainty | null;
  /** Deres avgjorte tilbud hos samme oppdragsgiver (fra Resultater). */
  buyerRecord: { decided: number; won: number } | null;
  minDecided: number;
}

export function hitSource(hit: Pick<RequirementHit, 'sourceTitle' | 'page' | 'text' | 'documentId'>): SourceRef {
  return { kind: hit.documentId ? 'document' : 'notice', label: hit.sourceTitle, page: hit.page, quote: hit.text };
}

export function termSource(hit: Pick<TermHit, 'sourceId' | 'sourceTitle' | 'page' | 'snippet'>): SourceRef {
  return { kind: hit.sourceId === 'S0' ? 'notice' : 'document', label: hit.sourceTitle, page: hit.page, quote: hit.snippet };
}

/** Setningen om obligatorisk befaring (kunngjøring eller dokument), hvis den finnes. */
export function mandatoryVisit(scan: RequirementScan): RequirementHit | null {
  return scan.byKind.befaring.find((h) => /befaring|site visit/i.test(h.text) && MANDATORY.test(h.text)) ?? null;
}

export function riskLevel(score: number, blocker: boolean): Level {
  if (blocker || score >= RISK_LEVELS.høy) return 'høy';
  return score >= RISK_LEVELS.middels ? 'middels' : 'lav';
}

const DEADLINE: Partial<Record<ScreeningKey, { points: number; severity: RiskFactor['severity']; blocker: boolean }>> = {
  deadline_passed: { points: 100, severity: 'høy', blocker: true },
  deadline_soon: { points: 35, severity: 'høy', blocker: true },
  deadline_short: { points: 15, severity: 'middels', blocker: false },
  deadline_unknown: { points: 5, severity: 'lav', blocker: false },
};

export function scoreRisk(i: RiskInputs): { score: number; level: Level; factors: RiskFactor[] } {
  const factors: RiskFactor[] = [];
  const add = (f: Omit<RiskFactor, 'sources'> & { sources?: SourceRef[] }) => factors.push({ sources: [], ...f });

  // Frist og profil – fra forhåndsvurderingen (samme grenser som resten av appen).
  for (const p of i.screening.points) {
    const d = DEADLINE[p.key];
    if (d) add({ key: p.key, label: 'Frist', points: d.points, severity: d.severity, explanation: p.text, basis: 'fact', blocker: d.blocker });
    if (p.key === 'excluded') add({ key: 'excluded', label: 'Utelukket av profilen', points: 40, severity: 'høy', explanation: p.text, basis: 'calculation', blocker: true });
  }

  // Kvalifikasjoner: lovpålagte godkjenninger er en hindring; andre krav er en risiko.
  const q = i.qualifications;
  if (q) {
    const legal = q.required.filter((r) => r.legal && !r.have);
    if (legal.length) {
      add({
        key: 'legal_qualification',
        label: 'Lovpålagt godkjenning mangler',
        points: Math.min(50, legal.length * 35),
        severity: 'høy',
        explanation: `Teksten nevner ${legal.map((r) => r.label).join(', ')}, som ikke står i profilen eller bemanningen. Uten godkjenningen kan dere ikke levere.`,
        basis: 'fact',
        blocker: true,
      });
    }
    const other = q.required.filter((r) => !r.legal && !r.have);
    if (other.length) {
      add({
        key: 'qualification',
        label: 'Kvalifikasjoner som mangler i profilen',
        points: Math.min(20, other.length * 10),
        severity: 'middels',
        explanation: `${other.map((r) => r.label).join(', ')} nevnes, men står ikke i profilen eller bemanningen.`,
        basis: 'fact',
        blocker: false,
      });
    }
    if (q.turnover?.ok === false) {
      add({
        key: 'turnover',
        label: 'Omsetningskrav',
        points: 20,
        severity: 'høy',
        explanation: `Kravet er minst ${fmtKr(q.turnover.required)} i omsetning; profilen oppgir ${fmtKr(q.turnover.have ?? 0)}.`,
        basis: 'fact',
        blocker: false,
      });
    }
  }

  // Avvisningsgrunner og minstekrav: flere punkter = mer å dokumentere og flere måter å bli avvist på.
  const rejection = i.requirements.counts.avvisning + i.requirements.counts.minstekrav;
  if (rejection > 0) {
    const points = rejection >= 8 ? 12 : rejection >= 3 ? 8 : 4;
    add({
      key: 'rejection',
      label: 'Avvisningsgrunner og minstekrav',
      points,
      severity: points >= 8 ? 'middels' : 'lav',
      explanation: `${rejection} setninger om avvisning eller minstekrav. Hvert punkt må være oppfylt og dokumentert.`,
      basis: 'fact',
      blocker: false,
      sources: [...i.requirements.byKind.avvisning, ...i.requirements.byKind.minstekrav].slice(0, 3).map(hitSource),
    });
  }

  const visit = mandatoryVisit(i.requirements);
  if (visit) {
    add({
      key: 'site_visit',
      label: 'Obligatorisk befaring',
      points: 8,
      severity: 'middels',
      explanation: 'Uteblir dere fra befaringen, kan tilbudet bli avvist. Sett av tid og meld dere på.',
      basis: 'fact',
      blocker: false,
      sources: [hitSource(visit)],
    });
  }

  // Kostbare vilkår (ordsøk – nektelser holdes utenfor).
  const costly = COSTLY_TERMS.filter((c) => (i.terms.byCategory[c] ?? []).some((h) => !h.negated));
  if (costly.length) {
    add({
      key: 'costly_terms',
      label: 'Kostbare kontraktsvilkår',
      points: Math.min(18, costly.length * 6),
      severity: 'middels',
      explanation: `Nevnt: ${costly.map((c) => TERM_LABELS[c].toLowerCase()).join(', ')}. Ta høyde for dem i prisen.`,
      basis: 'fact',
      blocker: false,
      sources: costly.map((c) => termSource(i.terms.byCategory[c]!.find((h) => !h.negated)!)),
    });
  }

  // Kontraktsrisiko vurdert av AI (bare med analyse – sitatene er kontrollert mot dokumentene).
  const aiHigh = i.aiFindings.filter((f) => f.severity === 'høy');
  if (aiHigh.length) {
    add({
      key: 'ai_contract_risk',
      label: 'Høy kontraktsrisiko (AI-vurdering)',
      points: Math.min(24, aiHigh.length * 12),
      severity: 'høy',
      explanation: aiHigh.map((f) => f.title).join(' · '),
      basis: 'ai',
      blocker: false,
      sources: aiHigh.filter((f) => f.source).map((f) => ({ kind: 'ai' as const, label: f.source!.title ?? 'Dokument', page: f.source!.page, quote: f.source!.quote, verified: f.source!.verified })),
    });
  }

  // Kapasitet (fra kalkylens timer og registrert bemanning/kontrakter).
  const c = i.capacity;
  if (c && c.status !== 'ukjent') {
    if (c.gapPct !== null && c.gapPct > 25) {
      add({ key: 'capacity', label: 'Kapasitet', points: 20, severity: 'høy', explanation: `Mangler ca. ${fmtNumber(c.gapHoursPerYear ?? 0)} timer per år (${fmtNumber(c.gapPct)} % av behovet).`, basis: 'calculation', blocker: false });
    } else if (c.gapHoursPerYear !== null && c.gapHoursPerYear > 0) {
      add({ key: 'capacity', label: 'Kapasitet', points: 10, severity: 'middels', explanation: `Mangler ca. ${fmtNumber(c.gapHoursPerYear)} timer per år.`, basis: 'calculation', blocker: false });
    } else if (c.status === 'stram') {
      add({ key: 'capacity', label: 'Kapasitet', points: 5, severity: 'lav', explanation: 'Kapasiteten er stram i deler av perioden.', basis: 'calculation', blocker: false });
    }
  }

  // Lønnsomhet (bare når kostnadene er lagt inn).
  const at = i.calc?.atContractValue ?? null;
  if (i.calc && at) {
    if (at.profit < 0) {
      add({
        key: 'margin_loss',
        label: 'Tap ved oppdragsgivers verdi',
        points: 30,
        severity: 'høy',
        explanation: `Selvkosten er høyere enn kontraktsverdien: ${fmtKr(at.profit)} (margin ${fmtNumber(at.marginPct)} %).`,
        basis: 'calculation',
        blocker: true,
      });
    } else if (i.targetMarginPct !== null && at.marginPct < i.targetMarginPct) {
      add({
        key: 'margin_low',
        label: 'Lav margin',
        points: 12,
        severity: 'middels',
        explanation: `Marginen ved kontraktsverdien er ${fmtNumber(at.marginPct)} % – under ønsket ${fmtNumber(i.targetMarginPct)} %.`,
        basis: 'calculation',
        blocker: false,
      });
    }
    const ten = i.calc.sensitivity.find((s) => s.increasePct === 10);
    if (at.profit >= 0 && ten?.profitAtContractValue !== null && ten?.profitAtContractValue !== undefined && ten.profitAtContractValue < 0) {
      add({ key: 'sensitivity', label: 'Følsom for kostnadsøkning', points: 8, severity: 'middels', explanation: '10 % høyere kostnader gir tap ved kontraktsverdien.', basis: 'calculation', blocker: false });
    }
  }

  if (i.documentsRead === 0) {
    add({
      key: 'notice_only',
      label: 'Bare kunngjøringen er lest',
      points: 8,
      severity: 'middels',
      explanation: 'Konkurransegrunnlaget er ikke lest. Det har som regel flere krav og vilkår enn kunngjøringen.',
      basis: 'fact',
      blocker: false,
    });
  }
  if (i.matchUncertainty === 'høy') {
    add({ key: 'uncertainty', label: 'Høy usikkerhet', points: 6, severity: 'lav', explanation: 'Kunngjøringen sier lite om innholdet i oppdraget.', basis: 'calculation', blocker: false });
  }

  const b = i.buyerRecord;
  if (b && b.decided >= i.minDecided && b.won === 0) {
    add({
      key: 'buyer_losses',
      label: 'Tidligere resultater hos oppdragsgiveren',
      points: 10,
      severity: 'middels',
      explanation: `Dere har ikke vunnet noen av ${b.decided} avgjorte tilbud hos denne oppdragsgiveren.`,
      basis: 'fact',
      blocker: false,
      sources: [{ kind: 'own', label: 'Resultatene deres' }],
    });
  }

  factors.sort((a, z) => Number(z.blocker) - Number(a.blocker) || z.points - a.points);
  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  return { score, level: riskLevel(score, factors.some((f) => f.blocker)), factors };
}
