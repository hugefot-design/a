/**
 * Tallene og fristtavla på forsiden, og eksempelkunngjøringen på /funksjoner: ekte tall og ekte
 * kunngjøringer fra databasen – aldri oppdiktet.
 * Eksempeldata tas aldri med. Mellomlagres i fem minutter, så forsiden er rask og databasen spares.
 */
import { systemSql } from '@/lib/db';
import { CERTIFICATIONS, INDUSTRIES, REGIONS } from '@/domain/reference';
import { statusCondition } from './queries';

export interface BoardRow {
  id: string;
  title: string;
  buyerName: string | null;
  deadlineAt: Date;
  deadlineTimeKnown: boolean;
  /** Første fylke kunngjøringen gjelder, eller stedsteksten fra kunngjøringen. */
  place: string | null;
  source: string | null;
}

export interface MarketSnapshot {
  at: Date;
  open: number;
  new24h: number;
  closingWeek: number;
  buyers: number;
  lastIngested: Date | null;
  /** Siste vellykkede henting fra en påslått kilde. */
  lastFetched: Date | null;
  board: BoardRow[];
  /** De nyeste åpne konkurransene (med frist om minst to dager), til kortene ved radaren. */
  latest: (BoardRow & { industryId: string | null })[];
  /** Åpne anbud per fylke (alle 15, også de med 0). Et anbud kan gjelde flere fylker. */
  regions: { code: string; name: string; n: number }[];
  /** Bransjer med åpne anbud, flest først. */
  industries: { id: string; name: string; n: number }[];
  /** Oppdragsgivere med flest åpne anbud akkurat nå (til den rullende raden). */
  topBuyers: string[];
}

const REGION_NAME = new Map(REGIONS.map((r) => [r.code, r.name]));
const KEEP_UPPER = new Set(['AS', 'ASA', 'HF', 'RHF', 'IKS', 'KF', 'SF', 'DA', 'BA', 'NAV', 'NTNU', 'UIO', 'UIB', 'UIT', 'OSLOMET', 'DFØ', 'NVE', 'IT', 'EU']);

