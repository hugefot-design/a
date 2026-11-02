/**
 * Profit Intelligence – tjenestelaget.
 *
 * Henter dokumenterte fakta (kunngjøring, dokumenter, AI-funn med kontrollerte sitater),
 * bedriftens egne tall (økonomi, bemanning, utstyr, kontrakter, kalkylelinjer) og setter dem
 * sammen med den deterministiske kalkulatoren, vilkårsskanneren, kapasitetsanalysen og
 * anbefalingsmotoren. Ingen tall finnes på her: mangler noe, vises det som mangel.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { first, toJson, type Tx } from '@/lib/db';
import { audit } from '@/lib/audit';
import type { OrgContext } from '@/server/http';
import { CERT_BY_ID } from '@/domain/reference';
import { getTender, type TenderDetail } from '@/domain/tenders/queries';
import { getProfile, type CompanyProfile } from '@/domain/profile/profile';
import { detectCertifications, LEGAL_REQUIREMENTS, requiredTurnover } from '@/domain/matching/engine';
import { getLatestFitAssessment, loadDocumentSources, noticeSource } from '@/domain/ai/analysis';
import type { AnalysisSource } from '@/domain/ai/sources';
import {
  calculate,
  COST_CATEGORIES,
  fmtKr,
  fmtNumber,
  isHourUnit,
  maxLiquidatedDamages,
  PERIODS,
  workingCapital,
  type CalcInputs,
  type CalcResult,
  type CostCategory,
  type CostLine,
  type Period,
} from './calculator';
import { scanContractTerms, type TermScan } from './terms-scan';
import { analyzeCapacity, type CapacityResult } from './capacity';
import { recommend, type Recommendation, type RecommendationResult, type RiskLevel } from './recommendation';
import { getLatestProfitAnalysis, PROFIT_RISK_LABELS, type ProfitRiskCategory, type StoredProfitAnalysis } from './ai';
import { suggestPartners, type PartnerGaps, type PartnerSuggestion } from './partners';

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Tall fra skjema (norsk format: «1 500,50», «1.500», «12 %», «650 kr»)
// ---------------------------------------------------------------------------
export function parseNumber(raw: string | null | undefined): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  let s = raw.replace(/[\s  ]/g, '').replace(/(kr|nok|%|t|timer)$/i, '');
  if (s === '') return null;
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return 'invalid';
  const n = Number(s);
  return Number.isFinite(n) ? n : 'invalid';
}

/** zod-felt for valgfrie tall med grenser. Tom streng = null (ikke satt). */
function optionalNumber(label: string, min: number, max: number, int = false) {
  return z
    .string()
    .max(40)
    .transform((v, ctx) => {
      const n = parseNumber(v);
      if (n === 'invalid') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label}: «${v}» er ikke et tall.` });
        return z.NEVER;
      }
      if (n !== null && (n < min || n > max)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} må være mellom ${fmtNumber(min)} og ${fmtNumber(max)}.` });
        return z.NEVER;
      }
      return n === null ? null : int ? Math.round(n) : n;
    });
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------
// Bedriftens økonomi og kapasitet
// ---------------------------------------------------------------------------
export interface OrgEconomics {
  hourlyCost: number | null;
  overheadPct: number | null;
  targetMarginPct: number | null;
  minMarginPct: number | null;
  riskBufferPct: number | null;
  bidCostHours: number | null;
  notes: string | null;
  updatedAt: Date | null;
}

const EMPTY_ECONOMICS: OrgEconomics = {
  hourlyCost: null,
  overheadPct: null,
  targetMarginPct: null,
  minMarginPct: null,
  riskBufferPct: null,
  bidCostHours: null,
  notes: null,
  updatedAt: null,
};

export const economicsSchema = z.object({
  hourlyCost: optionalNumber('Kostnad per arbeidstime', 0, 100_000),
  overheadPct: optionalNumber('Påslag for indirekte kostnader', 0, 300),
  targetMarginPct: optionalNumber('Ønsket margin', 0, 90),
  minMarginPct: optionalNumber('Minstemargin', 0, 90),
  riskBufferPct: optionalNumber('Risikopåslag', 0, 100),
  bidCostHours: optionalNumber('Timer brukt på et tilbud', 0, 10_000),
  notes: optionalText(2000),
});
export type EconomicsForm = z.infer<typeof economicsSchema>;

export function economicsFromData(form: FormData) {
  return Object.fromEntries(['hourlyCost', 'overheadPct', 'targetMarginPct', 'minMarginPct', 'riskBufferPct', 'bidCostHours', 'notes'].map((k) => [k, str(form, k)]));
}

export async function getEconomics(tx: Tx, orgId: string): Promise<OrgEconomics> {
  const row = first(
    (await tx`
      select hourly_cost, overhead_pct, target_margin_pct, min_margin_pct, risk_buffer_pct, bid_cost_hours, notes, updated_at
      from org_economics where org_id = ${orgId}
    `) as unknown as OrgEconomics[],
  );
  return row ?? EMPTY_ECONOMICS;
}

