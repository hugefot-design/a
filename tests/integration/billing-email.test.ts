/**
 * Betaling og e-post: rekkefølge og samtidighet i Stripe-hendelser, refusjoner, avstemming når
 * webhooks uteblir, nedgradering, avmelding og at samme e-post aldri sendes to ganger.
 * Stripe-API-et er simulert (ingen ekte betalinger); webhookene er signert med testhemmeligheten.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { loadOrgContext } from '../../src/domain/org/org';
import { handleStripeEvent, reconcileStripeSubscriptions, type StripeEvent } from '../../src/domain/billing/stripe';
import { dispatchNotificationEmails, insertNotifications } from '../../src/domain/notifications/engine';
import { unsubscribeToken } from '../../src/domain/email/unsubscribe';
import { Client, clientFor, createAccount, startServer, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const plan = async (acc: TestAccount) => (await loadOrgContext(acc.user))!.billing.effectivePlan;

function signed(event: object) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${payload}`).digest('hex');
  return fetch(`${server.base}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` },
    body: payload,
  });
}

function subEvent(type: string, acc: TestAccount, subId: string, status: string, created: number, extra: Record<string, unknown> = {}): StripeEvent {
  return {
    id: `evt_${randomUUID()}`,
    type,
    created,
    data: {
      object: {
        id: subId,
        customer: `cus_${acc.orgId.slice(0, 8)}`,
        status,
        cancel_at_period_end: false,
        metadata: { org_id: acc.orgId },
        items: { data: [{ price: { id: 'price_test_professional' }, current_period_end: created + 30 * 86400 }] },
        ...extra,
      },
    },
  };
}

async function outbox(acc: TestAccount, kind: string): Promise<number> {
  const rows = await systemSql()`select 1 from email_outbox where to_email = ${acc.email} and kind = ${kind}`;
  return rows.length;
}

test('et avsluttet abonnement blir aldri aktivt igjen – heller ikke ved hendelser med samme tidsstempel', async () => {
  const acc = await createAccount({ plan: 'free' });
  const t0 = Math.floor(Date.now() / 1000);
  const sub = `sub_${randomUUID().slice(0, 10)}`;
  await signed(subEvent('customer.subscription.created', acc, sub, 'active', t0));
  assert.equal(await plan(acc), 'professional');
  await signed(subEvent('customer.subscription.deleted', acc, sub, 'canceled', t0 + 60));
  assert.equal(await plan(acc), 'free');
  // Samme sekund som slettingen, levert etterpå:
  const res = await signed(subEvent('customer.subscription.updated', acc, sub, 'active', t0 + 60));
  assert.equal(res.status, 200);
  assert.equal(await plan(acc), 'free');
  // Til og med en «nyere» hendelse for det avsluttede abonnementet gjenoppliver det ikke.
  await signed(subEvent('customer.subscription.updated', acc, sub, 'active', t0 + 120));
  assert.equal(await plan(acc), 'free');
});

test('et dødt abonnement kan ikke overskrive et nytt, levende abonnement', async () => {
  const acc = await createAccount({ plan: 'free' });
  const t0 = Math.floor(Date.now() / 1000);
  const oldSub = `sub_old_${randomUUID().slice(0, 6)}`;
  const newSub = `sub_new_${randomUUID().slice(0, 6)}`;
  await signed(subEvent('customer.subscription.created', acc, oldSub, 'active', t0));
  await signed(subEvent('customer.subscription.created', acc, newSub, 'active', t0 + 30));
  assert.equal(await plan(acc), 'professional');
  // Det gamle abonnementet avsluttes senere – det skal ikke fjerne tilgangen fra det nye.
  await signed(subEvent('customer.subscription.deleted', acc, oldSub, 'canceled', t0 + 90));
  assert.equal(await plan(acc), 'professional');
  const [row] = (await systemSql()`select stripe_subscription_id, status from subscriptions where org_id = ${acc.orgId}`) as unknown as {
    stripeSubscriptionId: string;
    status: string;
  }[];
  assert.deepEqual(row, { stripeSubscriptionId: newSub, status: 'active' });
});

test('samme hendelse levert samtidig behandles én gang og gir én e-post', async () => {
  const acc = await createAccount({ plan: 'free' });
  const t0 = Math.floor(Date.now() / 1000);
  await signed(subEvent('customer.subscription.created', acc, `sub_${randomUUID().slice(0, 8)}`, 'active', t0));
  const event: StripeEvent = {
    id: `evt_${randomUUID()}`,
    type: 'invoice.payment_failed',
    created: t0 + 5,
    data: { object: { id: `in_${randomUUID().slice(0, 8)}`, customer: `cus_${acc.orgId.slice(0, 8)}`, amount_due: 49900, currency: 'nok', attempt_count: 1 } },
  };
  const results = await Promise.all([handleStripeEvent(event), handleStripeEvent(event), handleStripeEvent(event)]);
  assert.equal(results.filter((r) => r === 'processed').length, 1, JSON.stringify(results));
  assert.ok(results.every((r) => ['processed', 'in_progress', 'duplicate'].includes(r)));
  assert.equal(await handleStripeEvent(event), 'duplicate');
  assert.equal(await outbox(acc, 'payment_failed'), 1);
  // Nytt mislykket forsøk på samme faktura (ny hendelse) gir én ny e-post.
  await handleStripeEvent({ ...event, id: `evt_${randomUUID()}`, data: { object: { ...event.data.object, attempt_count: 2 } } });
  assert.equal(await outbox(acc, 'payment_failed'), 2);
});

test('e-post ved aktivering og oppsigelse sendes én gang', async () => {
  const acc = await createAccount({ plan: 'free' });
  const t0 = Math.floor(Date.now() / 1000);
  const sub = `sub_${randomUUID().slice(0, 10)}`;
  await signed(subEvent('customer.subscription.created', acc, sub, 'active', t0));
  await signed(subEvent('customer.subscription.updated', acc, sub, 'active', t0 + 10));
  assert.equal(await outbox(acc, 'subscription_activated'), 1);
  await signed(subEvent('customer.subscription.updated', acc, sub, 'active', t0 + 20, { cancel_at_period_end: true }));
  await signed(subEvent('customer.subscription.updated', acc, sub, 'active', t0 + 30, { cancel_at_period_end: true }));
  assert.equal(await outbox(acc, 'subscription_cancel_scheduled'), 1);
  assert.equal(await plan(acc), 'professional', 'tilgang ut perioden etter oppsigelse');
  // Gjenopptak før periodeslutt
  await signed(subEvent('customer.subscription.updated', acc, sub, 'active', t0 + 40, { cancel_at_period_end: false }));
  const [row] = (await systemSql()`select cancel_at_period_end from subscriptions where org_id = ${acc.orgId}`) as unknown as { cancelAtPeriodEnd: boolean }[];
  assert.equal(row!.cancelAtPeriodEnd, false);
  await signed(subEvent('customer.subscription.deleted', acc, sub, 'canceled', t0 + 50));
  assert.equal(await outbox(acc, 'subscription_ended'), 1);
  assert.equal(await plan(acc), 'free');
});

test('refusjon og tvist registreres på betalingen', async () => {
  const acc = await createAccount({ plan: 'free' });
  const t0 = Math.floor(Date.now() / 1000);
  await signed(subEvent('customer.subscription.created', acc, `sub_${randomUUID().slice(0, 8)}`, 'active', t0));
  const invoice = `in_${randomUUID().slice(0, 8)}`;
  const charge = `ch_${randomUUID().slice(0, 8)}`;
  await signed({
    id: `evt_${randomUUID()}`,
    type: 'invoice.paid',
    created: t0 + 1,
    data: { object: { id: invoice, customer: `cus_${acc.orgId.slice(0, 8)}`, amount_paid: 49900, currency: 'nok', charge } },
  });
  await signed({ id: `evt_${randomUUID()}`, type: 'charge.refunded', created: t0 + 2, data: { object: { id: charge, invoice, amount: 49900, amount_refunded: 20000 } } });
  let [p] = (await systemSql()`select status, amount_refunded_cents from payments where stripe_invoice_id = ${invoice}`) as unknown as { status: string; amountRefundedCents: number }[];
  assert.deepEqual(p, { status: 'partially_refunded', amountRefundedCents: 20000 });
  await signed({ id: `evt_${randomUUID()}`, type: 'charge.refunded', created: t0 + 3, data: { object: { id: charge, invoice, amount: 49900, amount_refunded: 49900 } } });
  [p] = (await systemSql()`select status, amount_refunded_cents from payments where stripe_invoice_id = ${invoice}`) as unknown as { status: string; amountRefundedCents: number }[];
  assert.deepEqual(p, { status: 'refunded', amountRefundedCents: 49900 });
  // En forsinket «invoice.paid» overskriver ikke refusjonen.
  await signed({ id: `evt_${randomUUID()}`, type: 'invoice.paid', created: t0 + 4, data: { object: { id: invoice, customer: `cus_${acc.orgId.slice(0, 8)}`, amount_paid: 49900, currency: 'nok', charge } } });
  [p] = (await systemSql()`select status, amount_refunded_cents from payments where stripe_invoice_id = ${invoice}`) as unknown as { status: string; amountRefundedCents: number }[];
  assert.equal(p!.status, 'refunded');
});

test('avstemming mot Stripe retter status når webhooks har uteblitt (Stripe-API simulert)', async () => {
  const acc = await createAccount({ plan: 'free' });
  const sub = `sub_${randomUUID().slice(0, 10)}`;
  const t0 = Math.floor(Date.now() / 1000) - 40 * 86400;
  await signed({ ...subEvent('customer.subscription.created', acc, sub, 'active', Math.floor(Date.now() / 1000)) });
  // Perioden er over, men slettehendelsen kom aldri.
  await systemSql()`update subscriptions set current_period_end = to_timestamp(${t0}) where org_id = ${acc.orgId}`;
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.stripe.com/')) {
      seen.push(`${init?.method ?? 'GET'} ${url}`);
      const id = url.split('/subscriptions/')[1];
      return new Response(
        JSON.stringify({
          id: decodeURIComponent(id ?? ''),
          customer: `cus_${acc.orgId.slice(0, 8)}`,
          status: id === sub ? 'canceled' : 'active',
          metadata: { org_id: acc.orgId },
          items: { data: [{ price: { id: 'price_test_professional' }, current_period_end: t0 }] },
        }),
        { status: 200 },
      );
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const result = await reconcileStripeSubscriptions();
    assert.ok(result.updated >= 1);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(seen.every((s) => s.startsWith('GET ')), 'avstemming leser bare fra Stripe');
  assert.equal(await plan(acc), 'free');
});

test('nedgradering avvises når organisasjonen har flere brukere enn planen tillater', async () => {
  const acc = await createAccount({ plan: 'business' });
  for (let i = 0; i < 2; i++) {
    const extra = await createAccount({ plan: 'free', profile: false });
    await systemSql()`insert into organization_members (org_id, user_id, role) values (${acc.orgId}, ${extra.user.id}, 'member')`;
  }
  const c = await clientFor(server.base, acc);
  const res = await c.post('/app/abonnement/velg', { plan: 'starter' }, { from: '/app/abonnement' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/app/abonnement');
  assert.match((await c.get('/app/abonnement')).body, /Start har plass til 1 bruker, men organisasjonen har 3/);
});

test('avmelding fra varsel-e-post med signert lenke (også ettklikks uten innlogging)', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const token = unsubscribeToken(acc.user.id, acc.orgId);
  const anon = new Client(server.base);
  const page = await anon.get(`/avmeld?t=${encodeURIComponent(token)}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Meld meg av/);
  // E-postklienter sender POST uten CSRF-token (RFC 8058).
  const res = await fetch(`${server.base}/avmeld?t=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
  assert.equal(res.status, 200);
  const [prefs] = (await systemSql()`select email_frequency, weekly_summary from notification_preferences where user_id = ${acc.user.id} and org_id = ${acc.orgId}`) as unknown as {
    emailFrequency: string;
    weeklySummary: boolean;
  }[];
  assert.deepEqual(prefs, { emailFrequency: 'off', weeklySummary: false });
  assert.equal((await anon.get('/avmeld?t=forfalsket.token')).status, 400);
});

test('varsel-e-post sendes aldri dobbelt ved samtidig kjøring, og har avmeldingsheader', async () => {
  const acc = await createAccount({ plan: 'professional' });
  await systemSql()`update notification_preferences set email_frequency = 'instant' where user_id = ${acc.user.id}`;
  await insertNotifications([
    { orgId: acc.orgId, userId: acc.user.id, type: 'system', tenderId: null, title: 'Testvarsel 1', body: null, url: '/app', dedupeKey: `t1:${randomUUID()}` },
    { orgId: acc.orgId, userId: acc.user.id, type: 'system', tenderId: null, title: 'Testvarsel 2', body: null, url: '/app', dedupeKey: `t2:${randomUUID()}` },
  ]);
  await Promise.all([dispatchNotificationEmails(), dispatchNotificationEmails(), dispatchNotificationEmails()]);
  const mails = (await systemSql()`select headers from email_outbox where to_email = ${acc.email} and kind = 'notification_digest'`) as unknown as {
    headers: Record<string, string>;
  }[];
  assert.equal(mails.length, 1);
  assert.match(mails[0]!.headers['List-Unsubscribe'] ?? '', /\/avmeld\?t=/);
});
