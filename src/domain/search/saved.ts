import { z } from 'zod';
import { toJson, type Tx } from '@/lib/db';
import type { OrgContext } from '@/server/http';
import { filtersForStorage, sanitizeQuery, type TenderQuery } from './filters';

export interface SavedSearchRow {
  id: string;
  userId: string;
  name: string;
  filters: TenderQuery;
  nlQuery: string | null;
  alertEnabled: boolean;
  alertFrequency: 'instant' | 'daily' | 'weekly';
  lastAlertedAt: Date | null;
  createdAt: Date;
  ownerName: string | null;
}

export const saveSearchSchema = z.object({
  name: z.string().trim().min(1, 'Gi søket et navn.').max(120),
  alertEnabled: z.boolean(),
  alertFrequency: z.enum(['instant', 'daily', 'weekly']),
});

export async function listSavedSearches(tx: Tx, orgId: string): Promise<SavedSearchRow[]> {
  const rows = (await tx`
    select s.id, s.user_id, s.name, s.filters, s.nl_query, s.alert_enabled, s.alert_frequency, s.last_alerted_at, s.created_at,
           u.name as owner_name
    from saved_searches s left join users u on u.id = s.user_id
    where s.org_id = ${orgId}
    order by s.created_at desc
  `) as unknown as SavedSearchRow[];
  return rows.map((r) => ({ ...r, filters: sanitizeQuery(r.filters) }));
}

/** Avgjør hvilken varselfrekvens planen tillater. */
export function allowedAlert(org: OrgContext, enabled: boolean, frequency: 'instant' | 'daily' | 'weekly') {
  if (org.entitlements.alerts === 'none') return { enabled: false, frequency: 'daily' as const };
  if (org.entitlements.alerts === 'basic' && frequency === 'instant') return { enabled, frequency: 'daily' as const };
  return { enabled, frequency };
}

export async function createSavedSearch(
  tx: Tx,
  org: OrgContext,
  userId: string,
  input: { name: string; filters: TenderQuery; nlQuery: string | null; alertEnabled: boolean; alertFrequency: 'instant' | 'daily' | 'weekly' },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [count] = (await tx`select count(*)::int as n from saved_searches where org_id = ${org.id}`) as unknown as { n: number }[];
  if ((count?.n ?? 0) >= org.entitlements.maxSavedSearches) {
    return {
      ok: false,
      error:
        org.entitlements.maxSavedSearches === 0
          ? 'Lagrede søk er ikke med i planen din. Oppgrader for å lagre søk og få varsler.'
          : `Planen din har plass til ${org.entitlements.maxSavedSearches} lagrede søk.`,
    };
  }
  const alert = allowedAlert(org, input.alertEnabled, input.alertFrequency);
  const rows = (await tx`
    insert into saved_searches (org_id, user_id, name, filters, nl_query, alert_enabled, alert_frequency, last_alerted_at)
    values (${org.id}, ${userId}, ${input.name}, ${toJson(filtersForStorage(input.filters))}::text::jsonb, ${input.nlQuery},
            ${alert.enabled}, ${alert.frequency}, now())
    returning id
  `) as unknown as { id: string }[];
  return { ok: true, id: rows[0]!.id };
}

export async function updateSavedSearch(
  tx: Tx,
  org: OrgContext,
  id: string,
  input: { name: string; alertEnabled: boolean; alertFrequency: 'instant' | 'daily' | 'weekly' },
): Promise<boolean> {
  const alert = allowedAlert(org, input.alertEnabled, input.alertFrequency);
  const rows = await tx`
    update saved_searches set name = ${input.name}, alert_enabled = ${alert.enabled}, alert_frequency = ${alert.frequency}
    where id = ${id} and org_id = ${org.id} returning id
  `;
  return rows.length > 0;
}

export async function deleteSavedSearch(tx: Tx, orgId: string, id: string): Promise<boolean> {
  const rows = await tx`delete from saved_searches where id = ${id} and org_id = ${orgId} returning id`;
  return rows.length > 0;
}
