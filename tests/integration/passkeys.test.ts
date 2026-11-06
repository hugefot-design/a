/**
 * Passkeys (Face ID / fingeravtrykk / sikkerhetsnøkkel) som andre steg, testet med en
 * programvare-autentikator: legge til (krever ny bekreftelse), logge inn, «bekreft at det er deg»,
 * falske sider og gjenbruk avvises, kopiert nøkkel avvises, fjerne og slå av.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { adminClientFor, ageMfaVerification, challengeFrom, Client, clientFor, createAccount, csrfFrom, enableTestMfa, makeAdmin, ORIGIN, startServer, testTotpCode, type TestAccount } from '../helpers';
import { SoftAuthenticator } from '../soft-authenticator';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const unescape = (s: string) => s.replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

/** Valgene til nettleseren fra kodesiden / bekreftelsessiden. */
function passkeyOptionsFrom(html: string): { challenge: string; allowCredentials: { id: string }[]; rpId: string } {
  const m = /data-passkey-auth="([^"]+)"/.exec(html);
  if (!m) throw new Error('Fant ikke passkey-knappen på siden');
  return JSON.parse(unescape(m[1]!));
}

async function credentials(userId: string) {
  return (await systemSql()`select id, name, credential_id, counter, last_used_at from webauthn_credentials where user_id = ${userId} order by created_at`) as unknown as {
    id: string;
    name: string;
    credentialId: string;
    counter: string;
    lastUsedAt: Date | null;
  }[];
}

async function mails(userId: string, kind: string) {
  return (await systemSql()`select text_body from email_outbox where user_id = ${userId} and kind = ${kind}`) as unknown as { textBody: string }[];
}

/** Legger til en passkey slik nettleseren gjør: hent valg, la «enheten» svare, send skjemaet. */
async function addPasskey(c: Client, name = 'Testnøkkel'): Promise<{ key: SoftAuthenticator; res: Awaited<ReturnType<Client['post']>> }> {
  const page = await c.get('/konto/totrinn');
  const optRes = await c.request('POST', '/konto/passkey/valg', { headers: { accept: 'application/json', 'x-csrf-token': csrfFrom(page.body)! } });
  assert.equal(optRes.status, 200, optRes.body);
  const options = JSON.parse(optRes.body);
  const key = new SoftAuthenticator(ORIGIN);
  const res = await c.post('/konto/passkey', { name, response: JSON.stringify(key.register(options)) }, { csrf: csrfFrom(page.body) });
  return { key, res };
}

async function newAdmin(): Promise<TestAccount> {
  const acc = await createAccount();
  await makeAdmin(acc.user.id);
  return acc;
}

test('legge til passkey: valgene er riktige, nøkkelen lagres (bare offentlig del), og det kommer e-post', async () => {
  const admin = await newAdmin();
  const c = await adminClientFor(server.base, admin);
  const page = await c.get('/konto/totrinn');
  assert.match(page.body, /data-passkey-register="\/konto\/passkey\/valg"/);
  const optRes = await c.request('POST', '/konto/passkey/valg', { headers: { accept: 'application/json', 'x-csrf-token': csrfFrom(page.body)! } });
  const options = JSON.parse(optRes.body);
  assert.equal(options.rp.id, 'localhost');
  assert.equal(options.rp.name, 'AnbudRadar');
  assert.equal(options.user.name, admin.email);
  assert.equal(options.attestation, 'none');
  assert.ok(!JSON.stringify(options.user.id).includes(admin.email), 'bruker-ID-en overfor enheten er ikke e-posten');

  const { key, res } = await addPasskey(c, 'Jobb-Mac');
  assert.equal(res.status, 303);
  assert.equal(res.location, '/konto/totrinn#passkeys');
  const [cred] = await credentials(admin.user.id);
  assert.equal(cred?.name, 'Jobb-Mac');
  assert.equal(cred?.credentialId, key.id);
  const status = await c.get('/konto/totrinn');
  assert.match(status.body, /Jobb-Mac/);
  assert.match(status.body, /1 lagt til/);
  const [mail] = await mails(admin.user.id, 'security_passkey_added');
  assert.match(mail?.textBody ?? '', /Passkey: Jobb-Mac/);

  // Samme nøkkel kan ikke legges til to ganger.
  const page2 = await c.get('/konto/totrinn');
  const again = JSON.parse((await c.request('POST', '/konto/passkey/valg', { headers: { accept: 'application/json', 'x-csrf-token': csrfFrom(page2.body)! } })).body);
  assert.deepEqual(
    again.excludeCredentials.map((x: { id: string }) => x.id),
    [key.id],
  );
  const dup = await c.post('/konto/passkey', { name: 'Igjen', response: JSON.stringify(key.register(again)) }, { csrf: csrfFrom(page2.body) });
  assert.equal(dup.status, 303);
  assert.equal((await credentials(admin.user.id)).length, 1);
});

