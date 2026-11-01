import { first, systemSql } from '@/lib/db';
import { isProd } from '@/lib/env';
import { log } from '@/lib/logger';
import { scoreTender, type MatchProfile, type MatchTender } from './engine';

/** Lagres bare treff over denne grensen (holder tabellen liten). */
const MIN_STORED_SCORE = 15;

interface ProfileRow extends MatchProfile {
  orgId: string;
  version: number;
}

async function loadProfiles(orgId?: string): Promise<ProfileRow[]> {
  const sql = systemSql();
  return (await sql`
    select org_id, industries, cpv_codes, keywords, services, regions, countries, certifications, min_contract_value,
           max_contract_value, contract_types, excluded_cpv, excluded_keywords, min_days_to_deadline, version
    from company_profiles
    where onboarding_completed_at is not null ${orgId ? sql`and org_id = ${orgId}` : sql``}
  `) as unknown as ProfileRow[];
}

async function loadCandidateTenders(tenderIds?: string[]): Promise<MatchTender[]> {
  const sql = systemSql();
  return (await sql`
    select id, title, left(description, 8000) as description, cpv_codes, industry_ids, region_codes, country_code,
           estimated_value, currency, contract_nature, deadline_at, lifecycle
    from tenders t
    where (t.lifecycle = 'planned' or (t.lifecycle in ('competition', 'other') and (t.deadline_at > now() or (t.deadline_at is null and t.published_at > now() - interval '60 days'))))
      ${isProd ? sql`and t.is_sample = false` : sql``}
      ${tenderIds ? sql`and t.id = any(${tenderIds}::uuid[])` : sql``}
  `) as unknown as MatchTender[];
}

async function storeResults(orgId: string, version: number, results: { tenderId: string; score: number; excluded: boolean; breakdown: unknown }[]) {
  if (!results.length) return;
  const sql = systemSql();
  for (let i = 0; i < results.length; i += 500) {
    const chunk = results.slice(i, i + 500);
    await sql`
      insert into match_results (org_id, tender_id, score, breakdown, excluded, profile_version, computed_at)
      select ${orgId}, x.tender_id, x.score, x.breakdown::jsonb, x.excluded::boolean, ${version}, now()
      from unnest(${chunk.map((r) => r.tenderId)}::uuid[], ${chunk.map((r) => r.score)}::int[],
                  ${chunk.map((r) => JSON.stringify(r.breakdown))}::text[], ${chunk.map((r) => (r.excluded ? 'true' : 'false'))}::text[])
        as x(tender_id, score, breakdown, excluded)
      on conflict (org_id, tender_id) do update set
        score = excluded.score, breakdown = excluded.breakdown, excluded = excluded.excluded,
        profile_version = excluded.profile_version, computed_at = now()
    `;
  }
}

/** Beregner alle treff for én organisasjon (kalles når profilen lagres). */
export async function recomputeMatchesForOrg(orgId: string): Promise<number> {
  const profile = first(await loadProfiles(orgId));
  if (!profile) return 0;
  const tenders = await loadCandidateTenders();
  const now = new Date();
  const results = tenders
    .map((t) => ({ tenderId: t.id, ...scoreTender(profile, t, now) }))
    .filter((r) => r.score >= MIN_STORED_SCORE);
  const sql = systemSql();
  await sql`delete from match_results where org_id = ${orgId}`;
  await storeResults(orgId, profile.version, results);
  return results.length;
}

/** Beregner treff for nye/endrede kunngjøringer for alle organisasjoner (etter import). */
export async function recomputeMatchesForTenders(tenderIds: string[]): Promise<number> {
  if (!tenderIds.length) return 0;
  const tenders = await loadCandidateTenders(tenderIds);
  const profiles = await loadProfiles();
  const now = new Date();
  let stored = 0;
  const sql = systemSql();
  // Fjern treff for kunngjøringer som ikke lenger er åpne.
  await sql`
    delete from match_results where tender_id = any(${tenderIds}::uuid[])
      and tender_id <> all(${tenders.map((t) => t.id)}::uuid[])
  `;
  for (const p of profiles) {
    const results = tenders.map((t) => ({ tenderId: t.id, ...scoreTender(p, t, now) })).filter((r) => r.score >= MIN_STORED_SCORE);
    await storeResults(p.orgId, p.version, results);
    stored += results.length;
  }
  log.info('matches_recomputed', { tenders: tenders.length, orgs: profiles.length, stored });
  return stored;
}