export async function saveEconomics(tx: Tx, ctx: { orgId: string; userId: string; ipHash?: string }, d: EconomicsForm): Promise<void> {
  await tx`
    insert into org_economics (org_id, hourly_cost, overhead_pct, target_margin_pct, min_margin_pct, risk_buffer_pct, bid_cost_hours, notes, updated_by, updated_at)
    values (${ctx.orgId}, ${d.hourlyCost}, ${d.overheadPct}, ${d.targetMarginPct}, ${d.minMarginPct}, ${d.riskBufferPct}, ${d.bidCostHours}, ${d.notes}, ${ctx.userId}, now())
    on conflict (org_id) do update set
      hourly_cost = excluded.hourly_cost, overhead_pct = excluded.overhead_pct, target_margin_pct = excluded.target_margin_pct,
      min_margin_pct = excluded.min_margin_pct, risk_buffer_pct = excluded.risk_buffer_pct, bid_cost_hours = excluded.bid_cost_hours,
      notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now()
  `;
  await audit({ action: 'profit.economics_updated', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'org_economics', targetId: ctx.orgId, ipHash: ctx.ipHash }, tx);
}

export interface StaffGroup {
  id: string;
  role: string;
  headcount: number;
  hoursPerYearEach: number | null;
  certifications: string[];
  notes: string | null;
}
export interface EquipmentRow {
  id: string;
  name: string;
  category: string | null;
  quantity: number;
  notes: string | null;
}
export interface ContractRow {
  id: string;
  name: string;
  client: string | null;
  startDate: Date | null;
  endDate: Date | null;
  hoursPerMonth: number | null;
  notes: string | null;
}

const splitList = (v: string) =>
  [
    ...new Set(
      v
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];

export const staffSchema = z.object({
  role: z.string().trim().min(1, 'Skriv inn rolle eller fag (f.eks. «Vekter» eller «Tømrer»).').max(160),
  headcount: optionalNumber('Antall', 0, 100_000, true).refine((v) => v !== null, 'Skriv inn antall personer.'),
  hoursPerYearEach: optionalNumber('Timer per person per år', 0, 4000),
  certifications: z
    .string()
    .max(3000)
    .transform((v) => splitList(v).map((c) => c.slice(0, 100)).slice(0, 30)),
  notes: optionalText(1000),
});

export const equipmentSchema = z.object({
  name: z.string().trim().min(1, 'Skriv inn navn på utstyret.').max(200),
  category: optionalText(60),
  quantity: optionalNumber('Antall', 0, 100_000, true).transform((v) => v ?? 1),
  notes: optionalText(1000),
});

const optionalDate = z
  .string()
  .trim()
  .refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Bruk datoformatet ÅÅÅÅ-MM-DD.')
  .transform((v) => (v === '' ? null : new Date(`${v}T00:00:00Z`)));

export const contractSchema = z
  .object({
    name: z.string().trim().min(1, 'Skriv inn navnet på kontrakten.').max(200),
    client: optionalText(200),
    startDate: optionalDate,
    endDate: optionalDate,
    hoursPerMonth: optionalNumber('Timer per måned', 0, 100_000),
    notes: optionalText(1000),
  })
  .refine((d) => !d.startDate || !d.endDate || d.startDate <= d.endDate, { message: 'Startdato må være før sluttdato.', path: ['endDate'] });

export function formFields(form: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, str(form, k)]));
}

export async function listStaff(tx: Tx, orgId: string): Promise<StaffGroup[]> {
  return (await tx`
    select id, role, headcount, hours_per_year_each, certifications, notes from org_staff where org_id = ${orgId} order by created_at
  `) as unknown as StaffGroup[];
}
export async function listEquipment(tx: Tx, orgId: string): Promise<EquipmentRow[]> {
  return (await tx`select id, name, category, quantity, notes from org_equipment where org_id = ${orgId} order by created_at`) as unknown as EquipmentRow[];
}
export async function listContracts(tx: Tx, orgId: string): Promise<ContractRow[]> {
  return (await tx`
    select id, name, client, start_date, end_date, hours_per_month, notes from org_contracts where org_id = ${orgId}
    order by end_date nulls last, created_at
  `) as unknown as ContractRow[];
}

const CAPACITY_LIMIT = 200;

export async function addStaff(tx: Tx, ctx: { orgId: string; userId: string }, d: z.infer<typeof staffSchema>): Promise<string | null> {
  const [{ n } = { n: 0 }] = (await tx`select count(*)::int as n from org_staff where org_id = ${ctx.orgId}`) as unknown as { n: number }[];
  if (n >= CAPACITY_LIMIT) return `Dere kan registrere høyst ${CAPACITY_LIMIT} roller.`;
  await tx`
    insert into org_staff (org_id, role, headcount, hours_per_year_each, certifications, notes, created_by)
    values (${ctx.orgId}, ${d.role}, ${d.headcount!}, ${d.hoursPerYearEach}, ${d.certifications}::text[], ${d.notes}, ${ctx.userId})
  `;
  await audit({ action: 'profit.capacity_updated', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'org_staff', metadata: { op: 'add' } }, tx);
  return null;
}
export async function addEquipment(tx: Tx, ctx: { orgId: string; userId: string }, d: z.infer<typeof equipmentSchema>): Promise<string | null> {
  const [{ n } = { n: 0 }] = (await tx`select count(*)::int as n from org_equipment where org_id = ${ctx.orgId}`) as unknown as { n: number }[];
  if (n >= CAPACITY_LIMIT) return `Dere kan registrere høyst ${CAPACITY_LIMIT} typer utstyr.`;
  await tx`
    insert into org_equipment (org_id, name, category, quantity, notes, created_by)
    values (${ctx.orgId}, ${d.name}, ${d.category}, ${d.quantity}, ${d.notes}, ${ctx.userId})
  `;
  await audit({ action: 'profit.capacity_updated', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'org_equipment', metadata: { op: 'add' } }, tx);
  return null;
}
export async function addContract(tx: Tx, ctx: { orgId: string; userId: string }, d: z.infer<typeof contractSchema>): Promise<string | null> {
  const [{ n } = { n: 0 }] = (await tx`select count(*)::int as n from org_contracts where org_id = ${ctx.orgId}`) as unknown as { n: number }[];
  if (n >= CAPACITY_LIMIT) return `Dere kan registrere høyst ${CAPACITY_LIMIT} kontrakter.`;
  await tx`
    insert into org_contracts (org_id, name, client, start_date, end_date, hours_per_month, notes, created_by)
    values (${ctx.orgId}, ${d.name}, ${d.client}, ${d.startDate}, ${d.endDate}, ${d.hoursPerMonth}, ${d.notes}, ${ctx.userId})
  `;
  await audit({ action: 'profit.capacity_updated', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'org_contracts', metadata: { op: 'add' } }, tx);
  return null;
}

