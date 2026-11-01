/**
 * Stripe-integrasjon via REST (ingen SDK). Betalt tilgang aktiveres KUN av webhooks med gyldig
 * signatur eller av avstemming direkte mot Stripe – aldri av at nettleseren kommer tilbake fra Checkout.
 *
 * Regler for abonnementsstatus (se upsertFromSubscription):
 *  - Hendelser behandles én gang (stripe_events) og av én prosess om gangen.
 *  - Et avsluttet abonnement (canceled/incomplete_expired) er endelig – en forsinket eldre hendelse
 *    kan aldri gjøre det aktivt igjen.
 *  - Et dødt abonnement kan aldri overskrive et annet, levende abonnement for samme organisasjon.
 *  - Ellers vinner nyeste hendelse (event.created).
 */
import { createHmac } from 'node:crypto';
import { env, integrationStatus } from '@/lib/env';
import { first, systemSql } from '@/lib/db';
import { safeEqual } from '@/lib/crypto';
import { audit } from '@/lib/audit';
import { log } from '@/lib/logger';
import { queueEmail } from '@/lib/email';
import {
  absoluteUrl,
  adminAlertTemplate,
  paymentFailedTemplate,
  subscriptionActivatedTemplate,
  subscriptionEndedTemplate,
  subscriptionEndingTemplate,
} from '@/domain/email/templates';
import { insertNotifications } from '@/domain/notifications/engine';
import { PLANS, type PaidPlanId, type PlanId } from './plans';

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
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: method === 'GET' ? undefined : body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new StripeError(`Fikk ikke kontakt med Stripe: ${err instanceof Error ? err.message : String(err)}`);
  }
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
  const session = await stripe<{ url: string }>(
    'POST',
    '/checkout/sessions',
    {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: input.orgId,
      ...(input.existingCustomerId
        ? // Med eksisterende kunde krever Stripe at navn/adresse kan oppdateres når org.nr. samles inn.
          { customer: input.existingCustomerId, customer_update: { name: 'auto', address: 'auto' } }
        : { customer_email: input.userEmail }),
      metadata: { org_id: input.orgId, plan: input.plan },
      subscription_data: {
        metadata: { org_id: input.orgId, plan: input.plan },
        ...(env.STRIPE_TAX_RATE_ID ? { default_tax_rates: [env.STRIPE_TAX_RATE_ID] } : {}),
      },
      ...(env.STRIPE_AUTOMATIC_TAX ? { automatic_tax: { enabled: 'true' } } : {}),
      allow_promotion_codes: 'true',
      billing_address_collection: 'required',
      tax_id_collection: { enabled: 'true' },
      locale: 'nb',
      success_url: absoluteUrl('/app/abonnement?checkout=fullfort'),
      cancel_url: absoluteUrl('/app/abonnement?checkout=avbrutt'),
    },
    // Samme organisasjon og plan samme minutt gir samme Checkout-økt (dobbeltklikk).
    `checkout:${input.orgId}:${input.plan}:${Math.floor(Date.now() / 60_000)}`,
  );
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
// Kontroll av oppsettet i Stripe (kun lesing)
// ---------------------------------------------------------------------------
export interface PriceCheck {
  plan: PaidPlanId;
  priceId: string | null;
  ok: boolean;
  problems: string[];
}

/**
 * Kontrollerer at prisene i Stripe faktisk er 199/499/999 NOK per måned, gjentakende og aktive.
 * Feil pris-ID i miljøvariablene ville ellers gi kunder feil plan eller feil beløp.
 */
