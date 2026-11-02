/**
 * Profit Intelligence – deterministisk lønnsomhetskalkulator.
 *
 * Samme input gir alltid samme resultat, og hvert tall har en formel brukeren kan kontrollere.
 * Kalkulatoren finner ALDRI på tall: mangler mengde, enhetskost, varighet eller kontraktsverdi,
 * står det tydelig, og linjen holdes utenfor summene.
 *
 * Opphav (provenance) for hvert tall:
 *   dokument  – står i kunngjøringen eller i opplastede dokumenter
 *   bruker    – bedriftens egne tall og forutsetninger
 *   ai        – AI-estimat (f.eks. timer utledet av bemanningskrav) – alltid redigerbart og merket
 *   beregnet  – regnet ut av kalkulatoren fra tallene over
 *
 * Definisjoner (vises også i grensesnittet):
 *   Selvkost         = direkte kostnader + indirekte kostnader (påslag i % av direkte)
 *   Risikopåslag     = selvkost × risikopåslag %
 *   Fortjeneste      = pris − selvkost
 *   Margin           = fortjeneste ÷ pris
 *   Pris for margin m = (selvkost + risikopåslag) ÷ (1 − m)
 */

export type Provenance = 'dokument' | 'bruker' | 'ai' | 'beregnet' | 'mangler';
export type CostCategory = 'arbeid' | 'materialer' | 'utstyr' | 'transport' | 'underleverandor' | 'annet';
export type Period = 'total' | 'per_maaned' | 'per_aar';

export const COST_CATEGORIES: { id: CostCategory; label: string }[] = [
  { id: 'arbeid', label: 'Arbeid og personal' },
  { id: 'materialer', label: 'Materialer' },
  { id: 'utstyr', label: 'Maskiner og utstyr' },
  { id: 'transport', label: 'Transport og logistikk' },
  { id: 'underleverandor', label: 'Underleverandører' },
  { id: 'annet', label: 'Andre driftskostnader' },
];
export const CATEGORY_LABEL = new Map(COST_CATEGORIES.map((c) => [c.id, c.label]));

export const PERIODS: { id: Period; label: string }[] = [
  { id: 'total', label: 'Totalt' },
  { id: 'per_maaned', label: 'Per måned' },
  { id: 'per_aar', label: 'Per år' },
];

export interface SourceRef {
  sourceId: string;
  title?: string | null;
  page: number | null;
  quote: string | null;
  verified?: boolean;
}

export interface CostLine {
  id: string;
  category: CostCategory;
  description: string;
  quantity: number | null;
  unit: string;
  unitCost: number | null;
  period: Period;
  /** Hvor mengden kommer fra. Enhetskosten er alltid bedriftens egen. */
  basis: 'bruker' | 'dokument' | 'ai';
  sourceRef?: SourceRef | null;
  /** Utregning AI-en har vist for en utledet mengde (f.eks. «2 vektere × 8 760 timer»). */
  calculation?: string | null;
  /** 'ai_import' = hentet inn fra AI-analysen (erstattes ved ny import hvis brukeren ikke har endret linjen). */
  origin?: 'ai_import' | 'bruker';
}

export interface CalcInputs {
  /** Forventet omsetning (eks. mva.) for hele perioden. */
  contractValue: number | null;
  contractValueBasis: 'dokument' | 'bruker' | 'mangler';
  durationMonths: number | null;
  durationBasis: 'dokument' | 'bruker' | 'mangler';
  isFramework: boolean;
  lines: CostLine[];
  overheadPct: number | null;
  riskBufferPct: number | null;
  targetMarginPct: number | null;
  minMarginPct: number | null;
  /** Prisen brukeren vil prøve («hva om vi byr X?»). */
  testPrice?: number | null;
  hourlyCost?: number | null;
  bidCostHours?: number | null;
}

export interface ComputedLine extends CostLine {
  periods: number | null;
  total: number | null;
  hours: number | null;
  included: boolean;
  formula: string;
  problem: string | null;
}

export interface PricePoint {
  key: 'selvkost' | 'minstepris' | 'malpris' | 'kontraktsverdi' | 'testpris';
  label: string;
  price: number;
  profit: number;
  marginPct: number;
  basis: Provenance;
  note?: string;
}

export interface SensitivityRow {
  increasePct: number;
  cost: number;
  profitAtTarget: number | null;
  marginAtTarget: number | null;
  profitAtContractValue: number | null;
  marginAtContractValue: number | null;
}

