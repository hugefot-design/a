import { z } from 'zod';
import { first, systemSql, withTenant } from '@/lib/db';
import { env } from '@/lib/env';
import { audit } from '@/lib/audit';
import { randomToken, sha256Hex } from '@/lib/crypto';
import { sendEmailSoon } from '@/lib/email';
import { absoluteUrl, invitationTemplate } from '@/domain/email/templates';
import { entitlementsFor, resolveBilling, TRIAL_PLAN, type SubscriptionRow } from '@/domain/billing/plans';
import type { AuthUser, Membership, OrgContext, OrgRole } from '@/server/http';

export const orgNumberSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s|NO|MVA/gi, ''))
  .refine((v) => v === '' || /^\d{9}$/.test(v), 'Organisasjonsnummer må ha 9 siffer.')
  .transform((v) => (v === '' ? null : v));

export async function getMemberships(userId: string): Promise<Membership[]> {
  return withTenant({ userId, orgId: null }, async (tx) => {
    const rows = (await tx`
      select o.id as org_id, o.name, m.role
      from organization_members m join organizations o on o.id = m.org_id
      where m.user_id = ${userId}
      order by o.name
    `) as unknown as Membership[];
    return rows;
  });
}

export async function loadOrgContext(user: AuthUser): Promise<OrgContext | null> {
  const memberships = await getMemberships(user.id);
  if (memberships.length === 0) return null;
  const current = memberships.find((m) => m.orgId === user.currentOrgId) ?? memberships[0]!;
  const data = await withTenant({ userId: user.id, orgId: current.orgId }, async (tx) => {
    const sub = first(
      (await tx`
        select plan, status, source, current_period_end, trial_ends_at, cancel_at_period_end,
               stripe_customer_id, stripe_subscription_id
        from subscriptions where org_id = ${current.orgId}
      `) as unknown as SubscriptionRow[],
    );
    const profile = first(
      (await tx`select onboarding_completed_at from company_profiles where org_id = ${current.orgId}`) as unknown as {
        onboardingCompletedAt: Date | null;
      }[],
    );
    return { sub, profile };
  });
  const billing = resolveBilling(data.sub);
  return {
    id: current.orgId,
    name: current.name,
    role: current.role,
    plan: billing.effectivePlan,
    entitlements: entitlementsFor(billing.effectivePlan),
    billing,
    onboardingCompleted: Boolean(data.profile?.onboardingCompletedAt),
    memberships,
  };
}

/** Maks antall organisasjoner én bruker kan opprette (hindrer misbruk av gratisgrensene). */
export const MAX_ORGS_CREATED_PER_USER = 5;

export class OrgLimitError extends Error {}

/**
 * Oppretter organisasjon med eier og standard varselinnstillinger. Prøveperioden gis bare én gang
 * per bruker: en ny organisasjon fra en bruker som allerede har hatt prøveperiode, starter på
 * gratisplanen (ellers kunne man fått evig prøveperiode ved å opprette nye organisasjoner).
 */
export async function createOrganization(
  user: AuthUser,
  input: { name: string; orgNumber: string | null },
  ipHash?: string,
): Promise<string> {
  const sql = systemSql();
  const orgId = await sql.begin(async (tx) => {
    const [me] = (await tx`select trial_started_at from users where id = ${user.id} for update`) as unknown as { trialStartedAt: Date | null }[];
    const [created] = (await tx`select count(*)::int as n from organizations where created_by = ${user.id}`) as unknown as { n: number }[];
    if ((created?.n ?? 0) >= MAX_ORGS_CREATED_PER_USER) {
      throw new OrgLimitError(`Du kan opprette inntil ${MAX_ORGS_CREATED_PER_USER} organisasjoner. Kontakt oss hvis du trenger flere.`);
    }
    const trial = !me?.trialStartedAt;
    const [org] = (await tx`
      insert into organizations (name, org_number, created_by) values (${input.name}, ${input.orgNumber}, ${user.id})
      returning id
    `) as unknown as { id: string }[];
    await tx`insert into organization_members (org_id, user_id, role) values (${org!.id}, ${user.id}, 'owner')`;
    if (trial) {
      await tx`
        insert into subscriptions (org_id, plan, status, source, trial_ends_at)
        values (${org!.id}, ${TRIAL_PLAN}, 'trialing', 'trial', now() + make_interval(days => ${env.TRIAL_DAYS}))
      `;
      await tx`update users set trial_started_at = now() where id = ${user.id}`;
    } else {
      // Prøveperioden er brukt: organisasjonen starter på gratisplanen.
      await tx`insert into subscriptions (org_id, plan, status, source, trial_ends_at) values (${org!.id}, ${TRIAL_PLAN}, 'trialing', 'trial', now())`;
    }
    await tx`insert into notification_preferences (user_id, org_id) values (${user.id}, ${org!.id}) on conflict do nothing`;
    await tx`update users set current_org_id = ${org!.id} where id = ${user.id}`;
    return org!.id;
  });
  await audit({ action: 'org.created', orgId, actorUserId: user.id, targetType: 'organization', targetId: orgId, ipHash });
  return orgId;
}