export async function verifyStripePrices(): Promise<PriceCheck[]> {
  const out: PriceCheck[] = [];
  for (const plan of ['starter', 'professional', 'business'] as const) {
    const priceId = priceIdFor(plan) ?? null;
    const problems: string[] = [];
    if (!priceId) {
      out.push({ plan, priceId, ok: false, problems: ['Pris-ID mangler i miljøvariablene.'] });
      continue;
    }
    try {
      const p = await stripe<{
        active?: boolean;
        currency?: string;
        unit_amount?: number | null;
        type?: string;
        recurring?: { interval?: string; interval_count?: number; usage_type?: string } | null;
        livemode?: boolean;
      }>('GET', `/prices/${encodeURIComponent(priceId)}`);
      const expected = (PLANS[plan].priceNok ?? 0) * 100;
      if (!p.active) problems.push('Prisen er ikke aktiv.');
      if ((p.currency ?? '').toLowerCase() !== 'nok') problems.push(`Valuta er ${p.currency ?? 'ukjent'}, forventet NOK.`);
      if (p.unit_amount !== expected) problems.push(`Beløpet er ${(p.unit_amount ?? 0) / 100} kr, forventet ${expected / 100} kr.`);
      if (p.type !== 'recurring' || p.recurring?.interval !== 'month' || (p.recurring?.interval_count ?? 1) !== 1) {
        problems.push('Prisen er ikke månedlig gjentakende.');
      }
      if (p.recurring?.usage_type && p.recurring.usage_type !== 'licensed') problems.push('Prisen er bruksbasert – forventet fast pris.');
      if (p.livemode === true && env.STRIPE_SECRET_KEY?.startsWith('sk_test_')) problems.push('Live-pris brukt med testnøkkel.');
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
    out.push({ plan, priceId, ok: problems.length === 0, problems });
  }
  return out;
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
  const event = JSON.parse(payload.toString('utf8')) as StripeEvent;
  if (typeof event?.id !== 'string' || typeof event?.type !== 'string' || !event.data?.object) throw new StripeError('Ugyldig hendelse');
  return event;
}

function toDate(sec: unknown): Date | null {
  return typeof sec === 'number' && sec > 0 ? new Date(sec * 1000) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
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
const LIVE = new Set(['active', 'trialing', 'past_due']);

interface Manager {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  orgName: string;
}

async function managers(orgId: string): Promise<Manager[]> {
  return (await systemSql()`
    select u.id, u.email, u.email_verified_at, o.name as org_name from organization_members m
    join users u on u.id = m.user_id join organizations o on o.id = m.org_id
    where m.org_id = ${orgId} and m.role in ('owner', 'admin')
  `) as unknown as Manager[];
}

async function alertPlatformAdmin(title: string, details: string, dedupeKey: string): Promise<void> {
  log.error('billing_alert', { title, details });
  if (!env.ADMIN_NOTIFICATION_EMAIL) return;
  await queueEmail({ to: env.ADMIN_NOTIFICATION_EMAIL, ...adminAlertTemplate(title, details), kind: 'admin_alert', dedupeKey });
}

interface PreviousSub {
  plan: PlanId;
  status: string;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  source: string;
}

/**
 * Oppdaterer abonnementet fra et Stripe-subscription-objekt. `eventAt` er tidspunktet for hendelsen.
 * Returnerer om raden faktisk ble endret.
 */
export async function upsertFromSubscription(sub: Record<string, unknown>, eventAt: Date): Promise<boolean> {
  const customer = str(sub.customer);
  const subscriptionId = String(sub.id);
  const metadata = (sub.metadata ?? {}) as Record<string, unknown>;
  const orgId = await orgIdForCustomer(customer, metadata.org_id);
  if (!orgId) {
    log.warn('stripe_subscription_unmatched', { subscription: sub.id, customer });
    return false;
  }
  const item = ((sub.items as { data?: Record<string, unknown>[] } | undefined)?.data ?? [])[0] ?? {};
  const priceId = ((item.price ?? {}) as { id?: string }).id ?? null;
  const plan = planFromPriceId(priceId);
  if (!plan) {
    await alertPlatformAdmin('Ukjent Stripe-pris', `Abonnement ${subscriptionId} for organisasjon ${orgId} har pris ${priceId}, som ikke er en kjent plan.`, `unknown_price:${subscriptionId}:${priceId}`);
    return false;
  }
  const status = KNOWN_STATUSES.has(String(sub.status)) ? String(sub.status) : 'incomplete';
  const periodEnd = toDate(sub.current_period_end) ?? toDate(item.current_period_end);
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end) || toDate(sub.cancel_at) !== null;
  const previous = first(
    (await systemSql()`
      select plan, status, stripe_subscription_id, cancel_at_period_end, source from subscriptions where org_id = ${orgId}
    `) as unknown as PreviousSub[],
  );

  const rows = await systemSql()`
    insert into subscriptions (org_id, plan, status, source, stripe_customer_id, stripe_subscription_id, stripe_price_id,
                               current_period_end, cancel_at_period_end, stripe_event_at)
    values (${orgId}, ${plan}, ${status}, 'stripe', ${customer}, ${subscriptionId}, ${priceId}, ${periodEnd}, ${cancelAtPeriodEnd}, ${eventAt})
    on conflict (org_id) do update set
      plan = excluded.plan, status = excluded.status, source = 'stripe', stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id, stripe_price_id = excluded.stripe_price_id,
      current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
      trial_ends_at = null, stripe_event_at = excluded.stripe_event_at
    where
      subscriptions.source <> 'stripe'
      or subscriptions.stripe_subscription_id is null
      or (
        -- Samme abonnement: avsluttet er endelig; ellers vinner nyeste hendelse.
        subscriptions.stripe_subscription_id = excluded.stripe_subscription_id
        and subscriptions.status not in ('canceled', 'incomplete_expired')
        and (subscriptions.stripe_event_at is null or subscriptions.stripe_event_at <= excluded.stripe_event_at)
      )
      or (
        -- Et annet abonnement: et dødt abonnement kan aldri overskrive et levende.
        subscriptions.stripe_subscription_id <> excluded.stripe_subscription_id
        and not (excluded.status not in ('active', 'trialing', 'past_due') and subscriptions.status in ('active', 'trialing', 'past_due'))
        and (subscriptions.stripe_event_at is null or subscriptions.stripe_event_at <= excluded.stripe_event_at)
      )
    returning org_id
  `;
  if (!rows.length) {
    log.info('stripe_subscription_event_ignored', { subscription: subscriptionId, status, orgId, previousStatus: previous?.status });
    return false;
  }
  await audit({ action: 'billing.subscription_changed', orgId, targetType: 'subscription', targetId: subscriptionId, metadata: { plan, status, cancelAtPeriodEnd } });

  // Varsle om dobbeltabonnement (f.eks. to Checkout-økter fullført samtidig).
  if (previous?.source === 'stripe' && previous.stripeSubscriptionId && previous.stripeSubscriptionId !== subscriptionId && LIVE.has(previous.status) && LIVE.has(status)) {
    await alertPlatformAdmin(
      'Organisasjon har to aktive Stripe-abonnementer',
      `Organisasjon ${orgId} fikk nytt abonnement ${subscriptionId} mens ${previous.stripeSubscriptionId} fortsatt er aktivt. Avslutt og refunder det gamle i Stripe.`,
      `double_sub:${orgId}:${subscriptionId}`,
    );
  }

  // E-post til eiere/administratorer ved overganger. Nøklene hindrer duplikater.
  const sameSub = previous?.stripeSubscriptionId === subscriptionId;
  const becameLive = LIVE.has(status) && status !== 'past_due' && (!sameSub || !LIVE.has(previous?.status ?? ''));
  const cancelScheduled = LIVE.has(status) && cancelAtPeriodEnd && !(sameSub && previous?.cancelAtPeriodEnd);
  const ended = (status === 'canceled' || status === 'unpaid' || status === 'incomplete_expired') && !(sameSub && previous?.status === status);
  if (becameLive || cancelScheduled || ended) {
    for (const m of (await managers(orgId)).filter((x) => x.emailVerifiedAt)) {
      const billingUrl = absoluteUrl('/app/abonnement');
      if (becameLive) {
        await queueEmail({
          to: m.email,
          ...subscriptionActivatedTemplate(m.orgName, PLANS[plan].name, PLANS[plan].priceNok, billingUrl),
          kind: 'subscription_activated',
          userId: m.id,
          orgId,
          dedupeKey: `sub_active:${subscriptionId}:${plan}:${m.id}`,
        });
      }
      if (cancelScheduled) {
        await queueEmail({
          to: m.email,
          ...subscriptionEndingTemplate(m.orgName, PLANS[plan].name, periodEnd, billingUrl),
          kind: 'subscription_cancel_scheduled',
          userId: m.id,
          orgId,
          dedupeKey: `sub_cancel:${subscriptionId}:${periodEnd?.toISOString() ?? 'x'}:${m.id}`,
        });
      }
      if (ended) {
        await queueEmail({
          to: m.email,
          ...subscriptionEndedTemplate(m.orgName, absoluteUrl('/priser')),
          kind: 'subscription_ended',
          userId: m.id,
          orgId,
          dedupeKey: `sub_ended:${subscriptionId}:${m.id}`,
        });
      }
    }
  }
  return true;
}

function invoiceOrgMetadata(invoice: Record<string, unknown>): unknown {
  const direct = (invoice.subscription_details as { metadata?: Record<string, unknown> } | undefined)?.metadata?.org_id;
  if (direct) return direct;
  // Nyere API-versjoner legger abonnementsdetaljene under «parent».
  const parent = invoice.parent as { subscription_details?: { metadata?: Record<string, unknown> } } | undefined;
  return parent?.subscription_details?.metadata?.org_id;
}

async function recordInvoice(invoice: Record<string, unknown>, status: 'paid' | 'failed'): Promise<string | null> {
  const customer = str(invoice.customer);
  const orgId = await orgIdForCustomer(customer, invoiceOrgMetadata(invoice));
  if (!orgId) return null;
  await systemSql()`
    insert into payments (org_id, stripe_invoice_id, stripe_charge_id, amount_cents, currency, status, hosted_invoice_url, period_start, period_end)
    values (${orgId}, ${String(invoice.id)}, ${str(invoice.charge)}, ${Number(status === 'paid' ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0))},
            ${String(invoice.currency ?? 'nok').toUpperCase()}, ${status}, ${str(invoice.hosted_invoice_url)},
            ${toDate(invoice.period_start)}, ${toDate(invoice.period_end)})
    on conflict (stripe_invoice_id) do update set
      status = case when payments.status in ('refunded', 'partially_refunded', 'disputed') then payments.status else excluded.status end,
      amount_cents = excluded.amount_cents,
      stripe_charge_id = coalesce(excluded.stripe_charge_id, payments.stripe_charge_id),
      hosted_invoice_url = coalesce(excluded.hosted_invoice_url, payments.hosted_invoice_url)
  `;
  return orgId;
}

async function notifyPaymentFailed(orgId: string, invoice: Record<string, unknown>): Promise<void> {
  const admins = await managers(orgId);
  const attempt = Number(invoice.attempt_count ?? 1);
  const invoiceId = String(invoice.id);
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
    // Én e-post per mislykket forsøk – samme hendelse levert flere ganger gir ikke flere e-poster.
    await queueEmail({ to: a.email, ...tpl, kind: 'payment_failed', userId: a.id, orgId, dedupeKey: `payment_failed:${invoiceId}:${attempt}:${a.id}` });
  }
  await audit({ action: 'billing.payment_failed', orgId, targetType: 'organization', targetId: orgId, metadata: { invoice: invoiceId, attempt } });
}

