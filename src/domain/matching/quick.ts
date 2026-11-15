/**
 * «Prøv uten konto» (/prov): de åpne anbudene som passer best for en bransje, et fylke og det bedriften leverer –
 * rangert med nøyaktig samme treffmotor som i appen (scoreTender). En smakebit, ikke hele produktet:
 *
 * - Bare de fem beste vises. Godkjenninger, kontraktsstørrelse, CPV-koder og ekskluderinger teller først i appen.
 * - Ingenting lagres: verken valgene eller ordene besøkende skriver.
 * - Bare norske anbud (profilen dekker Norge). Åpne anbud per bransje mellomlagres i 15 minutter, med språket
 *   regnet ut én gang per anbud, så siden er lett for serveren. Antallet som vises er det ekte antallet, også
 *   når bare de POOL_LIMIT med nærmest frist rangeres.
 */
import { keywordsFromServices } from '@/domain/profile/profile';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { displayBuyer } from '@/domain/tenders/market';
import { guessLanguage } from '@/connectors/doffin';
import { systemSql } from '@/lib/db';
import { scoreTender, type MatchProfile, type MatchTender } from './engine';

export const QUICK_TOP = 5;
/** Treff på 60 eller mer regnes som gode – samme grense som resten av appen. */
export const QUICK_GOOD = 60;
/** Så mange åpne anbud per bransje rangeres (nærmest frist først). */
export const POOL_LIMIT = 1000;
const MAX_DESCRIPTION = 3000;
const TTL_MS = 15 * 60_000;
const MAX_WORDS_LENGTH = 200;

type PoolRow = MatchTender & { buyerName: string | null; placeText: string | null; nb: boolean };
interface Pool {
  at: number;
  rows: PoolRow[];
  /** Alle åpne anbud i bransjen (også de som ikke kom med i utvalget). */
  total: number;
}

export interface QuickMatch {
  id: string;
  title: string;
  buyerName: string | null;
  place: string | null;
  deadlineAt: Date | null;
  score: number;
  /** Hvorfor anbudet passer (høyst tre grunner, fra treffmotoren). */
  reasons: string[];
  /** Det viktigste som trekker ned (f.eks. «Utenfor området du dekker»). */
  gap: string | null;
}

export interface QuickResult {
  industry: { id: string; name: string };
  region: { code: string; name: string } | null;
  /** Ordene som faktisk ble brukt i rangeringen (ryddet og begrenset). */
  words: string[];
  /** Åpne anbud i bransjen (frist om mer enn et døgn). */
  open: number;
  /** Hvor mange av dem som ble rangert (de med nærmest frist, høyst POOL_LIMIT). */
  ranked: number;
  /** Hvor mange av dem som er gode treff (60+). */
  good: number;
  rows: QuickMatch[];
}

const pools = new Map<string, Pool>();

export function resetQuickCache(): void {
  pools.clear();
}

async function pool(industry: string): Promise<Pool> {
  const hit = pools.get(industry);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  const sql = systemSql();
  const where = sql`
    not t.is_sample and t.country_code = 'NO' and t.lifecycle = 'competition' and t.deadline_at > now() + interval '1 day'
    and t.industry_ids @> array[${industry}]::text[]
  `;
  const [rows, [count]] = await Promise.all([
    sql`
      select t.id, t.title, left(t.description, ${MAX_DESCRIPTION}) as description, t.cpv_codes, t.industry_ids, t.region_codes, t.country_code,
             t.estimated_value::float8 as estimated_value, t.currency, t.contract_nature, t.deadline_at, t.lifecycle, t.buyer_name, t.place_text,
             coalesce((select array_agg(left(x, 2000)) from jsonb_array_elements_text(t.selection_criteria) x), '{}') as selection_criteria
      from tenders t
      where ${where}
      order by t.deadline_at asc, t.id
      limit ${POOL_LIMIT}
    ` as unknown as Promise<Omit<PoolRow, 'nb'>[]>,
    sql`select count(*)::int as n from tenders t where ${where}` as unknown as Promise<{ n: number }[]>,
  ]);
  const value: Pool = {
    at: Date.now(),
    // Språket regnes ut én gang her – ikke i hver sammenligning når listen sorteres.
    rows: rows.map((r) => ({ ...r, nb: guessLanguage(`${r.title} ${r.description ?? ''}`) === 'nb' })),
    total: count?.n ?? rows.length,
  };
  pools.set(industry, value);
  return value;
}

/** «Trøndelag», «Oslo, Akershus og 2 til» eller «Hele landet» – ikke en lang liste med alle fylkene. */
export function placeText(t: Pick<PoolRow, 'regionCodes' | 'placeText'>): string | null {
  const names = t.regionCodes.map((c) => REGION_BY_CODE.get(c)?.name).filter((n): n is string => Boolean(n));
  if (!names.length) return t.placeText || null;
  if (names.length >= 10) return 'Hele landet';
  return names.length > 3 ? `${names.slice(0, 2).join(', ')} og ${names.length - 2} til` : names.join(', ');
}

/** Profilen besøkende beskriver med tre valg – resten er tomt, slik det er for en helt ny kunde. */
export function quickProfile(industry: string, region: string | null, words: string): MatchProfile {
  const text = words.slice(0, MAX_WORDS_LENGTH).trim();
  return {
    industries: [industry],
    cpvCodes: [],
    keywords: keywordsFromServices(text),
    services: text || null,
    regions: region ? [region] : [],
    countries: ['NO'],
    certifications: [],
    minContractValue: null,
    maxContractValue: null,
    contractTypes: [],
    excludedCpv: [],
    excludedKeywords: [],
    minDaysToDeadline: 3,
  };
}

/** Null når bransjen er ukjent. Et ukjent fylke regnes som «hele landet». */
export async function quickRanking(input: { industry: string; region: string | null; words: string }, now = new Date()): Promise<QuickResult | null> {
  const industry = INDUSTRY_BY_ID.get(input.industry);
  if (!industry) return null;
  const region = input.region ? REGION_BY_CODE.get(input.region) : null;
  const profile = quickProfile(industry.id, region ? region.code : null, input.words);
  const p = await pool(industry.id);
  const scored = p.rows
    .filter((t) => t.deadlineAt && t.deadlineAt > now)
    .map((t) => ({ t, r: scoreTender(profile, t, now) }))
    .filter((x) => !x.r.excluded)
    // Likt treff: norsk tekst først (de fleste besøkende er norske; TED publiserer norske kunngjøringer på engelsk), så nærmeste frist.
    .sort((a, b) => b.r.score - a.r.score || Number(b.t.nb) - Number(a.t.nb) || (a.t.deadlineAt?.getTime() ?? 0) - (b.t.deadlineAt?.getTime() ?? 0));
  return {
    industry: { id: industry.id, name: industry.name },
    region: region ? { code: region.code, name: region.name } : null,
    words: profile.keywords,
    open: Math.max(p.total, scored.length),
    ranked: scored.length,
    good: scored.filter((x) => x.r.score >= QUICK_GOOD).length,
    rows: scored.slice(0, QUICK_TOP).map(({ t, r }) => ({
      id: t.id,
      title: t.title,
      buyerName: t.buyerName ? displayBuyer(t.buyerName) : null,
      place: placeText(t),
      deadlineAt: t.deadlineAt,
      score: r.score,
      reasons: r.breakdown.reasons.slice(0, 3),
      gap: r.breakdown.gaps[0] ?? null,
    })),
  };
}