/** Sletter en rad i en av kapasitetstabellene. RLS sikrer at bare egne rader og bare eier/admin kan slette. */
export async function deleteCapacityRow(tx: Tx, ctx: { orgId: string; userId: string }, table: 'org_staff' | 'org_equipment' | 'org_contracts', id: string): Promise<boolean> {
  const rows = await tx`delete from ${tx(table)} where id = ${id} and org_id = ${ctx.orgId} returning id`;
  if (rows.length) await audit({ action: 'profit.capacity_updated', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: table, targetId: id, metadata: { op: 'delete' } }, tx);
  return rows.length > 0;
}

export interface CapacityData {
  economics: OrgEconomics;
  staff: StaffGroup[];
  equipment: EquipmentRow[];
  contracts: ContractRow[];
  /** Sum av antall × timer for roller der timer er registrert. Null hvis ingen har timer. */
  availableHoursPerYear: number | null;
  staffWithoutHours: number;
  staffCertificationText: string;
}

export async function loadCapacityData(tx: Tx, orgId: string): Promise<CapacityData> {
  const [economics, staff, equipment, contracts] = await Promise.all([getEconomics(tx, orgId), listStaff(tx, orgId), listEquipment(tx, orgId), listContracts(tx, orgId)]);
  const withHours = staff.filter((s) => s.hoursPerYearEach !== null);
  return {
    economics,
    staff,
    equipment,
    contracts,
    availableHoursPerYear: withHours.length ? Math.round(withHours.reduce((sum, s) => sum + s.headcount * s.hoursPerYearEach!, 0) * 10) / 10 : null,
    staffWithoutHours: staff.length - withHours.length,
    staffCertificationText: staff.flatMap((s) => s.certifications).join(' · '),
  };
}

// ---------------------------------------------------------------------------
// Kalkyle for ett anbud
// ---------------------------------------------------------------------------
export interface StoredInputs extends CalcInputs {
  /** Brukerens egen vurdering av kontraktsrisikoen (brukes når AI-analyse mangler, eller overstyrer den). */
  userRiskLevel: Exclude<RiskLevel, 'ukjent'> | null;
  /** Brukeren bekrefter at kontraktsvilkårene er gjennomgått. */
  termsReviewedByUser: boolean;
  notes: string | null;
  importedAnalysisId: string | null;
}

export interface Documented {
  /** Verdi i kroner fra kunngjøringen (eller kontrollert AI-funn), ellers null. */
  contractValue: number | null;
  contractValueNote: string | null;
  durationMonths: number | null;
}

/** Hva dokumentene faktisk sier om verdi og varighet. Annen valuta enn NOK omregnes ikke. */
export function documentedFacts(tender: TenderDetail): Documented {
  const nok = tender.currency === null || tender.currency === 'NOK';
  return {
    contractValue: nok && tender.estimatedValue !== null && tender.estimatedValue > 0 ? tender.estimatedValue : null,
    contractValueNote:
      !nok && tender.estimatedValue !== null
        ? `Kunngjøringen oppgir verdien i ${tender.currency}. Vi regner ikke om valuta – legg inn forventet omsetning i kroner selv.`
        : null,
    durationMonths: tender.durationMonths !== null && tender.durationMonths > 0 ? tender.durationMonths : null,
  };
}

export function defaultInputs(tender: TenderDetail, economics: OrgEconomics): StoredInputs {
  const doc = documentedFacts(tender);
  return {
    contractValue: doc.contractValue,
    contractValueBasis: doc.contractValue !== null ? 'dokument' : 'mangler',
    durationMonths: doc.durationMonths,
    durationBasis: doc.durationMonths !== null ? 'dokument' : 'mangler',
    isFramework: tender.isFramework === true,
    lines: [],
    overheadPct: economics.overheadPct,
    riskBufferPct: economics.riskBufferPct,
    targetMarginPct: economics.targetMarginPct,
    minMarginPct: economics.minMarginPct,
    hourlyCost: economics.hourlyCost,
    bidCostHours: economics.bidCostHours,
    userRiskLevel: null,
    termsReviewedByUser: false,
    notes: null,
    importedAnalysisId: null,
  };
}

export const MAX_LINES = 60;
const CATEGORY_IDS = new Set<string>(COST_CATEGORIES.map((c) => c.id));
const PERIOD_IDS = new Set<string>(PERIODS.map((p) => p.id));

/**
 * Leser kalkyleskjemaet. Opphav bevares fra lagrede linjer: en linje fra dokument/AI beholder
 * opphavet så lenge mengden er uendret – endrer brukeren mengden, blir det brukerens tall.
 */
