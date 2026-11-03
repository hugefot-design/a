import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { loadOrgContext } from '../../src/domain/org/org';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

async function effectivePlan(acc: TestAccount): Promise<string> {
  return (await loadOrgContext(acc.user))!.billing.effectivePlan;
}

function signedWebhook(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${payload}`).digest('hex');
  return fetch(`${server.base}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` },
    body: payload,
  });
}

function subscriptionEvent(type: string, acc: TestAccount, status: string, createdSec: number, price = 'price_test_business') {
  return {
    id: `evt_${randomUUID()}`,
    type,
    created: createdSec,
    data: {
      object: {
        id: `sub_${acc.orgId.slice(0, 8)}`,
        customer: `cus_${acc.orgId.slice(0, 8)}`,
        status,
        cancel_at_period_end: false,
        metadata: { org_id: acc.orgId },
        items: { data: [{ price: { id: price }, current_period_end: createdSec + 30 * 86400 }] },
      },
    },
  };
}

test('betalt plan aktiveres ikke av at nettleseren sier at betalingen er fullført', async () => {
  const acc = await createAccount({ plan: 'free' });
  const c = await clientFor(server.base, acc);
  const page = await c.get('/app/abonnement?checkout=fullfort');
  assert.equal(page.status, 200);
  assert.equal(await effectivePlan(acc), 'free');
  // Falsk webhook uten gyldig signatur
  const fake = await fetch(`${server.base}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=abc' },
    body: JSON.stringify(subscriptionEvent('customer.subscription.created', acc, 'active', Math.floor(Date.now() / 1000))),
  });
  assert.equal(fake.status, 400);
  assert.equal(await effectivePlan(acc), 'free');
});

