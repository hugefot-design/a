/**
 * Innlogging: plattform-administratorer havner i admin-panelet (etter koden fra kode-appen), alle andre
 * i appen. En gyldig «neste»-lenke går foran, en ugyldig ignoreres, og et feilet forsøk låser ikke målet.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { challengeFrom, Client, createAccount, makeAdmin as makeAdminUser, startServer, testTotpCode } from '../helpers';

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
  await makeAdminUser(acc.user.id);
  return acc;
}

/** Passord, så kode fra kode-appen. Returnerer svaret på kodesteget. */
async function adminLogin(c: Client, admin: Awaited<ReturnType<typeof makeAdmin>>, query = '') {
  const pw = await c.post(`/logg-inn${query}`, { email: admin.email, password: admin.password }, { from: `/logg-inn${query}` });
  assert.equal(pw.status, 200, 'riktig passord gir kodesiden, ikke innlogging');
  assert.match(pw.body, /Skriv inn koden/);
  return c.post('/logg-inn/kode', { challenge: challengeFrom(pw.body), code: await testTotpCode(admin.user.id) }, { from: '/logg-inn' });
}

test('admin havner i admin-panelet etter innlogging, vanlige brukere i appen', async () => {
  const admin = await makeAdmin();
  const c = new Client(server.base);
  const res = await adminLogin(c, admin);
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
  const ok = await adminLogin(c, admin);
  assert.equal(ok.location, '/admin');

  const deepLink = new Client(server.base);
  const deep = await adminLogin(deepLink, admin, '?neste=%2Fapp%2Fanbud');
  assert.equal(deep.location, '/app/anbud');

  const other = new Client(server.base);
  const evil = await adminLogin(other, admin, '?neste=%2F%2Fevil.example');
  assert.equal(evil.location, '/admin', 'neste-lenke til et annet nettsted ignoreres');
  const tab = await adminLogin(new Client(server.base), admin, '?neste=%2F%09%2Fevil.example');
  assert.equal(tab.location, '/admin', 'usynlig tabulator gjør ikke lenken gyldig');
});