/** Navn som er skrevet med bare store bokstaver i kilden («STATSBYGG»), vises som «Statsbygg». */
export function displayBuyer(name: string): string {
  if (!/\p{Lu}/u.test(name) || name !== name.toUpperCase()) return name;
  return name
    .split(/(\s+|-)/)
    .map((w) => (KEEP_UPPER.has(w) || !/\p{L}/u.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join('');
}
const INDUSTRY_IDS = new Set(INDUSTRIES.map((i) => i.id));
let cache: { at: number; value: MarketSnapshot } | null = null;

export function clearMarketCache(): void {
  cache = null;
  specimenCache = null;
  boardCache.clear();
  listingCache.clear();
}

export async function marketSnapshot(): Promise<MarketSnapshot> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  const sql = systemSql();
  const open = statusCondition(sql, 'open');

  const [totals] = (await sql`
    select
      count(*) filter (where ${open})::int as open,
      count(*) filter (where t.first_seen_at > now() - interval '24 hours')::int as new24h,
      count(*) filter (where ${open} and t.deadline_at < now() + interval '7 days')::int as closing_week,
      count(distinct lower(t.buyer_name)) filter (where ${open} and t.buyer_name is not null)::int as buyers,
      max(t.first_seen_at) as last_ingested,
      (select max(last_success_at) from data_sources where enabled) as last_fetched
    from tenders t
    where not t.is_sample
  `) as unknown as {
    open: number;
    new24h: number;
    closingWeek: number;
    buyers: number;
    lastIngested: Date | null;
    lastFetched: Date | null;
  }[];

  const boardRows = (await sql`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known, t.region_codes, t.place_text,
      (select s.source from tender_sources s where s.tender_id = t.id and s.removed_at is null
        order by (s.source = 'doffin') desc, s.fetched_at desc limit 1) as source
    from tenders t
    where not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now()
    order by t.deadline_at asc, t.id
    limit 6
  `) as unknown as {
    id: string;
    title: string;
    buyerName: string | null;
    deadlineAt: Date;
    deadlineTimeKnown: boolean;
    regionCodes: string[];
    placeText: string | null;
    source: string | null;
  }[];

  const latestRows = (await sql`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known, t.region_codes, t.place_text, t.industry_ids,
      (select s.source from tender_sources s where s.tender_id = t.id and s.removed_at is null
        order by (s.source = 'doffin') desc, s.fetched_at desc limit 1) as source
    from tenders t
    where not t.is_sample and t.lifecycle = 'competition' and t.deadline_at > now() + interval '2 days'
    order by t.first_seen_at desc, t.id
    limit 3
  `) as unknown as {
    id: string;
    title: string;
    buyerName: string | null;
    deadlineAt: Date;
    deadlineTimeKnown: boolean;
    regionCodes: string[];
    placeText: string | null;
    industryIds: string[];
    source: string | null;
  }[];

  const regionCounts = (await sql`
    select rc as code, count(*)::int as n
    from tenders t, unnest(t.region_codes) as rc
    where not t.is_sample and ${open}
    group by rc
  `) as unknown as { code: string; n: number }[];

  const industryCounts = (await sql`
    select ind as id, count(*)::int as n
    from tenders t, unnest(t.industry_ids) as ind
    where not t.is_sample and ${open}
    group by ind
  `) as unknown as { id: string; n: number }[];

  const buyers = (await sql`
    select min(t.buyer_name) as name, count(*)::int as n
    from tenders t
    where not t.is_sample and ${open} and t.buyer_name is not null and length(t.buyer_name) between 3 and 60
    group by lower(t.buyer_name)
    order by n desc, name
    limit 32
  `) as unknown as { name: string; n: number }[];

  const byRegion = new Map(regionCounts.map((r) => [r.code, r.n]));
  const byIndustry = new Map(industryCounts.map((r) => [r.id, r.n]));
  const value: MarketSnapshot = {
    at: new Date(),
    open: totals!.open,
    new24h: totals!.new24h,
    closingWeek: totals!.closingWeek,
    buyers: totals!.buyers,
    lastIngested: totals!.lastIngested,
    lastFetched: totals!.lastFetched,
    board: boardRows.map((r) => ({
      id: r.id,
      title: r.title,
      buyerName: r.buyerName,
      deadlineAt: r.deadlineAt,
      deadlineTimeKnown: r.deadlineTimeKnown,
      place: (r.regionCodes[0] && REGION_NAME.get(r.regionCodes[0])) || r.placeText || null,
      source: r.source,
    })),
    latest: latestRows.map((r) => ({
      id: r.id,
      title: r.title,
      buyerName: r.buyerName,
      deadlineAt: r.deadlineAt,
      deadlineTimeKnown: r.deadlineTimeKnown,
      place: (r.regionCodes[0] && REGION_NAME.get(r.regionCodes[0])) || r.placeText || null,
      source: r.source,
      industryId: r.industryIds[0] ?? null,
    })),
    regions: REGIONS.map((r) => ({ code: r.code, name: r.name, n: byRegion.get(r.code) ?? 0 })),
    industries: INDUSTRIES.map((i) => ({ id: i.id, name: i.name, n: byIndustry.get(i.id) ?? 0 }))
      .filter((i) => i.n > 0)
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'nb')),
    topBuyers: [...new Set(buyers.map((b) => displayBuyer(b.name)))],
  };
  cache = { at: Date.now(), value };
  return value;
}

/** Fristtavla for én bransje og/eller ett fylke (velgeren på forsiden). Mellomlagres i fem minutter. */
export interface BoardFilter {
  industry: string | null;
  region: string | null;
}
const boardCache = new Map<string, { at: number; value: { rows: BoardRow[]; open: number } }>();

export function parseBoardFilter(industry: string | null, region: string | null): BoardFilter {
  return {
    industry: industry && INDUSTRY_IDS.has(industry) ? industry : null,
    region: region && REGION_NAME.has(region) ? region : null,
  };
}

