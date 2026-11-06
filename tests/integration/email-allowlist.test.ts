/**
 * Testperiode: med EMAIL_ALLOWED_RECIPIENTS sendes e-post bare til testmottakere. Andre adresser
 * stoppes før Resend kalles, og utboksen viser hvorfor.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { deliverEmail, queueEmail } from '../../src/lib/email';

const saved = { provider: env.EMAIL_PROVIDER, key: env.RESEND_API_KEY, list: env.EMAIL_ALLOWED_RECIPIENTS };
const sentTo: string[] = [];
let realFetch: typeof fetch;
const RUN = randomUUID().slice(0, 8);
// Fiktive adresser, men ikke på reserverte testdomener (de stoppes alltid, se testen under).
const ALLOWED = `eier-${RUN}@testfirma-anbudradar.no`;
const BLOCKED = `kunde-${RUN}@annenkunde-anbudradar.no`;

before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.resend.com/')) return realFetch(input, init);
    sentTo.push(...(JSON.parse(String(init?.body)).to as string[]));
    return new Response(JSON.stringify({ id: `msg-${sentTo.length}` }), { status: 200 });
  }) as typeof fetch;
  Object.assign(env, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-nokkel', EMAIL_ALLOWED_RECIPIENTS: ALLOWED.toUpperCase() });
});
after(async () => {
  globalThis.fetch = realFetch;
  Object.assign(env, { EMAIL_PROVIDER: saved.provider, RESEND_API_KEY: saved.key, EMAIL_ALLOWED_RECIPIENTS: saved.list });
  await closeDb();
});

const statusOf = async (id: string) =>
  ((await systemSql()`select status, last_error from email_outbox where id = ${id}`) as unknown as { status: string; lastError: string | null }[])[0]!;

test('e-post til testmottaker sendes; til andre stoppes uten kall til Resend', async () => {
  const ok = await queueEmail({ to: ALLOWED, subject: 'Test', html: '<p>Hei</p>', text: 'Hei', kind: 'admin_alert' });
  const blocked = await queueEmail({ to: BLOCKED, subject: 'Test', html: '<p>Hei</p>', text: 'Hei', kind: 'admin_alert' });
  await deliverEmail(ok!);
  await deliverEmail(blocked!);
  assert.deepEqual(sentTo, [ALLOWED], 'bare testmottakeren gikk til Resend');
  assert.equal((await statusOf(ok!)).status, 'sent');
  const b = await statusOf(blocked!);
  assert.equal(b.status, 'failed');
  assert.match(b.lastError ?? '', /testlisten/);
  await deliverEmail(blocked!);
  assert.deepEqual(sentTo, [ALLOWED], 'stoppet e-post prøves ikke på nytt');
});

test('adresser på reserverte testdomener (example.com o.l.) sendes aldri, heller ikke uten testliste', async () => {
  Object.assign(env, { EMAIL_ALLOWED_RECIPIENTS: undefined });
  const before = sentTo.length;
  const id = await queueEmail({ to: `test-${RUN}@example.com`, subject: 'Test', html: '<p>Hei</p>', text: 'Hei', kind: 'admin_alert' });
  await deliverEmail(id!);
  assert.equal(sentTo.length, before, 'Resend ble ikke kalt');
  const s = await statusOf(id!);
  assert.equal(s.status, 'failed');
  assert.match(s.lastError ?? '', /reservert domene/);
  const real = await queueEmail({ to: `kunde-${RUN}@ekte-kunde-anbudradar.no`, subject: 'Test', html: '<p>Hei</p>', text: 'Hei', kind: 'admin_alert' });
  await deliverEmail(real!);
  assert.equal(sentTo.at(-1), `kunde-${RUN}@ekte-kunde-anbudradar.no`, 'uten testliste går vanlige adresser til Resend');
});
