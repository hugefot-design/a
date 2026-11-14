/**
 * Kundereisen i admin: riktige antall per steg, ingen personopplysninger, og administratorer og
 * administratorens egen organisasjon (egne tester) er ikke med.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { customerJourney } from '../../src/domain/admin/journey';
import { adminClientFor, Client, clientFor, createAccount, ingest, makeAdmin, makeNotice, ORIGIN, startServer, tenderIdFor, uniqueEmail } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const counts = async () => Object.fromEntries((await customerJourney(30)).steps.map((s) => [s.key, s.n]));

test('kundereisen teller hvert steg riktig og holder administratorer utenfor', async () => {
  const notice = makeNotice({ title: 'Snøbrøyting i Tromsø kommune' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const before0 = await counts();

  const u1 = await createAccount({ verified: false, profile: false }); // bare registrert
  const u2 = await createAccount({ plan: 'free' }); // bekreftet og profil
  const u3 = await createAccount({ plan: 'free' }); // hele veien til betalende
  const admin = await createAccount();
  await makeAdmin(admin.user.id);
  const tester = await createAccount({ profile: false }); // kollega i administratorens organisasjon
  await systemSql()`insert into organization_members (org_id, user_id, role) values (${admin.orgId}, ${tester.user.id}, 'member')`;

  // Treff styres eksplisitt (profilen kan ellers gi treff på andre testers anbud).
  const orgs = [u1.orgId, u2.orgId, u3.orgId, admin.orgId, tester.orgId];
  await systemSql()`delete from match_results where org_id = any(${orgs})`;
  await systemSql()`insert into match_results (org_id, tender_id, score, breakdown, profile_version) values (${u3.orgId}, ${tenderId}, 72, '{}'::jsonb, 1)`;
  await systemSql()`insert into match_results (org_id, tender_id, score, breakdown, profile_version) values (${u2.orgId}, ${tenderId}, 40, '{}'::jsonb, 1)`;
  await systemSql()`insert into bookmarks (org_id, tender_id, created_by) values (${u3.orgId}, ${tenderId}, ${u3.user.id})`;
  await systemSql()`insert into bid_workspaces (org_id, tender_id, title, owner_user_id) values (${u3.orgId}, ${tenderId}, 'Tilbud', ${u3.user.id})`;
  await systemSql()`
    update subscriptions set plan = 'starter', source = 'stripe', status = 'active', stripe_customer_id = 'cus_test_reise', stripe_subscription_id = 'sub_test_reise'
    where org_id = ${u3.orgId}
  `;
  // Samme aktivitet i administratorens organisasjon skal ikke telle.
  await systemSql()`insert into match_results (org_id, tender_id, score, breakdown, profile_version) values (${admin.orgId}, ${tenderId}, 90, '{}'::jsonb, 1)`;
  await systemSql()`insert into bookmarks (org_id, tender_id, created_by) values (${admin.orgId}, ${tenderId}, ${admin.user.id})`;

  const after0 = await counts();
  const delta = Object.fromEntries(Object.keys(after0).map((k) => [k, after0[k]! - before0[k]!]));
  assert.deepEqual(delta, { registered: 3, verified: 2, profiled: 2, matched: 1, opened: 0, assessed: 0, saved: 1, bidding: 1, paying: 1 });
  assert.ok(u1 && u2);
});

test('Admin → Kundereise viser stegene, største frafall og ingen e-postadresser', async () => {
  const acc = await createAccount();
  await makeAdmin(acc.user.id);
  const customer = await createAccount({ verified: false, profile: false });
  const c = await adminClientFor(server.base, acc);
  for (const periode of ['30', '90', 'alle']) {
    const res = await c.get(`/admin/kundereise?periode=${periode}`);
    assert.equal(res.status, 200, periode);
    const body = res.body.replaceAll('<!-- -->', '');
    for (const label of ['Registrerte seg', 'Bekreftet e-posten', 'Fylte ut bedriftsprofilen', 'Fikk gode treff', 'Åpnet et anbud', 'Så en samlet vurdering', 'Lagret et anbud', 'Startet tilbudsarbeid', 'Betaler', 'Fra besøk til konto', 'Kom tilbake', 'Fra gratis til betalende', 'Hvor registreringene kom fra']) {
      assert.ok(body.includes(label), label);
    }
    assert.match(body, /Største frafall:/);
    assert.ok(!body.includes(customer.email), 'ingen e-postadresser');
    assert.match(body, /aria-current="page"/);
  }
  // Vanlige brukere ser ikke siden.
  assert.equal((await (await clientFor(server.base, customer)).get('/admin/kundereise')).status, 404);
});

test('aktivering, «kom tilbake etter 7 og 30 dager» og fra gratis til betalende', async () => {
  const notice = makeNotice({ title: 'Brøyting av kommunale veier (kundereise)' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const before0 = await customerJourney(null);

  // a: registrert for 40 dager siden, brukte appen dag 35 → tilbake etter både 7 og 30 dager. Åpnet anbud og vurdering.
  const a = await createAccount();
  await systemSql()`update users set created_at = now() - interval '40 days' where id = ${a.user.id}`;
  await systemSql()`insert into user_active_days (user_id, day) values (${a.user.id}, (now() at time zone 'Europe/Oslo')::date - 5)`;
  await systemSql()`insert into feature_first_use (org_id, feature, user_id) values (${a.orgId}, 'tender_viewed', ${a.user.id}), (${a.orgId}, 'intelligence_viewed', ${a.user.id})`;
  // b: registrert for 10 dager siden, bare aktiv dag 2 → ikke tilbake etter 7. Prøveperioden er over (gratis). Meldte interesse.
  const b = await createAccount();
  await systemSql()`update users set created_at = now() - interval '10 days' where id = ${b.user.id}`;
  await systemSql()`insert into user_active_days (user_id, day) values (${b.user.id}, (now() at time zone 'Europe/Oslo')::date - 8)`;
  await systemSql()`update subscriptions set trial_ends_at = now() - interval '1 day' where org_id = ${b.orgId}`;
  await systemSql()`insert into feature_first_use (org_id, feature, user_id) values (${b.orgId}, 'plan_interest', ${b.user.id})`;
  // c: betaler via Stripe, men har sagt opp ved periodens slutt.
  const c = await createAccount();
  await systemSql()`
    update subscriptions set plan = 'professional', source = 'stripe', status = 'active', cancel_at_period_end = true,
      stripe_customer_id = 'cus_test_reise2', stripe_subscription_id = 'sub_test_reise2' where org_id = ${c.orgId}
  `;
  assert.ok(tenderId);

  const j = await customerJourney(null);
  const step = (x: typeof j, key: string) => x.steps.find((s) => s.key === key)!.n;
  assert.equal(step(j, 'opened') - step(before0, 'opened'), 1);
  assert.equal(step(j, 'assessed') - step(before0, 'assessed'), 1);
  const r7 = (x: typeof j) => x.retention.find((r) => r.days === 7)!;
  const r30 = (x: typeof j) => x.retention.find((r) => r.days === 30)!;
  assert.equal(r7(j).eligible - r7(before0).eligible, 2, 'a og b registrerte seg for minst 7 dager siden');
  assert.equal(r7(j).returned - r7(before0).returned, 1, 'bare a kom tilbake etter dag 7');
  assert.equal(r30(j).eligible - r30(before0).eligible, 1);
  assert.equal(r30(j).returned - r30(before0).returned, 1);
  assert.equal(j.money.trialOverFree - before0.money.trialOverFree, 1);
  assert.equal(j.money.interested - before0.money.interested, 1);
  assert.equal(j.money.paying - before0.money.paying, 1);
  assert.equal(j.money.cancelled - before0.money.cancelled, 1);
});

test('registreringen husker siden og kilden den kom fra – og ignorerer andre nettsteder og rare verdier', async () => {
  await systemSql()`delete from rate_limits where key like 'register:%'`;
  const register = async (path: string, referer: string | null) => {
    const client = new Client(server.base);
    const page = await client.get(path, referer ? { referer } : {});
    const fra = /name="fra" value="([^"]*)"/.exec(page.body)?.[1] ?? null;
    const kilde = /name="kilde" value="([^"]*)"/.exec(page.body)?.[1] ?? null;
    const email = uniqueEmail('kilde');
    const res = await client.post(path, { name: 'Kari Kilde', email, password: 'Et-sikkert-passord-2026', acceptTerms: 'on', ...(fra ? { fra } : {}), ...(kilde ? { kilde } : {}) }, { from: path });
    assert.equal(res.status, 303, `${path} ${referer}`);
    const [row] = (await systemSql()`select signup_path, signup_source from users where email = ${email}`) as unknown as { signupPath: string | null; signupSource: string | null }[];
    return row!;
  };
  const tenderPath = `/anbud/${crypto.randomUUID()}`;
  assert.deepEqual(await register(`/registrer?neste=${encodeURIComponent('/app/anbud/x/intelligence')}&utm_source=ukesbrev`, `${ORIGIN}${tenderPath}`), { signupPath: tenderPath, signupSource: 'ukesbrev' });
  assert.deepEqual(await register('/registrer', `${ORIGIN}/eksempel`), { signupPath: '/eksempel', signupSource: 'intern' });
  assert.deepEqual(await register('/registrer', 'https://www.google.com/'), { signupPath: null, signupSource: 'google' });
  assert.deepEqual(await register('/registrer', null), { signupPath: null, signupSource: 'direkte' });

  // Forfalskede verdier lagres ikke.
  const client = new Client(server.base);
  await client.get('/registrer');
  const email = uniqueEmail('kilde');
  await client.post('/registrer', { name: 'Ola Rar', email, password: 'Et-sikkert-passord-2026', acceptTerms: 'on', fra: 'https://ondt.example/x', kilde: '<script>' }, { from: '/registrer' });
  const [row] = (await systemSql()`select signup_path, signup_source from users where email = ${email}`) as unknown as { signupPath: string | null; signupSource: string | null }[];
  assert.deepEqual(row, { signupPath: null, signupSource: null });

  // Admin → Kundereise viser sidene og kildene samlet.
  const j = await customerJourney(30);
  assert.ok(j.origins.pages.some((p) => p.key === '/anbud/*'), JSON.stringify(j.origins.pages));
  assert.ok(j.origins.sources.some((p) => p.key === 'ukesbrev'), JSON.stringify(j.origins.sources));
});
