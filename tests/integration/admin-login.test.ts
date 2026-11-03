/**
 * Innlogging: plattform-administratorer havner i admin-panelet, alle andre i appen. En gyldig
 * «neste»-lenke går foran, en ugyldig ignoreres, og et feilet forsøk låser ikke målet til appen.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { Client, createAccount, startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

async function makeAdmin() {
  const acc = await createAccount();
  await systemSql()`update users set is_platform_admin = true where id = ${acc.user.id}`;
  return acc;
}

test('admin havner i admin-panelet etter innlogging, vanlige brukere i appen', async () => {
  const admin = await makeAdmin();
  const c = new Client(server.base);
  const res = await c.post('/logg-inn', { email: admin.email, password: admin.password }, { from: '/logg-inn' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/admin');
  assert.equal((await c.get('/admin')).status, 200);
  // Allerede innlogget: innloggingssiden sender rett videre, og knappen på nettsiden går til admin.
  const again = await c.get('/logg-inn');
  assert.equal(again.status, 303);
  assert.equal(again.location, '/admin');
  assert.match((await c.get('/priser')).body, /href="\/admin"[^>]*>Til admin</);

  const user = await createAccount();
  const u = new Client(server.base);
  const r2 = await u.post('/logg-inn', { email: user.email, password: user.password }, { from: '/logg-inn' });
  assert.equal(r2.location, '/app');
  assert.equal((await u.get('/admin')).status, 404, 'vanlige brukere ser ikke at admin finnes');
});

test('gyldig neste-lenke går foran, ugyldig ignoreres, og et feilet forsøk låser ikke målet', async () => {
  const admin = await makeAdmin();
  const c = new Client(server.base);
  const bad = await c.post('/logg-inn', { email: admin.email, password: 'feil-passord-123' }, { from: '/logg-inn' });
  assert.equal(bad.status, 401);
  assert.doesNotMatch(bad.body, /neste=/, 'skjemaet etter et feilet forsøk har ingen neste-lenke');
  const ok = await c.post('/logg-inn', { email: admin.email, password: admin.password }, { from: '/logg-inn' });
  assert.equal(ok.location, '/admin');

  const deepLink = new Client(server.base);
  const deep = await deepLink.post('/logg-inn?neste=%2Fapp%2Fanbud', { email: admin.email, password: admin.password }, { from: '/logg-inn?neste=%2Fapp%2Fanbud' });
  assert.equal(deep.location, '/app/anbud');

  const other = new Client(server.base);
  const evil = await other.post('/logg-inn?neste=%2F%2Fevil.example', { email: admin.email, password: admin.password }, { from: '/logg-inn' });
  assert.equal(evil.location, '/admin', 'neste-lenke til et annet nettsted ignoreres');
});