export function parseCalcForm(form: FormData, previous: StoredInputs | null, documented: Documented): { inputs: StoredInputs; errors: string[] } {
  const errors: string[] = [];
  const num = (label: string, raw: string, min: number, max: number): number | null => {
    const n = parseNumber(raw);
    if (n === 'invalid') {
      errors.push(`${label}: «${raw.slice(0, 30)}» er ikke et tall.`);
      return null;
    }
    if (n !== null && (n < min || n > max)) {
      errors.push(`${label} må være mellom ${fmtNumber(min)} og ${fmtNumber(max)}.`);
      return null;
    }
    return n;
  };
  const prevLines = new Map((previous?.lines ?? []).map((l) => [l.id, l]));
  const all = (k: string) => form.getAll(k).map((v) => (typeof v === 'string' ? v : ''));
  const ids = all('l_id');
  const categories = all('l_category');
  const descriptions = all('l_description');
  const quantities = all('l_quantity');
  const units = all('l_unit');
  const unitCosts = all('l_unitCost');
  const periods = all('l_period');
  const lines: CostLine[] = [];
  for (let i = 0; i < descriptions.length; i++) {
    const description = (descriptions[i] ?? '').trim().slice(0, 200);
    const qRaw = quantities[i] ?? '';
    const cRaw = unitCosts[i] ?? '';
    if (!description && !qRaw.trim() && !cRaw.trim()) continue;
    if (lines.length >= MAX_LINES) {
      errors.push(`Kalkylen kan ha høyst ${MAX_LINES} linjer.`);
      break;
    }
    const label = `Linje ${lines.length + 1}${description ? ` («${description.slice(0, 40)}»)` : ''}`;
    const quantity = num(`${label}, mengde`, qRaw, 0, 1e9);
    const unitCost = num(`${label}, enhetskost`, cRaw, 0, 1e9);
    const category = (CATEGORY_IDS.has(categories[i] ?? '') ? categories[i] : 'annet') as CostCategory;
    const period = (PERIOD_IDS.has(periods[i] ?? '') ? periods[i] : 'total') as Period;
    const unit = (units[i] ?? '').trim().slice(0, 30) || 'enheter';
    const prev = ids[i] ? prevLines.get(ids[i]!) : undefined;
    const keepsSource = prev && prev.basis !== 'bruker' && prev.quantity === quantity && prev.unit === unit && prev.period === period;
    lines.push({
      id: prev?.id ?? randomUUID(),
      category,
      description: description || 'Uten beskrivelse',
      quantity,
      unit,
      unitCost,
      period,
      basis: keepsSource ? prev.basis : 'bruker',
      sourceRef: prev?.sourceRef ?? null,
      calculation: keepsSource ? (prev.calculation ?? null) : null,
      origin: prev?.origin ?? 'bruker',
    });
  }
  const contractValue = num('Kontraktsverdi', str(form, 'contractValue'), 0, 1e12);
  const durationMonths = num('Varighet', str(form, 'durationMonths'), 0, 600);
  const risk = str(form, 'userRiskLevel');
  const inputs: StoredInputs = {
    contractValue: contractValue && contractValue > 0 ? contractValue : null,
    contractValueBasis:
      !contractValue || contractValue <= 0 ? 'mangler' : documented.contractValue !== null && Math.abs(contractValue - documented.contractValue) < 0.5 ? 'dokument' : previous?.contractValueBasis === 'dokument' && previous.contractValue === contractValue ? 'dokument' : 'bruker',
    durationMonths: durationMonths && durationMonths > 0 ? durationMonths : null,
    durationBasis:
      !durationMonths || durationMonths <= 0 ? 'mangler' : documented.durationMonths !== null && durationMonths === documented.durationMonths ? 'dokument' : previous?.durationBasis === 'dokument' && previous.durationMonths === durationMonths ? 'dokument' : 'bruker',
    isFramework: str(form, 'isFramework') === 'on',
    lines,
    overheadPct: num('Påslag for indirekte kostnader', str(form, 'overheadPct'), 0, 300),
    riskBufferPct: num('Risikopåslag', str(form, 'riskBufferPct'), 0, 100),
    targetMarginPct: num('Ønsket margin', str(form, 'targetMarginPct'), 0, 90),
    minMarginPct: num('Minstemargin', str(form, 'minMarginPct'), 0, 90),
    hourlyCost: num('Kostnad per arbeidstime', str(form, 'hourlyCost'), 0, 100_000),
    bidCostHours: num('Timer brukt på tilbudet', str(form, 'bidCostHours'), 0, 10_000),
    userRiskLevel: risk === 'lav' || risk === 'middels' || risk === 'høy' ? risk : null,
    termsReviewedByUser: str(form, 'termsReviewedByUser') === 'on',
    notes: str(form, 'notes').trim().slice(0, 2000) || null,
    importedAnalysisId: previous?.importedAnalysisId ?? null,
  };
  return { inputs, errors };
}

