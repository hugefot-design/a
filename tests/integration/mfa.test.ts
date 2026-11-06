/**
 * Totrinnsinnlogging: oppsett med kode, innlogging krever kode, feil kode og for mange forsøk,
 * gjentaksvern, reservekoder (engangs), admin krever totrinn, og bare vanlige brukere kan slå det av.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { decryptSecret } from '../../src/lib/crypto';
import { currentStep, totpAt } from '../../src/lib/totp';
import { challengeFrom, Client, clientFor, createAccount, enableTestMfa, makeAdmin, startServer, TEST_TOTP_SECRET, testTotpCode } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const passwordStep = async (c: Client, email: string, password: string) => c.post('/logg-inn', { email, password }, { from: '/logg-inn' });

test('oppsett: QR-kode, riktig kode slår på, reservekoder vises én gang, andre økter logges ut', async () => {
  const acc = await createAccount();
  const other = await clientFor(server.base, acc);
  const c = await clientFor(server.base, acc);
  const setup = await c.get('/konto/totrinn');
  assert.equal(setup.status, 200);
  assert.match(setup.body, /data:image\/svg\+xml;base64,/, 'QR-kode');
  const [row] = (await systemSql()`select totp_pending_enc from users where id = ${acc.user.id}`) as unknown as { totpPendingEnc: string }[];
  const secret = decryptSecret(row!.totpPendingEnc);
  // Feil kode slår ikke på.
  const wrong = await c.post('/konto/totrinn', { code: '000000' }, { from: '/konto/totrinn' });
  assert.equal(wrong.status, 422);
  // Riktig kode slår på og viser 10 reservekoder.
  const ok = await c.post('/konto/totrinn', { code: totpAt(secret, currentStep()) }, { from: '/konto/totrinn' });
  assert.equal(ok.status, 200);
  const codes = [...ok.body.matchAll(/>([A-Z2-7]{5}-[A-Z2-7]{5})</g)].map((m) => m[1]);
  assert.equal(new Set(codes).size, 10);
  const [u] = (await systemSql()`select totp_enabled_at, totp_secret_enc, totp_pending_enc from users where id = ${acc.user.id}`) as unknown as {
    totpEnabledAt: Date | null;
    totpSecretEnc: string;
    totpPendingEnc: string | null;
  }[];
  assert.ok(u?.totpEnabledAt);
  assert.equal(u?.totpPendingEnc, null);
  assert.doesNotMatch(u!.totpSecretEnc, new RegExp(secret), 'hemmeligheten er kryptert');
  const stored = (await systemSql()`select code_hash from user_recovery_codes where user_id = ${acc.user.id}`) as unknown as { codeHash: string }[];
  assert.equal(stored.length, 10);
  for (const s of stored) assert.ok(!codes.includes(s.codeHash), 'reservekoder lagres bare som hash');
  // Andre innlogginger er logget ut, denne er beholdt.
  assert.equal((await other.get('/app')).status, 303);
  assert.equal((await c.get('/app')).status, 200);
});

test('innlogging krever kode: feil kode teller ned, riktig kode logger inn, samme kode virker ikke igjen', async () => {
  const acc = await createAccount();
  await enableTestMfa(acc.user.id);
  const c = new Client(server.base);
  const pw = await passwordStep(c, acc.email, acc.password);
  assert.equal(pw.status, 200);
  assert.match(pw.body, /Skriv inn koden/);
  assert.equal((await c.get('/app')).status, 303, 'ingen økt før koden er riktig');
  const challenge = challengeFrom(pw.body);
  const bad = await c.post('/logg-inn/kode', { challenge, code: '123456' }, { from: '/logg-inn' });
  assert.equal(bad.status, 401);
  assert.match(bad.body.replaceAll('<!-- -->', ''), /4 forsøk igjen/);
  const code = await testTotpCode(acc.user.id);
  const good = await c.post('/logg-inn/kode', { challenge, code }, { from: '/logg-inn' });
  assert.equal(good.status, 303);
  assert.equal(good.location, '/app');
  assert.equal((await c.get('/app')).status, 200);
  // Utfordringen er brukt opp, og samme kode kan ikke brukes i en ny innlogging.
  assert.equal((await c.post('/logg-inn/kode', { challenge, code }, { from: '/app' })).status, 303, 'innlogget: sendes videre');
  const c2 = new Client(server.base);
  const pw2 = await passwordStep(c2, acc.email, acc.password);
  const replay = await c2.post('/logg-inn/kode', { challenge: challengeFrom(pw2.body), code }, { from: '/logg-inn' });
  assert.equal(replay.status, 401, 'samme kode virker ikke to ganger');
});

test('for mange feil koder: utfordringen slutter å virke', async () => {
  const acc = await createAccount();
  await enableTestMfa(acc.user.id);
  const c = new Client(server.base);
  const challenge = challengeFrom((await passwordStep(c, acc.email, acc.password)).body);
  for (let i = 0; i < 5; i++) await c.post('/logg-inn/kode', { challenge, code: '000000' }, { from: '/logg-inn' });
  const after5 = await c.post('/logg-inn/kode', { challenge, code: await testTotpCode(acc.user.id) }, { from: '/logg-inn' });
  assert.equal(after5.status, 401);
  assert.match(after5.body, /Logg inn på nytt/);
  assert.equal((await c.get('/app')).status, 303);
});

test('reservekode virker én gang', async () => {
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  await c.get('/konto/totrinn');
  const [row] = (await systemSql()`select totp_pending_enc from users where id = ${acc.user.id}`) as unknown as { totpPendingEnc: string }[];
  const ok = await c.post('/konto/totrinn', { code: totpAt(decryptSecret(row!.totpPendingEnc), currentStep()) }, { from: '/konto/totrinn' });
  const recovery = /([A-Z2-7]{5}-[A-Z2-7]{5})/.exec(ok.body)![1]!;
  const l1 = new Client(server.base);
  const r1 = await l1.post('/logg-inn/kode', { challenge: challengeFrom((await passwordStep(l1, acc.email, acc.password)).body), code: recovery.toLowerCase() }, { from: '/logg-inn' });
  assert.equal(r1.status, 303, 'reservekode (små bokstaver) virker');
  const l2 = new Client(server.base);
  const r2 = await l2.post('/logg-inn/kode', { challenge: challengeFrom((await passwordStep(l2, acc.email, acc.password)).body), code: recovery }, { from: '/logg-inn' });
  assert.equal(r2.status, 401, 'brukt reservekode virker ikke igjen');
});

test('admin krever totrinnsinnlogging; administratorer kan ikke slå det av, vanlige brukere kan', async () => {
  const admin = await createAccount();
  await makeAdmin(admin.user.id, { mfa: false });
  const a = await clientFor(server.base, admin);
  const blocked = await a.get('/admin');
  assert.equal(blocked.status, 303);
  assert.equal(blocked.location, '/konto/totrinn?neste=%2Fadmin');
  assert.match((await a.get('/konto/totrinn')).body, /Admin-panelet viser alle kundene/);
  await enableTestMfa(admin.user.id);
  assert.equal((await a.get('/admin')).status, 200);
  const status = await a.get('/konto/totrinn');
  assert.match(status.body, /Administratorer må ha totrinnsinnlogging/);
  const denied = await a.post('/konto/totrinn/av', { password: admin.password, code: await testTotpCode(admin.user.id) }, { from: '/konto/totrinn' });
  assert.equal(denied.status, 422);

  const user = await createAccount();
  await enableTestMfa(user.user.id);
  const u = await clientFor(server.base, user);
  const off = await u.post('/konto/totrinn/av', { password: user.password, code: await testTotpCode(user.user.id) }, { from: '/konto/totrinn' });
  assert.equal(off.status, 303);
  const [row] = (await systemSql()`select totp_enabled_at, totp_secret_enc from users where id = ${user.user.id}`) as unknown as { totpEnabledAt: Date | null; totpSecretEnc: string | null }[];
  assert.equal(row?.totpEnabledAt, null);
  assert.equal(row?.totpSecretEnc, null);
  assert.equal(TEST_TOTP_SECRET.length, 32);
});
