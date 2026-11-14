/**
 * Ærlighet overfor kundene: sidene og e-postene lover bare det som faktisk virker.
 * - Uten kortbetaling: «Meld interesse» på planene (henvendelse til eieren), ikke døde «Velg plan»-knapper.
 * - Vanlige spørsmål om betaling og AI følger det som er slått på.
 * - Tomme AI-paneler vises ikke for kunder når AI er av.
 * - Påminnelsen før prøveperioden slutter nevner bare det som stopper, og tallene er ekte.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { generateTrialReminders } from '../../src/domain/notifications/engine';
import { adminClientFor, clientFor, createAccount, ingest, makeAdmin, makeNotice, startServer, tenderIdFor } from '../helpers';

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const saved = { stripe: env.STRIPE_SECRET_KEY, ai: env.AI_PROVIDER, key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL };

before(async () => {
  server = await startServer();
});
after(async () => {
  Object.assign(mutableEnv, { STRIPE_SECRET_KEY: saved.stripe, AI_PROVIDER: saved.ai, ANTHROPIC_API_KEY: saved.key, ANTHROPIC_MODEL: saved.model });
  await server.close();
  await closeDb();
});

/** Kjører en blokk uten kortbetaling (Stripe ikke satt opp), og setter tilbake etterpå. */
async function withoutPayments<T>(fn: () => Promise<T>): Promise<T> {
  mutableEnv.STRIPE_SECRET_KEY = undefined;
  try {
    return await fn();
  } finally {
    mutableEnv.STRIPE_SECRET_KEY = saved.stripe;
  }
}

async function withAi<T>(provider: 'none' | 'mock' | 'anthropic', fn: () => Promise<T>): Promise<T> {
  Object.assign(mutableEnv, provider === 'anthropic' ? { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'test-nokkel', ANTHROPIC_MODEL: 'test-modell' } : { AI_PROVIDER: provider });
  try {
    return await fn();
  } finally {
    Object.assign(mutableEnv, { AI_PROVIDER: saved.ai, ANTHROPIC_API_KEY: saved.key, ANTHROPIC_MODEL: saved.model });
  }
}

test('uten kortbetaling: «Meld interesse» i stedet for døde kjøpsknapper, og henvendelsen når eieren', async () => {
  const acc = await createAccount({ profile: { companyName: 'Ærlig Vakt AS' } });
  const c = await clientFor(server.base, acc);
  await withoutPayments(async () => {
    const page = await c.get('/app/abonnement');
    assert.equal(page.status, 200);
    const t = text(page.body);
    assert.match(t, /Kortbetaling er ikke åpnet ennå/);
    assert.equal((page.body.match(/action="\/app\/abonnement\/interesse"/g) ?? []).length, 3, 'én knapp per betalt plan');
    assert.doesNotMatch(page.body, /action="\/app\/abonnement\/velg"/);
    assert.doesNotMatch(page.body, /disabled=""/, 'ingen døde knapper');

    const res = await c.post('/app/abonnement/interesse', { plan: 'professional' }, { from: '/app/abonnement' });
    assert.equal(res.status, 303);
    assert.equal(res.location, '/app/abonnement');
    const after = text((await c.get('/app/abonnement')).body);
    assert.match(after, /Vi har fått beskjed om at dere ønsker Profesjonell/);

    const rows = (await systemSql()`select kind, message, email, status from reports where org_id = ${acc.orgId}`) as unknown as { kind: string; message: string; email: string; status: string }[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, 'plan_interest');
    assert.equal(rows[0]!.status, 'open');
    assert.equal(rows[0]!.email, acc.user.email);
    assert.match(rows[0]!.message, /Ønsker planen Profesjonell \(699 kr\/mnd eks\. mva\.\) for Ærlig Vakt AS/);
    const audit = (await systemSql()`select metadata from audit_logs where org_id = ${acc.orgId} and action = 'billing.plan_interest'`) as unknown as { metadata: { plan: string } }[];
    assert.deepEqual(audit.map((a) => a.metadata.plan), ['professional']);
    const first = (await systemSql()`select feature from feature_first_use where org_id = ${acc.orgId} and feature = 'plan_interest'`) as unknown as unknown[];
    assert.equal(first.length, 1, 'telles i kundereisen som kjøpsønske');
    // Planen er ikke endret – ingen betaling, ingen ny plan.
    const [sub] = (await systemSql()`select plan, source from subscriptions where org_id = ${acc.orgId}`) as unknown as { plan: string; source: string }[];
    assert.equal(sub!.source, 'trial');

    // Ukjent plan avvises, og høyst tre ønsker per døgn.
    assert.equal((await c.post('/app/abonnement/interesse', { plan: 'enterprise' }, { from: '/app/abonnement' })).status, 400);
    await c.post('/app/abonnement/interesse', { plan: 'business' }, { from: '/app/abonnement' });
    await c.post('/app/abonnement/interesse', { plan: 'starter' }, { from: '/app/abonnement' });
    await c.post('/app/abonnement/interesse', { plan: 'starter' }, { from: '/app/abonnement' });
    const count = (await systemSql()`select count(*)::int as n from reports where org_id = ${acc.orgId}`) as unknown as { n: number }[];
    assert.equal(count[0]!.n, 3);
  });

  // Administratoren ser ønsket som «Planønske» med organisasjonen.
  const admin = await createAccount();
  await makeAdmin(admin.user.id);
  const ac = await adminClientFor(server.base, admin);
  const list = text((await ac.get('/admin/rapporter')).body);
  assert.match(list, /Planønske/);
  assert.match(list, /Ærlig Vakt AS/);
});