export interface Formula {
  label: string;
  formula: string;
  value: number;
  basis: Provenance;
}

export interface CalcResult {
  version: 1;
  lines: ComputedLine[];
  byCategory: Record<CostCategory, number>;
  directCost: number;
  overhead: number;
  breakEven: number;
  riskBuffer: number;
  costWithBuffer: number;
  minPrice: number | null;
  targetPrice: number | null;
  recommendedRange: { low: number; high: number } | null;
  atContractValue: PricePoint | null;
  scenarios: PricePoint[];
  sensitivity: SensitivityRow[];
  totalHours: number;
  hoursPerYear: number | null;
  bidCost: number | null;
  formulas: Formula[];
  warnings: string[];
  completeness: {
    linesIncluded: number;
    linesMissing: number;
    aiLines: number;
    hasContractValue: boolean;
    hasDuration: boolean;
    hasMargins: boolean;
  };
}

export const SENSITIVITY_STEPS = [5, 10, 20];
const HOUR_UNITS = new Set(['t', 'time', 'timer', 'h', 'hours', 'timeverk', 'arbeidstimer']);

export function isHourUnit(unit: string): boolean {
  return HOUR_UNITS.has(unit.trim().toLowerCase().replace(/\.$/, ''));
}

const nf = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 2 });
export function fmtNumber(n: number): string {
  return nf.format(Math.round(n * 100) / 100);
}
export function fmtKr(n: number): string {
  return `${new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 }).format(Math.round(n))} kr`;
}
function pct(n: number): string {
  return `${fmtNumber(n)} %`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Hvor mange ganger linjen gjentas i kontraktsperioden. */
export function periodsFor(period: Period, durationMonths: number | null): number | null {
  if (period === 'total') return 1;
  if (durationMonths === null || durationMonths <= 0) return null;
  return period === 'per_maaned' ? durationMonths : durationMonths / 12;
}

export function computeLine(line: CostLine, durationMonths: number | null): ComputedLine {
  const periods = periodsFor(line.period, durationMonths);
  const periodText =
    line.period === 'per_maaned' ? ` × ${periods !== null ? fmtNumber(periods) : '?'} mnd` : line.period === 'per_aar' ? ` × ${periods !== null ? fmtNumber(periods) : '?'} år` : '';
  let problem: string | null = null;
  if (line.quantity === null) problem = 'Mengde mangler';
  else if (line.unitCost === null) problem = 'Enhetskost mangler';
  else if (periods === null) problem = 'Kontraktens varighet mangler (linjen gjelder per periode)';
  const included = problem === null;
  const total = included ? round2(line.quantity! * line.unitCost! * periods!) : null;
  const hours = isHourUnit(line.unit) && line.quantity !== null && periods !== null ? round2(line.quantity * periods) : null;
  const formula = included
    ? `${fmtNumber(line.quantity!)} ${line.unit} × ${fmtKr(line.unitCost!)}${periodText} = ${fmtKr(total!)}`
    : `${line.quantity !== null ? fmtNumber(line.quantity) : '?'} ${line.unit} × ${line.unitCost !== null ? fmtKr(line.unitCost) : '? kr'}${periodText} – ${problem}`;
  return { ...line, periods, total, hours, included, formula, problem };
}

function pricePoint(key: PricePoint['key'], label: string, price: number, breakEven: number, basis: Provenance, note?: string): PricePoint {
  const profit = round2(price - breakEven);
  return { key, label, price: round2(price), profit, marginPct: price > 0 ? round2((profit / price) * 100) : 0, basis, ...(note ? { note } : {}) };
}

/** Pris som gir en gitt margin på kostnaden (inkl. risikopåslag). Null hvis marginen er ugyldig. */
export function priceForMargin(cost: number, marginPct: number): number | null {
  if (marginPct < 0 || marginPct >= 100) return null;
  return round2(cost / (1 - marginPct / 100));
}

export function calculate(inputs: CalcInputs): CalcResult {
  const warnings: string[] = [];
  const formulas: Formula[] = [];
  const lines = inputs.lines.map((l) => computeLine(l, inputs.durationMonths));
  const byCategory = Object.fromEntries(COST_CATEGORIES.map((c) => [c.id, 0])) as Record<CostCategory, number>;
  for (const l of lines) if (l.included) byCategory[l.category] = round2(byCategory[l.category] + l.total!);

  const directCost = round2(lines.reduce((sum, l) => sum + (l.total ?? 0), 0));
  const overheadPct = inputs.overheadPct ?? 0;
  const riskBufferPct = inputs.riskBufferPct ?? 0;
  const overhead = round2(directCost * (overheadPct / 100));
  const breakEven = round2(directCost + overhead);
  const riskBuffer = round2(breakEven * (riskBufferPct / 100));
  const costWithBuffer = round2(breakEven + riskBuffer);

  const linesMissing = lines.filter((l) => !l.included).length;
  const aiLines = lines.filter((l) => l.basis === 'ai').length;
  if (!lines.length) warnings.push('Kalkylen har ingen kostnadslinjer ennå.');
  if (linesMissing) warnings.push(`${linesMissing} ${linesMissing === 1 ? 'linje mangler' : 'linjer mangler'} mengde, enhetskost eller varighet og er holdt utenfor summen.`);
  if (aiLines) warnings.push(`${aiLines} ${aiLines === 1 ? 'mengde er et AI-estimat' : 'mengder er AI-estimater'} – kontroller dem mot dokumentene.`);
  if (inputs.overheadPct === null) warnings.push('Påslag for indirekte kostnader er ikke satt (regnet som 0 %).');
  if (inputs.riskBufferPct === null) warnings.push('Risikopåslag er ikke satt (regnet som 0 %).');

  formulas.push({ label: 'Direkte kostnader', formula: `Sum av ${lines.filter((l) => l.included).length} kostnadslinjer`, value: directCost, basis: 'beregnet' });
  formulas.push({ label: 'Indirekte kostnader', formula: `${fmtKr(directCost)} × ${pct(overheadPct)}`, value: overhead, basis: 'beregnet' });
  formulas.push({ label: 'Selvkost (pris uten tap)', formula: `${fmtKr(directCost)} + ${fmtKr(overhead)}`, value: breakEven, basis: 'beregnet' });
  formulas.push({ label: 'Risikopåslag', formula: `${fmtKr(breakEven)} × ${pct(riskBufferPct)}`, value: riskBuffer, basis: 'beregnet' });

  const hasMargins = inputs.targetMarginPct !== null && inputs.minMarginPct !== null;
  let minPrice: number | null = null;
  let targetPrice: number | null = null;
  if (hasMargins) {
    let minM = inputs.minMarginPct!;
    let targetM = inputs.targetMarginPct!;
    if (minM > targetM) {
      warnings.push('Minstemarginen er høyere enn ønsket margin – verdiene er byttet om i prisintervallet.');
      [minM, targetM] = [targetM, minM];
    }
    minPrice = priceForMargin(costWithBuffer, minM);
    targetPrice = priceForMargin(costWithBuffer, targetM);
    if (minPrice !== null) formulas.push({ label: `Minstepris (margin ${pct(minM)})`, formula: `(${fmtKr(breakEven)} + ${fmtKr(riskBuffer)}) ÷ (1 − ${pct(minM)})`, value: minPrice, basis: 'beregnet' });
    if (targetPrice !== null) formulas.push({ label: `Målpris (margin ${pct(targetM)})`, formula: `(${fmtKr(breakEven)} + ${fmtKr(riskBuffer)}) ÷ (1 − ${pct(targetM)})`, value: targetPrice, basis: 'beregnet' });
  } else {
    warnings.push('Ønsket margin og minstemargin er ikke satt – prisintervallet kan ikke beregnes.');
  }
  const recommendedRange = minPrice !== null && targetPrice !== null && directCost > 0 ? { low: minPrice, high: targetPrice } : null;

  const scenarios: PricePoint[] = [];
  if (directCost > 0) {
    scenarios.push(pricePoint('selvkost', 'Selvkost (ingen fortjeneste)', breakEven, breakEven, 'beregnet'));
    if (minPrice !== null) scenarios.push(pricePoint('minstepris', 'Minstepris', minPrice, breakEven, 'beregnet'));
    if (targetPrice !== null) scenarios.push(pricePoint('malpris', 'Målpris', targetPrice, breakEven, 'beregnet'));
  }
  let atContractValue: PricePoint | null = null;
  if (inputs.contractValue !== null && inputs.contractValue > 0) {
    atContractValue = pricePoint(
      'kontraktsverdi',
      inputs.contractValueBasis === 'dokument' ? 'Oppdragsgivers estimerte verdi' : 'Forventet omsetning (din opplysning)',
      inputs.contractValue,
      breakEven,
      inputs.contractValueBasis === 'dokument' ? 'dokument' : 'bruker',
      inputs.isFramework ? 'Rammeavtale: verdien er et anslag eller tak, ikke garantert omsetning.' : undefined,
    );
    if (directCost > 0) scenarios.push(atContractValue);
    if (minPrice !== null && minPrice > inputs.contractValue) {
      warnings.push(`Minsteprisen (${fmtKr(minPrice)}) er høyere enn kontraktsverdien (${fmtKr(inputs.contractValue)}). Oppdraget gir lavere margin enn dere krever ved denne verdien.`);
    }
  } else {
    warnings.push('Kontraktsverdi er ikke oppgitt i kunngjøringen og ikke lagt inn – fortjenesten ved oppdragsgivers verdi kan ikke beregnes.');
  }
  if (inputs.isFramework) warnings.push('Rammeavtale: oppgitt verdi er ofte et anslag eller tak. Sett forventet omsetning selv hvis dere har grunnlag for det.');
  if (inputs.testPrice && inputs.testPrice > 0 && directCost > 0) {
    scenarios.push(pricePoint('testpris', 'Din testpris', inputs.testPrice, breakEven, 'bruker'));
  }

  const sensitivity: SensitivityRow[] = [0, ...SENSITIVITY_STEPS].map((inc) => {
    const cost = round2(directCost * (1 + inc / 100) * (1 + overheadPct / 100));
    const at = (price: number | null) => (price && price > 0 ? { profit: round2(price - cost), margin: round2(((price - cost) / price) * 100) } : null);
    const t = at(targetPrice);
    const c = at(inputs.contractValue);
    return {
      increasePct: inc,
      cost,
      profitAtTarget: t?.profit ?? null,
      marginAtTarget: t?.margin ?? null,
      profitAtContractValue: c?.profit ?? null,
      marginAtContractValue: c?.margin ?? null,
    };
  });

  const totalHours = round2(lines.reduce((sum, l) => sum + (l.hours ?? 0), 0));
  const hoursPerYear = inputs.durationMonths && inputs.durationMonths > 0 ? round2(totalHours / (inputs.durationMonths / 12)) : null;
  if (totalHours > 0 && hoursPerYear === null) warnings.push('Varighet mangler – timer per år kan ikke beregnes.');
  const bidCost =
    inputs.bidCostHours !== null && inputs.bidCostHours !== undefined && inputs.hourlyCost !== null && inputs.hourlyCost !== undefined
      ? round2(inputs.bidCostHours * inputs.hourlyCost)
      : null;
  if (bidCost !== null) {
    formulas.push({ label: 'Kostnad ved å lage tilbudet', formula: `${fmtNumber(inputs.bidCostHours!)} timer × ${fmtKr(inputs.hourlyCost!)}`, value: bidCost, basis: 'beregnet' });
  }

  return {
    version: 1,
    lines,
    byCategory,
    directCost,
    overhead,
    breakEven,
    riskBuffer,
    costWithBuffer,
    minPrice,
    targetPrice,
    recommendedRange,
    atContractValue,
    scenarios,
    sensitivity,
    totalHours,
    hoursPerYear,
    bidCost,
    formulas,
    warnings,
    completeness: {
      linesIncluded: lines.length - linesMissing,
      linesMissing,
      aiLines,
      hasContractValue: inputs.contractValue !== null && inputs.contractValue > 0,
      hasDuration: inputs.durationMonths !== null && inputs.durationMonths > 0,
      hasMargins,
    },
  };
}

/** Maksimal dagbot i kroner når både tak (%) og pris er kjent. Ellers null – ingen gjetning. */
export function maxLiquidatedDamages(maxPercent: number | null, price: number | null): number | null {
  if (maxPercent === null || price === null || maxPercent <= 0 || price <= 0) return null;
  return round2((price * maxPercent) / 100);
}

/** Kapital bundet i utestående betaling: månedlig kostnad × betalingsfrist (dager) ÷ 30. */
export function workingCapital(breakEven: number, durationMonths: number | null, paymentDays: number | null): number | null {
  if (!durationMonths || durationMonths <= 0 || paymentDays === null || paymentDays <= 0 || breakEven <= 0) return null;
  return round2((breakEven / durationMonths) * (paymentDays / 30));
}
