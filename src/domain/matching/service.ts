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
    select org_id, industries, cpv_codes, keywords, services, products, competencies, regions, countries, certifications,
           min_contract_value, max_contract_value, contract_types, excluded_cpv, excluded_keywords, min_days_to_deadline, version,
           annual_revenue, employee_count, jsonb_array_length(reference_projects)::int as reference_count
    from company_profiles
    where onboarding_completed_at is not null ${orgId ? sql`and org_id = ${orgId}` : sql``}
  `) as unknown as ProfileRow[];
}

/** Anbud som kan gi treff: åpne, eller planlagte. */
const CANDIDATE_CONDITION = (sql: ReturnType<typeof systemSql>) =>
  sql`(t.lifecycle = 'planned' or (t.lifecycle in ('competition', 'other') and (t.deadline_at > now() or (t.deadline_at is null and t.published_at > now() - interval '60 days'))))`;

async function loadCandidateTenders(tenderIds?: string[], opts: { deadlineWithinDays?: number } = {}): Promise<MatchTender[]> {
  const sql = systemSql();
  return (await sql`
    select id, title, left(description, 8000) as description, cpv_codes, industry_ids, region_codes, country_code,
           estimated_value, currency, contract_nature, deadline_at, lifecycle,
           coalesce((select array_agg(left(x, 2000)) from jsonb_array_elements_text(t.selection_criteria) x), '{}') as selection_criteria
    from tenders t
    where ${CANDIDATE_CONDITION(sql)}
      ${isProd ? sql`and t.is_sample = false` : sql``}
      ${tenderIds ? sql`and t.id = any(${tenderIds}::uuid[])` : sql``}
      ${opts.deadlineWithinDays !== undefined ? sql`and t.deadline_at <= now() + make_interval(days => ${opts.deadlineWithinDays})` : sql``}
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
      -- Uendrede treff skrives ikke på nytt (ellers blir hver rad skrevet hver dag: tabellen vokser og basen jobber).
      where match_results.score is distinct from excluded.score or match_results.excluded is distinct from excluded.excluded
         or match_results.profile_version is distinct from excluded.profile_version
         or match_results.breakdown is distinct from excluded.breakdown
    `;
  }
}

/**
 * Lagrer treffene for et sett anbud for én organisasjon: endrede rader skrives, og anbud fra settet som ikke lenger
 * gir treff (for lav score), fjernes – ellers ble et gammelt, høyere treff liggende.
 */
async function replaceForTenders(orgId: string, version: number, tenderIds: string[], results: { tenderId: string; score: number; excluded: boolean; breakdown: unknown }[]) {
  await storeResults(orgId, version, results);
  const kept = results.map((r) => r.tenderId);
  if (tenderIds.length > kept.length) {
    await systemSql()`
      delete from match_results where org_id = ${orgId} and tender_id = any(${tenderIds}::uuid[]) and tender_id <> all(${kept}::uuid[])
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
  const ids = tenders.map((t) => t.id);
  for (const p of profiles) {
    const results = tenders.map((t) => ({ tenderId: t.id, ...scoreTender(p, t, now) })).filter((r) => r.score >= MIN_STORED_SCORE);
    await replaceForTenders(p.orgId, p.version, ids, results);
    stored += results.length;
  }
  log.info('matches_recomputed', { tenders: tenders.length, orgs: profiles.length, stored });
  return stored;
}

/**
 * Daglig oppdatering av treffene. Bare tiden endrer et treff fra dag til dag (nye og endrede anbud og endrede
 * profiler regnes ut med en gang), og tiden virker bare gjennom fristen: «kort frist» (under profilens minimum),
 * «fristen er om N dager» (de siste 14 dagene) og frist som er passert. Derfor:
 *  1. treff for anbud som ikke lenger kan gi treff (fristen passert, lukket), fjernes i én spørring;
 *  2. for hver profil regnes bare anbudene med frist innen max(14, profilens minimum) + 1 dager på nytt –
 *     resten ville gitt nøyaktig samme resultat – og bare endrede rader skrives.
 * Før ble alle åpne anbud regnet ut og skrevet for alle organisasjoner hver dag.
 */
export async function refreshTimeSensitiveMatches(now = new Date()): Promise<{ removed: number; scored: number; stored: number }> {
  const sql = systemSql();
  const removed = (await sql`
    delete from match_results m using tenders t
    where t.id = m.tender_id and (not coalesce(${CANDIDATE_CONDITION(sql)}, false) ${isProd ? sql`or t.is_sample` : sql``})
    returning 1
  `).length;
  const profiles = await loadProfiles();
  if (!profiles.length) return { removed, scored: 0, stored: 0 };
  const windowFor = (p: ProfileRow) => Math.max(14, p.minDaysToDeadline ?? 0) + 1;
  const tenders = await loadCandidateTenders(undefined, { deadlineWithinDays: Math.max(...profiles.map(windowFor)) });
  let scored = 0;
  let stored = 0;
  for (const p of profiles) {
    const limit = now.getTime() + windowFor(p) * 86_400_000;
    const relevant = tenders.filter((t) => t.deadlineAt && new Date(t.deadlineAt).getTime() <= limit);
    const results = relevant.map((t) => ({ tenderId: t.id, ...scoreTender(p, t, now) })).filter((r) => r.score >= MIN_STORED_SCORE);
    await replaceForTenders(p.orgId, p.version, relevant.map((t) => t.id), results);
    scored += relevant.length;
    stored += results.length;
  }
  log.info('matches_refreshed', { removed, scored, stored, orgs: profiles.length });
  return { removed, scored, stored };
}
