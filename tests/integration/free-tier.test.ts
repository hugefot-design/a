/**
 * Gratisplanen håndheves på serveren: 5 distinkte søk per dag (bla/gjenta teller ikke, og grensen kan
 * ikke omgås med en ny organisasjon), 3 lagrede anbud, 1 AI-sammendrag per måned med bekreftet
 * e-post, prøveperiode bare én gang per bruker, og betalte funksjoner gir oppgraderingssiden.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql, withTenant } from '../../src/lib/db';
import { createOrganization } from '../../src/domain/org/org';
import { afterProfileSaved, profileFormSchema, saveProfile } from '../../src/domain/profile/profile';
import { clientFor, createAccount, DEFAULT_PROFILE, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const searches = (prefix: string) => ['renhold', 'vakthold', 'bygg', 'skole', 'vei', 'vann'].map((w) => `/app/anbud?q=${prefix}${w}`);

test('gratis: 5 distinkte søk per dag; bla, gjenta og standardlisten teller ikke', async () => {
  const acc = await createAccount({ plan: 'free' });
  const c = await clientFor(server.base, acc);
  const [s1, s2, s3, s4, s5, s6] = searches('a');
  for (const url of [s1, s2, s3, s4, s5]) assert.equal((await c.get(url!)).status, 200, url);
  const blocked = await c.get(s6!);
  assert.equal(blocked.status, 402);
  assert.match(blocked.body, /Dagens søk er brukt opp/);
  assert.match(blocked.body.replaceAll('<!-- -->', ''), /5 av 5/);
  // Samme søk igjen, neste side og standardlisten er fortsatt lov.
  assert.equal((await c.get(s1!)).status, 200);
  assert.equal((await c.get(`${s1}&side=2`)).status, 200);
  const list = await c.get('/app/anbud');
  assert.equal(list.status, 200);
  assert.match(list.body.replaceAll('<!-- -->', ''), /5 av 5<\/span> søk brukt i dag/);
});

test('gratis: grensen kan ikke omgås med en ny organisasjon, og prøveperioden gis bare én gang', async () => {
  const acc = await createAccount({ plan: 'free' });
  const c = await clientFor(server.base, acc);
  for (const url of searches('b').slice(0, 5)) assert.equal((await c.get(url)).status, 200);
  // Ny organisasjon for samme bruker: ingen ny prøveperiode, og søkene telles på brukeren.
  const orgId = await createOrganization(acc.user, { name: `Ekstra ${acc.email}`, orgNumber: null });
  const [sub] = (await systemSql()`select trial_ends_at <= now() as expired from subscriptions where org_id = ${orgId}`) as unknown as { expired: boolean }[];
  assert.equal(sub?.expired, true, 'ingen ny prøveperiode');
  const data = profileFormSchema.parse(DEFAULT_PROFILE);
  await withTenant({ userId: acc.user.id, orgId }, (tx) => saveProfile(tx, { orgId, userId: acc.user.id }, data));
  await afterProfileSaved(orgId);
  await systemSql()`update users set current_org_id = ${orgId} where id = ${acc.user.id}`;
  assert.equal((await c.get('/app/anbud?q=bnyorg')).status, 402);
});

test('betalt plan: ubegrenset søk og ingen telling', async () => {
  const acc = await createAccount({ plan: 'starter' });
  const c = await clientFor(server.base, acc);
  for (const url of searches('c')) assert.equal((await c.get(url)).status, 200, url);
  const [row] = (await systemSql()`select count(*)::int as n from search_usage where org_id = ${acc.orgId}`) as unknown as { n: number }[];
  assert.equal(row?.n, 0);
});

test('gratis: maks 3 lagrede anbud', async () => {
  const acc = await createAccount({ plan: 'free' });
  const c = await clientFor(server.base, acc);
  const notices = Array.from({ length: 4 }, () => makeNotice());
  await ingest(notices);
  for (const [i, n] of notices.entries()) {
    const id = await tenderIdFor(n.source, n.sourceNoticeId);
    await c.post(`/app/anbud/${id}/bokmerke`, {}, { from: `/app/anbud/${id}` });
    const [row] = (await systemSql()`select count(*)::int as n from bookmarks where org_id = ${acc.orgId}`) as unknown as { n: number }[];
    assert.equal(row?.n, Math.min(i + 1, 3), `etter ${i + 1} forsøk`);
  }
});

test('gratis: 1 AI-sammendrag per måned, bare med bekreftet e-post', async () => {
  const acc = await createAccount({ plan: 'free', verified: false });
  const c = await clientFor(server.base, acc);
  const [n1, n2] = [makeNotice(), makeNotice()];
  await ingest([n1, n2]);
  const t1 = await tenderIdFor(n1.source, n1.sourceNoticeId);
  const t2 = await tenderIdFor(n2.source, n2.sourceNoticeId);
  const unverified = await c.post(`/app/anbud/${t1}/analyse`, {}, { from: `/app/anbud/${t1}` });
  assert.equal(unverified.location, `/app/anbud/${t1}`, 'ubekreftet e-post: ingen analyse');
  assert.match((await c.get(`/app/anbud/${t1}`)).body, /Bekreft e-postadressen/);

  await systemSql()`update users set email_verified_at = now() where id = ${acc.user.id}`;
  const first = await c.post(`/app/anbud/${t1}/analyse`, {}, { from: `/app/anbud/${t1}` });
  assert.equal(first.location, `/app/anbud/${t1}/analyse`, 'første sammendrag går');
  const second = await c.post(`/app/anbud/${t2}/analyse`, {}, { from: `/app/anbud/${t2}` });
  assert.equal(second.location, `/app/anbud/${t2}`, 'andre sammendrag stoppes');
  assert.match((await c.get(`/app/anbud/${t2}`)).body, /AI-kvote \(1\) er brukt opp|AI-sammendrag per måned/);
});

test('låste funksjoner gir oppgraderingssiden med planene', async () => {
  const acc = await createAccount({ plan: 'free' });
  const c = await clientFor(server.base, acc);
  const page = await c.get('/app/lonnsomhet');
  assert.equal(page.status, 403);
  assert.match(page.body, /er ikke med i planen din/);
  assert.match(page.body, /Velg Profesjonell/);
  const billing = await c.get('/app/abonnement');
  assert.match(billing.body, /Søk i dag/);
  assert.match(billing.body.replaceAll('<!-- -->', ''), /4\s990<\/span> <span[^>]*>kr\/mnd/);
  const dash = await c.get('/app');
  assert.match(dash.body, /Gratisplanen/);
});