test('innlogging med passkey: falsk side og gjenbruk avvises, riktig enhet logger inn og bekrefter økten', async () => {
  const admin = await newAdmin();
  const { key } = await addPasskey(await adminClientFor(server.base, admin));
  const l = new Client(server.base);
  const pw = await l.post('/logg-inn', { email: admin.email, password: admin.password }, { from: '/logg-inn' });
  assert.equal(pw.status, 200);
  const challenge = challengeFrom(pw.body);
  const first = passkeyOptionsFrom(pw.body);
  assert.deepEqual(
    first.allowCredentials.map((x) => x.id),
    [key.id],
  );
  assert.match(pw.body, /Bruk Face ID \/ fingeravtrykk/);

  // En falsk innloggingsside (annen adresse) kan ikke bruke passkeyen.
  const phish = await l.post('/logg-inn/kode', { challenge, passkey: JSON.stringify(key.authenticate(first, { origin: 'https://anbudradar-login.example' })) }, { from: '/logg-inn' });
  assert.equal(phish.status, 401);
  assert.match(phish.body.replaceAll('<!-- -->', ''), /Passkeyen ble ikke godkjent\. Du har 4 forsøk igjen/);
  assert.equal((await l.get('/admin')).status, 303, 'ikke logget inn');

  // Utfordringen er brukt opp: et gyldig svar på den gamle virker ikke (gjentak).
  const replay = await l.post('/logg-inn/kode', { challenge, passkey: JSON.stringify(key.authenticate(first)) }, { from: '/logg-inn' });
  assert.equal(replay.status, 401);

  // Riktig enhet på riktig side.
  const fresh = passkeyOptionsFrom(replay.body);
  assert.notEqual(fresh.challenge, first.challenge);
  const ok = await l.post('/logg-inn/kode', { challenge, passkey: JSON.stringify(key.authenticate(fresh)) }, { from: '/logg-inn' });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/admin');
  assert.equal((await l.get('/admin')).status, 200, 'økten er bekreftet');
  const [cred] = await credentials(admin.user.id);
  assert.ok(cred?.lastUsedAt);
  assert.equal(Number(cred?.counter), key.signCount);
  const alerts = await mails(admin.user.id, 'security_admin_login');
  assert.match(alerts.at(-1)?.textBody ?? '', /Passord og passkey/);
});

test('kopiert nøkkel (telleren går bakover) avvises', async () => {
  const admin = await newAdmin();
  const { key } = await addPasskey(await adminClientFor(server.base, admin));
  const login = async () => {
    const l = new Client(server.base);
    const pw = await l.post('/logg-inn', { email: admin.email, password: admin.password }, { from: '/logg-inn' });
    return l.post('/logg-inn/kode', { challenge: challengeFrom(pw.body), passkey: JSON.stringify(key.authenticate(passkeyOptionsFrom(pw.body))) }, { from: '/logg-inn' });
  };
  key.signCount = 10;
  assert.equal((await login()).status, 303);
  key.signCount = 3; // en kopi med eldre teller
  assert.equal((await login()).status, 401);
});

