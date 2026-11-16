/**
 * Følg en oppdragsgiver uten konto (pakke 3): skjemaet på oppdragsgiversiden, dobbel bekreftelse, ukentlig e-post
 * med nye anbud og kontrakter som snart utløper (uten leverandørnavn, ingen e-post uten nye anbud), avmelding som
 * sletter, grenser mot misbruk, oversikten /oppdragsgivere, lenker fra anbudslistene, varselet i Admin – og at alt
 * forsvinner med PUBLIC_BUYER_PAGES=false.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { adminOverview } from '../../src/domain/admin/overview';
import { addMonths } from '../../src/domain/competitors/expiry';
import { BUYER_CONSENT_VERSION, sendWeeklyNewsletters } from '../../src/domain/newsletter/newsletter';
import { buyerPath, resetBuyerCache } from '../../src/domain/tenders/buyer-page';
import { resetExpiringCache } from '../../src/domain/tenders/expiring';
import { clearMarketCache } from '../../src/domain/tenders/market';
import { Client, csrfFrom, ingest, makeNotice, startServer, uniqueEmail } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const ORG = '923456783'; // Gyldig MOD11 – brukes ikke i andre tester.
const QUIET_ORG = '934567897';
const PLACEHOLDER = '__NEEDS_TRANSLATION_abc1234__'; // Slik TED-dataene av og til skriver et manglende navn.
const PLACEHOLDER_ORG = '945678917';
const NAME = 'Følgeby kommune (følg-test)';
const QUIET = 'Stille kommune (følg-test)';
const PATH = buyerPath(NAME, ORG);
const MONDAY = new Date('2026-11-16T08:00:00Z'); // mandag kl. 09 norsk tid
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const monthDay = (m: number) => addMonths(new Date(), m).toISOString().slice(0, 10);

before(async () => {
  server = await startServer();
  // Møre og Romsdal brukes ikke i andre tester, så fylkessiden viser bare disse anbudene.
  const here = { nutsCodes: ['NO0A3'], placeText: 'Molde', buyerCity: 'Molde' };
  const a = (id: string, title: string, over: Parameters<typeof makeNotice>[0] = {}) =>
    makeNotice({ sourceNoticeId: id, title, buyerName: NAME, buyerOrgNumber: ORG, ...here, ...over });
  await ingest([
    a('FOL-1', 'Brøyting av kommunale veier (følg-test)', { deadlineAt: days(9) }),
    a('FOL-2', 'Drift av svømmehallen (følg-test)', { deadlineAt: days(11) }),
    a('FOL-3', 'Vinduspuss på skolene (følg-test)', { deadlineAt: days(13) }),
    a('FOL-4', 'Kantinedrift på rådhuset (følg-test)', { deadlineAt: days(15) }),
    a('FOL-AW', 'Vakthold ved havna (følg-test)', {
      lifecycle: 'awarded',
      noticeType: 'award',
      details: { contractEnd: monthDay(3) },
      awards: [{ lotTitle: null, supplierName: 'Hemmelig Leverandør AS', supplierOrgNumber: null, value: 2_500_000, currency: 'NOK', awardDate: monthDay(-30) }],
    }),
    makeNotice({ sourceNoticeId: 'FOL-QUIET', title: 'Snørydding i sentrum (følg-test)', buyerName: QUIET, buyerOrgNumber: QUIET_ORG, ...here, deadlineAt: days(10) }),
    makeNotice({ sourceNoticeId: 'FOL-NOORG', title: 'Strøing av fortau (følg-test)', buyerName: 'Uten nummer (følg-test)', buyerOrgNumber: null, ...here, deadlineAt: days(12) }),
    // Nok innhold til å indekseres – men uten et ekte navn.
    ...[1, 2, 3, 4, 5].map((n) =>
      makeNotice({ sourceNoticeId: `FOL-PH-${n}`, title: `Plassholder ${n} (følg-test)`, buyerName: PLACEHOLDER, buyerOrgNumber: PLACEHOLDER_ORG, deadlineAt: days(20 + n) }),
    ),
  ]);
  // Stille kommune har ikke lagt ut noe nytt siste uke.
  await systemSql()`update tenders set first_seen_at = now() - interval '10 days' where title = 'Snørydding i sentrum (følg-test)'`;
  resetBuyerCache();
  resetExpiringCache();
  clearMarketCache();
  await systemSql()`delete from rate_limits where key like 'newsletter%'`;
});

after(async () => {
  mutableEnv.PUBLIC_BUYER_PAGES = true;
  await systemSql()`delete from rate_limits where key like 'newsletter%'`;
  await server.close();
  await closeDb();
});

const clean = (html: string) => html.replaceAll('<!-- -->', '').replaceAll('&amp;', '&');
const page = async (path: string) => {
  const res = await fetch(`${server.base}${path}`, { headers: { 'user-agent': 'Mozilla/5.0 (test)' } });
  return { status: res.status, body: clean(await res.text()) };
};
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

async function follow(c: Client, fields: Record<string, string>, org = ORG) {
  const p = await c.get(PATH);
  return c.post('/ukesbrev', { kilde: PATH, oppdragsgiver: org, ...fields }, { csrf: csrfFrom(p.body) });
}
async function row(email: string) {
  const [r] = (await systemSql()`
    select id, industry, region, authority_id, consent_version, confirmed_at, last_sent_at from newsletter_subscribers where email = ${email}
  `) as unknown as { id: string; industry: string | null; region: string | null; authorityId: string | null; consentVersion: string; confirmedAt: Date | null }[];
  return r;
}
async function mails(email: string, kind: string) {
  return (await systemSql()`select subject, text_body, html, headers from email_outbox where to_email = ${email} and kind = ${kind} order by created_at`) as unknown as {
    subject: string;
    textBody: string;
    html: string;
    headers: Record<string, string>;
  }[];
}
const confirmLink = async (email: string) => /(\/ukesbrev\/bekreft\?id=[^\s]+)/.exec((await mails(email, 'newsletter_confirm'))[0]!.textBody)![1]!;

test('oppdragsgiversiden har skjemaet for å følge uten konto, og knappen øverst går dit', async () => {
  const { status, body } = await page(PATH);
  assert.equal(status, 200);
  assert.match(body, /<form[^>]*id="folg"[^>]*>|<form[^>]*action="\/ukesbrev"[^>]*id="folg"/);
  assert.ok(body.includes(`name="oppdragsgiver" value="${ORG}"`));
  assert.doesNotMatch(body, /name="bransje"/, 'ingen bransje på oppdragsgiversiden');
  const t = text(body);
  assert.match(t, /Følg Følgeby kommune \(følg-test\) på e-post/);
  assert.match(t, /Vanligvis mandag morgen, de ukene det kommer nye anbud herfra – med kontraktene som snart utløper\./);
  assert.match(t, /Adressen brukes bare til disse e-postene\./);
  assert.match(body, /<label for="nl-epost"[^>]*>E-postadresse<\/label>/);
  assert.match(body, /href="#folg"[^>]*>[\s\S]*?Følg på e-post uten konto/);
});

test('påmelding: bekreftelse på e-post, ingen utsending før lenken er trykket, og bekreftelsen viser veien tilbake', async () => {
  const c = new Client(server.base);
  const email = uniqueEmail('folg');
  const res = await follow(c, { email });
  assert.equal(res.status, 200);
  assert.match(clean(res.body), /Sjekk e-posten din/);
  assert.match(text(res.body), /først da får du Ukens anbud: Følgeby kommune \(følg-test\)/);
  const r = await row(email);
  assert.ok(r?.authorityId, 'oppdragsgiveren er lagret');
  assert.equal(r.industry, null);
  assert.equal(r.consentVersion, BUYER_CONSENT_VERSION);
  assert.equal(r.confirmedAt, null);
  const [confirm] = await mails(email, 'newsletter_confirm');
  assert.equal(confirm?.subject, 'Bekreft påmeldingen til Ukens anbud');
  assert.match(confirm!.textBody, /Ukens anbud – Følgeby kommune \(følg-test\) på e-post de ukene det er nye anbud derfra \(vanligvis mandag\), med kontrakter som snart utløper\./);

  await sendWeeklyNewsletters(MONDAY, true);
  assert.equal((await mails(email, 'newsletter_buyer')).length, 0, 'ikke bekreftet: ingen e-post');

  const ok = await c.get(await confirmLink(email));
  assert.equal(ok.status, 200);
  const okText = text(clean(ok.body));
  assert.match(okText, /Du er påmeldt/);
  assert.match(okText, /Du får Ukens anbud – Følgeby kommune \(følg-test\) – de ukene det er nye anbud derfra, vanligvis mandag morgen\./);
  assert.ok(clean(ok.body).includes(`href="${PATH}?utm_source=ukesbrev"`), 'lenke tilbake til oppdragsgiversiden');
  assert.ok((await row(email))?.confirmedAt);
});

test('utsending: nye anbud og kontrakter som snart utløper, uten leverandørnavn, én gang per uke – og ingenting uten nye anbud', async () => {
  const c = new Client(server.base);
  const [busy, quiet] = [uniqueEmail('folg'), uniqueEmail('folg')];
  await follow(c, { email: busy });
  await c.get(await confirmLink(busy));
  await follow(c, { email: quiet }, QUIET_ORG);
  await c.get(await confirmLink(quiet));

  assert.equal(await sendWeeklyNewsletters(new Date('2026-11-17T08:00:00Z')), 0, 'tirsdag: ingenting');
  await sendWeeklyNewsletters(MONDAY);
  const [mail] = await mails(busy, 'newsletter_buyer');
  assert.ok(mail, 'e-posten er lagt i køen');
  assert.match(mail.subject, /^Ukens anbud: Følgeby kommune \(følg-test\) \(uke 47\)$/);
  assert.match(mail.textBody, /4 nye anbud fra Følgeby kommune \(følg-test\) siste uke\./);
  for (const title of ['Brøyting av kommunale veier', 'Drift av svømmehallen', 'Vinduspuss på skolene', 'Kantinedrift på rådhuset']) assert.ok(mail.textBody.includes(title), title);
  assert.ok(mail.textBody.indexOf('Brøyting av kommunale veier') < mail.textBody.indexOf('Kantinedrift på rådhuset'), 'nærmeste frist først');
  assert.match(mail.textBody, /Kontrakter som trolig utløper de neste 12 månedene/);
  assert.match(mail.textBody, /Vakthold ved havna \(følg-test\)\n {2}Utløper ca\. \p{L}+ \d{4} · oppgitt i kunngjøringen/u);
  assert.ok(!mail.textBody.includes('Hemmelig') && !mail.html.includes('Hemmelig'), 'ingen leverandørnavn i e-posten');
  assert.match(mail.textBody, /\/anbud\/[0-9a-f-]{36}\?utm_source=ukesbrev/);
  assert.ok(mail.textBody.includes(`${PATH}?utm_source=ukesbrev`), 'lenke til oppdragsgiversiden');
  assert.match(mail.headers['List-Unsubscribe'] ?? '', /\/ukesbrev\/avmeld\?id=/);
  assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(mail.html, /Slutt å følge Følgeby kommune \(følg-test\)/);

  await sendWeeklyNewsletters(MONDAY);
  assert.equal((await mails(busy, 'newsletter_buyer')).length, 1, 'ikke to ganger samme uke');
  assert.equal((await mails(quiet, 'newsletter_buyer')).length, 0, 'ingen nye anbud: ingen e-post');
});

test('avmelding med ett klikk sletter påmeldingen', async () => {
  const c = new Client(server.base);
  const email = uniqueEmail('folg');
  await follow(c, { email });
  await c.get(await confirmLink(email));
  const id = (await row(email))!.id;
  await systemSql()`update newsletter_subscribers set last_sent_at = null where id = ${id}`;
  await sendWeeklyNewsletters(new Date('2026-11-23T08:00:00Z'), true);
  const [mail] = await mails(email, 'newsletter_buyer');
  const unsub = /<(https?:\/\/[^>]+)>/.exec(mail!.headers['List-Unsubscribe']!)![1]!.replace(/^https?:\/\/[^/]+/, '');
  const view = await c.get(unsub);
  assert.match(text(clean(view.body)), /Følgeby kommune \(følg-test\)/);
  assert.ok(await row(email), 'å åpne lenken melder ikke av');
  const res = await c.request('POST', unsub, { body: 'List-Unsubscribe=One-Click', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 200);
  assert.match(text(clean(res.body)), /Du får ikke lenger Ukens anbud – Følgeby kommune \(følg-test\)\. Vi har slettet adressen din fra listen\./);
  assert.equal(await row(email), undefined, 'adressen er slettet');
});

test('ukjent oppdragsgiver og ugyldig adresse gir feil, robotfellen lagrer ingenting, og grensen per adresse gjelder', async () => {
  await systemSql()`delete from rate_limits where key like 'newsletter%'`;
  const c = new Client(server.base);
  const unknown = uniqueEmail('folg');
  assert.equal((await follow(c, { email: unknown }, '111111111')).status, 422);
  assert.equal(await row(unknown), undefined);
  assert.equal((await follow(c, { email: 'ikke-en-adresse' })).status, 422);
  const bot = uniqueEmail('robot');
  assert.equal((await follow(c, { email: bot, nettside: 'http://spam.example' })).status, 200);
  assert.equal(await row(bot), undefined, 'roboten får samme svar, men ingenting lagres');

  const email = uniqueEmail('folg');
  for (let i = 0; i < 3; i++) assert.equal((await follow(c, { email })).status, 200);
  assert.equal((await mails(email, 'newsletter_confirm')).length, 3, 'ny lenke så lenge den ikke er bekreftet');
  assert.equal((await follow(c, { email })).status, 429, 'høyst tre påmeldinger per adresse i døgnet');
  await systemSql()`delete from rate_limits where key like 'newsletter%'`;
});

test('/oppdragsgivere: bare de med nok innhold, i alfabetisk rekkefølge – i bunnteksten og nettstedskartet', async () => {
  const { status, body } = await page('/oppdragsgivere');
  assert.equal(status, 200);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(body, new RegExp(`href="${PATH}"[^>]*>Følgeby kommune \\(følg-test\\)</a>`));
  assert.ok(!body.includes(buyerPath(QUIET, QUIET_ORG)), 'tynne sider er ikke med');
  assert.match(text(body), /Følgeby kommune \(følg-test\) Molde 4 åpne/);
  assert.match(body, /<h3 id="bokstav-f"/, "bokstavene i hele listen (bak «Vis mer»)");
  assert.doesNotMatch(body, /noindex/);
  assert.ok(body.includes(`<link rel="canonical" href="${new URL(env.APP_URL).origin}/oppdragsgivere"`));
  assert.match((await page('/')).body, /href="\/oppdragsgivere"[^>]*>Oppdragsgivere<\/a>/, 'bunnteksten');
  assert.match(await (await fetch(`${server.base}/sitemap.xml`)).text(), /<loc>[^<]+\/oppdragsgivere<\/loc>/);
  assert.equal((await page('/en/oppdragsgivere')).status, 404, 'bare norsk');
});

test('oppdragsgivere uten ekte navn (plassholdere fra TED) står ikke i oversikten, nettstedskartet eller Google', async () => {
  assert.ok(!(await page('/oppdragsgivere')).body.includes('NEEDS_TRANSLATION'));
  const ph = await page(buyerPath(PLACEHOLDER, PLACEHOLDER_ORG));
  assert.equal(ph.status, 200, 'siden finnes fortsatt');
  assert.match(ph.body, /<meta name="robots" content="noindex/);
  assert.ok(!(await (await fetch(`${server.base}/sitemap.xml`)).text()).includes(`-${PLACEHOLDER_ORG}<`));
});

test('anbudslistene lenker oppdragsgivernavnet til oppdragsgiversiden – når den finnes', async () => {
  const { body } = await page('/fylker/more-og-romsdal');
  assert.match(body, new RegExp(`<a href="${PATH}"[^>]*>Følgeby kommune \\(følg-test\\)</a>`));
  assert.match(body, /href="\/anbud\/[0-9a-f-]{36}"[^>]*>Brøyting av kommunale veier \(følg-test\)<\/a>/, 'tittelen lenker fortsatt til anbudet');
  assert.match(body, /<span class="truncate">Uten nummer \(følg-test\)<\/span>/, 'uten organisasjonsnummer: ingen lenke');
});

test('Admin varsler når e-postlistene nærmer seg dagstaket hos Resend', async () => {
  const has = async () => (await adminOverview()).attention.some((a) => /bekreftede påmeldinger til e-postlistene/.test(a.title));
  const [count] = (await systemSql()`select count(*)::int as n from newsletter_subscribers where confirmed_at is not null`) as unknown as { n: number }[];
  const n = count!.n;
  const add = Math.max(0, 70 - n);
  await systemSql()`
    insert into newsletter_subscribers (email, industry, confirmed_at)
    select 'dagstak-' || g || '@example.com', 'cleaning', now() from generate_series(1, ${add}) g
  `;
  try {
    assert.equal(await has(), true, '70 bekreftede gir varsel');
  } finally {
    await systemSql()`delete from newsletter_subscribers where email like 'dagstak-%@example.com'`;
  }
  if (n < 70) assert.equal(await has(), false, 'under 70: ikke varsel');
});

test('PUBLIC_BUYER_PAGES=false: ingen påmelding, ingen utsending, ingen oversikt og ingen lenker', async () => {
  const c = new Client(server.base);
  const email = uniqueEmail('folg');
  await follow(c, { email });
  await c.get(await confirmLink(email));
  const csrf = csrfFrom((await c.get(PATH)).body);
  mutableEnv.PUBLIC_BUYER_PAGES = false;
  try {
    assert.equal((await c.post('/ukesbrev', { kilde: '/', oppdragsgiver: ORG, email: uniqueEmail('folg') }, { csrf })).status, 404);
    await sendWeeklyNewsletters(new Date('2026-11-30T08:00:00Z'), true);
    assert.equal((await mails(email, 'newsletter_buyer')).length, 0, 'ingen utsending');
    assert.equal((await page('/oppdragsgivere')).status, 404);
    assert.equal((await page(PATH)).status, 404);
    assert.ok(!(await page('/')).body.includes('href="/oppdragsgivere"'));
    assert.ok(!(await page('/fylker/more-og-romsdal')).body.includes('/oppdragsgiver/'), 'ingen lenker fra listene');
    assert.doesNotMatch(await (await fetch(`${server.base}/sitemap.xml`)).text(), /\/oppdragsgivere?[</]/);
  } finally {
    mutableEnv.PUBLIC_BUYER_PAGES = true;
  }
});
