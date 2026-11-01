import { createHash } from 'node:crypto';
import { z } from 'zod';
import { INDUSTRIES, regionsFromNuts } from '@/domain/reference';

export type Lifecycle = 'planned' | 'competition' | 'awarded' | 'cancelled' | 'direct_award' | 'withdrawn' | 'other';
export type SourceId = 'ted' | 'doffin' | 'manual' | 'sample';

/**
 * Versjon av oversettelsen fra kildeformat til felles format. Økes når oversettelsen endres,
 * slik at en ny kjøring som retter gamle data IKKE tolkes som endringer hos oppdragsgiver
 * (og dermed ikke gir falske varsler om «fristen er endret»).
 */
export const NORMALIZE_VERSION = 2;

export interface NoticeLot {
  id: string | null;
  title: string | null;
  estimatedValue: number | null;
  durationText: string | null;
}

export interface NoticeAwardCriterion {
  name: string;
  type: string | null;
  weight: string | null;
}

/**
 * Tilleggsopplysninger som ikke alle kilder har. Manglende verdier er null/tomme – de gjettes aldri.
 */
export interface NoticeDetails {
  /** eForms-kunngjøringens UUID (samme ID i TED og Doffin for samme kunngjøring). */
  noticeIdentifier?: string | null;
  noticeVersion?: number | null;
  /** Frist for spørsmål til oppdragsgiver (eForms BT-13). */
  questionsDeadlineAt?: string | null;
  /** Frist for forespørsel om å delta (begrenset konkurranse, eForms BT-1311). */
  participationDeadlineAt?: string | null;
  /** Hva `deadlineAt` er: tilbudsfrist, eller frist for å be om å delta (begrenset konkurranse). */
  deadlineKind?: 'tender' | 'participation' | null;
  /** Delkontraktene har ulike frister; `deadlineAt` er da den tidligste. */
  lotDeadlinesDiffer?: boolean;
  durationMonths?: number | null;
  durationText?: string | null;
  contractStart?: string | null;
  contractEnd?: string | null;
  /** Hvor tilbudet leveres (konkurransegjennomføringsverktøy). */
  submissionUrl?: string | null;
  lots?: NoticeLot[];
  /** Kvalifikasjonskrav slik de står i kunngjøringen. */
  selectionCriteria?: string[];
  awardCriteria?: NoticeAwardCriterion[];
  isFramework?: boolean | null;
  /** Beskrivelse av endringen når kunngjøringen er en rettelse. */
  changeDescription?: string | null;
  /** Språket tittel og beskrivelse er skrevet på ('nb', 'en', …). */
  language?: string | null;
}

export interface NoticeAward {
  lotTitle: string | null;
  supplierName: string;
  supplierOrgNumber: string | null;
  value: number | null;
  currency: string | null;
  awardDate: string | null;
}

/** Felles format alle kilder oversettes til før lagring. */
export interface NormalizedNotice {
  source: SourceId;
  sourceNoticeId: string;
  sourceUrl: string | null;
  noticeType: string | null;
  lifecycle: Lifecycle;
  procedureId: string | null;
  buyerReference: string | null;
  title: string;
  description: string | null;
  buyerName: string | null;
  buyerOrgNumber: string | null;
  buyerCity: string | null;
  countryCode: string;
  nutsCodes: string[];
  placeText: string | null;
  cpvCodes: string[];
  mainCpv: string | null;
  contractNature: 'works' | 'supplies' | 'services' | null;
  procedureType: string | null;
  estimatedValue: number | null;
  currency: string | null;
  publishedAt: string | null;
  deadlineAt: string | null;
  deadlineTimeKnown: boolean;
  documentsUrl: string | null;
  receivedTenders: number | null;
  awards: NoticeAward[];
  details?: NoticeDetails;
  raw: unknown;
}

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Ugyldig dato')
  .nullable();

const url = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Ugyldig URL')
  .nullable();

const money = z.number().finite().nonnegative().max(1e13).nullable();

const shortText = (max: number) => z.string().trim().max(max).nullable().optional();

export const noticeDetailsSchema = z.object({
  noticeIdentifier: z.string().max(100).nullable().optional(),
  noticeVersion: z.number().int().min(0).max(1000).nullable().optional(),
  questionsDeadlineAt: isoDate.optional(),
  participationDeadlineAt: isoDate.optional(),
  deadlineKind: z.enum(['tender', 'participation']).nullable().optional(),
  lotDeadlinesDiffer: z.boolean().optional(),
  durationMonths: z.number().finite().nonnegative().max(1200).nullable().optional(),
  durationText: shortText(300),
  contractStart: isoDate.optional(),
  contractEnd: isoDate.optional(),
  submissionUrl: url.optional(),
  lots: z
    .array(
      z.object({
        id: z.string().max(100).nullable(),
        title: z.string().max(1000).nullable(),
        estimatedValue: money,
        durationText: z.string().max(300).nullable(),
      }),
    )
    .max(300)
    .optional(),
  selectionCriteria: z.array(z.string().max(4000)).max(60).optional(),
  awardCriteria: z
    .array(z.object({ name: z.string().max(500), type: z.string().max(50).nullable(), weight: z.string().max(50).nullable() }))
    .max(60)
    .optional(),
  isFramework: z.boolean().nullable().optional(),
  changeDescription: shortText(4000),
  language: z.string().max(10).nullable().optional(),
});

