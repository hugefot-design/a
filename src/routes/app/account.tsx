import { first } from '@/lib/db';
import { integrationStatus, isProd } from '@/lib/env';
import { audit } from '@/lib/audit';
import { log } from '@/lib/logger';
import { changePassword, deleteOtherSessions, nameSchema, SESSION_COOKIE } from '@/domain/auth/auth';
import { changeMemberRole, inviteMember, listMembers, removeMember, revokeInvitation } from '@/domain/org/org';
import { deleteAccount, deleteOrganization, exportData } from '@/domain/account/privacy';
import { PAID_PLANS, PLANS, type PaidPlanId } from '@/domain/billing/plans';
import {
  changeSubscriptionPlan,
  createCheckoutSession,
  createPortalSession,
  setCancelAtPeriodEnd,
  StripeError,
} from '@/domain/billing/stripe';
import { usageSummary } from '@/domain/ai/usage';
import { redirectWith } from '@/server/flash';
import { HttpError, redirect, serializeCookie } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { BillingPage } from '@/ui/pages/app/billing';
import { searchQuota } from '@/domain/billing/quota';
import { SettingsPage, type SettingsProps } from '@/ui/pages/app/settings';
import { formStr, param, requireManager, requireOrg } from '../helpers';

async function loadSettings(ctx: Parameters<Parameters<Router['get']>[2]>[0], tab: SettingsProps['tab']): Promise<Omit<SettingsProps, 'tab' | 'errors'>> {
  const { org, user } = requireOrg(ctx);
  const { members, invitations } = await listMembers(user.id, org.id);
  const { sessions, auditRows } = await ctx.tenant(async (tx) => {
    const sessions = (await tx`
      select id, user_agent, created_at, last_seen_at from sessions where user_id = ${user.id} and expires_at > now() order by last_seen_at desc
    `) as unknown as { id: string; userAgent: string | null; createdAt: Date; lastSeenAt: Date }[];
    const auditRows =
      tab === 'team' && org.role !== 'member'
        ? ((await tx`
            select a.action, a.created_at, u.name as actor_name from audit_logs a left join users u on u.id = a.actor_user_id
            where a.org_id = ${org.id} order by a.created_at desc limit 20
          `) as unknown as { action: string; createdAt: Date; actorName: string | null }[])
        : [];
    return { sessions, auditRows };
  });
  return {
    members,
    invitations,
    sessions: sessions.map((s) => ({ ...s, current: s.id === ctx.session?.id })),
    audit: auditRows,
  };
}

function tabFrom(value: string | null): SettingsProps['tab'] {
  return value === 'team' || value === 'personvern' || value === 'organisasjon' ? value : 'konto';
}

/**
 * Viktige endringer (passord, sletting, eksport av alle data, hvem som har tilgang): brukere med
 * totrinnsinnlogging må ha bekreftet de siste 15 minuttene (se server/app.ts).
 */
const SENSITIVE = { sensitive: true } as const;