export async function switchOrganization(userId: string, orgId: string): Promise<boolean> {
  const memberships = await getMemberships(userId);
  if (!memberships.some((m) => m.orgId === orgId)) return false;
  await systemSql()`update users set current_org_id = ${orgId} where id = ${userId}`;
  return true;
}

export function canManageOrg(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin';
}

// ---------------------------------------------------------------------------
// Medlemmer og invitasjoner
// ---------------------------------------------------------------------------
export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  createdAt: Date;
}

export interface InvitationRow {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: Date;
  createdAt: Date;
}

export async function listMembers(userId: string, orgId: string) {
  return withTenant({ userId, orgId }, async (tx) => {
    const members = (await tx`
      select u.id as user_id, u.name, u.email, m.role, m.created_at
      from organization_members m join users u on u.id = m.user_id
      where m.org_id = ${orgId}
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.name
    `) as unknown as MemberRow[];
    const invitations = (await tx`
      select id, email, role, expires_at, created_at from invitations
      where org_id = ${orgId} and accepted_at is null and revoked_at is null and expires_at > now()
      order by created_at desc
    `) as unknown as InvitationRow[];
    return { members, invitations };
  });
}

export async function inviteMember(
  actor: AuthUser,
  org: OrgContext,
  emailRaw: string,
  role: 'admin' | 'member',
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canManageOrg(org.role)) return { ok: false, error: 'Bare eiere og administratorer kan invitere.' };
  if (!actor.emailVerified) return { ok: false, error: 'Bekreft e-postadressen din før du inviterer andre.' };
  const email = emailRaw.trim().toLowerCase();
  if (!z.string().email().safeParse(email).success) return { ok: false, error: 'Skriv inn en gyldig e-postadresse.' };

  const { members, invitations } = await listMembers(actor.id, org.id);
  if (members.some((m) => m.email.toLowerCase() === email)) return { ok: false, error: 'Personen er allerede medlem.' };
  if (members.length + invitations.length >= org.entitlements.maxMembers) {
    return { ok: false, error: `Planen din har plass til ${org.entitlements.maxMembers} bruker(e). Oppgrader for å invitere flere.` };
  }
  const token = randomToken(32);
  await withTenant({ userId: actor.id, orgId: org.id }, async (tx) => {
    await tx`
      update invitations set revoked_at = now()
      where org_id = ${org.id} and email = ${email} and accepted_at is null and revoked_at is null
    `;
    await tx`
      insert into invitations (org_id, email, role, token_hash, invited_by, expires_at)
      values (${org.id}, ${email}, ${role}, ${sha256Hex(token)}, ${actor.id}, now() + interval '7 days')
    `;
  });
  const tpl = invitationTemplate(org.name, actor.name, absoluteUrl(`/invitasjon?token=${encodeURIComponent(token)}`));
  await sendEmailSoon({ to: email, ...tpl, kind: 'invitation', orgId: org.id });
  await audit({ action: 'org.member_invited', orgId: org.id, actorUserId: actor.id, targetType: 'invitation', metadata: { role } });
  return { ok: true };
}

export async function findInvitation(token: string) {
  if (!token || token.length > 100) return null;
  return first(
    (await systemSql()`
      select i.id, i.org_id, i.email, i.role, o.name as org_name
      from invitations i join organizations o on o.id = i.org_id
      where i.token_hash = ${sha256Hex(token)} and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    `) as unknown as { id: string; orgId: string; email: string; role: OrgRole; orgName: string }[],
  );
}

