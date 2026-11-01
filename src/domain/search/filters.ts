import { z } from 'zod';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';

export const STATUSES = ['open', 'planned', 'closed', 'awarded', 'cancelled', 'direct_award'] as const;
export type TenderStatus = (typeof STATUSES)[number];
export const SORTS = ['relevance', 'match', 'published', 'deadline', 'value'] as const;
export type SortKey = (typeof SORTS)[number];

export interface TenderQuery {
  q: string;
  industries: string[];
  countries: string[];
  regions: string[];
  place: string;
  valueMin: number | null;
  valueMax: number | null;
  deadlineMinDays: number | null;
  deadlineMaxDays: number | null;
  publishedWithinDays: number | null;
  authority: string;
  statuses: TenderStatus[];
  cpv: string[];
  excludeIndustries: string[];
  excludeCpv: string[];
  excludeKeywords: string[];
  sort: SortKey | null;
  page: number;
}

export const EMPTY_QUERY: TenderQuery = {
  q: '',
  industries: [],
  countries: [],
  regions: [],
  place: '',
  valueMin: null,
  valueMax: null,
  deadlineMinDays: null,
  deadlineMaxDays: null,
  publishedWithinDays: null,
  authority: '',
  statuses: [],
  cpv: [],
  excludeIndustries: [],
  excludeCpv: [],
  excludeKeywords: [],
  sort: null,
  page: 1,
};

/** Felter som krever avansert søk (Profesjonell og oppover). */
export const ADVANCED_FIELDS: (keyof TenderQuery)[] = ['cpv', 'authority', 'excludeIndustries', 'excludeCpv', 'excludeKeywords'];

const nonNeg = (max: number) => z.number().int().min(0).max(max).nullable();

export const tenderQuerySchema = z.object({
  q: z.string().max(300).transform((s) => s.trim()),
  industries: z.array(z.string()).max(20).transform((a) => a.filter((i) => INDUSTRY_BY_ID.has(i))),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(10),
  regions: z.array(z.string()).max(20).transform((a) => a.filter((r) => REGION_BY_CODE.has(r))),
  place: z.string().max(100).transform((s) => s.trim()),
  valueMin: z.number().min(0).max(1e13).nullable(),
  valueMax: z.number().min(0).max(1e13).nullable(),
  deadlineMinDays: nonNeg(3650),
  deadlineMaxDays: nonNeg(3650),
  publishedWithinDays: nonNeg(3650),
  authority: z.string().max(200).transform((s) => s.trim()),
  statuses: z.array(z.enum(STATUSES)).max(6),
  cpv: z.array(z.string().regex(/^\d{2,8}$/)).max(30),
  excludeIndustries: z.array(z.string()).max(20).transform((a) => a.filter((i) => INDUSTRY_BY_ID.has(i))),
  excludeCpv: z.array(z.string().regex(/^\d{2,8}$/)).max(30),
  excludeKeywords: z.array(z.string().min(2).max(50)).max(20),
  sort: z.enum(SORTS).nullable(),
  page: z.number().int().min(1).max(400),
});

