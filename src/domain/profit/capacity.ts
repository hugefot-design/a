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
  overlappingContracts: { name: string; hoursPerYear: number; overlapPct: number }[];
  equipmentMatched: { need: string; have: string }[];
  equipmentMissing: string[];
  missingQualifications: string[];
  status: 'ok' | 'stram' | 'mangler' | 'ukjent';
  notes: string[];
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
      return { name: c.name, hoursPerYear: round1((c.hoursPerMonth ?? 0) * 12 * fraction), overlapPct: Math.round(fraction * 100) };
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

  let status: CapacityResult['status'] = 'ukjent';
  if (gapHoursPerYear !== null) status = gapHoursPerYear > 0 ? 'mangler' : utilizationPct !== null && utilizationPct > 90 ? 'stram' : 'ok';
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
  };
}
