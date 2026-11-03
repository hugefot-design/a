import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { entitlementsFor, resolveBilling, type SubscriptionRow } from '../../src/domain/billing/plans';
import { encodeStripeParams, planFromPriceId, verifyStripeSignature } from '../../src/domain/billing/stripe';

const NOW = new Date('2026-11-01T12:00:00Z');
const base: SubscriptionRow = {
  plan: 'professional',
  status: 'active',
  source: 'stripe',
  currentPeriodEnd: new Date('2026-12-01T12:00:00Z'),
  trialEndsAt: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
};

test('plan avgjøres på serveren ut fra abonnementet', () => {
  assert.equal(resolveBilling(null, NOW).effectivePlan, 'free');
  assert.equal(resolveBilling(base, NOW).effectivePlan, 'professional');
  assert.equal(resolveBilling({ ...base, status: 'past_due' }, NOW).status, 'past_due');
  for (const status of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused']) {
    assert.equal(resolveBilling({ ...base, status }, NOW).effectivePlan, 'free', status);
  }
});

test('prøveperiode og manuell avtale utløper', () => {
  const trial: SubscriptionRow = { ...base, source: 'trial', status: 'trialing', trialEndsAt: new Date('2026-11-10T00:00:00Z') };
  assert.equal(resolveBilling(trial, NOW).status, 'trial');
  assert.equal(resolveBilling({ ...trial, trialEndsAt: new Date('2026-10-31T00:00:00Z') }, NOW).effectivePlan, 'free');
  const manual: SubscriptionRow = { ...base, source: 'manual', plan: 'business', currentPeriodEnd: new Date('2026-10-01T00:00:00Z') };
  assert.equal(resolveBilling(manual, NOW).effectivePlan, 'free');
  assert.equal(resolveBilling({ ...manual, currentPeriodEnd: null }, NOW).effectivePlan, 'business');
});

test('rettigheter per plan', () => {
  assert.equal(entitlementsFor('free').aiAnalysesPerMonth, 1); // gratisplanen: 1 AI-sammendrag per måned
  assert.equal(entitlementsFor('starter').advancedSearch, false);
  assert.equal(entitlementsFor('professional').matching, true);
  assert.equal(entitlementsFor('professional').bidAssistant, false);
  assert.equal(entitlementsFor('business').bidAssistant, true);
  assert.equal(entitlementsFor('business').competitorIntel, true);
});

test('Stripe-parametre kodes som nøstede skjemafelt', () => {
  const encoded = new URLSearchParams(
    encodeStripeParams({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 1 }], metadata: { org_id: 'abc' }, allow_promotion_codes: true }),
  ).toString();
  assert.equal(
    decodeURIComponent(encoded),
    'mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&metadata[org_id]=abc&allow_promotion_codes=true',
  );
});

test('pris-ID gir plan (fra testmiljøet)', () => {
  assert.equal(planFromPriceId('price_test_business'), 'business');
  assert.equal(planFromPriceId('price_ukjent'), null);
  assert.equal(planFromPriceId(null), null);
});

test('webhook-signatur verifiseres, og forfalskninger avvises', () => {
  const secret = 'whsec_test';
  const payload = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} }, created: 1 }));
  const t = 1_800_000_000;
  const sig = createHmac('sha256', secret).update(`${t}.${payload.toString()}`).digest('hex');
  assert.equal(verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, 300, t).id, 'evt_1');
  assert.throws(() => verifyStripeSignature(payload, `t=${t},v1=${'0'.repeat(64)}`, secret, 300, t), /Ugyldig signatur/);
  assert.throws(() => verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, 300, t + 301), /for gammel/);
  assert.throws(() => verifyStripeSignature(payload, undefined, secret, 300, t), /Mangler/);
  const tampered = Buffer.from(payload.toString().replace('evt_1', 'evt_2'));
  assert.throws(() => verifyStripeSignature(tampered, `t=${t},v1=${sig}`, secret, 300, t), /Ugyldig signatur/);
});

