import type postgres from 'postgres';
import { first, type Db, type Tx } from '@/lib/db';
import { isProd } from '@/lib/env';
import { cpvToPrefix, type TenderQuery } from '@/domain/search/filters';

export const PAGE_SIZE = 25;

export interface TenderListItem {
  id: string;
  title: string;
  buyerName: string | null;
  placeText: string | null;
  regionCodes: string[];
  industryIds: string[];
  cpvCodes: string[];
  estimatedValue: number | null;
  currency: string | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  lifecycle: string;
  status: string;
  isSample: boolean;
  sources: string[];
  score: number | null;
  bookmarked: boolean;
  firstSeenAt: Date;
}

type Fragment = postgres.PendingQuery<postgres.Row[]>;

function likeEscape(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function and(sql: Db, parts: Fragment[]): Fragment {
  return parts.reduce((acc, part) => sql`${acc} and ${part}`, sql`true` as Fragment);
}

function or(sql: Db, parts: Fragment[]): Fragment {
  if (parts.length === 0) return sql`true` as Fragment;
  return parts.slice(1).reduce((acc, part) => sql`${acc} or ${part}`, parts[0]!);
}

export function statusCondition(sql: Db, status: string): Fragment {
  switch (status) {
    case 'open':
      return sql`(t.lifecycle in ('competition', 'other') and (t.deadline_at > now() or (t.deadline_at is null and t.published_at > now() - interval '60 days')))`;
    case 'closed':
      return sql`(t.lifecycle in ('competition', 'other') and t.deadline_at <= now())`;
    default:
      return sql`t.lifecycle = ${status}`;
  }
}

/** Bygger WHERE-betingelser fra filtrene. Brukes av søk, lagrede søk og varsler. */
export function buildConditions(sql: Db, q: TenderQuery, opts: { firstSeenAfter?: Date } = {}): Fragment {
  const c: Fragment[] = [];
  if (isProd) c.push(sql`t.is_sample = false`);
  if (q.q) {
    c.push(sql`t.search_tsv @@ (websearch_to_tsquery('norwegian', ${q.q}) || websearch_to_tsquery('simple', ${q.q}))`);
  }
  if (q.industries.length) c.push(sql`t.industry_ids && ${q.industries}::text[]`);
  if (q.excludeIndustries.length) c.push(sql`not (t.industry_ids && ${q.excludeIndustries}::text[])`);
  if (q.countries.length) c.push(sql`t.country_code = any(${q.countries}::text[])`);
  if (q.regions.length) c.push(sql`t.region_codes && ${q.regions}::text[]`);
  if (q.place) {
    const pattern = likeEscape(q.place);
    c.push(sql`(t.place_text ilike ${pattern} or t.buyer_name ilike ${pattern})`);
  }
  if (q.authority) c.push(sql`t.buyer_name ilike ${likeEscape(q.authority)}`);
  if (q.valueMin !== null) c.push(sql`(t.estimated_value >= ${q.valueMin} and coalesce(t.currency, 'NOK') = 'NOK')`);
  if (q.valueMax !== null) c.push(sql`(t.estimated_value <= ${q.valueMax} and coalesce(t.currency, 'NOK') = 'NOK')`);
  if (q.deadlineMinDays !== null) c.push(sql`t.deadline_at >= now() + make_interval(days => ${q.deadlineMinDays})`);
  if (q.deadlineMaxDays !== null) c.push(sql`(t.deadline_at <= now() + make_interval(days => ${q.deadlineMaxDays}) and t.deadline_at > now())`);
  if (q.publishedWithinDays !== null) c.push(sql`t.published_at >= now() - make_interval(days => ${q.publishedWithinDays})`);
  if (q.cpv.length) c.push(sql`t.cpv_prefixes && ${q.cpv.map(cpvToPrefix)}::text[]`);
  if (q.excludeCpv.length) c.push(sql`not (t.cpv_prefixes && ${q.excludeCpv.map(cpvToPrefix)}::text[])`);
  for (const word of q.excludeKeywords) {
    c.push(sql`not (t.search_tsv @@ (plainto_tsquery('norwegian', ${word}) || plainto_tsquery('simple', ${word})))`);
  }
  const statuses = q.statuses.length ? q.statuses : ['open', 'planned'];
  c.push(sql`(${or(sql, statuses.map((s) => statusCondition(sql, s)))})`);
  if (opts.firstSeenAfter) c.push(sql`t.first_seen_at > ${opts.firstSeenAfter}`);
  return and(sql, c);
}

function orderBy(sql: Db, q: TenderQuery, matching: boolean): Fragment {
  const sort = q.sort ?? (q.q ? 'relevance' : matching ? 'match' : 'published');
  switch (sort) {
    case 'relevance':
      return q.q
        ? sql`ts_rank_cd(t.search_tsv, websearch_to_tsquery('norwegian', ${q.q}) || websearch_to_tsquery('simple', ${q.q})) desc, t.deadline_at asc nulls last`
        : sql`t.published_at desc nulls last`;
    case 'match':
      return matching ? sql`m.score desc nulls last, t.deadline_at asc nulls last` : sql`t.published_at desc nulls last`;
    case 'deadline':
      return sql`t.deadline_at asc nulls last`;
    case 'value':
      return sql`t.estimated_value desc nulls last`;
    default:
      return sql`t.published_at desc nulls last, t.first_seen_at desc`;
  }
}

/** Søk i kunngjøringer. Kjøres i tenant-transaksjon (RLS) for treff/bokmerker. */
export async function searchTenders(
  tx: Tx,
  q: TenderQuery,
  opts: { orgId: string; matching: boolean; pageSize?: number },
): Promise<{ items: TenderListItem[]; total: number; page: number; totalPages: number }> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const where = buildConditions(tx, q);
  const offset = (q.page - 1) * pageSize;
  const [countRow] = (await tx`select count(*)::int as total from tenders t where ${where}`) as unknown as { total: number }[];
  const items = (await tx`
    select t.id, t.title, t.buyer_name, t.place_text, t.region_codes, t.industry_ids, t.cpv_codes, t.estimated_value, t.currency,
           t.published_at, t.deadline_at, t.deadline_time_known, t.lifecycle, t.is_sample, t.first_seen_at,
           tender_status(t.lifecycle, t.deadline_at, t.published_at) as status,
           (select coalesce(array_agg(distinct s.source), '{}') from tender_sources s where s.tender_id = t.id) as sources,
           ${opts.matching ? tx`m.score` : tx`null::int`} as score,
           (b.id is not null) as bookmarked
    from tenders t
    left join match_results m on m.tender_id = t.id and m.org_id = ${opts.orgId}
    left join bookmarks b on b.tender_id = t.id and b.org_id = ${opts.orgId}
    where ${where}
    order by ${orderBy(tx, q, opts.matching)}
    limit ${pageSize} offset ${offset}
  `) as unknown as TenderListItem[];
  const total = countRow?.total ?? 0;
  return { items, total, page: q.page, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface TenderDetail {
  id: string;
  title: string;
  description: string | null;
  buyerName: string | null;
  buyerOrgNumber: string | null;
  authorityId: string | null;
  countryCode: string;
  nutsCodes: string[];
  regionCodes: string[];
  placeText: string | null;
  cpvCodes: string[];
  mainCpv: string | null;
  industryIds: string[];
  contractNature: string | null;
  procedureType: string | null;
  noticeType: string | null;
  lifecycle: string;
  status: string;
  estimatedValue: number | null;
  currency: string | null;
  publishedAt: Date | null;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  sourceUrl: string | null;
  documentsUrl: string | null;
  receivedTenders: number | null;
  isSample: boolean;
  firstSeenAt: Date;
  sourceUpdatedAt: Date | null;
  lastCheckedAt: Date;
  buyerReference: string | null;
}

export interface TenderSourceRow {
  source: string;
  sourceNoticeId: string;
  noticeType: string | null;
  sourceUrl: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  removedAt: Date | null;
}

export async function getTender(db: Db, id: string): Promise<TenderDetail | null> {
  return first(
    (await db`
      select t.*, tender_status(t.lifecycle, t.deadline_at, t.published_at) as status
      from tenders t where t.id = ${id} ${isProd ? db`and t.is_sample = false` : db``}
    `) as unknown as TenderDetail[],
  );
}

export async function getTenderExtras(tx: Tx, tenderId: string, orgId: string) {
  const sources = (await tx`
    select source, source_notice_id, notice_type, source_url, published_at, fetched_at, removed_at
    from tender_sources where tender_id = ${tenderId} order by published_at nulls last
  `) as unknown as TenderSourceRow[];
  const updates = (await tx`
    select id, change_type, summary, detected_at, source from tender_updates where tender_id = ${tenderId} order by detected_at desc limit 20
  `) as unknown as { id: string; changeType: string; summary: string; detectedAt: Date; source: string | null }[];
  const awards = (await tx`
    select a.id, a.supplier_id, a.supplier_name, a.lot_title, a.awarded_value, a.currency, a.award_date, a.source
    from contract_awards a where a.tender_id = ${tenderId} order by a.award_date desc nulls last
  `) as unknown as {
    id: string;
    supplierId: string | null;
    supplierName: string;
    lotTitle: string | null;
    awardedValue: number | null;
    currency: string | null;
    awardDate: Date | null;
    source: string;
  }[];
  const bookmark = first(
    (await tx`select id, status, note from bookmarks where tender_id = ${tenderId} and org_id = ${orgId}`) as unknown as {
      id: string;
      status: string;
      note: string | null;
    }[],
  );
  const match = first(
    (await tx`select score, breakdown, computed_at, excluded from match_results where tender_id = ${tenderId} and org_id = ${orgId}`) as unknown as {
      score: number;
      breakdown: unknown;
      computedAt: Date;
      excluded: boolean;
    }[],
  );
  const documents = (await tx`
    select id, title, source_url, mime_type, size_bytes, page_count, text_status, text_error, org_id, created_at
    from tender_documents where tender_id = ${tenderId} order by created_at desc
  `) as unknown as {
    id: string;
    title: string;
    sourceUrl: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    pageCount: number | null;
    textStatus: string;
    textError: string | null;
    orgId: string | null;
    createdAt: Date;
  }[];
  const workspace = first(
    (await tx`select id, status from bid_workspaces where tender_id = ${tenderId} and org_id = ${orgId}`) as unknown as { id: string; status: string }[],
  );
  return { sources, updates, awards, bookmark, match, documents, workspace };
}

export async function cpvLabels(db: Db, codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const rows = (await db`select code, coalesce(label_nb, label_en) as label from cpv_codes where code = any(${codes}::text[])`) as unknown as {
    code: string;
    label: string;
  }[];
  return new Map(rows.map((r) => [r.code, r.label]));
}

/** Tall for forsiden og dekningsoversikt – alltid hentet fra databasen, aldri anslått. */
export async function coverageStats(db: Db) {
  const [row] = (await db`
    select
      count(*) filter (where ${statusCondition(db, 'open')} and not t.is_sample)::int as open_real,
      count(*) filter (where t.is_sample)::int as sample_count,
      count(*) filter (where not t.is_sample)::int as total_real,
      max(t.first_seen_at) filter (where not t.is_sample) as last_ingested
    from tenders t
  `) as unknown as { openReal: number; sampleCount: number; totalReal: number; lastIngested: Date | null }[];
  const sources = (await db`
    select id, name, enabled, verified_live, last_success_at from data_sources order by id
  `) as unknown as { id: string; name: string; enabled: boolean; verifiedLive: boolean; lastSuccessAt: Date | null }[];
  return { ...row!, sources };
}
