import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { systemSql, closeDb } from '../../src/lib/db';
import { Client, createAccount, csrfFrom, startServer, uniqueEmail } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

async function lastEmail(to: string, kind: string): Promise<{ textBody: string; subject: string }> {
  const rows = (await systemSql()`
    select text_body, subject from email_outbox where to_email = ${to} and kind = ${kind} order by created_at desc limit 1
  `) as unknown as { textBody: string; subject: string }[];
  assert.ok(rows[0], `fant ingen e-post (${kind}) til ${to}`);
  return rows[0];
}

test('registrering, e-postbekreftelse, utlogging og innlogging', async () => {
  const c = new Client(server.base);
  const email = uniqueEmail('reg');
  const password = 'Et-langt-passord-123';

  const reg = await c.post('/registrer', { name: 'Kari Test', email, password, acceptTerms: 'on' }, { from: '/registrer' });
  assert.equal(reg.status, 303);
  assert.equal(reg.location, '/app/onboarding');
  const cookie = reg.headers.getSetCookie().find((h) => h.startsWith('ar_session='));
  assert.ok(cookie, 'sesjonskapsel settes');
  assert.match(cookie!, /HttpOnly/i);
  assert.match(cookie!, /SameSite=Lax/i);

  // Kontoen er ikke bekreftet ennå
  const verifyMail = await lastEmail(email, 'verify_email');
  const token = /token=([A-Za-z0-9_-]+)/.exec(verifyMail.textBody)?.[1];
  assert.ok(token, 'bekreftelseslenken har et token');
  const verify = await c.get(`/bekreft-epost?token=${token}`);
  assert.equal(verify.status, 303);
  const row = (await systemSql()`select email_verified_at from users where email = ${email}`) as unknown as { emailVerifiedAt: Date | null }[];
  assert.ok(row[0]?.emailVerifiedAt);
  // Lenken kan ikke brukes to ganger
  assert.equal((await c.get(`/bekreft-epost?token=${token}`)).status, 400);

  // Utlogging gjør sesjonen ugyldig
  const out = await c.post('/logg-ut', {}, { from: '/app/onboarding' });
  assert.equal(out.status, 303);
  assert.equal((await c.get('/app')).status, 303);

  // Feil passord gir 401 og en nøytral feilmelding
  const bad = await c.post('/logg-inn', { email, password: 'feil-passord-123' }, { from: '/logg-inn' });
  assert.equal(bad.status, 401);
  assert.doesNotMatch(bad.body, /finnes ikke/i, 'avslører ikke om kontoen finnes');

  const ok = await c.post('/logg-inn', { email, password }, { from: '/logg-inn' });
  assert.equal(ok.status, 303);
  assert.equal((await c.get('/app/onboarding')).status, 200);
});

test('svake passord og duplikat e-post avvises', async () => {
  const c = new Client(server.base);
  const weak = await c.post('/registrer', { name: 'A', email: uniqueEmail(), password: 'kort', acceptTerms: 'on' }, { from: '/registrer' });
  assert.equal(weak.status, 422);
  const acc = await createAccount({ profile: false });
  const dup = await c.post('/registrer', { name: 'B', email: acc.email, password: 'Et-langt-passord-123', acceptTerms: 'on' }, { from: '/registrer' });
  assert.equal(dup.status, 422);
});

test('CSRF: skjema uten token eller fra fremmed opprinnelse avvises', async () => {
  const c = new Client(server.base);
  await c.get('/logg-inn');
  const noToken = await c.post('/logg-inn', { email: 'x@example.com', password: 'y' }, { csrf: null });
  assert.equal(noToken.status, 403);
  const page = await c.get('/logg-inn');
  const foreign = await c.request('POST', '/logg-inn', {
    body: new URLSearchParams({ _csrf: csrfFrom(page.body)!, email: 'x@example.com', password: 'y' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
  });
  assert.equal(foreign.status, 403);
});

test('passord kan tilbakestilles, og gamle sesjoner blir ugyldige', async () => {
  const acc = await createAccount({ profile: false });
  const loggedIn = new Client(server.base);
  assert.equal((await loggedIn.post('/logg-inn', { email: acc.email, password: acc.password }, { from: '/logg-inn' })).status, 303);

  const c = new Client(server.base);
  const req = await c.post('/glemt-passord', { email: acc.email }, { from: '/glemt-passord' });
  assert.equal(req.status, 200);
  // Samme svar for ukjent e-post (avslører ikke hvem som har konto)
  const unknown = await c.post('/glemt-passord', { email: uniqueEmail('ukjent') }, { from: '/glemt-passord' });
  assert.equal(unknown.status, 200);

  const mail = await lastEmail(acc.email, 'reset_password');
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.textBody)?.[1];
  assert.ok(token);
  const reset = await c.post('/tilbakestill-passord', { token: token!, password: 'Helt-nytt-passord-456' }, { from: `/tilbakestill-passord?token=${token}` });
  assert.equal(reset.status, 303);

  // Den gamle sesjonen er ikke lenger gyldig
  assert.equal((await loggedIn.get('/app')).status, 303);
  const relog = await c.post('/logg-inn', { email: acc.email, password: 'Helt-nytt-passord-456' }, { from: '/logg-inn' });
  assert.equal(relog.status, 303);
});

test('beskyttede sider krever innlogging, og admin krever plattform-admin', async () => {
  const anon = new Client(server.base);
  const r = await anon.get('/app/anbud');
  assert.equal(r.status, 303);
  assert.match(r.location ?? '', /^\/logg-inn/);
  // Admin-panelet synes ikke for besøkende: ingen innloggingsside, bare «finnes ikke».
  for (const path of ['/admin', '/admin/brukere', '/admin/helse?stripe=1']) {
    const res = await anon.get(path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.body, /logg-inn\?neste=%2Fadmin/);
  }
  assert.doesNotMatch((await anon.get('/robots.txt')).body, /admin/i, 'robots.txt nevner ikke admin');

  const acc = await createAccount();
  const c = new Client(server.base);
  await c.post('/logg-inn', { email: acc.email, password: acc.password }, { from: '/logg-inn' });
  assert.equal((await c.get('/app')).status, 200);
  // Admin-sidene skjules helt for vanlige brukere
  assert.equal((await c.get('/admin')).status, 404);
});

test('sikkerhetshoder på alle sider', async () => {
  const res = await new Client(server.base).get('/');
  const csp = res.headers.get('content-security-policy') ?? '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'nonce-[A-Za-z0-9+/=_-]+'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('referrer-policy'));
  // Ingen hemmeligheter i HTML
  assert.doesNotMatch(res.body, /sk_test_|whsec_|SESSION_SECRET|anbudradar_owner/);
});