/** Linjer fra AI-analysen. Enhetskosten er bedriftens egen timekost for timer – ellers tom. */
export function linesFromAnalysis(analysis: StoredProfitAnalysis, economics: OrgEconomics): CostLine[] {
  return analysis.data.cost_drivers.map((d, i) => {
    const unit = d.unit?.trim() || 'enheter';
    const verified = analysis.checks?.costDrivers?.[i] === true;
    const ref = d.source;
    const refCheck = ref ? Object.values(analysis.verification).find((v) => v.sourceId === ref.source_id && v.quote === ref.quote) : undefined;
    return {
      id: randomUUID(),
      category: d.category,
      description: `${d.description}${d.period === 'ukjent' && d.quantity !== null ? ' (periode uklar – kontroller)' : ''}`.slice(0, 200),
      quantity: d.quantity,
      unit,
      unitCost: isHourUnit(unit) ? economics.hourlyCost : null,
      period: d.period === 'ukjent' ? 'total' : d.period,
      basis: d.quantity_basis === 'kilde' && verified ? 'dokument' : 'ai',
      sourceRef: ref
        ? { sourceId: ref.source_id, title: refCheck?.sourceTitle ?? null, page: refCheck ? refCheck.page : null, quote: ref.quote, verified: refCheck?.quoteVerified ?? false }
        : null,
      calculation: d.calculation,
      origin: 'ai_import',
    } satisfies CostLine;
  });
}

/** Henter AI-funn inn i kalkylen: erstatter tidligere importerte linjer brukeren ikke har endret. */
export function mergeAnalysisIntoInputs(inputs: StoredInputs, analysis: StoredProfitAnalysis, economics: OrgEconomics): { inputs: StoredInputs; added: number } {
  const kept = inputs.lines.filter((l) => l.origin !== 'ai_import' || l.basis === 'bruker');
  const imported = linesFromAnalysis(analysis, economics).filter(
    (n) => !kept.some((k) => k.description.toLowerCase() === n.description.toLowerCase() && k.category === n.category),
  );
  const next: StoredInputs = { ...inputs, lines: [...kept, ...imported].slice(0, MAX_LINES), importedAnalysisId: analysis.id };
  // Kontraktsverdi og varighet hentes bare når de mangler og tallet er kontrollert mot sitatet.
  if (next.contractValue === null) {
    const idx = analysis.data.stated_values.findIndex(
      (v, i) => analysis.checks?.statedValues?.[i] === true && v.period === 'total' && (v.currency === null || /^(nok|kr)$/i.test(v.currency)),
    );
    if (idx >= 0) {
      next.contractValue = analysis.data.stated_values[idx]!.amount;
      next.contractValueBasis = 'dokument';
    }
  }
  if (next.durationMonths === null && analysis.data.duration.months !== null && analysis.checks?.duration === true) {
    next.durationMonths = analysis.data.duration.months;
    next.durationBasis = 'dokument';
  }
  return { inputs: next, added: imported.length };
}

// ---------------------------------------------------------------------------
// Risiko
// ---------------------------------------------------------------------------
export interface RiskFinding {
  category: ProfitRiskCategory;
  categoryLabel: string;
  title: string;
  finding: string;
  economicImpact: string;
  severity: 'lav' | 'middels' | 'høy';
  basis: 'kilde' | 'tolkning';
  source: { sourceId: string; title: string | null; page: number | null; quote: string | null; verified: boolean } | null;
  /** Konsekvens regnet ut av kalkulatoren (bare når tallet står i et kontrollert sitat). */
  consequence: string | null;
  /** Tall AI-en oppga som ikke ble funnet i sitatet – brukes ikke i beregninger. */
  unverifiedNumbers: string[];
}

export interface RiskView {
  level: RiskLevel;
  levelSource: 'ai' | 'bruker' | 'ukjent';
  findings: RiskFinding[];
  highRisks: string[];
  scan: TermScan;
  contractTermsAnalyzed: boolean;
  documentsAnalyzed: number;
}

export function buildRiskView(analysis: StoredProfitAnalysis | null, scan: TermScan, inputs: StoredInputs, calc: CalcResult): RiskView {
  const findings: RiskFinding[] = [];
  const refPrice = calc.targetPrice ?? inputs.contractValue;
  for (const [i, r] of (analysis?.data.contract_risks ?? []).entries()) {
    const check = analysis?.checks?.risks?.[i];
    const refCheck = r.source ? Object.values(analysis!.verification).find((v) => v.sourceId === r.source!.source_id && v.quote === r.source!.quote) : undefined;
    const unverified: string[] = [];
    if (r.percent !== null && check?.percent !== true) unverified.push(`${fmtNumber(r.percent)} %`);
    if (r.days !== null && check?.days !== true) unverified.push(`${fmtNumber(r.days)} dager`);
    if (r.amount !== null && check?.amount !== true) unverified.push(fmtKr(r.amount));
    let consequence: string | null = null;
    if (r.category === 'dagbot' && r.percent !== null && check?.percent === true) {
      const max = maxLiquidatedDamages(r.percent, refPrice);
      if (max !== null) consequence = `Maks samlet dagbot ved ${fmtKr(refPrice!)}: ${fmtKr(max)} (${fmtNumber(r.percent)} % tak).`;
    } else if (r.category === 'betalingsvilkar' && r.days !== null && check?.days === true) {
      const wc = workingCapital(calc.breakEven, inputs.durationMonths, r.days);
      if (wc !== null) consequence = `Kapital bundet i utestående betaling: ca. ${fmtKr(wc)} (månedlig selvkost × ${fmtNumber(r.days)} dager ÷ 30).`;
    } else if (r.category === 'garanti' && r.percent !== null && check?.percent === true && refPrice) {
      consequence = `Garantibeløp ved ${fmtKr(refPrice)}: ${fmtKr((refPrice * r.percent) / 100)}. Spør banken hva garantien koster – vi anslår ikke gebyret.`;
    }
    findings.push({
      category: r.category,
      categoryLabel: PROFIT_RISK_LABELS[r.category],
      title: r.title,
      finding: r.finding,
      economicImpact: r.economic_impact,
      severity: r.severity,
      basis: r.basis,
      // Sidetallet vises bare når det er kontrollert (finnes i dokumentet) – ellers «side ukjent».
      source: r.source
        ? { sourceId: r.source.source_id, title: refCheck?.sourceTitle ?? null, page: refCheck ? refCheck.page : null, quote: r.source.quote, verified: check?.quote === true }
        : null,
      consequence,
      unverifiedNumbers: unverified,
    });
  }
  const severityOrder = { høy: 0, middels: 1, lav: 2 } as const;
  findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const documentsAnalyzed = analysis?.documentsAnalyzed ?? 0;
  const highRisks = findings.filter((f) => f.severity === 'høy').map((f) => f.title);

  let aiLevel: RiskLevel = 'ukjent';
  if (analysis) {
    if (highRisks.length) aiLevel = 'høy';
    else if (findings.some((f) => f.severity === 'middels')) aiLevel = documentsAnalyzed > 0 ? 'middels' : 'ukjent';
    else if (documentsAnalyzed > 0) aiLevel = 'lav';
  }
  const level: RiskLevel = inputs.userRiskLevel ?? aiLevel;
  return {
    level,
    levelSource: inputs.userRiskLevel ? 'bruker' : aiLevel !== 'ukjent' ? 'ai' : 'ukjent',
    findings,
    highRisks,
    scan,
    contractTermsAnalyzed: documentsAnalyzed > 0 || inputs.termsReviewedByUser,
    documentsAnalyzed,
  };
}