/** Godtar invitasjon. Krever at innlogget bruker har bekreftet samme e-postadresse. */
export async function acceptInvitation(user: AuthUser, token: string): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  const inv = await findInvitation(token);
  if (!inv) return { ok: false, error: 'Invitasjonen er ugyldig eller utløpt.' };
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, error: `Invitasjonen ble sendt til ${inv.email}. Logg inn med den adressen.` };
  }
  if (!user.emailVerified) return { ok: false, error: 'Bekreft e-postadressen din først.' };
  await systemSql().begin(async (tx) => {
    await tx`
      insert into organization_members (org_id, user_id, role) values (${inv.orgId}, ${user.id}, ${inv.role})
      on conflict (org_id, user_id) do nothing
    `;
    await tx`update invitations set accepted_at = now() where id = ${inv.id}`;
    await tx`insert into notification_preferences (user_id, org_id) values (${user.id}, ${inv.orgId}) on conflict do nothing`;
    await tx`update users set current_org_id = ${inv.orgId} where id = ${user.id}`;
  });
  await audit({ action: 'org.member_joined', orgId: inv.orgId, actorUserId: user.id, targetType: 'user', targetId: user.id });
  return { ok: true, orgId: inv.orgId };
}

export async function revokeInvitation(actor: AuthUser, org: OrgContext, invitationId: string): Promise<void> {
  if (!canManageOrg(org.role)) return;
  await withTenant({ userId: actor.id, orgId: org.id }, (tx) =>
    tx`update invitations set revoked_at = now() where id = ${invitationId} and org_id = ${org.id}`,
  );
  await audit({ action: 'org.invitation_revoked', orgId: org.id, actorUserId: actor.id, targetType: 'invitation', targetId: invitationId });
}

export async function changeMemberRole(
  actor: AuthUser,
  org: OrgContext,
  targetUserId: string,
  role: OrgRole,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canManageOrg(org.role)) return { ok: false, error: 'Du har ikke tilgang til å endre roller.' };
  if (role === 'owner' && org.role !== 'owner') return { ok: false, error: 'Bare eieren kan overføre eierskap.' };
  return withTenant({ userId: actor.id, orgId: org.id }, async (tx) => {
    const target = first(
      (await tx`select role from organization_members where org_id = ${org.id} and user_id = ${targetUserId}`) as unknown as {
        role: OrgRole;
      }[],
    );
    if (!target) return { ok: false as const, error: 'Fant ikke medlemmet.' };
    if (target.role === 'owner' && org.role !== 'owner') return { ok: false as const, error: 'Du kan ikke endre eierens rolle.' };
    if (target.role === 'owner' && role !== 'owner') {
      const owners = (await tx`select count(*)::int as n from organization_members where org_id = ${org.id} and role = 'owner'`) as unknown as {
        n: number;
      }[];
      if ((owners[0]?.n ?? 0) <= 1) return { ok: false as const, error: 'Organisasjonen må ha minst én eier.' };
    }
    await tx`update organization_members set role = ${role} where org_id = ${org.id} and user_id = ${targetUserId}`;
    await audit({
      action: 'org.member_role_changed',
      orgId: org.id,
      actorUserId: actor.id,
      targetType: 'user',
      targetId: targetUserId,
      metadata: { role },
    });
    return { ok: true as const };
  });
}

export async function removeMember(
  actor: AuthUser,
  org: OrgContext,
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const self = targetUserId === actor.id;
  if (!self && !canManageOrg(org.role)) return { ok: false, error: 'Du har ikke tilgang til å fjerne medlemmer.' };
  return withTenant({ userId: actor.id, orgId: org.id }, async (tx) => {
    const target = first(
      (await tx`select role from organization_members where org_id = ${org.id} and user_id = ${targetUserId}`) as unknown as {
        role: OrgRole;
      }[],
    );
    if (!target) return { ok: false as const, error: 'Fant ikke medlemmet.' };
    if (target.role === 'owner') {
      const owners = (await tx`select count(*)::int as n from organization_members where org_id = ${org.id} and role = 'owner'`) as unknown as {
        n: number;
      }[];
      if ((owners[0]?.n ?? 0) <= 1) return { ok: false as const, error: 'Den siste eieren kan ikke fjernes. Overfør eierskap først.' };
      if (!self && org.role !== 'owner') return { ok: false as const, error: 'Bare eiere kan fjerne andre eiere.' };
    }
    await tx`delete from organization_members where org_id = ${org.id} and user_id = ${targetUserId}`;
    await audit({ action: 'org.member_removed', orgId: org.id, actorUserId: actor.id, targetType: 'user', targetId: targetUserId });
    return { ok: true as const };
  });
}
