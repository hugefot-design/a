/**
 * Sikkerhetsgjennomgang november 2026 – rettinger med tester:
 * - invitasjoner kan ikke brukes til søppelpost (grense per mottaker, per bruker og per organisasjon),
 * - passordsjekk i innstillingene har forsøksgrense (stjålet økt kan ikke prøve mange passord),
 * - viktige kontohandlinger krever ny bekreftelse for brukere med totrinn (eksport, sletting, passord, team),
 * - filtypen på tilbudsdokumenter bestemmes av serveren, ikke av nettleseren.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { INVITES_PER_RECIPIENT_PER_DAY, INVITES_PER_USER_PER_HOUR } from '../../src/domain/org/org';
import { clientFor, createAccount, enableTestMfa, ingest, makeNotice, startServer, tenderIdFor, testTotpCode, uniqueEmail } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const TEAM = '/app/innstillinger?fane=team';
const flashText = async (c: Awaited<ReturnType<typeof clientFor>>, path: string) => (await c.get(path)).body.replaceAll('<!-- -->', '');

async function outboxCount(email: string): Promise<number> {
  const [row] = (await systemSql()`select count(*)::int as n from email_outbox where to_email = ${email} and kind = 'invitation'`) as unknown as { n: number }[];
  return row?.n ?? 0;
}

test('invitasjoner: samme mottaker får høyst tre e-poster i døgnet, og én bruker høyst ti i timen', async () => {
  const owner = await createAccount();
  const c = await clientFor(server.base, owner);
  const victim = uniqueEmail('mottaker');
  for (let i = 0; i < INVITES_PER_RECIPIENT_PER_DAY; i++) {
    const r = await c.post('/app/team/inviter', { email: victim, role: 'member' }, { from: TEAM });
    assert.equal(r.status, 303);
    assert.match(await flashText(c, r.location!), /Invitasjonen er sendt/, `invitasjon ${i + 1}`);
  }
  const blocked = await c.post('/app/team/inviter', { email: victim, role: 'member' }, { from: TEAM });
  assert.match(await flashText(c, blocked.location!), /For mange invitasjoner på kort tid/);
  assert.equal(await outboxCount(victim), INVITES_PER_RECIPIENT_PER_DAY, 'ingen ekstra e-post');

  // Inviter – trekk tilbake – inviter en ny adresse: stopper etter grensen per bruker. Alle forsøk teller,
  // også det som ble stoppet over (ellers kunne man prøve uendelig).
  let attempts = INVITES_PER_RECIPIENT_PER_DAY + 1;
  let blockedAt: number | null = null;
  for (let i = 0; i < INVITES_PER_USER_PER_HOUR; i++) {
    await systemSql()`update invitations set revoked_at = now() where org_id = ${owner.orgId} and revoked_at is null and accepted_at is null`;
    attempts++;
    const r = await c.post('/app/team/inviter', { email: uniqueEmail('syklus'), role: 'member' }, { from: TEAM });
    if (/For mange invitasjoner/.test(await flashText(c, r.location!))) {
      blockedAt = attempts;
      break;
    }
  }
  assert.equal(blockedAt, INVITES_PER_USER_PER_HOUR + 1, 'forsøk nummer elleve i timen stoppes');
});

test('passordsjekk i innstillingene: ti feil i timen, så stopp (også med riktig passord)', async () => {
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  for (let i = 0; i < 10; i++) {
    const r = await c.post('/app/innstillinger/passord', { currentPassword: `feil-${i}-passord`, newPassword: 'Et-nytt-sterkt-passord-1' });
    assert.equal(r.status, 422);
    assert.match(r.body, /Nåværende passord er feil/);
  }
  const r = await c.post('/app/innstillinger/passord', { currentPassword: acc.password, newPassword: 'Et-nytt-sterkt-passord-1' });
  assert.equal(r.status, 422);
  assert.match(r.body, /For mange forsøk/);
  // Sletting av konto bruker samme grense.
  const del = await c.post('/app/innstillinger/slett-konto', { password: acc.password }, { from: '/app/innstillinger?fane=personvern' });
  assert.equal(del.status, 422);
  assert.ok((await systemSql()`select 1 from users where id = ${acc.user.id}`).length, 'kontoen finnes fortsatt');
});

test('viktige kontohandlinger krever ny bekreftelse for brukere med totrinn – uten ekstra steg for andre', async () => {
  const plain = await createAccount();
  const p = await clientFor(server.base, plain);
  const plainExport = await p.get('/app/innstillinger/eksport');
  assert.equal(plainExport.status, 200, 'uten totrinn: rett til eksporten');
  assert.match(plainExport.headers.get('content-disposition') ?? '', /attachment/);

  const acc = await createAccount();
  await enableTestMfa(acc.user.id);
  const c = await clientFor(server.base, acc); // økt uten nylig bekreftelse
  const exp = await c.get('/app/innstillinger/eksport');
  assert.equal(exp.status, 303);
  assert.equal(exp.location, '/konto/bekreft?neste=%2Fapp%2Finnstillinger%2Feksport');
  const del = await c.post('/app/innstillinger/slett-organisasjon', { confirmName: `Testorg ${acc.email}` }, { from: '/app/innstillinger?fane=personvern' });
  assert.equal(del.status, 303);
  assert.match(del.location ?? '', /^\/konto\/bekreft/);
  assert.ok((await systemSql()`select 1 from organizations where id = ${acc.orgId}`).length, 'organisasjonen finnes fortsatt');
  const invite = await c.post('/app/team/inviter', { email: uniqueEmail(), role: 'admin' }, { from: TEAM });
  assert.match(invite.location ?? '', /^\/konto\/bekreft/, 'å gi andre tilgang krever bekreftelse');

  await c.post('/konto/bekreft', { neste: '/app/innstillinger/eksport', code: await testTotpCode(acc.user.id) }, { from: '/konto/bekreft' });
  const ok = await c.get('/app/innstillinger/eksport');
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).account.id, acc.user.id);
});

test('tilbudsdokumenter: filtypen settes av serveren og filen lastes alltid ned', async () => {
  const acc = await createAccount({ plan: 'business' }); // tilbudsarbeid er i Bedrift
  const notice = makeNotice();
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const c = await clientFor(server.base, acc);
  const ws = await c.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` });
  const workspaceId = ws.location!.split('/').pop()!;

  const form = new FormData();
  form.append('file', new File(['<script>alert(1)</script>'], 'notat.txt', { type: 'text/html' }));
  form.append('category', 'vedlegg');
  const up = await c.postMultipart(`/app/tilbud/${workspaceId}/dokumenter`, form, `/app/tilbud/${workspaceId}`);
  assert.equal(up.status, 303);
  const [doc] = (await systemSql()`select id, mime_type from bid_documents where workspace_id = ${workspaceId}`) as unknown as { id: string; mimeType: string }[];
  assert.equal(doc?.mimeType, 'text/plain; charset=utf-8', 'ikke typen nettleseren oppga');
  const dl = await c.get(`/app/tilbud/${workspaceId}/dokumenter/${doc!.id}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.match(dl.headers.get('content-disposition') ?? '', /^attachment;/);
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');

  const html = new FormData();
  html.append('file', new File(['<h1>hei</h1>'], 'side.html', { type: 'text/html' }));
  const bad = await c.postMultipart(`/app/tilbud/${workspaceId}/dokumenter`, html, `/app/tilbud/${workspaceId}`);
  assert.match(await flashText(c, bad.location!), /Filtypen støttes ikke/);
});

test('planlagte jobber: feil nøkkel gir 401, og mange forsøk fra samme sted stoppes', async () => {
  const c = new (await import('../helpers')).Client(server.base);
  const tries = async () => c.request('POST', '/api/cron/retention', { headers: { authorization: 'Bearer feil-nokkel' } });
  for (let i = 0; i < 20; i++) assert.equal((await tries()).status, 401);
  assert.equal((await tries()).status, 429);
});