export const normalizedNoticeSchema = z.object({
  source: z.enum(['ted', 'doffin', 'manual', 'sample']),
  sourceNoticeId: z.string().trim().min(1).max(200),
  sourceUrl: url,
  noticeType: z.string().max(100).nullable(),
  lifecycle: z.enum(['planned', 'competition', 'awarded', 'cancelled', 'direct_award', 'withdrawn', 'other']),
  procedureId: z.string().max(200).nullable(),
  buyerReference: z.string().max(300).nullable(),
  title: z.string().trim().min(3, 'Tittel mangler').max(1000),
  description: z.string().max(100_000).nullable(),
  buyerName: z.string().max(500).nullable(),
  buyerOrgNumber: z.string().max(50).nullable(),
  buyerCity: z.string().max(200).nullable(),
  countryCode: z.string().regex(/^[A-Z]{2}$/, 'Ugyldig landkode'),
  nutsCodes: z.array(z.string().max(10)).max(100),
  placeText: z.string().max(500).nullable(),
  cpvCodes: z.array(z.string().regex(/^\d{8}$/, 'Ugyldig CPV-kode')).max(200),
  mainCpv: z.string().regex(/^\d{8}$/).nullable(),
  contractNature: z.enum(['works', 'supplies', 'services']).nullable(),
  procedureType: z.string().max(100).nullable(),
  estimatedValue: money,
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  publishedAt: isoDate,
  deadlineAt: isoDate,
  deadlineTimeKnown: z.boolean(),
  documentsUrl: url,
  receivedTenders: z.number().int().nonnegative().max(100_000).nullable(),
  awards: z
    .array(
      z.object({
        lotTitle: z.string().max(1000).nullable(),
        supplierName: z.string().trim().min(1).max(500),
        supplierOrgNumber: z.string().max(50).nullable(),
        value: money,
        currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
        awardDate: isoDate,
      }),
    )
    .max(500),
  details: noticeDetailsSchema.optional(),
  raw: z.unknown(),
});

// ---------------------------------------------------------------------------
// Hjelpefunksjoner (rene, testes i tests/unit/normalize.test.ts)
// ---------------------------------------------------------------------------

