/**
 * Kapasitetsanalyse: har bedriften folk, timer, utstyr og kvalifikasjoner til å gjennomføre kontrakten?
 * Bare bedriftens egne opplysninger og kravene i kunngjøringen brukes – ingen standardtall gjettes.
 */
import { containsTerm } from '@/domain/tenders/normalize';

export interface ExistingContract {
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  hoursPerMonth: number | null;
  /** Måneder (1–12) med arbeid, f.eks. vinterdrift [11, 12, 1, 2, 3]. Null = hele året. */
  activeMonths?: number[] | null;
}

export const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** Måneder fra avkrysningsbokser. Ingen eller alle tolv = hele året (null). */
export function parseMonths(values: unknown[]): number[] | null {
  const months = [...new Set(values.map((v) => Number(v)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 12))].sort((a, b) => a - b);
  return months.length === 0 || months.length === 12 ? null : months;
}

/** «hele året», «nov–mar», «jun–aug» eller «jan, mar, jun» (sammenhengende perioder også over nyttår). */
export function monthsLabel(months: number[] | null | undefined): string {
  if (!months?.length || months.length === 12) return 'hele året';
  const set = new Set(months);
  // Start en periode der forrige måned ikke er med (sirkulært, så nov–mar blir én periode).
  const runs: [number, number][] = [];
  for (const m of ALL_MONTHS) {
    if (!set.has(m) || set.has(m === 1 ? 12 : m - 1)) continue;
    let end = m;
    while (set.has(end === 12 ? 1 : end + 1) && (end === 12 ? 1 : end + 1) !== m) end = end === 12 ? 1 : end + 1;
    runs.push([m, end]);
  }
  return runs.map(([a, b]) => (a === b ? MONTH_SHORT[a - 1] : b === (a === 12 ? 1 : a + 1) ? `${MONTH_SHORT[a - 1]}, ${MONTH_SHORT[b - 1]}` : `${MONTH_SHORT[a - 1]}–${MONTH_SHORT[b - 1]}`)).join(', ');
}

export interface MonthLoad {
  month: number;
  /** Tilgjengelige timer i måneden (årstimer ÷ 12). */
  capacity: number;
  committed: number;
  required: number;
  /** Belastning i prosent av kapasiteten (eksisterende + dette oppdraget). */
  loadPct: number | null;
  /** Mangel i timer (positivt = for lite) – bare måneder dette oppdraget har arbeid. */
  gap: number | null;
}

export interface EquipmentItem {
  name: string;
  quantity: number;
}

export interface CapacityInput {
  availableHoursPerYear: number | null;
  employeeCount: number | null;
  contracts: ExistingContract[];
  /** Timer per år kontrakten krever (fra kalkylen). */
  requiredHoursPerYear: number | null;
  /** Måneder dette oppdraget har arbeid (sesong). Null = hele året. Timene fordeles likt på disse månedene. */
  requiredActiveMonths?: number[] | null;
  periodStart: Date;
  periodEnd: Date | null;
  /** Utstyr som nevnes i dokumentene (AI-kostnadsdrivere i kategorien utstyr). */
  equipmentNeeds: string[];
  equipment: EquipmentItem[];
  /** Kvalifikasjoner/krav som ikke ser ut til å være oppfylt (fra matching og egnethetsvurdering). */
  missingQualifications: string[];
}

export interface CapacityResult {
  availableHoursPerYear: number | null;
  committedHoursPerYear: number;
  freeHoursPerYear: number | null;
  requiredHoursPerYear: number | null;
  /** Mangel i timer per år (positivt = for lite kapasitet). */
  gapHoursPerYear: number | null;
  /** Mangel i prosent av behovet (positivt = for lite). */
  gapPct: number | null;
  utilizationPct: number | null;
  overlappingContracts: { name: string; hoursPerYear: number; overlapPct: number; hoursPerMonth: number; activeMonths: number[] | null }[];
  equipmentMatched: { need: string; have: string }[];
  equipmentMissing: string[];
  missingQualifications: string[];
  status: 'ok' | 'stram' | 'mangler' | 'ukjent';
  notes: string[];
  /** Belastning måned for måned (null når tilgjengelige timer ikke er registrert). */
  months: MonthLoad[] | null;
  /** Måneder der det mangler timer selv om året samlet kan gå opp (sesongtopp). */
  seasonalShortage: { months: number[]; maxGapHours: number } | null;
}

const DAY = 86_400_000;