test('med kortbetaling: vanlige kjøpsknapper, og «Meld interesse» sender ingenting', async () => {
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  const page = await c.get('/app/abonnement');
  assert.match(page.body, /action="\/app\/abonnement\/velg"/);
  assert.doesNotMatch(page.body, /action="\/app\/abonnement\/interesse"/);
  const res = await c.post('/app/abonnement/interesse', { plan: 'professional' }, { from: '/app/abonnement' });
  assert.equal(res.status, 303);
  const rows = (await systemSql()`select 1 from reports where org_id = ${acc.orgId}`) as unknown as unknown[];
  assert.equal(rows.length, 0);
});

test('bare eier eller administrator kan melde interesse', async () => {
  const owner = await createAccount();
  const member = await createAccount({ profile: false });
  await systemSql()`insert into organization_members (org_id, user_id, role) values (${owner.orgId}, ${member.user.id}, 'member')`;
  await systemSql()`update users set current_org_id = ${owner.orgId} where id = ${member.user.id}`;
  const c = await clientFor(server.base, member);
  await withoutPayments(async () => {
    const res = await c.post('/app/abonnement/interesse', { plan: 'professional' }, { from: '/app/abonnement' });
    assert.equal(res.status, 403);
  });
});

test('vanlige spørsmål: betaling og AI beskrives slik de faktisk er', async () => {
  const get = async (path = '/priser') => text(await (await fetch(`${server.base}${path}`)).text());

  // Testmiljøet: Stripe med testnøkler (ikke produksjon) og AI i testmodus (simulert).
  let t = await get();
  assert.match(t, /Med kort via Stripe/);
  assert.match(t, /Er vurderingene alltid riktige\?/);
  assert.doesNotMatch(t, /Er AI-analysen alltid riktig\?/, 'simulert AI markedsføres ikke som ekte');
  assert.doesNotMatch(t, /Hva teller som en AI-analyse\?/);
  assert.match(t, /AI-funksjonene i planene .* er ikke slått på ennå/);

  t = await withoutPayments(() => get());
  assert.match(t, /Kortbetaling er ikke åpnet ennå/);
  assert.doesNotMatch(t, /Med kort via Stripe/);

  t = await withAi('anthropic', () => get());
  assert.match(t, /Er AI-analysen alltid riktig\?/);
  assert.match(t, /Hva teller som en AI-analyse\?/);
  assert.doesNotMatch(t, /AI-funksjonene i planene .* er ikke slått på ennå/);

  // Plankortene: AI-linjene merkes «ikke slått på ennå» når AI ikke er ekte – og ellers ikke.
  const pricingHtml = async () => (await (await fetch(`${server.base}/priser`)).text()).replace(/<!-- -->/g, '');
  assert.ok(((await pricingHtml()).match(/ikke slått på ennå/g) ?? []).length >= 5, 'AI-linjene er merket');
  assert.equal(((await withAi('anthropic', pricingHtml)).match(/ikke slått på ennå/g) ?? []).length, 0);

  // Engelsk side følger de samme reglene.
  t = await withoutPayments(() => get('/en/pricing'));
  assert.match(t, /Card payment is not open yet/);
});