// ---------------------------------------------------------------------------
// Kvalifikasjoner
// ---------------------------------------------------------------------------
export interface QualificationView {
  required: { id: string; label: string; legal: boolean; have: boolean; via: 'profil' | 'bemanning' | null }[];
  missing: string[];
  missingCertIds: string[];
  turnover: { required: number; have: number | null; ok: boolean | null } | null;
  aiUnfulfilled: string[];
}

export function assessQualifications(sources: AnalysisSource[], profile: CompanyProfile | null, capacity: CapacityData, fitUnfulfilled: string[]): QualificationView {
  const text = sources.flatMap((s) => s.pages.map((p) => p.text)).join('\n').slice(0, 400_000);
  const required = detectCertifications(text).map((id) => {
    const cert = CERT_BY_ID.get(id)!;
    const inProfile = profile?.certifications.includes(id) ?? false;
    const inStaff = !inProfile && cert.patterns.some((p) => p.test(capacity.staffCertificationText));
    return { id, label: cert.label, legal: LEGAL_REQUIREMENTS.has(id), have: inProfile || inStaff, via: inProfile ? ('profil' as const) : inStaff ? ('bemanning' as const) : null };
  });
  const turnoverReq = requiredTurnover(text);
  const turnover =
    turnoverReq !== null
      ? { required: turnoverReq, have: profile?.annualRevenue ?? null, ok: profile?.annualRevenue === null || profile?.annualRevenue === undefined ? null : profile.annualRevenue >= turnoverReq }
      : null;
  const missing = [
    ...required.filter((r) => !r.have).map((r) => (r.legal ? `${r.label} (kan være et absolutt krav)` : r.label)),
    ...(turnover?.ok === false ? [`Omsetning på minst ${fmtKr(turnover.required)}`] : []),
    ...fitUnfulfilled.slice(0, 5),
  ];
  return { required, missing: [...new Set(missing)], missingCertIds: required.filter((r) => !r.have).map((r) => r.id), turnover, aiUnfulfilled: fitUnfulfilled };
}

// ---------------------------------------------------------------------------
// Arbeidsflate
// ---------------------------------------------------------------------------
export interface CalcSnapshot {
  version: 1;
  calc: CalcResult;
  riskLevel: RiskLevel;
  riskSource: RiskView['levelSource'];
  highRisks: string[];
  missingQualifications: string[];
  capacityStatus: CapacityResult['status'];
  capacityGapHours: number | null;
  recommendation: RecommendationResult;
  computedAt: string;
}

export interface ProfitWorkspace {
  tender: TenderDetail;
  documented: Documented;
  economics: OrgEconomics;
  capacityData: CapacityData;
  inputs: StoredInputs;
  saved: { at: Date; recommendation: Recommendation } | null;
  calc: CalcResult;
  analysis: StoredProfitAnalysis | null;
  risk: RiskView;
  capacity: CapacityResult;
  capacityPeriodNote: string | null;
  qualifications: QualificationView;
  recommendation: RecommendationResult;
  partnerSuggestions: PartnerSuggestion[];
  partnerGaps: PartnerGaps;
  documents: { analyzable: number; notReadable: string[] };
  testPrice: number | null;
}

interface CalcRow {
  inputs: StoredInputs;
  result: CalcSnapshot;
  recommendation: Recommendation;
  updatedAt: Date;
}

export async function getCalculation(tx: Tx, orgId: string, tenderId: string): Promise<CalcRow | null> {
  return first(
    (await tx`select inputs, result, recommendation, updated_at from tender_calculations where org_id = ${orgId} and tender_id = ${tenderId}`) as unknown as CalcRow[],
  );
}

