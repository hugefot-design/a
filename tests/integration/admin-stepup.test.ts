/**
 * Strengere admin: ny bekreftelse etter 12 timer, viktige endringer krever bekreftelse de siste
 * 15 minuttene, pause etter mange feil koder (med varsel), e-post ved hver admin-innlogging og
 * «logg ut alle enheter»-lenken.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { revokeAllToken, verifyRevokeAllToken } from '../../src/domain/auth/security';
import { describeDevice } from '../../src/lib/device';
import { adminClientFor, ageMfaVerification, challengeFrom, Client, clientFor, createAccount, csrfFrom, enableTestMfa, makeAdmin, ORIGIN, startServer, testTotpCode } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

async function newAdmin() {
  const acc = await createAccount();
  await makeAdmin(acc.user.id);
  return acc;
}

async function planOf(orgId: string): Promise<string> {
  const [row] = (await systemSql()`select plan from subscriptions where org_id = ${orgId}`) as unknown as { plan: string }[];
  return row!.plan;
}

async function outbox(userId: string, kind: string) {
  return (await systemSql()`select subject, text_body, to_email from email_outbox where user_id = ${userId} and kind = ${kind} order by created_at`) as unknown as {
    subject: string;
    textBody: string;
    toEmail: string;
  }[];
}

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('admin: bekreftet for under 12 timer siden slipper inn, eldre må bekrefte på nytt', async () => {
  const admin = await newAdmin();
  const c = await adminClientFor(server.base, admin);
  assert.equal((await c.get('/admin/brukere')).status, 200);
  await ageMfaVerification(admin.user.id, 11 * 60);
  assert.equal((await c.get('/admin/brukere')).status, 200, '11 timer: fortsatt inne');
  await ageMfaVerification(admin.user.id, 12 * 60 + 5);
  const stale = await c.get('/admin/brukere?q=test');
  assert.equal(stale.status, 303);
  assert.equal(stale.location, '/konto/bekreft?neste=%2Fadmin%2Fbrukere%3Fq%3Dtest');
  const page = await c.get(stale.location!);
  assert.equal(page.status, 200);
  assert.match(page.body, /Bekreft at det er deg/);
  assert.match(page.body, /hver 12\. time/);
  // Feil kode: blir på siden. Riktig kode: tilbake dit administratoren skulle.
  const wrong = await c.post('/konto/bekreft', { neste: '/admin/brukere?q=test', code: '000000' }, { from: stale.location! });
  assert.equal(wrong.status, 401);
  assert.match(wrong.body, /Koden stemmer ikke/);
  const ok = await c.post('/konto/bekreft', { neste: '/admin/brukere?q=test', code: await testTotpCode(admin.user.id) }, { from: stale.location! });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/admin/brukere?q=test');
  assert.equal((await c.get('/admin/brukere')).status, 200);
});

test('bekreftelsessiden sender aldri til et annet nettsted', async () => {
  const admin = await newAdmin();
  const c = await adminClientFor(server.base, admin);
  const res = await c.post('/konto/bekreft', { neste: '//evil.example/x', code: await testTotpCode(admin.user.id) }, { from: '/konto/bekreft' });
  assert.equal(res.status, 303);
  assert.equal(res.location, '/admin');
});

test('viktige endringer krever bekreftelse de siste 15 minuttene; vanlige handlinger gjør ikke', async () => {
  const admin = await newAdmin();
  const customer = await createAccount({ plan: 'starter' });
  const c = await adminClientFor(server.base, admin);
  const orgPage = `/admin/organisasjoner/${customer.orgId}`;
  await ageMfaVerification(admin.user.id, 20);
  const blocked = await c.post(`${orgPage}/plan`, { plan: 'business', note: 'Test', until: '' }, { from: orgPage, headers: { referer: `${ORIGIN}${orgPage}` } });
  assert.equal(blocked.status, 303);
  assert.equal(blocked.location, `/konto/bekreft?neste=${encodeURIComponent(orgPage)}`);
  assert.equal(await planOf(customer.orgId), 'starter', 'planen er ikke endret');
  // Meldingen forklarer hvorfor.
  assert.match((await c.get(blocked.location!)).body, /Bekreft at det er deg før du gjør denne endringen/);

  // En vanlig handling (markere en henvendelse som løst) går fint.
  const [report] = (await systemSql()`insert into reports (kind, name, email, message) values ('contact', 'Test', 'test@example.com', 'Hei (test)') returning id`) as unknown as { id: string }[];
  const resolved = await c.post(`/admin/rapporter/${report!.id}`, {}, { from: '/admin/rapporter' });
  assert.equal(resolved.status, 303);
  assert.equal(resolved.location, '/admin/rapporter');

  // Etter ny bekreftelse virker endringen.
  await c.post('/konto/bekreft', { neste: orgPage, code: await testTotpCode(admin.user.id) }, { from: blocked.location! });
  const done = await c.post(`${orgPage}/plan`, { plan: 'business', note: 'Test', until: '' }, { from: orgPage });
  assert.equal(done.status, 303);
  assert.equal(done.location, orgPage);
  assert.equal(await planOf(customer.orgId), 'business');

  // Endre admin-tilgang og datakilder er også viktige endringer.
  await ageMfaVerification(admin.user.id, 16);
  assert.match((await c.post(`/admin/brukere/${customer.user.id}/admin`, {}, { from: '/admin/brukere' })).location ?? '', /^\/konto\/bekreft/);
  assert.match((await c.post('/admin/kilder/ted', { enabled: '1' }, { from: '/admin/kilder' })).location ?? '', /^\/konto\/bekreft/);
  const [row] = (await systemSql()`select is_platform_admin from users where id = ${customer.user.id}`) as unknown as { isPlatformAdmin: boolean }[];
  assert.equal(row!.isPlatformAdmin, false);
});

test('mange feil koder gir pause for kontoen (også med riktig kode) og et varsel på e-post', async () => {
  const admin = await newAdmin();
  const c = await adminClientFor(server.base, admin);
  for (let i = 0; i < 10; i++) {
    const r = await c.post('/konto/bekreft', { neste: '/admin', code: String(100000 + i) }, { from: '/konto/bekreft' });
    assert.equal(r.status, 401, `forsøk ${i + 1}`);
  }
  const paused = await c.post('/konto/bekreft', { neste: '/admin', code: await testTotpCode(admin.user.id) }, { from: '/konto/bekreft' });
  assert.equal(paused.status, 429);
  assert.match(paused.body, /Vent 15 minutter/);
  // Pausen gjelder kontoen, også ved ny innlogging fra et annet sted.
  const other = new Client(server.base);
  const pw = await other.post('/logg-inn', { email: admin.email, password: admin.password }, { from: '/logg-inn' });
  const login = await other.post('/logg-inn/kode', { challenge: challengeFrom(pw.body), code: await testTotpCode(admin.user.id) }, { from: '/logg-inn' });
  assert.equal(login.status, 429);
  assert.equal((await other.get('/admin')).status, 303, 'ikke logget inn');
  const mails = await outbox(admin.user.id, 'security_mfa_failures');
  assert.equal(mails.length, 1, 'ett varsel, ikke ett per forsøk');
  assert.match(mails[0]!.textBody, /passordet ditt kan være kjent/i);
  assert.match(mails[0]!.textBody, /\/konto\/logg-ut-overalt\?token=/);
});

test('hver innlogging på en administratorkonto gir e-post med tid, enhet og lenke; vanlige brukere får ikke', async () => {
  const admin = await newAdmin();
  const c = new Client(server.base);
  const pw = await c.post('/logg-inn', { email: admin.email, password: admin.password }, { from: '/logg-inn', headers: { 'user-agent': UA_IPHONE } });
  assert.equal(pw.status, 200);
  assert.equal((await outbox(admin.user.id, 'security_admin_login')).length, 0, 'ingen e-post før koden er riktig');
  const res = await c.post('/logg-inn/kode', { challenge: challengeFrom(pw.body), code: await testTotpCode(admin.user.id) }, { from: '/logg-inn', headers: { 'user-agent': UA_IPHONE } });
  assert.equal(res.status, 303);
  const [mail] = await outbox(admin.user.id, 'security_admin_login');
  assert.ok(mail, 'varsel sendt');
  assert.equal(mail.toEmail, admin.email);
  assert.equal(mail.subject, 'Ny innlogging i admin-panelet');
  assert.match(mail.textBody, /Enhet: Safari på iPhone/);
  assert.match(mail.textBody, /Innlogging: Passord og kode fra appen/);
  assert.match(mail.textBody, /Tid: \d{1,2}\. \w+ \d{4}/);
  const token = /logg-ut-overalt\?token=([^\s]+)/.exec(mail.textBody)?.[1];
  assert.ok(token && verifyRevokeAllToken(decodeURIComponent(token)) === admin.user.id);
  // Sesjonen er bekreftet med kode, så admin åpner seg uten ny bekreftelse.
  assert.equal((await c.get('/admin')).status, 200);

  const user = await createAccount();
  await enableTestMfa(user.user.id);
  const u = new Client(server.base);
  const upw = await u.post('/logg-inn', { email: user.email, password: user.password }, { from: '/logg-inn' });
  await u.post('/logg-inn/kode', { challenge: challengeFrom(upw.body), code: await testTotpCode(user.user.id) }, { from: '/logg-inn' });
  assert.equal((await outbox(user.user.id, 'security_admin_login')).length, 0);
});

test('administrator uten totrinn får også varsel ved innlogging', async () => {
  const acc = await createAccount();
  await makeAdmin(acc.user.id, { mfa: false });
  const c = new Client(server.base);
  const res = await c.post('/logg-inn', { email: acc.email, password: acc.password }, { from: '/logg-inn' });
  assert.equal(res.status, 303);
  const [mail] = await outbox(acc.user.id, 'security_admin_login');
  assert.match(mail?.textBody ?? '', /Bare passord – totrinn er ikke satt opp ennå/);
});

test('«logg ut alle enheter»: lenken gjør ingenting før knappen trykkes, så logges alle ut', async () => {
  const admin = await newAdmin();
  const a = await adminClientFor(server.base, admin);
  const b = await adminClientFor(server.base, admin);
  const token = revokeAllToken(admin.user.id);
  const guest = new Client(server.base);
  const page = await guest.get(`/konto/logg-ut-overalt?token=${encodeURIComponent(token)}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Logg ut alle enheter/);
  assert.equal((await a.get('/admin')).status, 200, 'å åpne lenken logger ikke ut');
  const done = await guest.post('/konto/logg-ut-overalt', { token }, { csrf: csrfFrom(page.body) });
  assert.equal(done.status, 200);
  assert.match(done.body.replaceAll('<!-- -->', ''), /2 innlogginger ble avsluttet/);
  assert.equal((await a.get('/admin')).status, 303);
  assert.equal((await b.get('/admin')).status, 303);
  const [log] = (await systemSql()`select metadata from audit_logs where action = 'auth.sessions_revoked' and actor_user_id = ${admin.user.id}`) as unknown as { metadata: { via: string } }[];
  assert.equal(log?.metadata.via, 'email_link');
});

test('ugyldig, endret eller utløpt lenke virker ikke', async () => {
  const acc = await createAccount();
  const keep = await clientFor(server.base, acc);
  const good = revokeAllToken(acc.user.id);
  const tampered = good.replace(/.$/, (ch) => (ch === 'a' ? 'b' : 'a'));
  const otherUser = good.replace(acc.user.id, '00000000-0000-4000-8000-000000000000');
  const expired = revokeAllToken(acc.user.id, Date.now() - 8 * 86_400_000);
  for (const token of ['', 'tull', tampered, otherUser, expired]) {
    const c = new Client(server.base);
    const page = await c.get(`/konto/logg-ut-overalt?token=${encodeURIComponent(token)}`);
    assert.equal(page.status, 400, `GET ${token.slice(0, 12)}`);
    assert.match(page.body, /Lenken virker ikke/);
    const post = await c.post('/konto/logg-ut-overalt', { token }, { from: '/logg-inn' });
    assert.equal(post.status, 400, `POST ${token.slice(0, 12)}`);
  }
  assert.equal((await keep.get('/app')).status, 200, 'ingen ble logget ut');
});

test('skript som krever ny bekreftelse får adressen til bekreftelsessiden', async () => {
  const acc = await createAccount();
  await enableTestMfa(acc.user.id);
  const c = await clientFor(server.base, acc);
  const page = await c.get('/konto/totrinn');
  const res = await c.request('POST', '/konto/passkey/valg', {
    headers: { accept: 'application/json', 'x-csrf-token': csrfFrom(page.body)!, referer: `${ORIGIN}/konto/totrinn` },
  });
  assert.equal(res.status, 403);
  assert.equal(JSON.parse(res.body).stepUp, '/konto/bekreft?neste=%2Fkonto%2Ftotrinn');
});

test('enhetsbeskrivelse fra nettleseren', () => {
  assert.equal(describeDevice(UA_IPHONE).label, 'Safari på iPhone');
  assert.equal(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0').label, 'Edge på Windows');
  assert.equal(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36').label, 'Chrome på Mac');
  assert.equal(describeDevice('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36').label, 'Samsung Internet på Android');
  assert.equal(describeDevice('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0').label, 'Firefox på Linux');
  assert.equal(describeDevice('').label, 'Ukjent enhet');
});