test('«bekreft at det er deg» med passkey', async () => {
  const admin = await newAdmin();
  const c = await adminClientFor(server.base, admin);
  const { key } = await addPasskey(c);
  await ageMfaVerification(admin.user.id, 13 * 60);
  const stale = await c.get('/admin');
  assert.equal(stale.location, '/konto/bekreft?neste=%2Fadmin');
  const page = await c.get(stale.location!);
  const res = await c.post('/konto/bekreft', { neste: '/admin', passkey: JSON.stringify(key.authenticate(passkeyOptionsFrom(page.body))) }, { csrf: csrfFrom(page.body) });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/admin');
  assert.equal((await c.get('/admin')).status, 200);
});

test('passkey med en annen kontos nøkkel virker ikke', async () => {
  const a = await newAdmin();
  const { key } = await addPasskey(await adminClientFor(server.base, a));
  const b = await newAdmin();
  const l = new Client(server.base);
  const pw = await l.post('/logg-inn', { email: b.email, password: b.password }, { from: '/logg-inn' });
  assert.doesNotMatch(pw.body, /data-passkey-auth/, 'ingen passkey-knapp uten passkeys');
  const res = await l.post('/logg-inn/kode', { challenge: challengeFrom(pw.body), passkey: JSON.stringify(key.authenticate({ challenge: 'AAAA' })) }, { from: '/logg-inn' });
  assert.equal(res.status, 401);
});

test('legge til og fjerne krever bekreftelse de siste 15 minuttene; slå av totrinn fjerner passkeys', async () => {
  const user = await createAccount();
  // Uten totrinn: ingen passkeys.
  const plain = await clientFor(server.base, user);
  const page = await plain.get('/app/innstillinger');
  const noMfa = await plain.request('POST', '/konto/passkey/valg', { headers: { accept: 'application/json', 'x-csrf-token': csrfFrom(page.body)! } });
  assert.equal(noMfa.status, 400);

  await enableTestMfa(user.user.id);
  const c = await clientFor(server.base, user, { mfaVerified: true });
  const { res } = await addPasskey(c);
  assert.equal(res.status, 303);
  const [cred] = await credentials(user.user.id);
  assert.ok(cred);

  await ageMfaVerification(user.user.id, 20);
  assert.doesNotMatch((await c.get('/konto/totrinn')).body, /data-passkey-register/, 'skjemaet vises ikke før ny bekreftelse');
  const blocked = await c.post(`/konto/passkey/${cred.id}/fjern`, {}, { from: '/konto/totrinn', headers: { referer: `${ORIGIN}/konto/totrinn` } });
  assert.equal(blocked.status, 303);
  assert.equal(blocked.location, '/konto/bekreft?neste=%2Fkonto%2Ftotrinn');
  assert.equal((await credentials(user.user.id)).length, 1);

  await c.post('/konto/bekreft', { neste: '/konto/totrinn', code: await testTotpCode(user.user.id) }, { from: '/konto/bekreft' });
  const removed = await c.post(`/konto/passkey/${cred.id}/fjern`, {}, { from: '/konto/totrinn' });
  assert.equal(removed.status, 303);
  assert.equal((await credentials(user.user.id)).length, 0);
  assert.equal((await mails(user.user.id, 'security_passkey_removed')).length, 1);
  // En annen brukers passkey-ID gir 404.
  assert.equal((await c.post(`/konto/passkey/${cred.id}/fjern`, {}, { from: '/konto/totrinn' })).status, 404);

  await addPasskey(c);
  assert.equal((await credentials(user.user.id)).length, 1);
  const off = await c.post('/konto/totrinn/av', { password: user.password, code: await testTotpCode(user.user.id) }, { from: '/konto/totrinn' });
  assert.equal(off.status, 303);
  assert.equal((await credentials(user.user.id)).length, 0, 'passkeys fjernes sammen med totrinn');
  assert.equal((await mails(user.user.id, 'security_mfa_disabled')).length, 1);
});