test('AI av: kundene ser ingen tomme AI-paneler, og administratorens organisasjon ser testmodus', async () => {
  await ingest([makeNotice({ sourceNoticeId: 'AERLIG-AI-1' })]);
  const id = await tenderIdFor('manual', 'AERLIG-AI-1');
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);

  const off = await withAi('none', async () => text((await c.get(`/app/anbud/${id}`)).body));
  assert.doesNotMatch(off, /AI-tolkning/);
  assert.doesNotMatch(off, /Kan vi delta\? \(AI-vurdering\)/);
  assert.doesNotMatch(off, /AI er ikke slått på/);
  assert.match(off, /Krav og avvisningsrisiko|Kunngjøringen/, 'resten av siden er der');

  const on = text((await c.get(`/app/anbud/${id}`)).body);
  assert.match(on, /AI-tolkning/);
  assert.match(on, /Kan vi delta\? \(AI-vurdering\)/);

  // Gratisplanen: AI-kvoten vises ikke når AI er av.
  const free = await createAccount({ plan: 'free' });
  const fc = await clientFor(server.base, free);
  const dash = await withAi('none', async () => text((await fc.get('/app')).body));
  assert.match(dash, /Gratisplanen/);
  assert.doesNotMatch(dash, /AI-sammendrag/);

  // Administratorens egen organisasjon ser AI-panelene i testmodus (simulerte svar, tydelig merket).
  const admin = await createAccount();
  await makeAdmin(admin.user.id);
  const ac = await adminClientFor(server.base, admin);
  const adminView = await withAi('none', async () => text((await ac.get(`/app/anbud/${id}`)).body));
  assert.match(adminView, /AI-tolkning/);
  assert.match(adminView, /Testmodus: svarene simuleres/);
});

test('påminnelse før prøveperioden slutter: ekte tall, og bare det som faktisk stopper', async () => {
  await ingest([makeNotice({ sourceNoticeId: 'AERLIG-TRIAL-1', title: 'Vakthold og resepsjon ved rådhuset' })]);
  const tenderId = await tenderIdFor('manual', 'AERLIG-TRIAL-1');
  const acc = await createAccount({ profile: { companyName: 'Prøve Vakt AS' } });
  await systemSql()`update subscriptions set trial_ends_at = now() + interval '2 days' where org_id = ${acc.orgId}`;
  await systemSql()`insert into bookmarks (org_id, tender_id, created_by) values (${acc.orgId}, ${tenderId}, ${acc.user.id})`;
  const [m] = (await systemSql()`select count(*)::int as n from match_results m join tenders t on t.id = m.tender_id where m.org_id = ${acc.orgId} and not m.excluded and m.score >= 60 and t.deadline_at > now()`) as unknown as { n: number }[];

  await withAi('none', () => withoutPayments(() => generateTrialReminders()));
  const [mail] = (await systemSql()`select subject, text_body from email_outbox where org_id = ${acc.orgId} and kind = 'trial_ending'`) as unknown as { subject: string; textBody: string }[];
  assert.ok(mail, 'påminnelsen er lagt i køen');
  assert.match(mail.subject, /Prøveperioden din slutter om 2 dager/);
  assert.doesNotMatch(mail.textBody, /AI/, 'AI nevnes ikke når den aldri har vært på');
  assert.match(mail.textBody, /stopper automatiske varsler, personlig rangering og lønnsomhetskalkulatoren/);
  assert.match(mail.textBody, /slutter om 2 dager/);
  assert.match(mail.textBody, /1 lagret anbud/);
  if (m!.n > 0) assert.match(mail.textBody, new RegExp(`${m!.n} åpne anbud som passer profilen`));
  assert.match(mail.textBody, /Kortbetaling er ikke åpnet ennå/);
  assert.match(mail.textBody, /Meld interesse: http/);
  assert.doesNotMatch(mail.textBody, /Velg plan/);
});