/** Refusjon registreres på betalingen. Tilgangen endres ikke av refusjonen alene – det gjør oppsigelsen i Stripe. */
async function recordRefund(charge: Record<string, unknown>): Promise<void> {
  const chargeId = String(charge.id);
  const invoiceId = str(charge.invoice);
  const refunded = Number(charge.amount_refunded ?? 0);
  const amount = Number(charge.amount ?? 0);
  const status = refunded >= amount && amount > 0 ? 'refunded' : 'partially_refunded';
  const rows = (await systemSql()`
    update payments set amount_refunded_cents = ${refunded}, status = ${status}, stripe_charge_id = coalesce(stripe_charge_id, ${chargeId})
    where stripe_charge_id = ${chargeId} or (${invoiceId}::text is not null and stripe_invoice_id = ${invoiceId})
    returning org_id
  `) as unknown as { orgId: string }[];
  if (!rows.length) {
    await alertPlatformAdmin('Refusjon uten kjent betaling', `Charge ${chargeId} (faktura ${invoiceId ?? 'ukjent'}) ble refundert med ${refunded / 100} kr, men betalingen finnes ikke i AnbudRadar.`, `refund_unmatched:${chargeId}:${refunded}`);
    return;
  }
  await audit({ action: 'billing.refund_recorded', orgId: rows[0]!.orgId, targetType: 'charge', targetId: chargeId, metadata: { refundedCents: refunded, status } });
}

