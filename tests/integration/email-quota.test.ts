/**
 * E-postkvoten hos leverandøren (Resends gratisplan: 100 per døgn). Ukesbrevene får høyst 70 % og sendes etter alt
 * annet, så innlogging, bekreftelser og varsler aldri stopper av en stor mandag. Resten venter til det er plass –
 * dagen etter. Brev som har ventet mer enn 6 døgn, sendes ikke. Svar 429 (kvote eller fartsgrense) prøves igjen i
 * omtrent et døgn i stedet for å gi opp etter fem forsøk.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { deliverEmail, deliverPendingEmails, emailsSentLast24h, NEWSLETTER_EXPIRED, queueEmail } from '../../src/lib/email';

const saved = { provider: env.EMAIL_PROVIDER, key: env.RESEND_API_KEY, list: env.EMAIL_ALLOWED_RECIPIENTS, limit: env.EMAIL_DAILY_LIMIT };
const RUN = randomUUID().slice(0, 8);
const MINE = `%-${RUN}@kvotetest-anbudradar.no`;
const addr = (name: string) => `${name}-${RUN}@kvotetest-anbudradar.no`;
const sentTo: string[] = [];
const quotaHit = new Set<string>();
let realFetch: typeof fetch;
let parked: string[] = [];

before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).startsWith('https://api.resend.com/')) return realFetch(input, init);
    const to = (JSON.parse(String(init?.body)).to as string[])[0]!;
    if (quotaHit.has(to)) return new Response(JSON.stringify({ name: 'daily_quota_exceeded', message: 'You have reached your daily email sending quota.' }), { status: 429 });
    sentTo.push(to);
    return new Response(JSON.stringify({ id: `msg-${sentTo.length}` }), { status: 200 });
  }) as typeof fetch;
  Object.assign(env, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-nokkel', EMAIL_ALLOWED_RECIPIENTS: undefined });
  // Utboksen er felles i testdatabasen: e-post som andre testfiler har lagt i kø, venter til denne filen er ferdig.
  parked = (
    (await systemSql()`
      update email_outbox set next_attempt_at = now() + interval '30 days'
      where status = 'pending' and to_email not like ${MINE} returning id
    `) as unknown as { id: string }[]
  ).map((r) => r.id);
});
after(async () => {
  if (parked.length) await systemSql()`update email_outbox set next_attempt_at = now() where id = any(${parked}::uuid[])`;
  globalThis.fetch = realFetch;
  Object.assign(env, { EMAIL_PROVIDER: saved.provider, RESEND_API_KEY: saved.key, EMAIL_ALLOWED_RECIPIENTS: saved.list, EMAIL_DAILY_LIMIT: saved.limit });
  await closeDb();
});

const outbox = async (id: string) =>
  ((await systemSql()`
    select status, last_error, attempts, extract(epoch from next_attempt_at - now()) / 60 as wait_minutes from email_outbox where id = ${id}
  `) as unknown as { status: string; lastError: string | null; attempts: number; waitMinutes: string }[])[0]!;
const letter = (name: string, kind = 'newsletter_weekly') =>
  queueEmail({ to: addr(name), subject: `Ukens anbud (${name})`, html: '<p>Ukens anbud</p>', text: 'Ukens anbud', kind, dedupeKey: `kvote:${RUN}:${name}` });

test('ukesbrevene venter når deres del av døgnkvoten er brukt – passord-e-post går først, og resten sendes dagen etter', async () => {
  // Døgnkvote som gir plass til nøyaktig to ukesbrev etter passord-e-posten, uansett hva andre testfiler har sendt.
  const others = await emailsSentLast24h();
  let limit = 1;
  while (Math.floor((limit * 70) / 100) !== others + 3) limit++;
  env.EMAIL_DAILY_LIMIT = limit;

  const letters = [await letter('brev1'), await letter('brev2', 'newsletter_buyer'), await letter('brev3'), await letter('brev4')];
  await queueEmail({ to: addr('passord'), subject: 'Tilbakestill passordet', html: '<p>Lenke</p>', text: 'Lenke', kind: 'password_reset' });
  await deliverPendingEmails(50);
  assert.deepEqual(sentTo, [addr('passord'), addr('brev1'), addr('brev2')], 'passord-e-posten først, så de to eldste ukesbrevene');
  assert.equal((await outbox(letters[2]!)).status, 'pending');
  assert.equal((await outbox(letters[3]!)).status, 'pending');
  assert.equal((await outbox(letters[3]!)).attempts, 0, 'ventende brev er ikke forsøkt sendt');

  // Samme døgn: fortsatt ikke plass – men annen e-post går som før.
  await queueEmail({ to: addr('bekreft'), subject: 'Bekreft e-postadressen', html: '<p>Lenke</p>', text: 'Lenke', kind: 'verify_email' });
  await deliverPendingEmails(50);
  assert.deepEqual(sentTo.slice(3), [addr('bekreft')]);

  // Et døgn senere teller ikke gårsdagens e-post lenger, og resten av ukesbrevene sendes.
  await systemSql()`update email_outbox set sent_at = sent_at - interval '25 hours' where to_email like ${MINE} and status = 'sent'`;
  await deliverPendingEmails(50);
  assert.deepEqual(sentTo.slice(4), [addr('brev3'), addr('brev4')]);
  assert.equal((await outbox(letters[3]!)).status, 'sent');
});

test('ukesbrev som har ventet mer enn 6 døgn på plass i kvoten, sendes ikke', async () => {
  env.EMAIL_DAILY_LIMIT = 100_000;
  const stale = await letter('gammelt', 'newsletter_buyer');
  const fresh = await letter('nytt');
  await systemSql()`update email_outbox set created_at = now() - interval '7 days' where id = ${stale}`;
  await deliverPendingEmails(50);
  const s = await outbox(stale!);
  assert.equal(s.status, 'failed');
  assert.equal(s.lastError, NEWSLETTER_EXPIRED);
  assert.ok(!sentTo.includes(addr('gammelt')));
  assert.equal((await outbox(fresh!)).status, 'sent');
});

test('svar 429 (kvote eller fartsgrense) prøves igjen i omtrent et døgn – ikke gitt opp etter fem forsøk', async () => {
  const id = (await queueEmail({ to: addr('varsel'), subject: 'Nye treff', html: '<p>Treff</p>', text: 'Treff', kind: 'alert' }))!;
  quotaHit.add(addr('varsel'));
  for (let i = 0; i < 6; i++) {
    await systemSql()`update email_outbox set next_attempt_at = now() where id = ${id}`;
    await deliverEmail(id);
  }
  let s = await outbox(id);
  assert.equal(s.status, 'pending', 'fortsatt i kø etter seks forsøk');
  assert.equal(s.attempts, 6);
  assert.match(s.lastError ?? '', /HTTP 429/);
  assert.ok(Number(s.waitMinutes) > 55 && Number(s.waitMinutes) <= 60, 'høyst en time mellom forsøkene');

  // Når kvoten er tilbake, går den.
  quotaHit.delete(addr('varsel'));
  await systemSql()`update email_outbox set next_attempt_at = now() where id = ${id}`;
  await deliverEmail(id);
  assert.equal((await outbox(id)).status, 'sent');

  // Etter 30 forsøk (omtrent et døgn) gis det opp.
  const late = (await queueEmail({ to: addr('sent-varsel'), subject: 'Nye treff', html: '<p>Treff</p>', text: 'Treff', kind: 'alert' }))!;
  quotaHit.add(addr('sent-varsel'));
  await systemSql()`update email_outbox set attempts = 29 where id = ${late}`;
  await deliverEmail(late);
  s = await outbox(late);
  assert.equal(s.status, 'failed');
  assert.equal(s.attempts, 30);
});
