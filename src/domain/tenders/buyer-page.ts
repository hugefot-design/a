/**
 * Offentlig side per oppdragsgiver (/oppdragsgiver/<navn>-<orgnr>, bare norsk): de åpne anbudene, hva oppdragsgiveren
 * kjøper mest (CPV-hovedgrupper siste 12 måneder) og kontrakter som trolig utløper – fra kunngjøringene.
 *
 * - Ingen leverandørnavn og ingen tildelte verdier. Hvem som vinner, står i appen.
 * - Bare norske oppdragsgivere med organisasjonsnummer får side: adressen er stabil selv om navnet skrives ulikt.
 * - Indekseres bare når det er nok innhold: minst ett åpent anbud og minst BUYER_MIN_NOTICES anbud og tildelinger
 *   siste 12 måneder. Resten får noindex og står ikke i nettstedskartet – ingen tynne sider.
 * - Mellomlagres i 30 minutter per oppdragsgiver.
 */
import { CPV_DIVISIONS, REGION_BY_CODE } from '@/domain/reference';
import { systemSql } from '@/lib/db';
import { log } from '@/lib/logger';
import { buyerExpiring, type IndustryExpiring } from './expiring';
import { displayBuyer, type BoardRow } from './market';
import { statusCondition } from './queries';

/** Så mange anbud og tildelinger siste 12 måneder må oppdragsgiveren ha før siden står i Google. */
export const BUYER_MIN_NOTICES = 5;
const SHOWN = 30;
const TTL_MS = 30 * 60_000;
const MAX_CACHED = 500;

/** «Sykehusinnkjøp HF» → «sykehusinnkjop-hf». */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function buyerPath(name: string, orgNumber: string): string {
  const slug = slugify(displayBuyer(name));
  return `/oppdragsgiver/${slug ? `${slug}-` : ''}${orgNumber}`;
}

/** Organisasjonsnummeret til slutt i adressen (ni sifre). */
export function orgNumberFromSlug(slug: string): string | null {
  return /(?:^|-)(\d{9})$/.exec(slug)?.[1] ?? null;
}

export interface PublicBuyer {
  id: string;
  name: string;
  orgNumber: string;
  city: string | null;
  path: string;
  /** Åpne anbud nå. */
  open: number;
  /** De nærmeste fristene (høyst SHOWN). */
  rows: (BoardRow & { estimatedValue: number | null; currency: string | null })[];
  /** Anbud og tildelinger siste 12 måneder (rader i tenders, alle typer). */
  notices12m: number;
  /** Hva de kjøper mest: CPV-hovedgrupper siste 12 måneder (en kunngjøring kan ha flere). */
  divisions: { code: string; label: string; n: number }[];
  expiring: IndustryExpiring;
  indexable: boolean;
}

const cache = new Map<string, { at: number; value: PublicBuyer | null }>();

export function resetBuyerCache(): void {
  cache.clear();
}

async function load(orgNumber: string): Promise<PublicBuyer | null> {
  const sql = systemSql();
  const [a] = (await sql`
    select id, name, org_number, city from authorities where country_code = 'NO' and org_number = ${orgNumber}
  `) as unknown as { id: string; name: string; orgNumber: string; city: string | null }[];
  if (!a) return null;
  const open = statusCondition(sql, 'open');
  const [[counts], rows, divisions, expiring] = await Promise.all([
    sql`
      select count(*) filter (where ${open})::int as open,
             count(*) filter (where coalesce(t.published_at, t.first_seen_at) > now() - interval '12 months')::int as notices
      from tenders t where t.authority_id = ${a.id} and not t.is_sample
    ` as unknown as Promise<{ open: number; notices: number }[]>,
    sql`
      select t.id, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known, t.region_codes, t.place_text,
             t.estimated_value::float8 as estimated_value, t.currency,
             (select s.source from tender_sources s where s.tender_id = t.id and s.removed_at is null
               order by (s.source = 'doffin') desc, s.fetched_at desc limit 1) as source
      from tenders t
      where t.authority_id = ${a.id} and not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now()
      order by t.deadline_at asc, t.id
      limit ${SHOWN}
    ` as unknown as Promise<
      {
        id: string;
        title: string;
        buyerName: string | null;
        deadlineAt: Date;
        deadlineTimeKnown: boolean;
        regionCodes: string[];
        placeText: string | null;
        estimatedValue: number | null;
        currency: string | null;
        source: string | null;
      }[]
    >,
    sql`
      select left(c, 2) as code, count(distinct t.id)::int as n
      from tenders t, unnest(t.cpv_codes) as c
      where t.authority_id = ${a.id} and not t.is_sample and coalesce(t.published_at, t.first_seen_at) > now() - interval '12 months'
      group by 1 order by n desc, 1 limit 8
    ` as unknown as Promise<{ code: string; n: number }[]>,
    buyerExpiring(a.id),
  ]);
  const name = displayBuyer(a.name);
  return {
    id: a.id,
    name,
    orgNumber: a.orgNumber,
    city: a.city ? displayBuyer(a.city) : null,
    path: buyerPath(a.name, a.orgNumber),
    open: counts?.open ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      buyerName: r.buyerName ? displayBuyer(r.buyerName) : name,
      deadlineAt: r.deadlineAt,
      deadlineTimeKnown: r.deadlineTimeKnown,
      place: (r.regionCodes[0] && REGION_BY_CODE.get(r.regionCodes[0])?.name) || r.placeText || null,
      source: r.source,
      estimatedValue: r.estimatedValue,
      currency: r.currency,
    })),
    notices12m: counts?.notices ?? 0,
    divisions: divisions.flatMap((d) => (CPV_DIVISIONS[d.code] ? [{ code: d.code, label: CPV_DIVISIONS[d.code]!, n: d.n }] : [])).slice(0, 5),
    expiring,
    indexable: (counts?.open ?? 0) >= 1 && (counts?.notices ?? 0) >= BUYER_MIN_NOTICES,
  };
}

/** Siden for én oppdragsgiver. Null for ukjente organisasjonsnumre og oppdragsgivere utenfor Norge. */
export async function publicBuyer(orgNumber: string): Promise<PublicBuyer | null> {
  const hit = cache.get(orgNumber);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: PublicBuyer | null = null;
  try {
    value = await load(orgNumber);
  } catch (err) {
    log.warn('public_buyer_failed', { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(orgNumber, { at: Date.now(), value });
  return value;
}

/** Oppdragsgiverne som står i nettstedskartet (samme terskel som indekseringen). */
export async function indexableBuyers(limit = 2000): Promise<{ name: string; orgNumber: string }[]> {
  const sql = systemSql();
  const open = statusCondition(sql, 'open');
  return (await sql`
    select a.name, a.org_number
    from authorities a
    join tenders t on t.authority_id = a.id and not t.is_sample
    where a.country_code = 'NO' and a.org_number is not null
    group by a.id
    having count(*) filter (where ${open}) >= 1
       and count(*) filter (where coalesce(t.published_at, t.first_seen_at) > now() - interval '12 months') >= ${BUYER_MIN_NOTICES}
    order by count(*) filter (where ${open}) desc, a.name
    limit ${limit}
  `) as unknown as { name: string; orgNumber: string }[];
}
