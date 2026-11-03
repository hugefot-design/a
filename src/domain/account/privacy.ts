/**
 * Personvern: dataeksport (GDPR art. 15/20) og sletting av konto/organisasjon (art. 17).
 */
import { first, systemSql, withTenant } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { log } from '@/lib/logger';
import { storage } from '@/lib/storage';
import { cancelStripeSubscriptionNow } from '@/domain/billing/stripe';
import type { AuthUser, OrgContext } from '@/server/http';

export async function exportData(user: AuthUser, org: OrgContext | null): Promise<Record<string, unknown>> {
  const sql = systemSql();
  const [account] = (await sql`
    select id, email, name, email_verified_at, created_at, last_login_at, terms_version, terms_accepted_at from users where id = ${user.id}
  `) as unknown as Record<string, unknown>[];
  const memberships = await sql`
    select o.id, o.name, m.role, m.created_at from organization_members m join organizations o on o.id = m.org_id where m.user_id = ${user.id}
  `;
  const auditRows = await sql`
    select action, target_type, target_id, metadata, created_at from audit_logs
    where actor_user_id = ${user.id} order by created_at desc limit 1000
  `;
  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    format: 'AnbudRadar dataeksport v1',
    account,
    memberships,
    auditLog: auditRows,
  };
  if (org) {
    const isAdmin = org.role === 'owner' || org.role === 'admin';
    out.organization = await withTenant({ userId: user.id, orgId: org.id }, async (tx) => {
      const own = {
        savedSearches: await tx`select name, filters, nl_query, alert_enabled, alert_frequency, created_at from saved_searches where user_id = ${user.id}`,
        notifications: await tx`select type, title, body, url, read_at, created_at from notifications order by created_at desc limit 2000`,
        notificationPreferences: await tx`select * from notification_preferences`,
      };
      if (!isAdmin) return { name: org.name, note: 'Organisasjonsdata eksporteres av eier eller administrator.', ...own };
      return {
        name: org.name,
        ...own,
        companyProfile: first(await tx`select * from company_profiles where org_id = ${org.id}`),
        bookmarks: await tx`select b.status, b.note, b.created_at, t.title, t.id as tender_id from bookmarks b join tenders t on t.id = b.tender_id`,
        bidWorkspaces: await tx`
          select w.id, w.title, w.status, w.created_at,
            (select coalesce(json_agg(json_build_object('title', s.title, 'content', s.content, 'requirement', s.requirement)), '[]') from bid_sections s where s.workspace_id = w.id) as sections,
            (select coalesce(json_agg(json_build_object('label', c.label, 'done', c.is_done)), '[]') from bid_checklist_items c where c.workspace_id = w.id) as checklist
          from bid_workspaces w
        `,
        subscription: first(await tx`select plan, status, source, current_period_end, trial_ends_at from subscriptions`),
        payments: await tx`select amount_cents, currency, status, created_at from payments`,
        profitIntelligence: {
          economics: first(await tx`select hourly_cost, overhead_pct, target_margin_pct, min_margin_pct, risk_buffer_pct, bid_cost_hours, notes, updated_at from org_economics`),
          staff: await tx`select role, headcount, hours_per_year_each, certifications, notes, created_at from org_staff`,
          equipment: await tx`select name, category, quantity, notes, created_at from org_equipment`,
          contracts: await tx`select name, client, start_date, end_date, hours_per_month, notes, created_at from org_contracts`,
          calculations: await tx`
            select c.tender_id, t.title, c.inputs, c.recommendation, c.updated_at
            from tender_calculations c join tenders t on t.id = c.tender_id
          `,
          partnerProfile: first(await tx`select * from partner_profiles where org_id = ${org.id}`),
          partnerRequests: await tx`
            select id, case when from_org_id = ${org.id} then 'sendt' else 'mottatt' end as direction, tender_id, role_sought, message,
                   self_assessment, status, requester_contact_name, requester_contact_email, responder_contact_name, responder_contact_email,
                   created_at, responded_at
            from partner_requests
          `,
        },
      };
    });
  }
  await audit({ action: 'data.exported', actorUserId: user.id, orgId: org?.id ?? null, targetType: 'user', targetId: user.id });
  return out;
}

async function storageKeysForOrg(orgId: string): Promise<string[]> {
  const rows = (await systemSql()`
    select storage_key from tender_documents where org_id = ${orgId} and storage_key is not null
    union all select storage_key from bid_documents where org_id = ${orgId}
  `) as unknown as { storageKey: string }[];
  return rows.map((r) => r.storageKey);
}

async function deleteOrgInternal(orgId: string): Promise<void> {
  const sql = systemSql();
  const sub = first(
    (await sql`select stripe_subscription_id from subscriptions where org_id = ${orgId} and source = 'stripe'`) as unknown as {
      stripeSubscriptionId: string | null;
    }[],
  );
  if (sub?.stripeSubscriptionId) {
    await cancelStripeSubscriptionNow(sub.stripeSubscriptionId).catch((err) => log.error('stripe_cancel_failed', { orgId, err }));
  }
  const keys = await storageKeysForOrg(orgId);
  await sql`delete from organizations where id = ${orgId}`;
  if (keys.length) await storage().remove(keys).catch((err) => log.warn('storage_cleanup_failed', { orgId, err }));
}

export async function deleteOrganization(user: AuthUser, org: OrgContext, confirmName: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (org.role !== 'owner') return { ok: false, error: 'Bare eieren kan slette organisasjonen.' };
  if (confirmName.trim() !== org.name) return { ok: false, error: 'Skriv inn organisasjonens navn nøyaktig for å bekrefte.' };
  await deleteOrgInternal(org.id);
  await audit({ action: 'org.deleted', actorUserId: user.id, targetType: 'organization', targetId: org.id });
  return { ok: true };
}

/** Sletter kontoen. Organisasjoner der brukeren er eneste medlem slettes også. */
export async function deleteAccount(user: AuthUser, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = systemSql();
  const row = first((await sql`select password_hash from users where id = ${user.id}`) as unknown as { passwordHash: string }[]);
  if (!row || !(await verifyPassword(password, row.passwordHash))) return { ok: false, error: 'Passordet er feil.' };
  const owned = (await sql`
    select m.org_id, o.name,
      (select count(*)::int from organization_members x where x.org_id = m.org_id) as members,
      (select count(*)::int from organization_members x where x.org_id = m.org_id and x.role = 'owner') as owners
    from organization_members m join organizations o on o.id = m.org_id
    where m.user_id = ${user.id} and m.role = 'owner'
  `) as unknown as { orgId: string; name: string; members: number; owners: number }[];
  const blocking = owned.filter((o) => o.members > 1 && o.owners === 1);
  if (blocking.length) {
    return {
      ok: false,
      error: `Du er eneste eier av ${blocking.map((b) => b.name).join(', ')}. Gi en annen bruker eierrollen først, eller fjern de andre medlemmene.`,
    };
  }
  for (const o of owned.filter((x) => x.members === 1)) await deleteOrgInternal(o.orgId);
  await sql`delete from users where id = ${user.id}`;
  await audit({ action: 'account.deleted', targetType: 'user', targetId: user.id, metadata: { deletedOrgs: owned.filter((x) => x.members === 1).length } });
  return { ok: true };
}
