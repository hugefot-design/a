/**
 * Anbefaling: Vurder å by / Undersøk nærmere / Høy risiko / For lite grunnlag.
 *
 * Bygger KUN på kalkylen, risikofunnene, kapasiteten og kvalifikasjonene – aldri på et anslag om
 * hvem som vinner. Hver anbefaling har begrunnelser brukeren kan kontrollere.
 */
import type { CalcResult } from './calculator';
import { fmtKr, fmtNumber } from './calculator';
import type { CapacityResult } from './capacity';

export type Recommendation = 'bid' | 'investigate' | 'high_risk' | 'insufficient_data';
export type RiskLevel = 'lav' | 'middels' | 'høy' | 'ukjent';

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  bid: 'Vurder å by',
  investigate: 'Undersøk nærmere',
  high_risk: 'Høy risiko',
  insufficient_data: 'For lite grunnlag',
};

export interface RecommendationInput {
  calc: CalcResult;
  targetMarginPct: number | null;
  riskLevel: RiskLevel;
  highRisks: string[];
  missingQualifications: string[];
  capacity: CapacityResult;
  /** Er kontraktsvilkårene (dokumentene) faktisk analysert, eller bare kunngjøringen? */
  contractTermsAnalyzed: boolean;
  deadlinePassed: boolean;
}

export interface RecommendationResult {
  recommendation: Recommendation;
  label: string;
  reasons: string[];
  checks: { label: string; ok: boolean | null }[];
}

export function recommend(input: RecommendationInput): RecommendationResult {
  const { calc, capacity } = input;
  const reasons: string[] = [];
  const checks: { label: string; ok: boolean | null }[] = [];
  const margin = calc.atContractValue?.marginPct ?? null;
  const target = input.targetMarginPct;

  if (input.deadlinePassed) reasons.push('Fristen har gått ut.');
  if (calc.completeness.linesIncluded === 0 || calc.directCost <= 0) {
    return {
      recommendation: 'insufficient_data',
      label: RECOMMENDATION_LABEL.insufficient_data,
      reasons: [...reasons, 'Legg inn kostnadene deres (timer, materialer, utstyr, transport) for å få en vurdering.'],
      checks: [{ label: 'Kostnader lagt inn', ok: false }],
    };
  }

  // Økonomi
  const profitOk = margin !== null ? margin >= (target ?? 0) : null;
  checks.push({ label: target !== null ? `Margin ved kontraktsverdi minst ${fmtNumber(target)} %` : 'Margin ved kontraktsverdi', ok: profitOk });
  if (calc.atContractValue) {
    if (calc.atContractValue.profit < 0) {
      reasons.push(`Tap ved oppdragsgivers verdi: ${fmtKr(calc.atContractValue.profit)} (margin ${fmtNumber(calc.atContractValue.marginPct)} %).`);
    } else if (target !== null && calc.atContractValue.marginPct < target) {
      reasons.push(`Marginen ved kontraktsverdien (${fmtNumber(calc.atContractValue.marginPct)} %) er under ønsket margin (${fmtNumber(target)} %).`);
    } else {
      reasons.push(`Fortjeneste ved kontraktsverdien: ${fmtKr(calc.atContractValue.profit)} (margin ${fmtNumber(calc.atContractValue.marginPct)} %).`);
    }
  } else {
    reasons.push('Kontraktsverdien er ukjent – sammenlign prisintervallet med det dere tror oppdragsgiver vil betale.');
  }
  const worst = calc.sensitivity.at(-1);
  if (worst?.profitAtContractValue !== null && worst?.profitAtContractValue !== undefined && worst.profitAtContractValue < 0) {
    reasons.push(`Kostnadsøkning på ${worst.increasePct} % gir tap ved kontraktsverdien.`);
  }

  // Risiko
  checks.push({ label: 'Ingen høye risikoer i kontraktsvilkårene', ok: input.riskLevel === 'ukjent' ? null : input.highRisks.length === 0 });
  for (const r of input.highRisks.slice(0, 4)) reasons.push(`Høy risiko: ${r}`);
  if (!input.contractTermsAnalyzed) reasons.push('Kontraktsvilkårene er ikke analysert – last opp konkurransegrunnlaget for å få med dagbøter, betalingsvilkår og ansvar.');
  checks.push({ label: 'Kontraktsvilkår analysert', ok: input.contractTermsAnalyzed });

  // Kvalifikasjoner og kapasitet
  checks.push({ label: 'Kvalifikasjonskrav oppfylt', ok: input.missingQualifications.length === 0 });
  for (const q of input.missingQualifications.slice(0, 3)) reasons.push(`Mangler: ${q}`);
  checks.push({ label: 'Kapasitet', ok: capacity.status === 'ukjent' ? null : capacity.status === 'ok' });
  if (capacity.gapHoursPerYear !== null && capacity.gapHoursPerYear > 0) {
    reasons.push(`Mangler ca. ${fmtNumber(capacity.gapHoursPerYear)} timer per år (${fmtNumber(capacity.gapPct ?? 0)} % av behovet) – vurder underleverandør eller partner.`);
  }
  if (capacity.equipmentMissing.length) reasons.push(`Utstyr som ikke er registrert: ${capacity.equipmentMissing.slice(0, 3).join(', ')}.`);
  if (calc.completeness.aiLines > 0) reasons.push('Noen mengder er AI-estimater – kontroller dem før dere bestemmer pris.');

  const loss = calc.atContractValue !== null && calc.atContractValue.profit < 0;
  const capacityShort = capacity.gapPct !== null && capacity.gapPct > 25;
  let recommendation: Recommendation;
  if (input.deadlinePassed || loss || input.highRisks.length > 0 || input.missingQualifications.length > 0 || capacityShort) {
    recommendation = 'high_risk';
  } else if (
    profitOk === true &&
    input.contractTermsAnalyzed &&
    input.riskLevel !== 'ukjent' &&
    (capacity.status === 'ok' || capacity.status === 'stram') &&
    (capacity.gapHoursPerYear === null || capacity.gapHoursPerYear <= 0) &&
    calc.completeness.linesMissing === 0
  ) {
    recommendation = 'bid';
  } else {
    recommendation = 'investigate';
  }
  return { recommendation, label: RECOMMENDATION_LABEL[recommendation], reasons, checks };
}