export async function loadProfitWorkspace(
  tx: Tx,
  org: OrgContext,
  tenderId: string,
  opts: { inputsOverride?: StoredInputs; testPrice?: number | null; now?: Date } = {},
): Promise<ProfitWorkspace | null> {
  const tender = await getTender(tx, tenderId);
  if (!tender) return null;
  const now = opts.now ?? new Date();
  const [capacityData, stored, profile, analysis, docs, fit, docStatus] = await Promise.all([
    loadCapacityData(tx, org.id),
    getCalculation(tx, org.id, tenderId),
    getProfile(tx, org.id),
    org.entitlements.profitAI ? getLatestProfitAnalysis(tx, tenderId, org.id) : Promise.resolve(null),
    org.entitlements.documentUpload ? loadDocumentSources(tx, tenderId) : Promise.resolve([] as AnalysisSource[]),
    getLatestFitAssessment(tx, tenderId, org.id),
    tx`select title, text_status from tender_documents where tender_id = ${tenderId} and (org_id is null or org_id = ${org.id})` as unknown as Promise<{ title: string; textStatus: string }[]>,
  ]);
  const economics = capacityData.economics;
  const documented = documentedFacts(tender);
  const inputs = opts.inputsOverride ?? stored?.inputs ?? defaultInputs(tender, economics);
  const sources = [noticeSource(tender), ...docs];
  const scan = scanContractTerms(sources);
  const testPrice = opts.testPrice && opts.testPrice > 0 ? opts.testPrice : null;
  const calc = calculate({ ...inputs, testPrice });
  const risk = buildRiskView(analysis, scan, inputs, calc);

  const fitUnfulfilled = (fit?.data.requirements ?? []).filter((r) => r.status === 'ikke_oppfylt').map((r) => r.requirement.slice(0, 200));
  const qualifications = assessQualifications(sources, profile, capacityData, fitUnfulfilled);

  // Kapasitetsperioden: oppgitt start/slutt, ellers fra fristen og varigheten. Ingen gjetning ut over det.
  let capacityPeriodNote: string | null = null;
  const periodStart = tender.contractStart ?? tender.deadlineAt ?? now;
  if (!tender.contractStart) capacityPeriodNote = tender.deadlineAt ? 'Oppstart er ikke oppgitt – perioden regnes fra tilbudsfristen.' : 'Oppstart er ikke oppgitt – perioden regnes fra i dag.';
  const periodEnd = tender.contractEnd ?? (inputs.durationMonths ? new Date(periodStart.getTime() + inputs.durationMonths * 30.44 * DAY) : null);
  const equipmentNeeds = (analysis?.data.cost_drivers ?? []).filter((d) => d.category === 'utstyr').map((d) => d.description.slice(0, 80));
  const capacity = analyzeCapacity({
    availableHoursPerYear: capacityData.availableHoursPerYear,
    employeeCount: capacityData.staff.reduce((s, g) => s + g.headcount, 0) || profile?.employeeCount || null,
    contracts: capacityData.contracts.map((c) => ({ name: c.name, startDate: c.startDate, endDate: c.endDate, hoursPerMonth: c.hoursPerMonth })),
    requiredHoursPerYear: calc.hoursPerYear,
    periodStart,
    periodEnd,
    equipmentNeeds,
    equipment: capacityData.equipment.map((e) => ({ name: e.name, quantity: e.quantity })),
    missingQualifications: qualifications.missing,
  });
  if (capacityData.staffWithoutHours > 0) capacity.notes.push(`${capacityData.staffWithoutHours} roller mangler timer per person og er ikke regnet med i tilgjengelige timer.`);

  const recommendation = recommend({
    calc,
    targetMarginPct: inputs.targetMarginPct,
    riskLevel: risk.level,
    highRisks: risk.highRisks,
    missingQualifications: qualifications.missing,
    capacity,
    contractTermsAnalyzed: risk.contractTermsAnalyzed,
    deadlinePassed: tender.deadlineAt !== null && tender.deadlineAt.getTime() < now.getTime(),
  });

  const partnerGaps: PartnerGaps = {
    certifications: qualifications.missingCertIds,
    equipment: capacity.equipmentMissing,
    competencies: qualifications.aiUnfulfilled,
    regions: tender.regionCodes,
    industries: tender.industryIds,
    capacityHours: capacity.gapHoursPerYear,
  };
  const partnerSuggestions = org.entitlements.partnerSearch ? await suggestPartners(tx, org.id, partnerGaps) : [];

  return {
    tender,
    documented,
    economics,
    capacityData,
    inputs,
    saved: stored ? { at: stored.updatedAt, recommendation: stored.recommendation } : null,
    calc,
    analysis,
    risk,
    capacity,
    capacityPeriodNote,
    qualifications,
    recommendation,
    partnerSuggestions,
    partnerGaps,
    documents: {
      analyzable: docs.length,
      notReadable: docStatus.filter((d) => d.textStatus !== 'extracted').map((d) => d.title),
    },
    testPrice,
  };
}

export function snapshotOf(ws: Pick<ProfitWorkspace, 'calc' | 'risk' | 'qualifications' | 'capacity' | 'recommendation'>): CalcSnapshot {
  // Testpris er et «hva om» og lagres ikke.
  const calc = { ...ws.calc, scenarios: ws.calc.scenarios.filter((s) => s.key !== 'testpris') };
  return {
    version: 1,
    calc,
    riskLevel: ws.risk.level,
    riskSource: ws.risk.levelSource,
    highRisks: ws.risk.highRisks,
    missingQualifications: ws.qualifications.missing,
    capacityStatus: ws.capacity.status,
    capacityGapHours: ws.capacity.gapHoursPerYear,
    recommendation: ws.recommendation,
    computedAt: new Date().toISOString(),
  };
}

