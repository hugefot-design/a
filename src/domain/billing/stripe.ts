/**
 * Stripe-integrasjon via REST (ingen SDK). Betalt tilgang aktiveres KUN av webhooks
 * med gyldig signatur – aldri av at nettleseren kommer tilbake fra Checkout.
 */
import { createHmac } from 'node:crypto';
import { env, integrationStatus } from '@/lib/env';
import { first, systemSql } from '@/lib/db';
import { safeEqual } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { log } from '@/lib/logger';
import { queueEmail } from '@/lib/email';
import { absoluteUrl, paymentFailedTemplate } from '@/domain/email/templates';
import { insertNotifications } from '@/domain/notifications/engine';
import type { PaidPlanId, PlanId } from './plans';

export class StripeError extends Error {}

type Params = Record<string, unknown>;

/** Stripe forventer form-encoding med nøstede nøkler: line_items[0][price]=... */
export function encodeStripeParams(params: Params, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') out.push(...encodeStripeParams(item as Params, `${key}[${i}]`));
        else out.push([`${key}[${i}]`, String(item)]);
      });
    } else if (typeof v === 'object') {
      out.push(...encodeStripeParams(v as Params, key));
    } else {
      out.push([key, String(v)]);
    }
  }
  return out;
}

async function stripe<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'DELETE', path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  if (!env.STRIPE_SECRET_KEY) throw new StripeError('Stripe er ikke konfigurert (mangler STRIPE_SECRET_KEY).');
  const body = new URLSearchParams(encodeStripeParams(params));
  const url = `https://api.stripe.com/v1${path}${method === 'GET' && body.toString() ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: method === 'GET' ? undefined : body,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new StripeError(data.error?.message ?? `Stripe svarte ${res.status}`);
  return data;
}

export function priceIdFor(plan: PaidPlanId): string | undefined {
  return { starter: env.STRIPE_PRICE_STARTER, professional: env.STRIPE_PRICE_PROFESSIONAL, business: env.STRIPE_PRICE_BUSINESS }[plan];
}

export function planFromPriceId(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_STARTER) return 'starter';
  if (priceId === env.STRIPE_PRICE_PROFESSIONAL) return 'professional';
  if (priceId === env.STRIPE_PRICE_BUSINESS) return 'business';
  return null;
}

export async function createCheckoutSession(input: {
  orgId: string;
  orgName: string;
  userEmail: string;
  plan: PaidPlanId;
  existingCustomerId: string | null;
}): Promise<string> {
  if (!integrationStatus().stripe) throw new StripeError('Betaling er ikke satt opp ennå.');
  const price = priceIdFor(input.plan)!;
  const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: input.orgId,
    ...(input.existingCustomerId ? { customer: input.existingCustomerId } : { customer_email: input.userEmail }),
    metadata: { org_id: input.orgId, plan: input.plan },
    subscription_data: { metadata: { org_id: input.orgId, plan: input.plan } },
    allow_promotion_codes: 'true',
    billing_address_collection: 'required',
    tax_id_collection: { enabled: 'true' },
    locale: 'nb',
    success_url: absoluteUrl('/app/abonnement?checkout=fullfort'),
    cancel_url: absoluteUrl('/app/abonnement?checkout=avbrutt'),
  });
  return session.url;
}

export async function createPortalSession(customerId: string): Promise<string> {
  const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: absoluteUrl('/app/abonnement'),
  });
  return session.url;
}

export async function changeSubscriptionPlan(subscriptionId: string, plan: PaidPlanId): Promise<void> {
  const sub = await stripe<{ items: { data: { id: string }[] } }>('GET', `/subscriptions/${subscriptionId}`);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new StripeError('Fant ikke abonnementslinjen hos Stripe.');
  await stripe('POST', `/subscriptions/${subscriptionId}`, {
    items: [{ id: itemId, price: priceIdFor(plan) }],
    proration_behavior: 'create_prorations',
    metadata: { plan },
  });
}

export async function setCancelAtPeriodEnd(subscriptionId: string, cancel: boolean): Promise<void> {
  await stripe('POST', `/subscriptions/${subscriptionId}`, { cancel_at_period_end: String(cancel) });
}

export async function cancelStripeSubscriptionNow(subscriptionId: string): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) return;
  await stripe('DELETE', `/subscriptions/${subscriptionId}`);
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
  created: number;
}

/** Verifiserer Stripe-Signature (t=...,v1=...) med HMAC-SHA256 og toleranse for klokkeforskjell. */
export function verifyStripeSignature(payload: Buffer, header: string | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)): StripeEvent {
  if (!header) throw new StripeError('Mangler Stripe-Signature');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !signatures.length) throw new StripeError('Ugyldig signaturformat');
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp) || Math.abs(nowSec - timestamp) > toleranceSec) throw new StripeError('Signaturen er for gammel');
  const expected = createHmac('sha256', secret).update(`${t}.${payload.toString('utf8')}`).digest('hex');
  if (!signatures.some((s) => safeEqual(s, expected))) throw new StripeError('Ugyldig signatur');
  return JSON.parse(payload.toString('utf8')) as StripeEvent;
}

function toDate(sec: unknown): Date | null {
  return typeof sec === 'number' && sec > 0 ? new Date(sec * 1000) : null;
}

async function orgIdForCustomer(customerId: string | null, metadataOrgId: unknown): Promise<string | null> {
  if (typeof metadataOrgId === 'string' && /^[0-9a-f-]{36}$/i.test(metadataOrgId)) {
    const exists = await systemSql()`select 1 from organizations where id = ${metadataOrgId}`;
    if (exists.length) return metadataOrgId;
  }
  if (!customerId) return null;
  const row = first((await systemSql()`select org_id from subscriptions where stripe_customer_id = ${customerId}`) as unknown as { orgId: string }[]);
  return row?.orgId ?? null;
}

const KNOWN_STATUSES = new Set(['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused']);

/**
 * Oppdaterer abonnementet fra et Stripe-subscription-objekt.
 * `eventAt` er tidspunktet for hendelsen; eldre hendelser enn den som sist ble brukt ignoreres,
 * slik at en forsinket «updated» ikke kan gjenopplive et kansellert abonnement.
 */
async function upsertFromSubscription(sub: Record<string, unknown>, eventAt: Date): Promise<void> {
  const customer = typeof sub.customer === 'string' ? sub.customer : null;
  const metadata = (sub.metadata ?? {}) as Record<string, unknown>;
  const orgId = await orgIdForCustomer(customer, metadata.org_id);
  if (!orgId) {
    log.warn('stripe_subscription_unmatched', { subscription: sub.id, customer });
    return;
  }
  const item = ((sub.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0] ?? {};
  const priceId = ((item.price ?? {}) as { id?: string }).id ?? null;
  const plan = planFromPriceId(priceId);
  if (!plan) {
    log.error('stripe_unknown_price', { priceId, subscription: sub.id });
    return;
  }
  const status = KNOWN_STATUSES.has(String(sub.status)) ? String(sub.status) : 'incomplete';
  const periodEnd = toDate(sub.current_period_end) ?? toDate(item.current_period_end);
  await systemSql()`
    insert into subscriptions (org_id, plan, status, source, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, cancel_at_period_end, stripe_event_at)
    values (${orgId}, ${plan}, ${status}, 'stripe', ${customer}, ${String(sub.id)}, ${priceId}, ${periodEnd}, ${Boolean(sub.cancel_at_period_end)}, ${eventAt})
    on conflict (org_id) do update set
      plan = excluded.plan, status = excluded.status, source = 'stripe', stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id, stripe_price_id = excluded.stripe_price_id,
      current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
      trial_ends_at = null, stripe_event_at = excluded.stripe_event_at
    where subscriptions.stripe_event_at is null or subscriptions.stripe_event_at <= excluded.stripe_event_at
  `;
  await audit({ action: 'billing.subscription_changed', orgId, targetType: 'subscription', targetId: String(sub.id), metadata: { plan, status } });
}

async function recordInvoice(invoice: Record<string, unknown>, status: 'paid' | 'failed'): Promise<string | null> {
  const customer = typeof invoice.customer === 'string' ? invoice.customer : null;
  const orgId = await orgIdForCustomer(customer, (invoice.subscription_details as { metadata?: Record<string, unknown> } | undefined)?.metadata?.org_id);
  if (!orgId) return null;
  await systemSql()`
    insert into payments (org_id, stripe_invoice_id, amount_cents, currency, status, hosted_invoice_url, period_start, period_end)
    values (${orgId}, ${String(invoice.id)}, ${Number(invoice.amount_paid ?? invoice.amount_due ?? 0)}, ${String(invoice.currency ?? 'nok').toUpperCase()},
            ${status}, ${typeof invoice.hosted_invoice_url === 'string' ? invoice.hosted_invoice_url : null},
            ${toDate(invoice.period_start)}, ${toDate(invoice.period_end)})
    on conflict (stripe_invoice_id) do update set status = excluded.status, amount_cents = excluded.amount_cents
  `;
  return orgId;
}

async function notifyPaymentFailed(orgId: string): Promise<void> {
  const sql = systemSql();
  const admins = (await sql`
    select u.id, u.email, u.email_verified_at, o.name as org_name from organization_members m
    join users u on u.id = m.user_id join organizations o on o.id = m.org_id
    where m.org_id = ${orgId} and m.role in ('owner', 'admin')
  `) as unknown as { id: string; email: string; emailVerifiedAt: Date | null; orgName: string }[];
  const day = new Date().toISOString().slice(0, 10);
  await insertNotifications(
    admins.map((a) => ({
      orgId,
      userId: a.id,
      type: 'payment_failed',
      tenderId: null,
      title: 'Betalingen feilet',
      body: 'Oppdater betalingsmåten for å beholde tilgangen.',
      url: '/app/abonnement',
      dedupeKey: `payment_failed:${day}`,
    })),
  ).catch(() => 0);
  for (const a of admins.filter((x) => x.emailVerifiedAt)) {
    const tpl = paymentFailedTemplate(a.orgName, absoluteUrl('/app/abonnement'));
    await queueEmail({ to: a.email, ...tpl, kind: 'payment_failed', userId: a.id, orgId });
  }
  await audit({ action: 'billing.payment_failed', orgId, targetType: 'organization', targetId: orgId });
}

/** Behandler en verifisert hendelse. Idempotent via stripe_events. */
export async function handleStripeEvent(event: StripeEvent): Promise<'processed' | 'duplicate' | 'ignored'> {
  const sql = systemSql();
  const inserted = await sql`insert into stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing returning id`;
  if (!inserted.length) {
    const prev = first((await sql`select processed_at from stripe_events where id = ${event.id}`) as unknown as { processedAt: Date | null }[]);
    if (prev?.processedAt) return 'duplicate';
  }
  const obj = event.data.object;
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const subId = typeof obj.subscription === 'string' ? obj.subscription : null;
        const customer = typeof obj.customer === 'string' ? obj.customer : null;
        const orgId = await orgIdForCustomer(customer, (obj.metadata as Record<string, unknown> | undefined)?.org_id ?? obj.client_reference_id);
        if (orgId && customer) {
          await sql`update subscriptions set stripe_customer_id = ${customer} where org_id = ${orgId} and (stripe_customer_id is null or stripe_customer_id = ${customer})`;
        }
        if (subId && env.STRIPE_SECRET_KEY) {
          // Hent ferske data fra Stripe i stedet for å stole på innholdet i hendelsen.
          const sub = await stripe<Record<string, unknown>>('GET', `/subscriptions/${subId}`);
          await upsertFromSubscription(sub, new Date());
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await upsertFromSubscription(obj, new Date(event.created * 1000));
        break;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await recordInvoice(obj, 'paid');
        break;
      case 'invoice.payment_failed': {
        const orgId = await recordInvoice(obj, 'failed');
        if (orgId) await notifyPaymentFailed(orgId);
        break;
      }
      default:
        await sql`update stripe_events set processed_at = now() where id = ${event.id}`;
        return 'ignored';
    }
    await sql`update stripe_events set processed_at = now(), error = null where id = ${event.id}`;
    return 'processed';
  } catch (err) {
    await sql`update stripe_events set error = ${err instanceof Error ? err.message : String(err)} where id = ${event.id}`;
    throw err;
  }
}

/** Manuell plan (enterprise/avtale) satt av plattform-admin. Logges alltid. */
export async function setManualPlan(adminUserId: string, orgId: string, plan: PlanId, periodEnd: Date | null, note: string): Promise<void> {
  await systemSql()`
    insert into subscriptions (org_id, plan, status, source, current_period_end, manual_note)
    values (${orgId}, ${plan}, 'active', 'manual', ${periodEnd}, ${note})
    on conflict (org_id) do update set plan = excluded.plan, status = 'active', source = 'manual',
      current_period_end = excluded.current_period_end, manual_note = excluded.manual_note, trial_ends_at = null
  `;
  await audit({ action: 'billing.manual_override', orgId, actorUserId: adminUserId, targetType: 'subscription', targetId: orgId, metadata: { plan, note, periodEnd: periodEnd?.toISOString() ?? null } });
}