export async function boardFor(f: BoardFilter): Promise<{ rows: BoardRow[]; open: number }> {
  const key = `${f.industry ?? ''}|${f.region ?? ''}`;
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const sql = systemSql();
  const open = statusCondition(sql, 'open');
  const industry = f.industry ? sql`and ${f.industry}::text = any(t.industry_ids)` : sql``;
  const region = f.region ? sql`and ${f.region}::text = any(t.region_codes)` : sql``;
  const [count] = (await sql`
    select count(*)::int as n from tenders t where not t.is_sample and ${open} ${industry} ${region}
  `) as unknown as { n: number }[];
  const rows = (await sql`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known, t.region_codes, t.place_text,
      (select s.source from tender_sources s where s.tender_id = t.id and s.removed_at is null
        order by (s.source = 'doffin') desc, s.fetched_at desc limit 1) as source
    from tenders t
    where not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now() ${industry} ${region}
    order by t.deadline_at asc, t.id
    limit 6
  `) as unknown as {
    id: string;
    title: string;
    buyerName: string | null;
    deadlineAt: Date;
    deadlineTimeKnown: boolean;
    regionCodes: string[];
    placeText: string | null;
    source: string | null;
  }[];
  const value = {
    open: count?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      buyerName: r.buyerName,
      deadlineAt: r.deadlineAt,
      deadlineTimeKnown: r.deadlineTimeKnown,
      place: (f.region && REGION_NAME.get(f.region)) || (r.regionCodes[0] && REGION_NAME.get(r.regionCodes[0])) || r.placeText || null,
      source: r.source,
    })),
  };
  if (boardCache.size > 500) boardCache.clear();
  boardCache.set(key, { at: Date.now(), value });
  return value;
}

/** Offentlig bransjeside: åpne anbud i én bransje (eventuelt ett fylke), nærmeste frist først. */
export interface IndustryListing {
  open: number;
  regions: { code: string; name: string; n: number }[];
  rows: (BoardRow & { estimatedValue: number | null; currency: string | null })[];
}
const listingCache = new Map<string, { at: number; value: IndustryListing }>();

export async function industryListing(industryId: string, region: string | null): Promise<IndustryListing> {
  const key = `${industryId}|${region ?? ''}`;
  const hit = listingCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const sql = systemSql();
  const open = statusCondition(sql, 'open');
  const regionCond = region ? sql`and ${region}::text = any(t.region_codes)` : sql``;
  const regionCounts = (await sql`
    select rc as code, count(*)::int as n
    from tenders t, unnest(t.region_codes) as rc
    where not t.is_sample and ${open} and ${industryId}::text = any(t.industry_ids)
    group by rc
  `) as unknown as { code: string; n: number }[];
  const [count] = (await sql`
    select count(*)::int as n from tenders t where not t.is_sample and ${open} and ${industryId}::text = any(t.industry_ids) ${regionCond}
  `) as unknown as { n: number }[];
  const rows = (await sql`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known, t.region_codes, t.place_text, t.estimated_value, t.currency,
      (select s.source from tender_sources s where s.tender_id = t.id and s.removed_at is null
        order by (s.source = 'doffin') desc, s.fetched_at desc limit 1) as source
    from tenders t
    where not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now()
      and ${industryId}::text = any(t.industry_ids) ${regionCond}
    order by t.deadline_at asc, t.id
    limit 24
  `) as unknown as {
    id: string;
    title: string;
    buyerName: string | null;
    deadlineAt: Date;
    deadlineTimeKnown: boolean;
    regionCodes: string[];
    placeText: string | null;
    estimatedValue: string | number | null;
    currency: string | null;
    source: string | null;
  }[];
  const byRegion = new Map(regionCounts.map((r) => [r.code, r.n]));
  const value: IndustryListing = {
    open: count?.n ?? 0,
    regions: REGIONS.map((r) => ({ code: r.code, name: r.name, n: byRegion.get(r.code) ?? 0 })).filter((r) => r.n > 0),
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      buyerName: r.buyerName ? displayBuyer(r.buyerName) : null,
      deadlineAt: r.deadlineAt,
      deadlineTimeKnown: r.deadlineTimeKnown,
      place: (region && REGION_NAME.get(region)) || (r.regionCodes[0] && REGION_NAME.get(r.regionCodes[0])) || r.placeText || null,
      source: r.source,
      estimatedValue: r.estimatedValue === null ? null : Number(r.estimatedValue),
      currency: r.currency,
    })),
  };
  if (listingCache.size > 500) listingCache.clear();
  listingCache.set(key, { at: Date.now(), value });
  return value;
}