function overlapFraction(aStart: Date, aEnd: Date, bStart: Date | null, bEnd: Date | null): number {
  const start = Math.max(aStart.getTime(), bStart?.getTime() ?? -Infinity);
  const end = Math.min(aEnd.getTime(), bEnd?.getTime() ?? Infinity);
  const total = aEnd.getTime() - aStart.getTime();
  if (end <= start || total <= 0) return 0;
  return (end - start) / total;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function analyzeCapacity(input: CapacityInput): CapacityResult {
  const notes: string[] = [];
  // Uten kjent slutt: vurder første 12 måneder.
  const periodEnd = input.periodEnd ?? new Date(input.periodStart.getTime() + 365 * DAY);
  if (!input.periodEnd) notes.push('Kontraktens varighet er ukjent – kapasiteten er vurdert for de første 12 månedene.');

  const overlapping = input.contracts
    .map((c) => {
      const fraction = overlapFraction(input.periodStart, periodEnd, c.startDate, c.endDate);
      // Sesongkontrakter har timer bare i sine måneder.
      const monthsPerYear = c.activeMonths?.length ?? 12;
      return { name: c.name, hoursPerYear: round1((c.hoursPerMonth ?? 0) * monthsPerYear * fraction), overlapPct: Math.round(fraction * 100), activeMonths: c.activeMonths ?? null, hoursPerMonth: c.hoursPerMonth ?? 0 };
    })
    .filter((c) => c.hoursPerYear > 0);
  const committedHoursPerYear = round1(overlapping.reduce((s, c) => s + c.hoursPerYear, 0));
  if (input.contracts.some((c) => c.hoursPerMonth === null)) notes.push('Noen eksisterende kontrakter mangler timer per måned og er ikke regnet med.');

  const available = input.availableHoursPerYear;
  const freeHoursPerYear = available !== null ? round1(available - committedHoursPerYear) : null;
  const required = input.requiredHoursPerYear;
  let gapHoursPerYear: number | null = null;
  let gapPct: number | null = null;
  let utilizationPct: number | null = null;
  if (available === null) notes.push('Tilgjengelige timer per år er ikke registrert under Kapasitet og økonomi.');
  if (required === null || required <= 0) notes.push('Timebehovet per år er ukjent: kalkylen har ingen arbeidstimer, eller varigheten mangler.');
  if (freeHoursPerYear !== null && required !== null && required > 0) {
    gapHoursPerYear = round1(required - freeHoursPerYear);
    gapPct = round1((gapHoursPerYear / required) * 100);
    utilizationPct = available && available > 0 ? round1(((committedHoursPerYear + required) / available) * 100) : null;
  }

  const equipmentMatched: { need: string; have: string }[] = [];
  const equipmentMissing: string[] = [];
  for (const need of input.equipmentNeeds) {
    const have = input.equipment.find(
      (e) => e.quantity > 0 && (containsTerm(need, e.name) || containsTerm(e.name, need.split(/\s+/).slice(0, 2).join(' '))),
    );
    if (have) equipmentMatched.push({ need, have: have.name });
    else equipmentMissing.push(need);
  }

  // Måned for måned: årstimene likt fordelt, eksisterende kontrakter i sine måneder, oppdraget i sine.
  let months: MonthLoad[] | null = null;
  let seasonalShortage: CapacityResult['seasonalShortage'] = null;
  if (available !== null && available > 0) {
    const perMonth = available / 12;
    const reqMonths = input.requiredActiveMonths?.length ? input.requiredActiveMonths : ALL_MONTHS;
    const reqPerMonth = required !== null && required > 0 ? required / reqMonths.length : 0;
    months = ALL_MONTHS.map((m) => {
      const committed = round1(overlapping.reduce((sum, c) => sum + ((c.activeMonths ?? ALL_MONTHS).includes(m) ? c.hoursPerMonth : 0), 0));
      const req = reqMonths.includes(m) ? round1(reqPerMonth) : 0;
      return {
        month: m,
        capacity: round1(perMonth),
        committed,
        required: req,
        loadPct: Math.round(((committed + req) / perMonth) * 100),
        gap: req > 0 ? round1(req - (perMonth - committed)) : null,
      };
    });
    const short = months.filter((m) => m.gap !== null && m.gap > 0.5);
    if (short.length) {
      seasonalShortage = { months: short.map((m) => m.month), maxGapHours: Math.max(...short.map((m) => m.gap!)) };
      if (gapHoursPerYear !== null && gapHoursPerYear <= 0) {
        notes.push(
          `Sesongtopp: i ${monthsLabel(seasonalShortage.months)} mangler dere opptil ${Math.round(seasonalShortage.maxGapHours)} timer per måned, selv om året samlet går opp.`,
        );
      }
    }
    notes.push('Tilgjengelige timer er fordelt likt på årets måneder – ferie og fravær er ikke trukket fra per måned.');
  }

  let status: CapacityResult['status'] = 'ukjent';
  if (gapHoursPerYear !== null) status = gapHoursPerYear > 0 ? 'mangler' : utilizationPct !== null && utilizationPct > 90 ? 'stram' : 'ok';
  // Mangel i enkelte måneder: «mangler» når toppen er over 10 % av månedens behov, ellers «stram».
  if (seasonalShortage && status !== 'mangler' && months) {
    const worst = months.filter((m) => m.gap !== null && m.gap > 0.5).some((m) => m.required > 0 && m.gap! / m.required > 0.1);
    status = worst ? 'mangler' : 'stram';
  }
  if (status === 'ok' && (equipmentMissing.length || input.missingQualifications.length)) status = 'stram';
  if (input.missingQualifications.length && status !== 'mangler') status = status === 'ukjent' ? 'ukjent' : 'stram';

  return {
    availableHoursPerYear: available,
    committedHoursPerYear,
    freeHoursPerYear,
    requiredHoursPerYear: required,
    gapHoursPerYear,
    gapPct,
    utilizationPct,
    overlappingContracts: overlapping,
    equipmentMatched,
    equipmentMissing,
    missingQualifications: input.missingQualifications,
    status,
    notes,
    months,
    seasonalShortage,
  };
}