/** "45000000-7" → "45000000". Returnerer null for ugyldige koder. */
export function cleanCpv(code: unknown): string | null {
  if (typeof code !== 'string' && typeof code !== 'number') return null;
  const digits = String(code).trim().split('-')[0]!.replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

/** Hierarkiske prefikser (2–5 siffer) uten avsluttende nuller: 79713000 → 79, 797, 7971, 79713. */
export function cpvPrefixes(codes: string[]): string[] {
  const out = new Set<string>();
  for (const code of codes) {
    const significant = code.replace(/0+$/, '');
    const len = Math.min(5, Math.max(2, significant.length));
    for (let i = 2; i <= len; i++) out.add(code.slice(0, i));
  }
  return [...out].sort();
}

const WORD_BOUNDARY = '(^|[^\\p{L}\\p{N}])';

export function containsTerm(text: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${WORD_BOUNDARY}${escaped}`, 'iu').test(text.toLowerCase());
}

/** Bransjer fra CPV-prefikser; nøkkelord brukes kun når kunngjøringen mangler CPV-koder. */
export function deriveIndustries(prefixes: string[], title: string, description: string | null): string[] {
  const set = new Set(prefixes);
  const out: string[] = [];
  for (const ind of INDUSTRIES) {
    if (ind.cpvPrefixes.some((p) => set.has(p))) out.push(ind.id);
  }
  if (out.length === 0 && prefixes.length === 0) {
    const text = `${title} ${description ?? ''}`.slice(0, 5000);
    for (const ind of INDUSTRIES) {
      if (ind.keywords.some((k) => containsTerm(text, k))) out.push(ind.id);
    }
  }
  return out;
}

const LEGAL_SUFFIXES = /\b(as|asa|ans|da|sa|ab|oy|gmbh|ltd|limited|inc|aps|nuf|ks|iks|sf)\b\.?/gi;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Norsk organisasjonsnummer med MOD11-kontroll. */
export function isValidNorwegianOrgNumber(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(value[i]), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  return check !== 10 && check === Number(value[8]);
}

export function cleanOrgNumber(value: unknown, countryCode: string): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).toUpperCase().replace(/^NO/, '').replace(/MVA$/, '');
  const digits = raw.replace(/\D/g, '');
  if (countryCode === 'NO') return isValidNorwegianOrgNumber(digits) ? digits : null;
  return digits.length >= 6 && digits.length <= 20 ? digits : null;
}

/**
 * Renser NUTS-koder fra en kilde: store bokstaver, uten duplikater, uten landkoder (ISO3, f.eks.
 * «NOR»), uten «ANYW» (hele landet/ikke angitt) og uten «extra-regio»-koder (…ZZ/…ZZZ).
 */
export function cleanNutsCodes(codes: unknown[]): string[] {
  const out = new Set<string>();
  for (const raw of codes) {
    if (typeof raw !== 'string') continue;
    const c = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}[0-9A-Z]{1,3}$/.test(c)) continue;
    if (/^[A-Z]{3}$/.test(c) || c.startsWith('ANYW') || /ZZZ?$/.test(c)) continue;
    out.add(c);
  }
  return [...out].sort();
}

/** Den mest spesifikke CPV-koden (flest signifikante sifre). Kilder legger ofte til overordnede koder. */
export function mostSpecificCpv(codes: string[]): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const code of codes) {
    const len = code.replace(/0+$/, '').length;
    if (len > bestLen) {
      best = code;
      bestLen = len;
    }
  }
  return best;
}

const UNIT_MONTHS: Record<string, number> = { DAY: 1 / 30.44, WEEK: 1 / 4.345, MONTH: 1, YEAR: 12 };
const UNIT_LABEL: Record<string, [string, string]> = {
  DAY: ['dag', 'dager'],
  WEEK: ['uke', 'uker'],
  MONTH: ['måned', 'måneder'],
  YEAR: ['år', 'år'],
};

/** «48» + «MONTH» → { months: 48, text: '48 måneder' }. Ukjente enheter gir null. */
export function durationFrom(value: unknown, unit: unknown): { months: number; text: string } | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.replace(',', '.')) : NaN;
  const u = typeof unit === 'string' ? unit.trim().toUpperCase() : '';
  if (!Number.isFinite(n) || n <= 0 || !(u in UNIT_MONTHS)) return null;
  const months = Math.round(n * UNIT_MONTHS[u]! * 100) / 100;
  // Over 50 år er nesten alltid en feil hos kilden (f.eks. årstallet «2026» skrevet som varighet).
  if (months > 600) return null;
  const [one, many] = UNIT_LABEL[u]!;
  return { months, text: `${n.toLocaleString('nb-NO')} ${n === 1 ? one : many}` };
}

export function regionCodesFor(notice: Pick<NormalizedNotice, 'nutsCodes' | 'countryCode'>): string[] {
  return notice.countryCode === 'NO' ? regionsFromNuts(notice.nutsCodes) : [];
}

const LIFECYCLE_RANK: Record<Lifecycle, number> = {
  other: 0,
  planned: 1,
  competition: 2,
  direct_award: 2,
  awarded: 3,
  cancelled: 4,
  withdrawn: 5,
};

export function laterLifecycle(a: Lifecycle, b: Lifecycle): Lifecycle {
  return LIFECYCLE_RANK[b] > LIFECYCLE_RANK[a] ? b : a;
}

/** Hash av innholdet (uten rådata) for å oppdage endringer. */
export function noticeHash(n: NormalizedNotice): string {
  const { raw: _raw, ...rest } = n;
  return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

export function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
}

/** UTC-forskyvning for norsk tid på en gitt dato ("+01:00" vinter, "+02:00" sommer). */
export function osloOffset(datePart: string): string {
  const d = new Date(`${datePart}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '+01:00';
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', timeZoneName: 'longOffset' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')?.value;
  return /GMT([+-]\d{2}:\d{2})/.exec(tz ?? '')?.[1] ?? '+01:00';
}

/**
 * Tolker et tidspunkt fra en kilde. Har verdien ingen tidssone ("2026-11-24T12:00"),
 * antas norsk tid – ikke serverens tidssone.
 */
export function parseSourceDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(v);
  const candidate = local ? `${local[1]}T${local[2]}${osloOffset(local[1]!)}` : v;
  const ms = Date.parse(candidate);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Kombinerer dato og eventuelt klokkeslett til ISO. Uten klokkeslett brukes datoen og timeKnown=false. */
export function combineDateTime(date: string | null | undefined, time: string | null | undefined): { iso: string | null; timeKnown: boolean } {
  if (!date) return { iso: null, timeKnown: false };
  const datePart = date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return { iso: null, timeKnown: false };
  const offsetMatch = /([+-]\d{2}:\d{2}|Z)$/.exec(date);
  if (time) {
    const tm = /^(\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?/.exec(time);
    if (tm) {
      const offset = tm[2] ?? offsetMatch?.[1] ?? osloOffset(datePart);
      const t = tm[1]!.length === 5 ? `${tm[1]}:00` : tm[1]!;
      const iso = `${datePart}T${t}${offset}`;
      if (!Number.isNaN(Date.parse(iso))) return { iso: new Date(iso).toISOString(), timeKnown: true };
    }
  }
  // Kun dato: lagres som slutten av dagen (23:59 norsk tid) slik at "dager igjen" blir riktig.
  const offset = offsetMatch?.[1] && offsetMatch[1] !== 'Z' ? offsetMatch[1] : osloOffset(datePart);
  const iso = `${datePart}T23:59:00${offset}`;
  return Number.isNaN(Date.parse(iso)) ? { iso: null, timeKnown: false } : { iso: new Date(iso).toISOString(), timeKnown: false };
}