test('Checkout startes med riktig pris og organisasjon (Stripe-API simulert)', async () => {
  const acc = await createAccount({ plan: 'free' });
  const c = await clientFor(server.base, acc);
  const realFetch = globalThis.fetch;
  let captured: { url: string; body: string; auth: string } | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://api.stripe.com/')) {
      captured = { url, body: String(init?.body ?? ''), auth: String((init?.headers as Record<string, string>)?.Authorization ?? '') };
      return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  try {
    const res = await c.post('/app/abonnement/velg', { plan: 'business' }, { from: '/app/abonnement' });
    assert.equal(res.status, 303);
    assert.equal(res.location, 'https://checkout.stripe.com/c/pay/cs_test_1');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.ok(captured);
  const { url, body, auth } = captured as { url: string; body: string; auth: string };
  assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
  const params = new URLSearchParams(body);
  assert.equal(params.get('line_items[0][price]'), 'price_test_business');
  assert.equal(params.get('metadata[org_id]'), acc.orgId);
  assert.equal(params.get('subscription_data[metadata][org_id]'), acc.orgId);
  assert.equal(auth, `Bearer ${env.STRIPE_SECRET_KEY}`);
  // Fortsatt ikke betalt før Stripe bekrefter
  assert.equal(await effectivePlan(acc), 'free');
  // Ukjent plan avvises
  assert.equal((await c.post('/app/abonnement/velg', { plan: 'enterprise' }, { from: '/app/abonnement' })).status, 400);
});

test('signert webhook aktiverer planen, er idempotent og tåler feil rekkefølge', async () => {
  const acc = await createAccount({ plan: 'free' });
  const t0 = Math.floor(Date.now() / 1000);
  const created = subscriptionEvent('customer.subscription.created', acc, 'active', t0);
  const r1 = await signedWebhook(created);
  assert.equal(r1.status, 200);
  assert.equal(((await r1.json()) as { result: string }).result, 'processed');
  assert.equal(await effectivePlan(acc), 'business');
  assert.equal((await loadOrgContext(acc.user))!.entitlements.bidAssistant, true);

  // Samme hendelse to ganger
  const r2 = await signedWebhook(created);
  assert.equal(((await r2.json()) as { result: string }).result, 'duplicate');

  // Kansellering, og deretter en forsinket, eldre «active»-hendelse
  await signedWebhook(subscriptionEvent('customer.subscription.deleted', acc, 'canceled', t0 + 20));
  assert.equal(await effectivePlan(acc), 'free');
  await signedWebhook(subscriptionEvent('customer.subscription.updated', acc, 'active', t0 + 10));
  assert.equal(await effectivePlan(acc), 'free', 'eldre hendelse skal ikke gjenopplive abonnementet');
});

test('mislykket betaling registreres og varsler eieren', async () => {
  const acc = await createAccount({ plan: 'free' });
  const t0 = Math.floor(Date.now() / 1000);
  await signedWebhook(subscriptionEvent('customer.subscription.created', acc, 'active', t0, 'price_test_starter'));
  assert.equal(await effectivePlan(acc), 'starter');
  const res = await signedWebhook({
    id: `evt_${randomUUID()}`,
    type: 'invoice.payment_failed',
    created: t0 + 5,
    data: { object: { id: `in_${randomUUID().slice(0, 8)}`, customer: `cus_${acc.orgId.slice(0, 8)}`, amount_due: 19900, currency: 'nok' } },
  });
  assert.equal(res.status, 200);
  const payments = (await systemSql()`select status, amount_cents from payments where org_id = ${acc.orgId}`) as unknown as { status: string; amountCents: number }[];
  assert.deepEqual(payments.map((p) => p.status), ['failed']);
  assert.equal(payments[0]!.amountCents, 19900);
  const notes = await systemSql()`select 1 from notifications where org_id = ${acc.orgId} and type = 'payment_failed'`;
  assert.equal(notes.length, 1);
  const mails = await systemSql()`select 1 from email_outbox where to_email = ${acc.email} and kind = 'payment_failed'`;
  assert.equal(mails.length, 1);
});

test('AI-analyse: lagret svar gir ingen ny kostnad, og kvoten håndheves', async () => {
  const acc = await createAccount({ plan: 'starter' });
  const n = makeNotice();
  await ingest([n]);
  const tenderId = await tenderIdFor('manual', n.sourceNoticeId);
  const c = await clientFor(server.base, acc);
  const from = { from: `/app/anbud/${tenderId}` };

  const first = await c.post(`/app/anbud/${tenderId}/analyse`, {}, from);
  assert.equal(first.location, `/app/anbud/${tenderId}/analyse`);
  const usage = async () =>
    ((await systemSql()`select count(*)::int as n from usage_records where org_id = ${acc.orgId} and not cached`) as unknown as { n: number }[])[0]!.n;
  assert.equal(await usage(), 1);
  const page = await c.get(`/app/anbud/${tenderId}/analyse`);
  assert.match(page.body, /Simulert svar fra testmodus/, 'testmodus er tydelig merket');

  // Ny forespørsel på samme innhold: hentes fra hurtigbuffer
  await c.post(`/app/anbud/${tenderId}/analyse`, {}, from);
  assert.equal(await usage(), 1);

  // Fyll opp kvoten (Starter: 10 per måned) og prøv en ny kunngjøring
  const period = new Date().toISOString().slice(0, 7);
  await systemSql()`insert into usage_records (org_id, kind, quantity, period) values (${acc.orgId}, 'ai_tender_analysis', 9, ${period})`;
  const n2 = makeNotice();
  await ingest([n2]);
  const t2 = await tenderIdFor('manual', n2.sourceNoticeId);
  const blocked = await c.post(`/app/anbud/${t2}/analyse`, {}, { from: `/app/anbud/${t2}` });
  assert.equal(blocked.location, `/app/anbud/${t2}`);
  assert.equal((await systemSql()`select 1 from ai_analyses where tender_id = ${t2}`).length, 0);
});

test('funksjoner låses etter plan på serveren', async () => {
  const free = await createAccount({ plan: 'free' });
  const pro = await createAccount({ plan: 'professional' });
  const n = makeNotice();
  await ingest([n]);
  const tenderId = await tenderIdFor('manual', n.sourceNoticeId);

  const cf = await clientFor(server.base, free);
  // Gratisplanen har 1 AI-sammendrag per måned: det første går, det neste stoppes på serveren.
  await cf.post(`/app/anbud/${tenderId}/analyse`, {}, { from: `/app/anbud/${tenderId}` });
  assert.equal((await systemSql()`select 1 from ai_analyses where tender_id = ${tenderId} and created_by = ${free.user.id}`).length, 1);
  const n2 = makeNotice();
  await ingest([n2]);
  const tender2 = await tenderIdFor('manual', n2.sourceNoticeId);
  await cf.post(`/app/anbud/${tender2}/analyse`, {}, { from: `/app/anbud/${tender2}` });
  assert.equal((await systemSql()`select 1 from ai_analyses where tender_id = ${tender2} and created_by = ${free.user.id}`).length, 0);

  const cp = await clientFor(server.base, pro);
  const bids = await cp.get('/app/tilbud');
  assert.equal(bids.status, 403);
  assert.match(bids.body, /Bedrift/);
  const ws = await cp.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` });
  assert.equal(ws.status, 403);
  assert.equal((await cp.get('/app/konkurrenter')).status, 403);
  // Avanserte søkefelt fjernes for Starter (kontrolleres i filters-testene) – her: profesjonell kan bruke dem
  assert.equal((await cp.get('/app/anbud?cpv=79713000')).status, 200);
});

test('personvern: dataeksport uten hemmeligheter, og sletting av konto', async () => {
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  const exp = await c.get('/app/innstillinger/eksport');
  assert.equal(exp.status, 200);
  assert.match(exp.headers.get('content-disposition') ?? '', /attachment/);
  const data = JSON.parse(exp.body) as Record<string, unknown>;
  assert.ok(JSON.stringify(data).includes(acc.email));
  assert.doesNotMatch(exp.body, /password_hash|passwordHash|token_hash|tokenHash|csrf/i);

  const wrong = await c.post('/app/innstillinger/slett-konto', { password: 'feil-passord' });
  assert.equal(wrong.status, 422);
  const ok = await c.post('/app/innstillinger/slett-konto', { password: acc.password });
  assert.equal(ok.status, 303);
  assert.equal((await systemSql()`select 1 from users where id = ${acc.user.id}`).length, 0);
  assert.equal((await systemSql()`select 1 from organizations where id = ${acc.orgId}`).length, 0, 'organisasjon med ett medlem slettes');
  assert.equal((await systemSql()`select 1 from company_profiles where org_id = ${acc.orgId}`).length, 0);
  assert.equal((await c.get('/app')).status, 303, 'sesjonen er borte');
});
