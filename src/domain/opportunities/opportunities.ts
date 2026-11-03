/**
 * Future Opportunities (Enterprise): offentlige prosjekter før de blir vanlige anbud.
 *
 * Kilder (offisielle og gratis, Norge først – landkode på alt, så flere land kan legges til):
 * 1. Planlagte anskaffelser (forhåndskunngjøringer) fra Doffin og TED – allerede hentet av
 *    kunngjøringskildene (lifecycle = 'planned').
 * 2. Politiske møtesaker fra eInnsyn (opportunity_signals) – se src/connectors/einnsyn.ts.
 *
 * Fakta og vurderinger holdes adskilt:
 * - `facts` er opplysninger som står i kilden (dato, oppdragsgiver, anslått verdi …).
 * - `match` og «kan gjelde» er AnbudRadars vurdering (regelbasert, ingen AI) og merkes slik.
 * - «Utlyst» vises bare når samme anskaffelse er utlyst ifølge kunngjøringene (samme rad går fra
 *   planlagt til konkurranse). Likhet i tittel er IKKE nok – testet mot ekte data og ga feiltreff.
 * Vi finner ikke alle fremtidige prosjekter, og sier det.
 */
import { systemSql, type Tx } from '@/lib/db';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';

export type OpportunityKind = 'planned_notice' | 'political_case';
export type OpportunityView = 'match' | 'all' | 'following';

export interface RelatedNotice {
  tenderId: string;
  title: string;
  buyerName: string | null;
  firstSeenAt: Date;
}

export interface OpportunityItem {
  kind: OpportunityKind;
  id: string;
  title: string;
  publisher: string | null;
  publishedAt: Date | null;
  sourceName: string;
  sourceUrl: string | null;
  detailUrl: string | null;
  regionNames: string[];
  industryNames: string[];
  facts: { label: string; value: string }[];
  status: { label: string; tone: 'planned' | 'published' | 'awarded' | 'cancelled' | 'case' };
  match: { score: number | null; reasons: string[] };
  matchedTerms: string[];
  following: boolean;
  related: RelatedNotice[];
}

export interface OpportunityFilters {
  view: OpportunityView;
  region: string | null;
  industry: string | null;
}

interface ProfileLite {
  industries: string[];
  regions: string[];
}

const names = (codes: string[], map: Map<string, { name: string }>) => codes.map((c) => map.get(c)?.name ?? c);

/** Regelbasert vurdering av et signal mot profilen (bransje må stemme; fylke hvis profilen har fylker). */
export function signalMatch(profile: ProfileLite, s: { industryIds: string[]; regionCodes: string[] }): { score: number | null; reasons: string[] } {
  const ind = s.industryIds.filter((i) => profile.industries.includes(i));
  if (!ind.length) return { score: null, reasons: [] };
  const reasons = [`Bransje i profilen: ${names(ind, INDUSTRY_BY_ID).join(', ')}`];
  let score = 60;
  if (!profile.regions.length) score += 20;
  else if (!s.regionCodes.length) score += 10;
  else {
    const reg = s.regionCodes.filter((r) => profile.regions.includes(r));
    if (!reg.length) return { score: null, reasons: [] };
    reasons.push(`Fylke i profilen: ${names(reg, REGION_BY_CODE).join(', ')}`);
    score += 40;
  }
  return { score: Math.min(100, score), reasons };
}

const dateFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' });
const money = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });
function moneyText(v: number, cur: string | null): string {
  const suffix = !cur || cur === 'NOK' ? 'kr' : cur;
  return v >= 1_000_000 ? `${money.format(v / 1_000_000)} mill. ${suffix}` : `${money.format(v)} ${suffix}`;
}

function statusFor(lifecycle: string): OpportunityItem['status'] {
  switch (lifecycle) {
    case 'planned':
      return { label: 'Planlagt', tone: 'planned' };
    case 'competition':
    case 'other':
      return { label: 'Utlyst som konkurranse', tone: 'published' };
    case 'awarded':
    case 'direct_award':
      return { label: 'Tildelt', tone: 'awarded' };
    default:
      return { label: 'Avlyst', tone: 'cancelled' };
  }
}

