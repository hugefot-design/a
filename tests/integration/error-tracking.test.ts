/**
 * Feilovervåking i appen: en side som krasjer havner i Admin → Feil (gruppert, uten personopplysninger),
 * kan merkes som løst, åpnes igjen når den skjer på nytt, og oppsummeres på e-post til administratoren.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { failJob } from '../../src/lib/jobs';
import { buildRouter } from '../../src/routes';
import { createApp } from '../../src/server/app';
import { adminOverview } from '../../src/domain/admin/overview';
import { applyRetention } from '../../src/domain/ops/tasks';
import { flushErrorTracking, installErrorTracking, resetErrorTrackingThrottle, sendErrorDigest } from '../../src/domain/ops/errors';
import { adminClientFor, clientFor, createAccount, makeAdmin } from '../helpers';

const mutableEnv = env as unknown as Record<string, unknown>;
const savedEnv = { ...env };
let base = '';
let close: () => Promise<void>;
let uninstall: () => void;

const UUID_A = '123e4567-e89b-12d3-a456-426614174000';
const UUID_B = '9f8e7d6c-1111-4222-8333-444455556666';
/** Samme feil hver gang, med ulike personopplysninger og ID-er. */
const crash = (id: string, email = 'kari@firma.no') => fetch(`${base}/test-feil/${id}?e=${encodeURIComponent(email)}`);