export function registerAccountRoutes(router: Router): void {
  // ------------------------------------------------------------ Innstillinger
  router.get('/app/innstillinger', 'org', async (ctx) => {
    const tab = tabFrom(ctx.query.get('fane'));
    return render(ctx, <SettingsPage tab={tab} {...await loadSettings(ctx, tab)} />, { title: 'Innstillinger' });
  });

  router.post('/app/innstillinger/konto', 'org', async (ctx) => {
    const parsed = nameSchema.safeParse(formStr(await ctx.form(), 'name', 200));
    if (!parsed.success) {
      return render(ctx, <SettingsPage tab="konto" {...await loadSettings(ctx, 'konto')} errors={{ name: parsed.error.issues[0]!.message }} />, {
        title: 'Innstillinger',
        status: 422,
      });
    }
    await ctx.tenant((tx) => tx`update users set name = ${parsed.data} where id = ${ctx.user!.id}`);
    return redirectWith(ctx, '/app/innstillinger', 'success', 'Navnet er oppdatert.');
  });

  router.post('/app/innstillinger/passord', 'org', async (ctx) => {
    const form = await ctx.form();
    const result = await changePassword(ctx.user!.id, formStr(form, 'currentPassword', 300), formStr(form, 'newPassword', 300), ctx.session!.id);
    if (!result.ok) {
      return render(ctx, <SettingsPage tab="konto" {...await loadSettings(ctx, 'konto')} errors={result.errors} />, { title: 'Innstillinger', status: 422 });
    }
    return redirectWith(ctx, '/app/innstillinger', 'success', 'Passordet er endret. Andre enheter er logget ut.');
  }, SENSITIVE);

  router.post('/app/innstillinger/logg-ut-andre', 'org', async (ctx) => {
    const n = await deleteOtherSessions(ctx.user!.id, ctx.session!.id);
    await audit({ action: 'auth.sessions_revoked', actorUserId: ctx.user!.id, metadata: { count: n } });
    return redirectWith(ctx, '/app/innstillinger', 'success', `${n} andre ${n === 1 ? 'enhet er' : 'enheter er'} logget ut.`);
  });

  router.get('/app/innstillinger/eksport', 'org', async (ctx) => {
    const data = await exportData(ctx.user!, ctx.org);
    const filename = `anbudradar-eksport-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
    });
  }, SENSITIVE);

  router.post('/app/innstillinger/slett-konto', 'org', async (ctx) => {
    const result = await deleteAccount(ctx.user!, formStr(await ctx.form(), 'password', 300));
    if (!result.ok) {
      return render(ctx, <SettingsPage tab="personvern" {...await loadSettings(ctx, 'personvern')} errors={{ deleteAccount: result.error }} />, {
        title: 'Innstillinger',
        status: 422,
      });
    }
    ctx.responseCookies.push(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isProd }));
    return redirectWith(ctx, '/', 'success', 'Kontoen er slettet.');
  }, SENSITIVE);

  router.post('/app/innstillinger/slett-organisasjon', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const result = await deleteOrganization(user, org, formStr(await ctx.form(), 'confirmName', 200));
    if (!result.ok) {
      return render(ctx, <SettingsPage tab="organisasjon" {...await loadSettings(ctx, 'organisasjon')} errors={{ confirmName: result.error }} />, {
        title: 'Innstillinger',
        status: 422,
      });
    }
    return redirectWith(ctx, '/app', 'success', 'Organisasjonen er slettet.');
  }, SENSITIVE);

  // ------------------------------------------------------------------- Team
  router.post('/app/team/inviter', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const form = await ctx.form();
    const role = formStr(form, 'role', 20) === 'admin' ? 'admin' : 'member';
    const result = await inviteMember(user, org, formStr(form, 'email', 300), role);
    if (!result.ok) return redirectWith(ctx, '/app/innstillinger?fane=team', 'error', result.error);
    return redirectWith(ctx, '/app/innstillinger?fane=team', 'success', 'Invitasjonen er sendt.');
  }, SENSITIVE);

  router.post('/app/team/invitasjon/:id/trekk', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    await revokeInvitation(user, org, param(ctx, 'id'));
    return redirectWith(ctx, '/app/innstillinger?fane=team', 'success', 'Invitasjonen er trukket tilbake.');
  });

  router.post('/app/team/:userId/rolle', 'org', async (ctx) => {
    const { org, user } = requireManager(ctx);
    const role = formStr(await ctx.form(), 'role', 20);
    if (!['owner', 'admin', 'member'].includes(role)) throw new HttpError(400, 'Ugyldig rolle.');
    const result = await changeMemberRole(user, org, param(ctx, 'userId'), role as 'owner' | 'admin' | 'member');
    return redirectWith(ctx, '/app/innstillinger?fane=team', result.ok ? 'success' : 'error', result.ok ? 'Rollen er endret.' : result.error);
  }, SENSITIVE);

  router.post('/app/team/:userId/fjern', 'org', async (ctx) => {
    const { org, user } = requireOrg(ctx);
    const target = param(ctx, 'userId');
    const result = await removeMember(user, org, target);
    if (!result.ok) return redirectWith(ctx, '/app/innstillinger?fane=team', 'error', result.error);
    return target === user.id ? redirectWith(ctx, '/app', 'success', 'Du har forlatt organisasjonen.') : redirectWith(ctx, '/app/innstillinger?fane=team', 'success', 'Medlemmet er fjernet.');
  }, SENSITIVE);

  // ------------------------------------------------------------ Abonnement
  router.get(
    '/app/abonnement',
    'org',
    async (ctx) => {
      const { org } = requireOrg(ctx);
      const data = await ctx.tenant(async (tx) => {
        const sub = first(
          (await tx`select stripe_customer_id, stripe_subscription_id, source from subscriptions where org_id = ${org.id}`) as unknown as {
            stripeCustomerId: string | null;
            stripeSubscriptionId: string | null;
            source: string;
          }[],
        );
        const payments = (await tx`
          select amount_cents, currency, status, created_at, hosted_invoice_url from payments order by created_at desc limit 24
        `) as unknown as { amountCents: number; currency: string; status: string; createdAt: Date; hostedInvoiceUrl: string | null }[];
        const [counts] = (await tx`
          select (select count(*)::int from bookmarks where org_id = ${org.id}) as bookmarks,
                 (select count(*)::int from organization_members where org_id = ${org.id}) as members
        `) as unknown as { bookmarks: number; members: number }[];
        return { sub, payments, counts: counts!, usage: await usageSummary(tx, org) };
      });
      const integrations = integrationStatus();
      return render(
        ctx,
        <BillingPage
          stripeConfigured={integrations.stripe}
          stripeTestMode={integrations.stripeTestMode}
          usage={data.usage}
          payments={data.payments}
          hasStripeSubscription={Boolean(data.sub?.stripeSubscriptionId && data.sub.source === 'stripe' && org.billing.status !== 'canceled')}
          hasCustomer={Boolean(data.sub?.stripeCustomerId)}
          checkout={ctx.query.get('checkout')}
          bookmarkCount={data.counts.bookmarks}
          memberCount={data.counts.members}
          searchQuota={await searchQuota(org.id, ctx.user!.id, org.entitlements)}
        />,
        { title: 'Abonnement' },
      );
    },
    { requireOnboarding: false },
  );

  router.post(
    '/app/abonnement/velg',
    'org',
    async (ctx) => {
      const { org, user } = requireManager(ctx);
      const plan = formStr(await ctx.form(), 'plan', 20) as PaidPlanId;
      if (!PAID_PLANS.includes(plan)) throw new HttpError(400, 'Ukjent plan.');
      if (!integrationStatus().stripe) return redirectWith(ctx, '/app/abonnement', 'error', 'Betaling er ikke satt opp ennå.');
      const sub = await ctx.tenant(async (tx) =>
        first(
          (await tx`select stripe_customer_id, stripe_subscription_id, status, source from subscriptions where org_id = ${org.id}`) as unknown as {
            stripeCustomerId: string | null;
            stripeSubscriptionId: string | null;
            status: string;
            source: string;
          }[],
        ),
      );
      // Nedgradering: planen må ha plass til alle brukerne (ellers ville planen ikke styrt tilgangen).
      const memberCount = await ctx.tenant(async (tx) => {
        const [row] = (await tx`select count(*)::int as n from organization_members where org_id = ${org.id}`) as unknown as { n: number }[];
        return row?.n ?? 0;
      });
      const maxMembers = PLANS[plan].entitlements.maxMembers;
      if (memberCount > maxMembers) {
        return redirectWith(
          ctx,
          '/app/abonnement',
          'error',
          `${PLANS[plan].name} har plass til ${maxMembers} ${maxMembers === 1 ? 'bruker' : 'brukere'}, men organisasjonen har ${memberCount}. Fjern brukere under Innstillinger → Team først.`,
        );
      }
      try {
        if (sub?.source === 'stripe' && sub.stripeSubscriptionId && ['active', 'trialing', 'past_due'].includes(sub.status)) {
          await changeSubscriptionPlan(sub.stripeSubscriptionId, plan);
          await audit({ action: 'billing.checkout_started', orgId: org.id, actorUserId: user.id, metadata: { plan, change: true } });
          return redirectWith(ctx, '/app/abonnement', 'info', 'Planendringen er sendt til Stripe. Den vises her når Stripe har bekreftet den.');
        }
        const url = await createCheckoutSession({ orgId: org.id, orgName: org.name, userEmail: user.email, plan, existingCustomerId: sub?.stripeCustomerId ?? null });
        await audit({ action: 'billing.checkout_started', orgId: org.id, actorUserId: user.id, metadata: { plan } });
        return redirect(url);
      } catch (err) {
        log.error('stripe_checkout_failed', { err });
        return redirectWith(ctx, '/app/abonnement', 'error', err instanceof StripeError ? err.message : 'Kunne ikke starte betalingen. Prøv igjen.');
      }
    },
    { requireOnboarding: false },
  );

  router.post(
    '/app/abonnement/portal',
    'org',
    async (ctx) => {
      const { org } = requireManager(ctx);
      const sub = await ctx.tenant(async (tx) =>
        first((await tx`select stripe_customer_id from subscriptions where org_id = ${org.id}`) as unknown as { stripeCustomerId: string | null }[]),
      );
      if (!sub?.stripeCustomerId) return redirectWith(ctx, '/app/abonnement', 'error', 'Organisasjonen har ingen betalingskunde hos Stripe ennå.');
      try {
        return redirect(await createPortalSession(sub.stripeCustomerId));
      } catch (err) {
        log.error('stripe_portal_failed', { err });
        return redirectWith(ctx, '/app/abonnement', 'error', 'Kunne ikke åpne betalingsportalen.');
      }
    },
    { requireOnboarding: false },
  );

  router.post(
    '/app/abonnement/avslutt',
    'org',
    async (ctx) => {
      const { org, user } = requireManager(ctx);
      const cancel = formStr(await ctx.form(), 'cancel', 2) === '1';
      const sub = await ctx.tenant(async (tx) =>
        first((await tx`select stripe_subscription_id from subscriptions where org_id = ${org.id} and source = 'stripe'`) as unknown as { stripeSubscriptionId: string | null }[]),
      );
      if (!sub?.stripeSubscriptionId) return redirectWith(ctx, '/app/abonnement', 'error', 'Fant ikke abonnementet.');
      try {
        await setCancelAtPeriodEnd(sub.stripeSubscriptionId, cancel);
        await audit({ action: 'billing.subscription_changed', orgId: org.id, actorUserId: user.id, metadata: { cancelAtPeriodEnd: cancel } });
        return redirectWith(ctx, '/app/abonnement', 'success', cancel ? 'Abonnementet avsluttes ved slutten av perioden.' : 'Abonnementet fortsetter.');
      } catch (err) {
        log.error('stripe_cancel_failed', { err });
        return redirectWith(ctx, '/app/abonnement', 'error', 'Kunne ikke endre abonnementet. Prøv igjen.');
      }
    },
    { requireOnboarding: false },
  );

}