function multi(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

function numberParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function intParam(params: URLSearchParams, key: string): number | null {
  const n = numberParam(params, key);
  return n === null ? null : Math.round(n);
}

/** Leser filtre fra URL. Ugyldige verdier forkastes stille (lenker skal aldri gi feilside). */
export function queryFromParams(params: URLSearchParams): TenderQuery {
  const candidate: TenderQuery = {
    q: params.get('q') ?? '',
    industries: multi(params, 'bransje'),
    countries: multi(params, 'land').map((c) => c.toUpperCase()),
    regions: multi(params, 'fylke'),
    place: params.get('sted') ?? '',
    valueMin: numberParam(params, 'verdi_min'),
    valueMax: numberParam(params, 'verdi_maks'),
    deadlineMinDays: intParam(params, 'frist_min'),
    deadlineMaxDays: intParam(params, 'frist_maks'),
    publishedWithinDays: intParam(params, 'publisert'),
    authority: params.get('oppdragsgiver') ?? '',
    statuses: multi(params, 'status').filter((s): s is TenderStatus => (STATUSES as readonly string[]).includes(s)),
    cpv: multi(params, 'cpv').map((c) => c.replace(/\D/g, '')).filter((c) => /^\d{2,8}$/.test(c)),
    excludeIndustries: multi(params, 'ekskl_bransje'),
    excludeCpv: multi(params, 'ekskl_cpv').map((c) => c.replace(/\D/g, '')).filter((c) => /^\d{2,8}$/.test(c)),
    excludeKeywords: multi(params, 'ekskl_ord').filter((w) => w.length >= 2),
    sort: (SORTS as readonly string[]).includes(params.get('sorter') ?? '') ? (params.get('sorter') as SortKey) : null,
    page: Math.max(1, Math.min(400, intParam(params, 'side') ?? 1)),
  };
  return sanitizeQuery(candidate);
}

export function sanitizeQuery(candidate: Partial<TenderQuery>): TenderQuery {
  const merged = { ...EMPTY_QUERY, ...candidate };
  const parsed = tenderQuerySchema.safeParse(merged);
  if (parsed.success) return parsed.data as TenderQuery;
  // Fjern felt som feiler valideringen ett og ett.
  const out: TenderQuery = { ...EMPTY_QUERY };
  for (const key of Object.keys(EMPTY_QUERY) as (keyof TenderQuery)[]) {
    const single = tenderQuerySchema.shape[key].safeParse(merged[key]);
    if (single.success) (out as unknown as Record<string, unknown>)[key] = single.data;
  }
  return out;
}

/** Fjerner avanserte filtre hvis planen ikke inkluderer avansert søk. */
export function restrictQuery(q: TenderQuery, advanced: boolean): { query: TenderQuery; removed: boolean } {
  if (advanced) return { query: q, removed: false };
  const removed =
    q.cpv.length > 0 || q.authority !== '' || q.excludeIndustries.length > 0 || q.excludeCpv.length > 0 || q.excludeKeywords.length > 0;
  return {
    query: { ...q, cpv: [], authority: '', excludeIndustries: [], excludeCpv: [], excludeKeywords: [] },
    removed,
  };
}

export function queryToParams(q: TenderQuery, overrides: Partial<TenderQuery> = {}): URLSearchParams {
  const v = { ...q, ...overrides };
  const p = new URLSearchParams();
  if (v.q) p.set('q', v.q);
  v.industries.forEach((x) => p.append('bransje', x));
  v.countries.forEach((x) => p.append('land', x));
  v.regions.forEach((x) => p.append('fylke', x));
  if (v.place) p.set('sted', v.place);
  if (v.valueMin !== null) p.set('verdi_min', String(v.valueMin));
  if (v.valueMax !== null) p.set('verdi_maks', String(v.valueMax));
  if (v.deadlineMinDays !== null) p.set('frist_min', String(v.deadlineMinDays));
  if (v.deadlineMaxDays !== null) p.set('frist_maks', String(v.deadlineMaxDays));
  if (v.publishedWithinDays !== null) p.set('publisert', String(v.publishedWithinDays));
  if (v.authority) p.set('oppdragsgiver', v.authority);
  v.statuses.forEach((x) => p.append('status', x));
  if (v.cpv.length) p.set('cpv', v.cpv.join(','));
  v.excludeIndustries.forEach((x) => p.append('ekskl_bransje', x));
  if (v.excludeCpv.length) p.set('ekskl_cpv', v.excludeCpv.join(','));
  if (v.excludeKeywords.length) p.set('ekskl_ord', v.excludeKeywords.join(','));
  if (v.sort) p.set('sorter', v.sort);
  if (v.page > 1) p.set('side', String(v.page));
  return p;
}

/** Lagret søk lagrer filtrene uten side og sortering. */
export function filtersForStorage(q: TenderQuery): TenderQuery {
  return { ...q, page: 1 };
}

export function isEmptyQuery(q: TenderQuery): boolean {
  const { page: _p, sort: _s, ...rest } = q;
  const { page: _ep, sort: _es, ...empty } = EMPTY_QUERY;
  return JSON.stringify(rest) === JSON.stringify(empty);
}

/** CPV-inndata til prefiks som matcher tenders.cpv_prefixes (2–5 siffer). */
export function cpvToPrefix(code: string): string {
  const significant = code.replace(/0+$/, '');
  const len = Math.min(5, Math.max(2, significant.length));
  return code.slice(0, len);
}