test('planene har riktige navn og priser (Start 199, Profesjonell 499, Bedrift 999 kr/mnd)', async () => {
  const { PLANS } = await import('../../src/domain/billing/plans');
  assert.deepEqual(
    (['starter', 'professional', 'business'] as const).map((p) => [PLANS[p].name, PLANS[p].priceNok]),
    [
      ['Start', 199],
      ['Profesjonell', 499],
      ['Bedrift', 999],
    ],
  );
});

test('sikkerhetsnett: utløpt periode uten bekreftet fornyelse gir ikke evig tilgang', async () => {
  const { STRIPE_RENEWAL_GRACE_DAYS } = await import('../../src/domain/billing/plans');
  const overdue = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
  // Litt forsinket webhook: fortsatt tilgang.
  assert.equal(resolveBilling({ ...base, currentPeriodEnd: overdue(2) }, NOW).effectivePlan, 'professional');
  // Uker uten bekreftelse: tilgangen stopper.
  const stale = resolveBilling({ ...base, currentPeriodEnd: overdue(STRIPE_RENEWAL_GRACE_DAYS + 1) }, NOW);
  assert.equal(stale.effectivePlan, 'free');
  assert.equal(stale.status, 'expired');
  // Oppsagt ved periodeslutt og perioden er over (slettehendelsen kom aldri): ingen tilgang.
  assert.equal(resolveBilling({ ...base, cancelAtPeriodEnd: true, currentPeriodEnd: overdue(2) }, NOW).effectivePlan, 'free');
  assert.equal(resolveBilling({ ...base, cancelAtPeriodEnd: true }, NOW).effectivePlan, 'professional', 'tilgang ut betalt periode');
});

test('prisene i Stripe kontrolleres mot planene (beløp, valuta, intervall)', async () => {
  const { verifyStripePrices } = await import('../../src/domain/billing/stripe');
  const { env } = await import('../../src/lib/env');
  const realFetch = globalThis.fetch;
  const prices: Record<string, Record<string, unknown>> = {
    [env.STRIPE_PRICE_STARTER!]: { active: true, currency: 'nok', unit_amount: 19900, type: 'recurring', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } },
    [env.STRIPE_PRICE_PROFESSIONAL!]: { active: true, currency: 'nok', unit_amount: 49000, type: 'recurring', recurring: { interval: 'month', interval_count: 1 } },
    [env.STRIPE_PRICE_BUSINESS!]: { active: true, currency: 'eur', unit_amount: 99900, type: 'recurring', recurring: { interval: 'year', interval_count: 1 } },
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const id = decodeURIComponent(String(input).split('/prices/')[1] ?? '');
    return new Response(JSON.stringify(prices[id] ?? { error: { message: 'No such price' } }), { status: prices[id] ? 200 : 404 });
  }) as typeof fetch;
  try {
    const checks = await verifyStripePrices();
    assert.deepEqual(checks.map((c) => [c.plan, c.ok]), [
      ['starter', true],
      ['professional', false],
      ['business', false],
    ]);
    assert.match(checks[1]!.problems.join(' '), /490 kr, forventet 499 kr/);
    assert.match(checks[2]!.problems.join(' '), /EUR|eur/);
    assert.match(checks[2]!.problems.join(' '), /månedlig/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('avmeldingslenken er signert og kan ikke forfalskes', async () => {
  const { unsubscribeToken, verifyUnsubscribeToken, listUnsubscribeHeaders } = await import('../../src/domain/email/unsubscribe');
  const userId = '11111111-1111-4111-8111-111111111111';
  const orgId = '22222222-2222-4222-8222-222222222222';
  const token = unsubscribeToken(userId, orgId);
  assert.deepEqual(verifyUnsubscribeToken(token), { userId, orgId });
  const otherOrg = Buffer.from(`${userId}:33333333-3333-4333-8333-333333333333`).toString('base64url');
  assert.equal(verifyUnsubscribeToken(`${otherOrg}.${token.split('.')[1]}`), null, 'signaturen gjelder bare én bruker og organisasjon');
  assert.equal(verifyUnsubscribeToken('tull'), null);
  assert.equal(verifyUnsubscribeToken(null), null);
  const headers = listUnsubscribeHeaders(userId, orgId);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(headers['List-Unsubscribe']!, /^<https?:\/\/.+\/avmeld\?t=/);
});