async function recordDispute(dispute: Record<string, unknown>): Promise<void> {
  const chargeId = str(dispute.charge);
  const rows = chargeId
    ? ((await systemSql()`update payments set status = 'disputed' where stripe_charge_id = ${chargeId} returning org_id`) as unknown as { orgId: string }[])
    : [];
  await alertPlatformAdmin(
    'Betalingstvist (chargeback) i Stripe',
    `Tvist ${String(dispute.id)} på ${Number(dispute.amount ?? 0) / 100} kr (charge ${chargeId ?? 'ukjent'}, organisasjon ${rows[0]?.orgId ?? 'ukjent'}). Svar i Stripe innen fristen.`,
    `dispute:${String(dispute.id)}`,
  );
  if (rows[0]) await audit({ action: 'billing.dispute_opened', orgId: rows[0].orgId, targetType: 'dispute', targetId: String(dispute.id) });
}

export type StripeEventResult = 'processed' | 'duplicate' | 'ignored' | 'in_progress';

/** Behandler en verifisert hendelse. Idempotent, og bare én prosess behandler samme hendelse. */
export async function handleStripeEvent(event: StripeEvent): Promise<StripeEventResult> {
  const sql = systemSql();
  await sql`insert into stripe_events (id, type) values (${event.id}, ${event.type}) on conflict (id) do nothing`;
  const claimed = await sql`
    update stripe_events set processing_started_at = now(), attempts = attempts + 1
    where id = ${event.id} and processed_at is null
      and (processing_started_at is null or processing_started_at < now() - interval '5 minutes')
    returning id
  `;
  if (!claimed.length) {
    const prev = first((await sql`select processed_at from stripe_events where id = ${event.id}`) as unknown as { processedAt: Date | null }[]);
    return prev?.processedAt ? 'duplicate' : 'in_progress';
  }
  const obj = event.data.object;
  const eventAt = new Date(event.created * 1000);
  try {
    let handled = true;
    switch (event.type) {
      case 'checkout.session.completed': {
        const subId = str(obj.subscription);
        const customer = str(obj.customer);
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
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await upsertFromSubscription(obj, eventAt);
        break;
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await recordInvoice(obj, 'paid');
        break;
      case 'invoice.payment_failed': {
        const orgId = await recordInvoice(obj, 'failed');
        if (orgId) await notifyPaymentFailed(orgId, obj);
        break;
      }
      case 'charge.refunded':
        await recordRefund(obj);
        break;
      case 'charge.dispute.created':
        await recordDispute(obj);
        break;
      default:
        handled = false;
    }
    await sql`update stripe_events set processed_at = now(), error = null where id = ${event.id}`;
    return handled ? 'processed' : 'ignored';
  } catch (err) {
    // Frigjør hendelsen slik at Stripes neste forsøk kan behandle den.
    await sql`update stripe_events set error = ${err instanceof Error ? err.message : String(err)}, processing_started_at = null where id = ${event.id}`;
    throw err;
  }
}

/**
 * Avstemming mot Stripe (daglig): hvis webhooks har uteblitt, hentes abonnementer som burde vært
 * fornyet eller avsluttet direkte fra Stripe. Bare lesing hos Stripe.
 */
export async function reconcileStripeSubscriptions(limit = 200): Promise<{ checked: number; updated: number; errors: number }> {
  if (!env.STRIPE_SECRET_KEY) return { checked: 0, updated: 0, errors: 0 };
  const rows = (await systemSql()`
    select org_id, stripe_subscription_id from subscriptions
    where source = 'stripe' and stripe_subscription_id is not null
      and status in ('active', 'trialing', 'past_due', 'incomplete')
      and (current_period_end is null or current_period_end < now() + interval '1 hour')
    order by current_period_end nulls first limit ${limit}
  `) as unknown as { orgId: string; stripeSubscriptionId: string }[];
  let updated = 0;
  let errors = 0;
  for (const r of rows) {
    try {
      const sub = await stripe<Record<string, unknown>>('GET', `/subscriptions/${encodeURIComponent(r.stripeSubscriptionId)}`);
      if (await upsertFromSubscription(sub, new Date())) updated++;
    } catch (err) {
      errors++;
      log.warn('stripe_reconcile_failed', { orgId: r.orgId, err: err instanceof Error ? err.message : String(err) });
    }
  }
  if (updated) await audit({ action: 'billing.reconciled', metadata: { checked: rows.length, updated } });
  return { checked: rows.length, updated, errors };
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
