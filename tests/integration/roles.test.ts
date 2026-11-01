/**
 * Roller og tilgang: ingen kan gjøre seg selv til administrator, vanlige medlemmer kan ikke endre
 * medlemskap (heller ikke med manipulerte kall eller direkte i databasen), og en bruker som fjernes
 * fra en organisasjon mister tilgangen med en gang.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql, withTenant } from '../../src/lib/db';
import { appSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let owner: TestAccount;
let member: TestAccount;
let outsider: TestAccount;

async function addMember(acc: TestAccount, orgId: string, role: 'admin' | 'member') {
  await systemSql()`insert into organization_members (org_id, user_id, role) values (${orgId}, ${acc.user.id}, ${role})`;
  await systemSql()`update users set current_org_id = ${orgId} where id = ${acc.user.id}`;
}

before(async () => {
  server = await startServer();
  owner = await createAccount({ plan: 'business', orgName: 'Rolleorg (test)' });
  member = await createAccount({ plan: 'business', orgName: 'Medlemmets egen org (test)' });
  outsider = await createAccount({ plan: 'business', orgName: 'Utenforstående org (test)' });
  await addMember(member, owner.orgId, 'member');
});

after(async () => {
  await server.close();
  await closeDb();
});

test('en vanlig bruker kan ikke bli plattform-administrator – verken via nettsiden eller databasen', async () => {
  const c = await clientFor(server.base, member);
  const page = await c.post(`/admin/brukere/${member.user.id}/admin`, {}, { from: '/app/innstillinger' });
  assert.equal(page.status, 404, 'admin-ruter finnes ikke for vanlige brukere');

  // Selv med en feil i appkoden kan webapp-rollen ikke skrive kolonnen.
  await assert.rejects(
    withTenant({ userId: member.user.id, orgId: owner.orgId }, (tx) => tx`update users set is_platform_admin = true where id = ${member.user.id}`),
    /permission denied/,
  );
  await assert.rejects(appSql()`update users set is_platform_admin = true where id = ${member.user.id}`, /permission denied/);
  await assert.rejects(
    appSql()`insert into users (email, name, password_hash, is_platform_admin) values ('angriper@example.com', 'x', 'x', true)`,
    /permission denied/,
  );
  const [row] = (await systemSql()`select is_platform_admin from users where id = ${member.user.id}`) as unknown as { isPlatformAdmin: boolean }[];
  assert.equal(row!.isPlatformAdmin, false);
});

test('i en organisasjon kan webapp-rollen bare endre egen brukerrad', async () => {
  const rows = await withTenant({ userId: member.user.id, orgId: owner.orgId }, (tx) => tx`update users set name = 'Kapret' where id = ${owner.user.id} returning id`);
  assert.equal(rows.length, 0);
  const own = await withTenant({ userId: member.user.id, orgId: owner.orgId }, (tx) => tx`update users set name = 'Nytt navn (test)' where id = ${member.user.id} returning id`);
  assert.equal(own.length, 1);
});

test('vanlig medlem kan ikke endre roller, invitere eller fjerne andre (manipulerte kall)', async () => {
  const c = await clientFor(server.base, member);
  const from = '/app/innstillinger?fane=team';
  assert.equal((await c.post(`/app/team/${member.user.id}/rolle`, { role: 'owner' }, { from })).status, 403);
  assert.equal((await c.post(`/app/team/${owner.user.id}/rolle`, { role: 'member' }, { from })).status, 403);
  assert.equal((await c.post('/app/team/inviter', { email: 'venn@example.com', role: 'admin' }, { from })).status, 403);
  const remove = await c.post(`/app/team/${owner.user.id}/fjern`, {}, { from });
  assert.equal(remove.status, 303);
  assert.match((await c.get(remove.location!)).body, /ikke tilgang til å fjerne medlemmer/);

  // Direkte i databasen med medlemmets kontekst: ingen rader påvirkes, og nye medlemskap kan ikke lages.
  const ctx = { userId: member.user.id, orgId: owner.orgId };
  assert.equal((await withTenant(ctx, (tx) => tx`update organization_members set role = 'owner' where org_id = ${owner.orgId} returning 1`)).length, 0);
  assert.equal((await withTenant(ctx, (tx) => tx`delete from organization_members where user_id = ${owner.user.id} returning 1`)).length, 0);
  await assert.rejects(
    withTenant(ctx, (tx) => tx`insert into organization_members (org_id, user_id, role) values (${outsider.orgId}, ${member.user.id}, 'owner')`),
    /permission denied/,
  );
  await assert.rejects(
    withTenant(ctx, (tx) => tx`insert into invitations (org_id, email, role, token_hash, expires_at) values (${owner.orgId}, 'x@example.com', 'admin', 'h', now() + interval '1 day')`),
    /row-level security/,
  );
  assert.equal((await withTenant(ctx, (tx) => tx`update company_profiles set description = 'kapret' where org_id = ${owner.orgId} returning 1`)).length, 0);
  assert.equal((await withTenant(ctx, (tx) => tx`update organizations set name = 'Kapret' where id = ${owner.orgId} returning 1`)).length, 0);
  const [roles] = (await systemSql()`
    select count(*) filter (where role = 'owner')::int as owners, count(*)::int as members from organization_members where org_id = ${owner.orgId}
  `) as unknown as { owners: number; members: number }[];
  assert.deepEqual(roles, { owners: 1, members: 2 });
});

test('AI-bruk (kvote og kostnad) kan ikke endres eller slettes av webappen', async () => {
  const ctx = { userId: owner.user.id, orgId: owner.orgId };
  await withTenant(ctx, (tx) => tx`insert into usage_records (org_id, user_id, kind, period) values (${owner.orgId}, ${owner.user.id}, 'ai_tender_analysis', to_char(now(), 'YYYY-MM'))`);
  await assert.rejects(withTenant(ctx, (tx) => tx`delete from usage_records where org_id = ${owner.orgId}`), /permission denied/);
  await assert.rejects(withTenant(ctx, (tx) => tx`update usage_records set quantity = 0 where org_id = ${owner.orgId}`), /permission denied/);
});

test('en bruker som fjernes fra organisasjonen mister tilgangen med en gang', async () => {
  const notice = makeNotice();
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const ownerClient = await clientFor(server.base, owner);
  assert.equal((await ownerClient.post(`/app/anbud/${tenderId}/bokmerke`, {}, { from: `/app/anbud/${tenderId}` })).status, 303);

  const leaving = await createAccount({ plan: 'business', orgName: 'Midlertidig (test)', profile: false });
  await systemSql()`delete from organizations where id = ${leaving.orgId}`; // bare medlem av rolleorgen
  await addMember(leaving, owner.orgId, 'member');
  const c = await clientFor(server.base, leaving);
  const before = await c.get('/app/lagret');
  assert.equal(before.status, 200);
  assert.ok(before.body.includes(notice.title), 'ser organisasjonens lagrede anbud mens hen er medlem');

  const removed = await ownerClient.post(`/app/team/${leaving.user.id}/fjern`, {}, { from: '/app/innstillinger?fane=team' });
  assert.equal(removed.status, 303);

  const afterRemoval = await c.get('/app/lagret');
  assert.equal(afterRemoval.status, 303, 'samme sesjon har ikke lenger tilgang');
  assert.equal(afterRemoval.location, '/app/onboarding');
  const direct = await withTenant({ userId: leaving.user.id, orgId: owner.orgId }, (tx) => tx`select 1 from bookmarks`);
  assert.equal(direct.length, 0, 'databasen gir heller ingen rader med den gamle organisasjonskonteksten');
});

test('et medlem kan selv forlate organisasjonen', async () => {
  const leaver = await createAccount({ plan: 'business', orgName: 'Forlater (test)', profile: false });
  await systemSql()`delete from organizations where id = ${leaver.orgId}`;
  await addMember(leaver, owner.orgId, 'member');
  const c = await clientFor(server.base, leaver);
  const res = await c.post(`/app/team/${leaver.user.id}/fjern`, {}, { from: '/app/innstillinger?fane=team' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/app');
  const left = await systemSql()`select 1 from organization_members where org_id = ${owner.orgId} and user_id = ${leaver.user.id}`;
  assert.equal(left.length, 0);
});

test('radnivåsikkerhet er slått på for alle tabeller', async () => {
  const rows = (await systemSql()`
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  `) as unknown as { relname: string }[];
  assert.deepEqual(rows.map((r) => r.relname), []);
});
