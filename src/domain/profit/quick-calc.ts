/**
 * Lønnsomhetssjekk uten konto (/kalkulator): en rask sjekk med de samme formlene som kalkulatoren i appen
 * (calculate) – selvkost, målpris for ønsket margin, fortjeneste ved kontraktsverdien og følsomhet.
 *
 * - Bare tallene besøkende skriver inn brukes. Ingenting lagres, og ingenting fylles inn eller anslås.
 * - Knyttet til et åpent anbud hentes oppdragsgivers anslåtte verdi (merket som det) og ekte tidligere
 *   tildelinger for samme type kontrakt, så målprisen kan plasseres blant dem.
 * - Kostnadslinjer, risikopåslag, minstemargin, kontraktsvilkår i kroner, kapasitet og lagring finnes i appen.
 */
import { calculate, fmtKr, type CalcResult, type CostLine, type Formula } from './calculator';
import { parseNumber } from './service';

export interface QuickCalcForm {
  hours: string;
  hourlyCost: string;
  materials: string;
  other: string;
  overheadPct: string;
  marginPct: string;
  contractValue: string;
}

export const EMPTY_QUICK_CALC: QuickCalcForm = { hours: '', hourlyCost: '', materials: '', other: '', overheadPct: '', marginPct: '', contractValue: '' };

export interface QuickCalcInput {
  hours: number | null;
  hourlyCost: number | null;
  materials: number | null;
  other: number | null;
  overheadPct: number | null;
  marginPct: number;
  contractValue: number | null;
}

type Errors = Partial<Record<keyof QuickCalcForm, string>>;

const LIMITS: Record<keyof QuickCalcForm, { label: string; max: number }> = {
  hours: { label: 'Timer', max: 10_000_000 },
  hourlyCost: { label: 'Timekost', max: 100_000 },
  materials: { label: 'Materialer og utstyr', max: 100_000_000_000 },
  other: { label: 'Underleverandører og annet', max: 100_000_000_000 },
  overheadPct: { label: 'Påslag for indirekte kostnader', max: 500 },
  marginPct: { label: 'Ønsket margin', max: 95 },
  contractValue: { label: 'Kontraktsverdi', max: 1_000_000_000_000 },
};

/** Leser skjemaet (norsk tallformat). Feil per felt – ingenting gjettes. */
export function parseQuickCalc(form: QuickCalcForm): { ok: true; input: QuickCalcInput } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const read = (key: keyof QuickCalcForm): number | null => {
    const n = parseNumber(form[key]);
    const { label, max } = LIMITS[key];
    if (n === 'invalid') {
      errors[key] = `${label}: skriv et tall.`;
      return null;
    }
    if (n !== null && (n < 0 || n > max)) {
      errors[key] = `${label}: må være mellom 0 og ${max.toLocaleString('nb-NO')}.`;
      return null;
    }
    return n;
  };
  const input = {
    hours: read('hours'),
    hourlyCost: read('hourlyCost'),
    materials: read('materials'),
    other: read('other'),
    overheadPct: read('overheadPct'),
    marginPct: read('marginPct'),
    contractValue: read('contractValue'),
  };
  // Bare når begge feltene ellers er lest riktig – en «skriv et tall»-feil skal ikke skrives over.
  if (!errors.hours && !errors.hourlyCost && (input.hours === null) !== (input.hourlyCost === null)) {
    errors[input.hours === null ? 'hours' : 'hourlyCost'] = 'Fyll ut både timer og timekost – eller la begge stå tomme.';
  }
  const anyCost = (input.hours ?? 0) * (input.hourlyCost ?? 0) + (input.materials ?? 0) + (input.other ?? 0) > 0;
  if (!anyCost && !Object.keys(errors).length) errors.hours = 'Legg inn minst én kostnad: timer og timekost, materialer eller annet.';
  if (input.marginPct === null && !errors.marginPct) errors.marginPct = 'Skriv hvilken margin dere ønsker, f.eks. 10.';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: { ...input, marginPct: input.marginPct! } };
}

export interface QuickCalcResult {
  calc: CalcResult;
  /** Utregningen steg for steg. Sjekken har ikke risikopåslag eller minstepris – de to linjene (alltid 0) vises ikke. */
  steps: Formula[];
  marginPct: number;
  /** Kontraktsverdien som er brukt, og hvor den kommer fra. */
  contractValue: { value: number; basis: 'bruker' | 'dokument' } | null;
  /** Vurdering ved kontraktsverdien – regnet, ikke anslått. */
  verdict: 'over_target' | 'under_target' | 'loss' | null;
}

/**
 * Regner med appens formler. `noticeValue` er oppdragsgivers anslåtte verdi fra kunngjøringen (brukes når
 * besøkende ikke har skrevet en egen verdi) og merkes som «fra kunngjøringen».
 */
export function quickCalc(input: QuickCalcInput, notice: { value: number | null; isFramework: boolean } = { value: null, isFramework: false }): QuickCalcResult {
  const lines: CostLine[] = [];
  if (input.hours !== null && input.hourlyCost !== null && input.hours > 0) {
    lines.push({ id: 'arbeid', category: 'arbeid', description: 'Arbeid', quantity: input.hours, unit: 'timer', unitCost: input.hourlyCost, period: 'total', basis: 'bruker' });
  }
  if (input.materials) lines.push({ id: 'materialer', category: 'materialer', description: 'Materialer og utstyr', quantity: 1, unit: 'sum', unitCost: input.materials, period: 'total', basis: 'bruker' });
  if (input.other) lines.push({ id: 'annet', category: 'annet', description: 'Underleverandører og annet', quantity: 1, unit: 'sum', unitCost: input.other, period: 'total', basis: 'bruker' });

  const own = input.contractValue !== null && input.contractValue > 0;
  const value = own ? input.contractValue : notice.value !== null && notice.value > 0 ? notice.value : null;
  const calc = calculate({
    contractValue: value,
    contractValueBasis: value === null ? 'mangler' : own ? 'bruker' : 'dokument',
    durationMonths: null,
    durationBasis: 'mangler',
    isFramework: notice.isFramework && !own,
    lines,
    overheadPct: input.overheadPct ?? 0,
    riskBufferPct: 0,
    targetMarginPct: input.marginPct,
    minMarginPct: 0,
  });
  const at = calc.atContractValue;
  const steps = calc.formulas
    .filter((f) => !/^(Risikopåslag|Minstepris)/.test(f.label))
    .map((f) => (f.label.startsWith('Målpris') ? { ...f, formula: f.formula.replace(` + ${fmtKr(0)})`, ')') } : f));
  return {
    calc,
    steps,
    marginPct: input.marginPct,
    contractValue: value === null ? null : { value, basis: own ? 'bruker' : 'dokument' },
    verdict: !at ? null : at.profit < 0 ? 'loss' : at.marginPct >= input.marginPct ? 'over_target' : 'under_target',
  };
}
