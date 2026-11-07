/**
 * Kundereisen i admin: riktige antall per steg, ingen personopplysninger, og administratorer og
 * administratorens egen organisasjon (egne tester) er ikke med.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { customerJourney } from '../../src/domain/admin/journey';
import { adminClientFor, clientFor, createAccount, ingest, makeAdmin, makeNotice, startServer, tenderIdFor } from '../helpers';

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
  assert.deepEqual(delta, { registered: 3, verified: 2, profiled: 2, matched: 1, saved: 1, bidding: 1, paying: 1 });
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
    for (const label of ['Registrerte seg', 'Bekreftet e-posten', 'Fylte ut bedriftsprofilen', 'Fikk gode treff', 'Lagret et anbud', 'Startet tilbudsarbeid', 'Betaler']) {
      assert.ok(body.includes(label), label);
    }
    assert.match(body, /Største frafall:/);
    assert.ok(!body.includes(customer.email), 'ingen e-postadresser');
    assert.match(body, /aria-current="page"/);
  }
  // Vanlige brukere ser ikke siden.
  assert.equal((await (await clientFor(server.base, customer)).get('/admin/kundereise')).status, 404);
});