export interface NoticeSpecimen {
  id: string;
  title: string;
  buyerName: string | null;
  deadlineAt: Date;
  deadlineTimeKnown: boolean;
  estimatedValue: number;
  currency: string | null;
  place: string | null;
  source: string;
  noticeId: string;
  sourceUrl: string | null;
  /** Utdrag av beskrivelsen. `mark` er kravet som er funnet (ordrett), ellers null. */
  excerpt: { before: string; mark: string | null; after: string };
  requirement: string | null;
}

let specimenCache: { at: number; value: NoticeSpecimen | null } | null = null;

/** Klipper ut et utdrag rundt treffet, kuttet ved hele ord. */
export function excerptAround(text: string, start: number, length: number, room = 170): { before: string; mark: string; after: string } {
  const clean = (s: string) => s.replace(/\s+/g, ' ');
  let from = Math.max(0, start - room);
  let to = Math.min(text.length, start + length + room);
  if (from > 0) from = text.indexOf(' ', from) + 1 || from;
  if (to < text.length) {
    const cut = text.lastIndexOf(' ', to);
    if (cut > start + length) to = cut;
  }
  return {
    before: (from > 0 ? '… ' : '') + clean(text.slice(from, start)),
    mark: clean(text.slice(start, start + length)),
    after: clean(text.slice(start + length, to)) + (to < text.length ? ' …' : ''),
  };
}

/**
 * En ekte, åpen kunngjøring til forsiden: med frist, anslått verdi og beskrivelse – og helst et
 * sertifiseringskrav i teksten, så markeringen viser noe som faktisk står der.
 */
export async function noticeSpecimen(): Promise<NoticeSpecimen | null> {
  if (specimenCache && Date.now() - specimenCache.at < 10 * 60_000) return specimenCache.value;
  const rows = (await systemSql()`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known, t.estimated_value::float8 as estimated_value, t.currency,
      t.description, t.region_codes, t.place_text, s.source, s.source_notice_id, s.source_url
    from tenders t
    join lateral (
      select source, source_notice_id, source_url from tender_sources s
      where s.tender_id = t.id and s.removed_at is null
      order by (s.source = 'doffin') desc, s.fetched_at desc limit 1
    ) s on true
    where not t.is_sample and t.lifecycle = 'competition' and t.deadline_at > now() + interval '5 days'
      and t.estimated_value is not null and char_length(coalesce(t.description, '')) > 160
    order by t.first_seen_at desc
    limit 60
  `) as unknown as {
    id: string;
    title: string;
    buyerName: string | null;
    deadlineAt: Date;
    deadlineTimeKnown: boolean;
    estimatedValue: number;
    currency: string | null;
    description: string;
    regionCodes: string[];
    placeText: string | null;
    source: string;
    sourceNoticeId: string;
    sourceUrl: string | null;
  }[];
  let pick: NoticeSpecimen | null = null;
  for (const r of rows) {
    let found: { cert: string; index: number; length: number } | null = null;
    for (const c of CERTIFICATIONS) {
      for (const p of c.patterns) {
        const m = p.exec(r.description);
        if (m) {
          found = { cert: c.label, index: m.index, length: m[0].length };
          break;
        }
      }
      if (found) break;
    }
    const excerpt = found
      ? excerptAround(r.description, found.index, found.length)
      : { ...excerptAround(r.description, 0, 0, 320), mark: null };
    const candidate: NoticeSpecimen = {
      id: r.id,
      title: r.title,
      buyerName: r.buyerName,
      deadlineAt: r.deadlineAt,
      deadlineTimeKnown: r.deadlineTimeKnown,
      estimatedValue: r.estimatedValue,
      currency: r.currency,
      place: (r.regionCodes[0] && REGION_NAME.get(r.regionCodes[0])) || r.placeText || null,
      source: r.source,
      noticeId: r.sourceNoticeId,
      sourceUrl: r.sourceUrl,
      excerpt: found ? excerpt : { before: excerpt.before + (excerpt.mark ?? '') + excerpt.after, mark: null, after: '' },
      requirement: found?.cert ?? null,
    };
    if (!pick) pick = candidate;
    if (found) {
      pick = candidate;
      break;
    }
  }
  specimenCache = { at: Date.now(), value: pick };
  return pick;
}