export async function saveCalculation(
  tx: Tx,
  ctx: { orgId: string; userId: string; ipHash?: string },
  tenderId: string,
  inputs: StoredInputs,
  snapshot: CalcSnapshot,
  opts: { audit?: boolean } = { audit: true },
): Promise<void> {
  await tx`
    insert into tender_calculations (org_id, tender_id, inputs, result, recommendation, created_by, updated_by)
    values (${ctx.orgId}, ${tenderId}, ${toJson(inputs)}::text::jsonb, ${toJson(snapshot)}::text::jsonb, ${snapshot.recommendation.recommendation},
            ${ctx.userId}, ${ctx.userId})
    on conflict (org_id, tender_id) do update set
      inputs = excluded.inputs, result = excluded.result, recommendation = excluded.recommendation,
      updated_by = excluded.updated_by, updated_at = now()
  `;
  if (opts.audit !== false) {
    await audit(
      { action: 'profit.calculation_saved', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'tender', targetId: tenderId, metadata: { recommendation: snapshot.recommendation.recommendation }, ipHash: ctx.ipHash },
      tx,
    );
  }
}

/** Oppdaterer lagret øyeblikksbilde når grunnlaget har endret seg (ny AI-analyse, ny kapasitet …). */
export async function refreshSnapshotIfChanged(tx: Tx, orgId: string, tenderId: string, ws: ProfitWorkspace): Promise<void> {
  if (!ws.saved || ws.testPrice !== null) return;
  const stored = await getCalculation(tx, orgId, tenderId);
  if (!stored) return;
  const next = snapshotOf(ws);
  const same =
    stored.recommendation === next.recommendation.recommendation &&
    stored.result.riskLevel === next.riskLevel &&
    stored.result.capacityStatus === next.capacityStatus &&
    stored.result.calc?.breakEven === next.calc.breakEven &&
    stored.result.calc?.atContractValue?.profit === next.calc.atContractValue?.profit &&
    stored.result.missingQualifications?.length === next.missingQualifications.length;
  if (same) return;
  await tx`
    update tender_calculations set result = ${toJson(next)}::text::jsonb, recommendation = ${next.recommendation.recommendation}
    where org_id = ${orgId} and tender_id = ${tenderId}
  `;
}

export async function deleteCalculation(tx: Tx, ctx: { orgId: string; userId: string; ipHash?: string }, tenderId: string): Promise<boolean> {
  const rows = await tx`delete from tender_calculations where org_id = ${ctx.orgId} and tender_id = ${tenderId} returning id`;
  if (rows.length) await audit({ action: 'profit.calculation_deleted', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'tender', targetId: tenderId, ipHash: ctx.ipHash }, tx);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Portefølje (dashboard)
// ---------------------------------------------------------------------------
export interface PortfolioRow {
  tenderId: string;
  title: string;
  buyerName: string | null;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  status: string;
  recommendation: Recommendation;
  snapshot: CalcSnapshot;
  updatedAt: Date;
}

export interface PortfolioSummary {
  rows: PortfolioRow[];
  totals: {
    count: number;
    open: number;
    byRecommendation: Record<Recommendation, number>;
    /** Sum av fortjeneste ved kontraktsverdi for åpne anbud med kjent verdi (beregnet, ikke prognose). */
    profitAtContractValue: number;
    withContractValue: number;
    costTotal: number;
  };
}

export async function listPortfolio(tx: Tx, orgId: string, now = new Date()): Promise<PortfolioSummary> {
  const rows = (await tx`
    select c.tender_id, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known,
           tender_status(t.lifecycle, t.deadline_at, t.published_at) as status,
           c.recommendation, c.result as snapshot, c.updated_at
    from tender_calculations c join tenders t on t.id = c.tender_id
    where c.org_id = ${orgId}
    order by (t.deadline_at is null or t.deadline_at < ${now}) asc, t.deadline_at asc nulls last, c.updated_at desc
    limit 200
  `) as unknown as PortfolioRow[];
  const byRecommendation: Record<Recommendation, number> = { bid: 0, investigate: 0, high_risk: 0, insufficient_data: 0 };
  let profit = 0;
  let withValue = 0;
  let cost = 0;
  let open = 0;
  for (const r of rows) {
    const isOpen = r.deadlineAt !== null && r.deadlineAt.getTime() > now.getTime();
    if (!isOpen) continue;
    open++;
    byRecommendation[r.recommendation]++;
    cost += r.snapshot.calc?.breakEven ?? 0;
    if (r.snapshot.calc?.atContractValue) {
      profit += r.snapshot.calc.atContractValue.profit;
      withValue++;
    }
  }
  return {
    rows,
    totals: { count: rows.length, open, byRecommendation, profitAtContractValue: Math.round(profit), withContractValue: withValue, costTotal: Math.round(cost) },
  };
}

/** Kort oppsummering til anbudssiden (vises bare når en kalkyle finnes). */
export async function calculationBadge(tx: Tx, orgId: string, tenderId: string): Promise<{ recommendation: Recommendation; marginPct: number | null; updatedAt: Date } | null> {
  const row = await getCalculation(tx, orgId, tenderId);
  if (!row) return null;
  return { recommendation: row.recommendation, marginPct: row.result.calc?.atContractValue?.marginPct ?? null, updatedAt: row.updatedAt };
}

