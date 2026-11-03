/**
 * Gratisgrensen for søk, håndhevet på serveren.
 *
 * - Et «søk» er et distinkt sett med filtre/fritekst. Å bla i resultatene, endre sortering eller
 *   gjenta et søk samme dag teller ikke. Standardlisten uten filtre teller ikke.
 * - Grensen gjelder både organisasjonen og brukeren (på tvers av organisasjoner), så den ikke kan
 *   omgås med flere organisasjoner. En lås per bruker hindrer at samtidige forespørsler slipper forbi.
 * - Dagen regnes i norsk tid. Radene slettes etter 8 dager (applyRetention).
 */
import { createHash } from 'node:crypto';
import { systemSql } from '@/lib/db';
import { sanitizeQuery, type TenderQuery } from '@/domain/search/filters';
import { UNLIMITED, type Entitlements } from './plans';

const osloDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' });

export function quotaDay(now = new Date()): string {
  return osloDay.format(now);
}

function normalized(q: TenderQuery, nl: string): string {
  const { page: _page, sort: _sort, ...rest } = q;
  const entries = Object.entries(rest)
    .map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : typeof v === 'string' ? v.trim().toLowerCase() : v] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return `${JSON.stringify(entries)}|${nl.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

const EMPTY = normalized(sanitizeQuery({}), '');

/** Nøkkel for et søk, eller null når det ikke er et søk (standardlisten uten filtre). */
export function searchKey(q: TenderQuery, nl = ''): string | null {
  const n = normalized(q, nl);
  if (n === EMPTY) return null;
  return createHash('sha256').update(n).digest('hex').slice(0, 32);
}

export interface SearchQuota {
  used: number;
  limit: number;
  unlimited: boolean;
}

/** Hvor mange søk som er brukt i dag (for visning). */
export async function searchQuota(orgId: string, userId: string, ent: Entitlements, now = new Date()): Promise<SearchQuota> {
  const limit = ent.searchesPerDay;
  if (limit >= UNLIMITED) return { used: 0, limit, unlimited: true };
  const [row] = (await systemSql()`
    select count(*)::int as n from search_usage where day = ${quotaDay(now)} and (org_id = ${orgId} or user_id = ${userId})
  `) as unknown as { n: number }[];
  return { used: row?.n ?? 0, limit, unlimited: false };
}

/** Registrerer et søk hvis det er plass. Et søk som allerede er gjort i dag, er alltid tillatt. */
export async function consumeSearch(
  orgId: string,
  userId: string,
  ent: Entitlements,
  key: string,
  now = new Date(),
): Promise<SearchQuota & { allowed: boolean }> {
  const limit = ent.searchesPerDay;
  if (limit >= UNLIMITED) return { allowed: true, used: 0, limit, unlimited: true };
  const day = quotaDay(now);
  return systemSql().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`search-quota:${userId}`}))`;
    const seen = await tx`select 1 from search_usage where org_id = ${orgId} and day = ${day} and query_hash = ${key}`;
    const [row] = (await tx`
      select count(*)::int as n from search_usage where day = ${day} and (org_id = ${orgId} or user_id = ${userId})
    `) as unknown as { n: number }[];
    const used = row?.n ?? 0;
    if (seen.length) return { allowed: true, used, limit, unlimited: false };
    if (used >= limit) return { allowed: false, used, limit, unlimited: false };
    await tx`insert into search_usage (org_id, user_id, day, query_hash) values (${orgId}, ${userId}, ${day}, ${key}) on conflict do nothing`;
    return { allowed: true, used: used + 1, limit, unlimited: false };
  }) as Promise<SearchQuota & { allowed: boolean }>;
}
