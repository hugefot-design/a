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
  assert.equal(entitlementsFor('free').aiAnalysesPerMonth, 0);
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