before(async () => {
  uninstall = installErrorTracking();
  const router = buildRouter();
  // Testside som krasjer med personopplysninger i feilmeldingen.
  router.get('/test-feil/:id', 'public', async (ctx) => {
    throw new Error(`Kunne ikke lagre kalkylen for ${ctx.query.get('e') ?? 'ukjent'} (${ctx.params.id})`);
  });
  const app = createApp(router);
  const server = createServer((req, res) => void app(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
});

after(async () => {
  uninstall();
  Object.assign(mutableEnv, savedEnv);
  await close();
  await closeDb();
});

beforeEach(async () => {
  resetErrorTrackingThrottle();
  await systemSql()`delete from app_errors`;
});

async function rows() {
  await flushErrorTracking();
  return (await systemSql()`select * from app_errors order by first_seen_at`) as unknown as {
    fingerprint: string;
    source: string;
    message: string;
    context: string | null;
    location: string | null;
    stack: string | null;
    count: number;
    notifiedAt: Date | null;
    resolvedAt: Date | null;
  }[];
}

test('en side som krasjer lagres én gang per feiltype, uten e-post eller ID-er', async () => {
  const anon = await crash(UUID_A, 'kari.nordmann@firma.no');
  assert.equal(anon.status, 500);
  const body = await anon.text();
  assert.ok(!body.includes('kari.nordmann'), 'feilmeldingen vises ikke for brukeren');
  resetErrorTrackingThrottle();
  assert.equal((await crash(UUID_B, 'per@annet.no')).status, 500);

  const r = await rows();
  assert.equal(r.length, 1, 'samme feil med ulike verdier er én gruppe');
  const e = r[0]!;
  assert.equal(e.count, 2);
  assert.equal(e.source, 'request_failed');
  assert.equal(e.context, 'GET /test-feil/:id');
  const all = JSON.stringify(e);
  for (const pii of ['kari.nordmann', 'firma.no', 'per@annet', UUID_A, UUID_B]) assert.ok(!all.includes(pii), `${pii} er ikke lagret`);
  assert.match(e.message, /Kunne ikke lagre kalkylen for \[e-post\]/);
  assert.ok(e.stack && !e.stack.includes('/home/'), 'stakken har bare stier i prosjektet');

  // Mange like feil på kort tid slås sammen (én skriving per 5 sekunder).
  for (let i = 0; i < 5; i++) await crash(UUID_A);
  assert.equal((await rows())[0]!.count, 2, 'sammenslått i minnet, ikke skrevet hver gang');
});

test('Admin → Feil: viser feilen, merk som løst, og feilen åpnes igjen når den skjer på nytt', async () => {
  await crash(UUID_A);
  const [e] = await rows();
  assert.ok(e);

  // Vanlige brukere slipper ikke inn.
  const user = await createAccount();
  const uc = await clientFor(base, user);
  assert.notEqual((await uc.get('/admin/feil')).status, 200);

  const acc = await createAccount();
  await makeAdmin(acc.user.id);
  const c = await adminClientFor(base, acc);
  const page = await c.get('/admin/feil');
  assert.equal(page.status, 200);
  const html = page.body.replaceAll('<!-- -->', '');
  assert.match(html, /Side eller skjema feilet/);
  assert.match(html, /GET \/test-feil\/:id/);
  assert.match(html, /Merk som løst/);
  assert.ok(!html.includes('kari@firma.no'));
  // Systemhelse viser også grunnlaget for å vurdere OCR (dokumenter som ikke kunne leses).
  const health = await c.get('/admin/helse');
  assert.equal(health.status, 200);
  assert.match(health.body.replaceAll('<!-- -->', ''), /Opplastede dokumenter siste 90 dager[\s\S]*Kunne ikke leses/);

  // Ugyldig ID gir 404; riktig ID merker som løst.
  assert.equal((await c.post('/admin/feil/ikke-en-id/lost', {}, { from: '/admin/feil' })).status, 404);
  const res = await c.post(`/admin/feil/${e.fingerprint}/lost`, {}, { from: '/admin/feil' });
  assert.equal(res.status, 303);
  let [after1] = await rows();
  assert.ok(after1!.resolvedAt, 'merket som løst');
  const logged = await systemSql()`select 1 from audit_logs where action = 'admin.error_resolved' and actor_user_id = ${acc.user.id}`;
  assert.equal(logged.length, 1, 'står i revisjonsloggen');

  // Skjer igjen: åpnes, telleren starter på nytt og den varsles igjen.
  await systemSql()`update app_errors set notified_at = now() where fingerprint = ${e.fingerprint}`;
  resetErrorTrackingThrottle();
  await crash(UUID_B, 'per@annet.no');
  const reopened = await rows();
  assert.equal(reopened.length, 1, 'samme gruppe, ikke en ny rad');
  after1 = reopened[0];
  assert.equal(after1!.resolvedAt, null);
  assert.equal(after1!.count, 1);
  assert.equal(after1!.notifiedAt, null);

  // Merk alle som løst.
  const all = await c.post('/admin/feil/lost-alle', {}, { from: '/admin/feil' });
  assert.equal(all.status, 303);
  assert.ok((await rows()).every((x) => x.resolvedAt));
});

test('e-postoppsummering: én e-post med nye feil, ikke igjen før noe nytt skjer', async () => {
  mutableEnv.ADMIN_NOTIFICATION_EMAIL = 'drift@example.test';
  await crash(UUID_A);
  // Siste forsøk av en bakgrunnsjobb er også en feil.
  await failJob({ id: UUID_B, kind: 'send_emails', payload: {}, attempts: 3, maxAttempts: 3 } as unknown as Parameters<typeof failJob>[0], 'Resend svarte 500 for ola@firma.no');
  const r = await rows();
  assert.equal(r.length, 2);
  const job = r.find((x) => x.source === 'job_failed')!;
  assert.equal(job.context, 'jobb: send_emails');
  assert.equal(job.message, 'Resend svarte 500 for [e-post]');

  const first = await sendErrorDigest();
  assert.deepEqual(first, { sent: true, errors: 2 });
  const mails = (await systemSql()`
    select to_email, subject, text_body from email_outbox where kind = 'admin_alert' and dedupe_key like 'error-digest:%' order by created_at desc limit 1
  `) as unknown as { toEmail: string; subject: string; textBody: string }[];
  const mail = mails[0]!;
  assert.equal(mail.toEmail, 'drift@example.test');
  assert.match(mail.subject, /2 nye feil i appen/);
  assert.match(mail.textBody, /\/admin\/feil/);
  assert.ok(!mail.textBody.includes('kari@firma.no') && !mail.textBody.includes('ola@firma.no'), 'ingen e-postadresser i e-posten');

  // Ingenting nytt: ingen ny e-post. Feil som fortsetter, varsles høyst én gang i døgnet.
  assert.deepEqual(await sendErrorDigest(), { sent: false, errors: 0 });
  resetErrorTrackingThrottle();
  await crash(UUID_B, 'per@annet.no');
  await flushErrorTracking();
  assert.deepEqual(await sendErrorDigest(), { sent: false, errors: 0 }, 'samme feil igjen innen et døgn gir ikke ny e-post');
  await systemSql()`update app_errors set notified_at = now() - interval '25 hours'`;
  resetErrorTrackingThrottle();
  await crash(UUID_A);
  await flushErrorTracking();
  const again = await sendErrorDigest();
  assert.equal(again.sent, true, 'feil som fortsatt skjer etter et døgn, varsles igjen');

  // Uten adresse sendes ingenting (feilene vises bare i admin).
  mutableEnv.ADMIN_NOTIFICATION_EMAIL = undefined;
  await systemSql()`update app_errors set notified_at = null`;
  assert.deepEqual(await sendErrorDigest(), { sent: false, errors: 0 });
});

test('oversikten i admin varsler om feil siste døgn, og gamle løste feil slettes', async () => {
  await crash(UUID_A);
  await flushErrorTracking();
  const o = await adminOverview();
  const item = o.attention.find((a) => a.href === '/admin/feil');
  assert.ok(item, 'varsel i oversikten');
  assert.equal(item!.tone, 'feil');

  await systemSql()`
    insert into app_errors (fingerprint, source, name, message, count, first_seen_at, last_seen_at, resolved_at) values
      ('a0000000000000000000000000000001', 'test', 'Error', 'gammel løst', 1, now() - interval '200 days', now() - interval '100 days', now() - interval '95 days'),
      ('a0000000000000000000000000000002', 'test', 'Error', 'gammel åpen', 1, now() - interval '300 days', now() - interval '190 days', null),
      ('a0000000000000000000000000000003', 'test', 'Error', 'nylig løst', 1, now() - interval '20 days', now() - interval '10 days', now() - interval '5 days')
  `;
  await applyRetention();
  const left = ((await systemSql()`select message from app_errors where source = 'test'`) as unknown as { message: string }[]).map((x) => x.message);
  assert.deepEqual(left, ['nylig løst']);
});