export async function loadProfileLite(tx: Tx, orgId: string): Promise<ProfileLite> {
  const [p] = (await tx`select industries, regions from company_profiles where org_id = ${orgId}`) as unknown as ProfileLite[];
  return { industries: p?.industries ?? [], regions: p?.regions ?? [] };
}

/** Planlagte kunngjøringer + politiske saker for organisasjonen. Leses med organisasjonens databaserolle. */
export async function listOpportunities(tx: Tx, orgId: string, filters: OpportunityFilters, limit = 60): Promise<OpportunityItem[]> {
  const profile = await loadProfileLite(tx, orgId);
  const following = filters.view === 'following';
  const regionCond = filters.region ? tx`and ${filters.region} = any(t.region_codes)` : tx``;
  const industryCond = filters.industry ? tx`and ${filters.industry} = any(t.industry_ids)` : tx``;
  const notices = (await tx`
    select t.id, t.title, t.buyer_name, t.published_at, t.first_seen_at, t.estimated_value::float8 as estimated_value, t.currency,
      t.region_codes, t.industry_ids, t.lifecycle, t.buyer_org_number, t.main_cpv,
      src.source, src.source_url, m.score, m.breakdown->'reasons' as reasons, f.id as follow_id
    from tenders t
    left join lateral (
      select s.source, s.source_url from tender_sources s where s.tender_id = t.id and s.removed_at is null
      order by (s.source = 'doffin') desc, s.fetched_at desc limit 1
    ) src on true
    left join match_results m on m.tender_id = t.id and m.org_id = ${orgId} and not m.excluded
    left join opportunity_follows f on f.tender_id = t.id and f.org_id = ${orgId}
    where not t.is_sample and t.country_code = 'NO'
      and ${following ? tx`f.id is not null` : tx`t.lifecycle = 'planned' and coalesce(t.published_at, t.first_seen_at) > now() - interval '18 months'`}
      ${filters.view === 'match' ? tx`and coalesce(m.score, 0) >= 40` : tx``}
      ${regionCond} ${industryCond}
    order by ${filters.view === 'match' ? tx`m.score desc,` : tx``} coalesce(t.published_at, t.first_seen_at) desc
    limit ${limit}
  `) as unknown as {
    id: string;
    title: string;
    buyerName: string | null;
    publishedAt: Date | null;
    firstSeenAt: Date;
    estimatedValue: number | null;
    currency: string | null;
    regionCodes: string[];
    industryIds: string[];
    lifecycle: string;
    buyerOrgNumber: string | null;
    mainCpv: string | null;
    source: string | null;
    sourceUrl: string | null;
    score: number | null;
    reasons: string[] | null;
    followId: string | null;
  }[];

  const sigRegion = filters.region ? tx`and ${filters.region} = any(g.region_codes)` : tx``;
  const sigIndustry = filters.industry ? tx`and ${filters.industry} = any(g.industry_ids)` : tx``;
  const signals = (await tx`
    select g.id, g.title, g.publisher, g.publisher_org_numbers, g.published_at, g.first_seen_at, g.region_codes, g.industry_ids,
      g.matched_terms, g.url, s.name as source_name, f.id as follow_id
    from opportunity_signals g
    join opportunity_sources s on s.id = g.source
    left join opportunity_follows f on f.signal_id = g.id and f.org_id = ${orgId}
    where g.country_code = 'NO'
      and ${following ? tx`f.id is not null` : tx`coalesce(g.published_at, g.first_seen_at) > now() - interval '18 months'`}
      ${sigRegion} ${sigIndustry}
    order by coalesce(g.published_at, g.first_seen_at) desc
    limit ${filters.view === 'match' ? 400 : limit}
  `) as unknown as {
    id: string;
    title: string;
    publisher: string | null;
    publisherOrgNumbers: string[];
    publishedAt: Date | null;
    firstSeenAt: Date;
    regionCodes: string[];
    industryIds: string[];
    matchedTerms: string[];
    url: string;
    sourceName: string;
    followId: string | null;
  }[];

  const items: OpportunityItem[] = [];
  for (const n of notices) {
    const facts: OpportunityItem['facts'] = [];
    facts.push({ label: 'Forhåndskunngjort', value: n.publishedAt ? dateFmt.format(n.publishedAt) : `sett ${dateFmt.format(n.firstSeenAt)}` });
    if (n.estimatedValue) facts.push({ label: 'Anslått verdi', value: moneyText(n.estimatedValue, n.currency) });
    if (n.mainCpv) facts.push({ label: 'CPV', value: n.mainCpv });
    items.push({
      kind: 'planned_notice',
      id: n.id,
      title: n.title,
      publisher: n.buyerName,
      publishedAt: n.publishedAt ?? n.firstSeenAt,
      sourceName: n.source === 'ted' ? 'TED' : n.source === 'doffin' ? 'Doffin' : (n.source ?? 'Kunngjøring'),
      sourceUrl: n.sourceUrl,
      detailUrl: `/app/anbud/${n.id}`,
      regionNames: names(n.regionCodes, REGION_BY_CODE),
      industryNames: names(n.industryIds, INDUSTRY_BY_ID),
      facts,
      status: statusFor(n.lifecycle),
      match: { score: n.score, reasons: (n.reasons ?? []).slice(0, 3) },
      matchedTerms: [],
      following: Boolean(n.followId),
      related: [],
    });
  }
  for (const g of signals) {
    const match = signalMatch(profile, g);
    if (filters.view === 'match' && match.score === null) continue;
    items.push({
      kind: 'political_case',
      id: g.id,
      title: g.title,
      publisher: g.publisher,
      publishedAt: g.publishedAt ?? g.firstSeenAt,
      sourceName: g.sourceName,
      sourceUrl: g.url,
      detailUrl: null,
      regionNames: names(g.regionCodes, REGION_BY_CODE),
      industryNames: names(g.industryIds, INDUSTRY_BY_ID),
      facts: [
        { label: 'Politisk sak publisert', value: g.publishedAt ? dateFmt.format(g.publishedAt) : `sett ${dateFmt.format(g.firstSeenAt)}` },
        ...(g.publisher ? [{ label: 'Organ', value: g.publisher }] : []),
      ],
      status: { label: 'Politisk sak', tone: 'case' },
      match,
      matchedTerms: g.matchedTerms,
      following: Boolean(g.followId),
      related: [],
    });
  }
  if (filters.view === 'match') items.sort((a, b) => (b.match.score ?? 0) - (a.match.score ?? 0) || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  else items.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  const out = items.slice(0, limit);
  if (following) {
    const related = await relatedNotices(out.map((i) => ({ kind: i.kind, id: i.id })));
    for (const i of out) i.related = related.get(i.id) ?? [];
  }
  return out;
}

/**
 * Nye konkurranser som KAN gjelde et fulgt prosjekt (vurdering, ikke fakta): samme oppdragsgiver og
 * samme CPV-klasse – fem første sifre – (planlagt kunngjøring), eller samme organ og bransje (politisk sak), publisert etterpå.
 */
export async function relatedNotices(refs: { kind: OpportunityKind; id: string }[], sinceDays = 365): Promise<Map<string, RelatedNotice[]>> {
  const out = new Map<string, RelatedNotice[]>();
  if (!refs.length) return out;
  const sql = systemSql();
  const tenderIds = refs.filter((r) => r.kind === 'planned_notice').map((r) => r.id);
  const signalIds = refs.filter((r) => r.kind === 'political_case').map((r) => r.id);
  if (tenderIds.length) {
    const rows = (await sql`
      select p.id as ref_id, c.id as tender_id, c.title, c.buyer_name, c.first_seen_at
      from tenders p
      join tenders c on c.id <> p.id and c.lifecycle in ('competition', 'other') and not c.is_sample
        and c.first_seen_at > coalesce(p.published_at, p.first_seen_at)
        and c.first_seen_at > now() - make_interval(days => ${sinceDays})
        and left(coalesce(c.main_cpv, ''), 5) = left(coalesce(p.main_cpv, 'x'), 5)
        and ((p.buyer_org_number is not null and c.buyer_org_number = p.buyer_org_number) or lower(c.buyer_name) = lower(p.buyer_name))
      where p.id in ${sql(tenderIds)}
      order by c.first_seen_at desc
    `) as unknown as (RelatedNotice & { refId: string })[];
    for (const r of rows) out.set(r.refId, [...(out.get(r.refId) ?? []), r].slice(0, 3));
  }
  if (signalIds.length) {
    const rows = (await sql`
      select g.id as ref_id, c.id as tender_id, c.title, c.buyer_name, c.first_seen_at
      from opportunity_signals g
      join tenders c on c.lifecycle in ('competition', 'other') and not c.is_sample
        and c.first_seen_at > coalesce(g.published_at, g.first_seen_at)
        and c.first_seen_at > now() - make_interval(days => ${sinceDays})
        and c.buyer_org_number = any(g.publisher_org_numbers)
        and c.industry_ids && g.industry_ids
      where g.id in ${sql(signalIds)}
      order by c.first_seen_at desc
    `) as unknown as (RelatedNotice & { refId: string })[];
    for (const r of rows) out.set(r.refId, [...(out.get(r.refId) ?? []), r].slice(0, 3));
  }
  return out;
}

export async function followOpportunity(tx: Tx, orgId: string, userId: string, kind: OpportunityKind, id: string): Promise<boolean> {
  const rows =
    kind === 'planned_notice'
      ? await tx`
          insert into opportunity_follows (org_id, tender_id, user_id)
          select ${orgId}, t.id, ${userId} from tenders t where t.id = ${id} and not t.is_sample
          on conflict do nothing returning id`
      : await tx`
          insert into opportunity_follows (org_id, signal_id, user_id)
          select ${orgId}, g.id, ${userId} from opportunity_signals g where g.id = ${id}
          on conflict do nothing returning id`;
  return rows.length > 0;
}

export async function unfollowOpportunity(tx: Tx, orgId: string, kind: OpportunityKind, id: string): Promise<void> {
  if (kind === 'planned_notice') await tx`delete from opportunity_follows where org_id = ${orgId} and tender_id = ${id}`;
  else await tx`delete from opportunity_follows where org_id = ${orgId} and signal_id = ${id}`;
}

export interface OpportunityCoverage {
  plannedNotices: number;
  signals: number;
  sources: { name: string; what: string; lastSuccessAt: Date | null; lastError: string | null }[];
}

/** Datadekning: hva vi henter, hvor mye, og når det sist ble hentet. */
export async function opportunityCoverage(): Promise<OpportunityCoverage> {
  const sql = systemSql();
  const [counts] = (await sql`
    select
      (select count(*)::int from tenders where lifecycle = 'planned' and not is_sample and country_code = 'NO'
         and coalesce(published_at, first_seen_at) > now() - interval '18 months') as planned_notices,
      (select count(*)::int from opportunity_signals where country_code = 'NO' and coalesce(published_at, first_seen_at) > now() - interval '18 months') as signals
  `) as unknown as { plannedNotices: number; signals: number }[];
  const notices = (await sql`select id, name, last_success_at, last_error from data_sources where id in ('doffin', 'ted') and enabled order by id`) as unknown as {
    id: string;
    name: string;
    lastSuccessAt: Date | null;
    lastError: string | null;
  }[];
  const others = (await sql`select name, description, last_success_at, last_error from opportunity_sources where enabled and country_code = 'NO' order by id`) as unknown as {
    name: string;
    description: string;
    lastSuccessAt: Date | null;
    lastError: string | null;
  }[];
  return {
    plannedNotices: counts?.plannedNotices ?? 0,
    signals: counts?.signals ?? 0,
    sources: [
      ...notices.map((n) => ({ name: n.name, what: 'Forhåndskunngjøringer (planlagte anskaffelser)', lastSuccessAt: n.lastSuccessAt, lastError: n.lastError })),
      ...others.map((o) => ({ name: o.name, what: o.description, lastSuccessAt: o.lastSuccessAt, lastError: o.lastError })),
    ],
  };
}
