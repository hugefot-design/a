import { first, type Tx } from '@/lib/db';
import { isProd } from '@/lib/env';
import type { OrgContext } from '@/server/http';
import { statusCondition, type TenderListItem } from '@/domain/tenders/queries';

export interface DashboardData {
  newMatches: number;
  savedCount: number;
  upcomingDeadlines: number;
  openInIndustries: number;
  topMatches: TenderListItem[];
  deadlines: { tenderId: string; title: string; deadlineAt: Date | null; deadlineTimeKnown: boolean; status: string; bookmarkStatus: string }[];
  recent: TenderListItem[];
  awards: { tenderId: string; title: string; supplierName: string; supplierId: string | null; awardedValue: number | null; currency: string | null; awardDate: Date | null; buyerName: string | null }[];
  industryStats: { industryId: string; open: number; newThisWeek: number; totalValue: number | null }[];
  profileIndustries: string[];
  profileRegions: string[];
  weeklyOverview: { headline: string; points: string[]; isMock: boolean; createdAt: Date } | null;
}

const LIST_COLUMNS = (tx: Tx, orgId: string) => tx`
  t.id, t.title, t.buyer_name, t.place_text, t.region_codes, t.industry_ids, t.cpv_codes, t.estimated_value, t.currency,
  t.published_at, t.deadline_at, t.deadline_time_known, t.lifecycle, t.is_sample, t.first_seen_at,
  tender_status(t.lifecycle, t.deadline_at, t.published_at) as status,
  (select coalesce(array_agg(distinct s.source), '{}') from tender_sources s where s.tender_id = t.id) as sources,
  (select b.id is not null from bookmarks b where b.tender_id = t.id and b.org_id = ${orgId}) is true as bookmarked
`;

export function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function loadDashboard(tx: Tx, org: OrgContext): Promise<DashboardData> {
  const profile = first(
    (await tx`select industries, regions from company_profiles where org_id = ${org.id}`) as unknown as { industries: string[]; regions: string[] }[],
  );
  const industries = profile?.industries ?? [];
  const regions = (profile?.regions ?? []).filter((r) => r !== 'ALL');
  const sampleFilter = isProd ? tx`and t.is_sample = false` : tx``;
  const open = statusCondition(tx, 'open');
  const relevant = tx`(${open} or t.lifecycle = 'planned') and t.industry_ids && ${industries}::text[] ${regions.length ? tx`and (t.region_codes && ${regions}::text[] or t.region_codes = '{}')` : tx``}`;

  const [counts] = (await tx`
    select
      (select count(*)::int from match_results m join tenders t on t.id = m.tender_id
        where m.org_id = ${org.id} and not m.excluded and m.score >= 60 and t.first_seen_at > now() - interval '7 days') as new_matches,
      (select count(*)::int from bookmarks where org_id = ${org.id}) as saved_count,
      (select count(*)::int from bookmarks b join tenders t on t.id = b.tender_id
        where b.org_id = ${org.id} and t.deadline_at between now() and now() + interval '14 days') as upcoming_deadlines,
      (select count(*)::int from tenders t where ${relevant} ${sampleFilter}) as open_in_industries
  `) as unknown as { newMatches: number; savedCount: number; upcomingDeadlines: number; openInIndustries: number }[];

  const topMatches = org.entitlements.matching
    ? ((await tx`
        select ${LIST_COLUMNS(tx, org.id)}, m.score
        from match_results m join tenders t on t.id = m.tender_id
        where m.org_id = ${org.id} and not m.excluded and (${open} or t.lifecycle = 'planned') ${sampleFilter}
        order by m.score desc, t.deadline_at asc nulls last
        limit 6
      `) as unknown as TenderListItem[])
    : [];

  const deadlines = (await tx`
    select t.id as tender_id, t.title, t.deadline_at, t.deadline_time_known, b.status as bookmark_status,
           tender_status(t.lifecycle, t.deadline_at, t.published_at) as status
    from bookmarks b join tenders t on t.id = b.tender_id
    where b.org_id = ${org.id} and t.deadline_at > now()
    order by t.deadline_at asc limit 6
  `) as unknown as DashboardData['deadlines'];

  const recent = industries.length
    ? ((await tx`
        select ${LIST_COLUMNS(tx, org.id)}, null::int as score from tenders t
        where ${relevant} ${sampleFilter}
        order by t.first_seen_at desc, t.published_at desc nulls last limit 6
      `) as unknown as TenderListItem[])
    : [];

  const awards = industries.length
    ? ((await tx`
        select a.tender_id, t.title, a.supplier_name, a.supplier_id, a.awarded_value, a.currency, a.award_date, t.buyer_name
        from contract_awards a join tenders t on t.id = a.tender_id
        where t.industry_ids && ${industries}::text[] ${sampleFilter}
        order by a.award_date desc nulls last, a.created_at desc limit 5
      `) as unknown as DashboardData['awards'])
    : [];

  const industryStats = industries.length
    ? ((await tx`
        select ind as industry_id,
               count(*) filter (where ${open})::int as open,
               count(*) filter (where ${open} and t.first_seen_at > now() - interval '7 days')::int as new_this_week,
               sum(t.estimated_value) filter (where ${open} and coalesce(t.currency, 'NOK') = 'NOK')::float8 as total_value
        from unnest(${industries}::text[]) as ind
        left join tenders t on t.industry_ids @> array[ind] ${sampleFilter}
        group by ind order by open desc
      `) as unknown as DashboardData['industryStats'])
    : [];

  const weekly = first(
    (await tx`
      select result, created_at from ai_analyses
      where kind = 'weekly_overview' and org_id = ${org.id} and status = 'completed' and result->>'week' = ${isoWeek()}
      order by created_at desc limit 1
    `) as unknown as { result: { data: { headline: string; points: string[] }; isMock?: boolean }; createdAt: Date }[],
  );

  return {
    ...counts!,
    topMatches,
    deadlines,
    recent,
    awards,
    industryStats,
    profileIndustries: industries,
    profileRegions: regions,
    weeklyOverview: weekly ? { ...weekly.result.data, isMock: Boolean(weekly.result.isMock), createdAt: weekly.createdAt } : null,
  };
}
