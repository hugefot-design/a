/**
 * Konkurrent- og tildelingsinnsikt. Bygger KUN på tildelinger som faktisk er publisert
 * i kildene. Mange anskaffelser publiseres uten tildelingsinformasjon – dekningen vises alltid.
 */
import { first, type Tx } from '@/lib/db';
import { isProd } from '@/lib/env';

const sample = (tx: Tx) => (isProd ? tx`and t.is_sample = false` : tx``);

export async function awardCoverage(tx: Tx) {
  const [row] = (await tx`
    select count(*)::int as awards, count(distinct a.supplier_id)::int as suppliers, min(a.award_date) as first_date,
           max(a.award_date) as last_date, count(*) filter (where a.awarded_value is not null)::int as with_value,
           coalesce(array_agg(distinct a.source), '{}') as sources
    from contract_awards a join tenders t on t.id = a.tender_id where true ${sample(tx)}
  `) as unknown as { awards: number; suppliers: number; firstDate: Date | null; lastDate: Date | null; withValue: number; sources: string[] }[];
  return row!;
}

export interface SupplierSummary {
  supplierId: string;
  name: string;
  wins: number;
  totalValue: number | null;
  lastWin: Date | null;
  authorities: number;
}

export async function topSuppliers(tx: Tx, industries: string[], limit = 15): Promise<SupplierSummary[]> {
  return (await tx`
    select s.id as supplier_id, s.name, count(*)::int as wins,
           sum(a.awarded_value) filter (where coalesce(a.currency, 'NOK') = 'NOK')::float8 as total_value,
           max(a.award_date) as last_win, count(distinct t.authority_id)::int as authorities
    from contract_awards a join suppliers s on s.id = a.supplier_id join tenders t on t.id = a.tender_id
    where true ${industries.length ? tx`and t.industry_ids && ${industries}::text[]` : tx``} ${sample(tx)}
    group by s.id, s.name
    order by wins desc, total_value desc nulls last
    limit ${limit}
  `) as unknown as SupplierSummary[];
}

export async function searchSuppliers(tx: Tx, q: string): Promise<SupplierSummary[]> {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return (await tx`
    select s.id as supplier_id, s.name, count(a.id)::int as wins,
           sum(a.awarded_value) filter (where coalesce(a.currency, 'NOK') = 'NOK')::float8 as total_value,
           max(a.award_date) as last_win, count(distinct t.authority_id)::int as authorities
    from suppliers s left join contract_awards a on a.supplier_id = s.id left join tenders t on t.id = a.tender_id
    where s.name ilike ${pattern}
    group by s.id, s.name order by wins desc limit 30
  `) as unknown as SupplierSummary[];
}

export async function supplierDetail(tx: Tx, supplierId: string, orgId: string) {
  const supplier = first(
    (await tx`select id, name, org_number, country_code from suppliers where id = ${supplierId}`) as unknown as {
      id: string;
      name: string;
      orgNumber: string | null;
      countryCode: string | null;
    }[],
  );
  if (!supplier) return null;
  const awards = (await tx`
    select a.id, a.tender_id, t.title, t.buyer_name, t.authority_id, a.lot_title, a.awarded_value, a.currency, a.award_date, a.source,
           t.received_tenders, t.cpv_codes, t.is_sample
    from contract_awards a join tenders t on t.id = a.tender_id
    where a.supplier_id = ${supplierId} ${sample(tx)}
    order by a.award_date desc nulls last limit 200
  `) as unknown as {
    id: string;
    tenderId: string;
    title: string;
    buyerName: string | null;
    authorityId: string | null;
    lotTitle: string | null;
    awardedValue: number | null;
    currency: string | null;
    awardDate: Date | null;
    source: string;
    receivedTenders: number | null;
    cpvCodes: string[];
    isSample: boolean;
  }[];
  const byYear = (await tx`
    select extract(year from a.award_date)::int as year, count(*)::int as wins, sum(a.awarded_value)::float8 as value
    from contract_awards a join tenders t on t.id = a.tender_id
    where a.supplier_id = ${supplierId} and a.award_date is not null ${sample(tx)}
    group by 1 order by 1 desc
  `) as unknown as { year: number; wins: number; value: number | null }[];
  const watched = (await tx`select 1 from competitor_watch where org_id = ${orgId} and supplier_id = ${supplierId}`).length > 0;
  return { supplier, awards, byYear, watched };
}

export async function authorityDetail(tx: Tx, authorityId: string) {
  const authority = first(
    (await tx`select id, name, org_number, city from authorities where id = ${authorityId}`) as unknown as {
      id: string;
      name: string;
      orgNumber: string | null;
      city: string | null;
    }[],
  );
  if (!authority) return null;
  const stats = first(
    (await tx`
      select count(*)::int as tenders,
             count(*) filter (where t.lifecycle = 'awarded')::int as awarded,
             avg(t.estimated_value) filter (where coalesce(t.currency, 'NOK') = 'NOK')::float8 as avg_value,
             avg(t.received_tenders)::float8 as avg_received
      from tenders t where t.authority_id = ${authorityId} ${sample(tx)}
    `) as unknown as { tenders: number; awarded: number; avgValue: number | null; avgReceived: number | null }[],
  )!;
  const divisions = (await tx`
    select left(c, 2) as division, count(*)::int as n
    from tenders t, unnest(t.cpv_codes) as c
    where t.authority_id = ${authorityId} ${sample(tx)}
    group by 1 order by n desc limit 8
  `) as unknown as { division: string; n: number }[];
  const winners = (await tx`
    select s.id as supplier_id, s.name, count(*)::int as wins, sum(a.awarded_value)::float8 as total_value
    from contract_awards a join suppliers s on s.id = a.supplier_id join tenders t on t.id = a.tender_id
    where t.authority_id = ${authorityId} ${sample(tx)}
    group by s.id, s.name order by wins desc limit 10
  `) as unknown as { supplierId: string; name: string; wins: number; totalValue: number | null }[];
  const tenders = (await tx`
    select t.id, t.title, t.published_at, t.lifecycle, tender_status(t.lifecycle, t.deadline_at, t.published_at) as status, t.estimated_value, t.currency
    from tenders t where t.authority_id = ${authorityId} ${sample(tx)}
    order by t.published_at desc nulls last limit 30
  `) as unknown as { id: string; title: string; publishedAt: Date | null; lifecycle: string; status: string; estimatedValue: number | null; currency: string | null }[];
  return { authority, stats, divisions, winners, tenders };
}

export async function watchedSuppliers(tx: Tx, orgId: string) {
  return (await tx`
    select s.id as supplier_id, s.name, count(a.id)::int as wins, max(a.award_date) as last_win
    from competitor_watch w join suppliers s on s.id = w.supplier_id left join contract_awards a on a.supplier_id = s.id
    where w.org_id = ${orgId} group by s.id, s.name order by s.name
  `) as unknown as { supplierId: string; name: string; wins: number; lastWin: Date | null }[];
}

export async function topAuthorities(tx: Tx, industries: string[], limit = 10) {
  return (await tx`
    select au.id, au.name, count(*)::int as tenders,
           count(*) filter (where t.first_seen_at > now() - interval '365 days')::int as last_year
    from tenders t join authorities au on au.id = t.authority_id
    where true ${industries.length ? tx`and t.industry_ids && ${industries}::text[]` : tx``} ${sample(tx)}
    group by au.id, au.name order by tenders desc limit ${limit}
  `) as unknown as { id: string; name: string; tenders: number; lastYear: number }[];
}
