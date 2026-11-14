/**
 * Ukesbrevet «Ukens anbud»: påmelding uten konto med dobbel bekreftelse, ingen utsending før
 * bekreftelse, utsending mandag med nye anbud (én gang per uke), ettklikks-avmelding som sletter
 * adressen, robotfelle, validering og grense mot misbruk.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { clearMarketCache } from '../../src/domain/tenders/market';
import { sendWeeklyNewsletters } from '../../src/domain/newsletter/newsletter';
import { Client, csrfFrom, ingest, makeNotice, startServer, uniqueEmail } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
// Egne testdata i en kombinasjon andre tester ikke bruker (miljøtjenester i Nordland), med tidlig frist.
const SOON = () => new Date(Date.now() + 2.25 * 86_400_000).toISOString();
before(async () => {
  server = await startServer();
  await ingest([
    makeNotice({ title: 'Avfallshenting Bodø havn (test)', buyerName: 'TESTHELSE MIDT HF', estimatedValue: 4_500_000, cpvCodes: ['90500000'], mainCpv: '90500000', nutsCodes: ['NO071'], placeText: 'Bodø', deadlineAt: SOON() }),
    makeNotice({ title: 'Renovasjon Narvik (test)', buyerName: 'Narviktest (test)', cpvCodes: ['90500000'], mainCpv: '90500000', nutsCodes: ['NO071'], placeText: 'Narvik', deadlineAt: SOON() }),
  ]);
  clearMarketCache();
});
after(async () => {
  await server.close();
  await closeDb();
});

const MONDAY_9 = new Date('2026-11-09T08:00:00Z'); // mandag kl. 09 norsk tid

async function signup(c: Client, fields: Record<string, string>) {
  const page = await c.get('/bransjer/miljotjenester/nordland');
  return c.post('/ukesbrev', { kilde: '/bransjer/miljotjenester/nordland', bransje: 'environmental', fylke: '18', ...fields }, { csrf: csrfFrom(page.body) });
}

async function row(email: string) {
  const [r] = (await systemSql()`select id, confirmed_at, last_sent_at from newsletter_subscribers where email = ${email}`) as unknown as {
    id: string;
    confirmedAt: Date | null;
    lastSentAt: Date | null;
  }[];
  return r;
}

async function mails(email: string, kind: string) {
  return (await systemSql()`select subject, text_body, headers from email_outbox where to_email = ${email} and kind = ${kind} order by created_at`) as unknown as {
    subject: string;
    textBody: string;
    headers: Record<string, string>;
  }[];
}

test('påmelding: skjemaet står på siden, bekreftelse på e-post, ingenting sendes før lenken er trykket', async () => {
  const c = new Client(server.base);
  const page = await c.get('/bransjer/miljotjenester/nordland');
  assert.match(page.body, /action="\/ukesbrev"/);
  assert.match(page.body, /name="bransje" value="environmental"/);
  assert.match(page.body, /name="fylke" value="18"/);

  const email = uniqueEmail('ukesbrev');
  const res = await signup(c, { email });
  assert.equal(res.status, 200);
  assert.match(res.body.replaceAll('<!-- -->', ''), /Sjekk e-posten din/);
  assert.match(res.body, new RegExp(email.replace('.', '\\.')));
  const r = await row(email);
  assert.ok(r, 'påmeldingen er lagret');
  assert.equal(r.confirmedAt, null);
  const [confirmMail] = await mails(email, 'newsletter_confirm');
  assert.equal(confirmMail?.subject, 'Bekreft påmeldingen til Ukens anbud');
  assert.match(confirmMail!.textBody, /Miljøtjenester i Nordland/);

  // Ikke bekreftet: ingen ukesbrev.
  await sendWeeklyNewsletters(MONDAY_9, true);
  assert.equal((await mails(email, 'newsletter_weekly')).length, 0);

  // Endret lenke virker ikke; riktig lenke bekrefter.
  const link = /(\/ukesbrev\/bekreft\?id=[^\s]+)/.exec(confirmMail!.textBody)![1]!;
  assert.equal((await c.get(link.replace(/t=([0-9a-f])/, (_m, ch) => `t=${ch === 'a' ? 'b' : 'a'}`))).status, 400);
  const ok = await c.get(link);
  assert.equal(ok.status, 200);
  assert.match(ok.body, /Du er påmeldt/);
  assert.ok((await row(email))?.confirmedAt);
});

test('utsending: nye anbud mandag, én gang per uke, med avmelding i hver e-post', async () => {
  const c = new Client(server.base);
  const email = uniqueEmail('ukesbrev');
  await signup(c, { email });
  const link = /(\/ukesbrev\/bekreft\?id=[^\s]+)/.exec((await mails(email, 'newsletter_confirm'))[0]!.textBody)![1]!;
  await c.get(link);

  assert.equal(await sendWeeklyNewsletters(new Date('2026-11-10T08:00:00Z')), 0, 'tirsdag: ingenting');
  await sendWeeklyNewsletters(MONDAY_9);
  const [weekly] = await mails(email, 'newsletter_weekly');
  assert.ok(weekly, 'ukesbrevet er lagt i køen');
  assert.match(weekly.subject, /^Ukens anbud: Miljøtjenester i Nordland \(uke \d+\)$/);
  assert.match(weekly.textBody, /Avfallshenting Bodø havn \(test\)/);
  assert.match(weekly.textBody, /Testhelse Midt HF/, 'oppdragsgivere med store bokstaver vises pent');
  assert.match(weekly.textBody, /ca\. 4,5 mill\. kr/);
  assert.match(weekly.textBody, /utm_source=ukesbrev/);
  // Hver sak lenker til vår side for anbudet (krav, risiko, «se om det passer dere») – ikke rett til kilden.
  assert.match(weekly.textBody, /Avfallshenting Bodø havn \(test\)\n[^\n]*\n {2}https?:\/\/[^/\s]+\/anbud\/[0-9a-f-]{36}\?utm_source=ukesbrev/);
  assert.match(weekly.textBody, /Få bare anbudene som passer bedriften/);
  assert.match(weekly.headers['List-Unsubscribe'] ?? '', /\/ukesbrev\/avmeld\?id=/);
  assert.equal(weekly.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok((await row(email))?.lastSentAt);

  await sendWeeklyNewsletters(MONDAY_9);
  assert.equal((await mails(email, 'newsletter_weekly')).length, 1, 'ikke to ganger samme uke');

  // Avmelding: lenken viser en knapp (ingenting slettes ved bare å åpne den) …
  const unsub = /<(https?:\/\/[^>]+)>/.exec(weekly.headers['List-Unsubscribe']!)![1]!.replace(/^https?:\/\/[^/]+/, '');
  const pageRes = await c.get(unsub);
  assert.equal(pageRes.status, 200);
  assert.match(pageRes.body, /Meld meg av/);
  assert.ok(await row(email), 'åpne lenken melder ikke av');
  // … og ettklikks-avmelding fra e-postprogrammet (uten CSRF) sletter adressen.
  const one = await c.request('POST', unsub, { body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(one.status, 200);
  assert.match(one.body, /Du er meldt av/);
  assert.equal(await row(email), undefined, 'adressen er slettet');
});

test('robotfelle, validering, ingen ny bekreftelse til påmeldte, og grense per adresse', async () => {
  const c = new Client(server.base);
  const bot = uniqueEmail('robot');
  const trap = await signup(c, { email: bot, nettside: 'http://spam.example' });
  assert.equal(trap.status, 200, 'roboten ser samme svar');
  assert.equal(await row(bot), undefined, 'men ingenting lagres');
  assert.equal((await mails(bot, 'newsletter_confirm')).length, 0);

  assert.equal((await signup(c, { email: 'ikke-en-adresse' })).status, 422);
  assert.equal((await signup(c, { email: uniqueEmail(), bransje: 'tull' })).status, 422);

  const email = uniqueEmail('ukesbrev');
  await signup(c, { email });
  await c.get(/(\/ukesbrev\/bekreft\?id=[^\s]+)/.exec((await mails(email, 'newsletter_confirm'))[0]!.textBody)![1]!);
  const again = await signup(c, { email });
  assert.equal(again.status, 200, 'samme svar …');
  assert.equal((await mails(email, 'newsletter_confirm')).length, 1, '… men ingen ny bekreftelse til en som allerede er påmeldt');
  const third = await signup(c, { email });
  assert.equal(third.status, 200);
  assert.equal((await signup(c, { email })).status, 429, 'maks tre påmeldinger per adresse i døgnet');
});
