/**
 * Tildelingssimulatoren (/tildeling): vekten på pris, prisene og kvalitetspoengene inn – hvem som vinner og prisen der
 * to tilbud står likt ut, med DFØs to prismodeller og utregningen vist. Knyttet til et anbud fylles vekten på pris inn
 * fra kunngjøringen (merket). Ingenting lagres, grense per besøkende, og PUBLIC_TOOLS=false fjerner alt.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { resetPublicTenderCache } from '../../src/domain/tenders/public-page';
import { Client, clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const ids = { weights: '', noWeights: '', none: '' };

before(async () => {
  server = await startServer();
  const open = (sourceNoticeId: string, title: string, awardCriteria?: { name: string; type: string | null; weight: string | null }[]) =>
    makeNotice({ sourceNoticeId, title, description: `${title}. Fiktiv kunngjøring for automatiske tester.`, ...(awardCriteria ? { details: { awardCriteria } } : {}) });
  await ingest([
    open('SIM-W', 'Drift av svømmehall (tildeling-test)', [
      { name: 'Pris', type: 'price', weight: '30 %' },
      { name: 'Kvalitet', type: 'quality', weight: '40 %' },
      { name: 'Miljø', type: 'quality', weight: '30 %' },
    ]),
    open('SIM-NOW', 'Drift av idrettshall uten vekter (tildeling-test)', [
      { name: 'Pris', type: 'price', weight: null },
      { name: 'Kvalitet', type: 'quality', weight: null },
    ]),
    open('SIM-NONE', 'Drift av kunstgress uten kriterier (tildeling-test)'),
  ]);
  [ids.weights, ids.noWeights, ids.none] = await Promise.all([tenderIdFor('manual', 'SIM-W'), tenderIdFor('manual', 'SIM-NOW'), tenderIdFor('manual', 'SIM-NONE')]);
  resetPublicTenderCache();
  await systemSql()`delete from rate_limits where key like 'tildeling:%'`;
});

after(async () => {
  mutableEnv.PUBLIC_TOOLS = true;
  mutableEnv.PUBLIC_TENDER_PAGES = true;
  await systemSql()`delete from rate_limits where key like 'tildeling:%'`;
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
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

/** Radioknappen for prismodellen som er valgt (React kan skrive attributtene i en annen rekkefølge). */
const checkedRadio = (value: string) => new RegExp(`<input(?=[^>]*name="model")(?=[^>]*value="${value}")(?=[^>]*checked="")[^>]*>`);
const NUMBERS = { model: 'forholdsmessig', pricePct: '30', ourPrice: '1 100 000', ourQuality: '8', theirPrice: '1 000 000', theirQuality: '6' };
const stored = async () => {
  const [row] = (await systemSql()`
    select (select count(*) from tender_calculations)::int as calcs, (select count(*) from audit_logs)::int as audits, (select count(*) from reports)::int as reports,
           (select count(*) from users)::int as users, (select count(*) from bookmarks)::int as bookmarks
  `) as unknown as Record<string, number>[];
  return row!;
};

test('/tildeling: skjemaet vises uten konto, med etiketter på alle felt, og indekseres', async () => {
  const { status, body } = await page('/tildeling');
  assert.equal(status, 200);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(body, /Hvor mye dyrere kan dere være\?/);
  assert.match(body, /<form[^>]*action="\/tildeling"/);
  for (const id of ['pricePct', 'ourPrice', 'ourQuality', 'theirPrice', 'theirQuality']) assert.match(body, new RegExp(`<label for="${id}"`), id);
  assert.match(body, /<legend[^>]*>Prismodell<\/legend>/);
  assert.match(body, checkedRadio('forholdsmessig'), 'forholdsmessig er valgt fra start');
  assert.match(body, /<input(?=[^>]*type="radio")(?=[^>]*value="lineaer")[^>]*>/);
  assert.doesNotMatch(body, checkedRadio('lineaer'));
  assert.match(body, /<legend[^>]*>Konkurrenten – deres antakelser<\/legend>/);
  assert.match(body, /Dette får dere svar på/);
  assert.doesNotMatch(body, /noindex/);
  assert.ok(body.includes(`<link rel="canonical" href="${new URL(env.APP_URL).origin}/tildeling"`));
  assert.doesNotMatch(body, /id="resultat"/);
});

test('/tildeling regner forholdsmessig: hvem som vinner, prisen der de står likt, og utregningen – og lagrer ingenting', async () => {
  const before = await stored();
  const c = new Client(server.base);
  const res = await c.post('/tildeling', NUMBERS, { from: '/tildeling' });
  assert.equal(res.status, 200);
  const t = text(res.body);
  // 10 × 1 000 000 ÷ 1 100 000 = 9,09 prispoeng → 9,09 × 30 % + 8 × 70 % = 8,33 mot 10 × 30 % + 6 × 70 % = 7,20.
  assert.match(t, /Med disse tallene vinner dere med 1,13 poeng\./);
  assert.match(t, /Dere 8,33 poeng 1 100 000 kr · prispoeng 9,09 · kvalitet 8,00/);
  assert.match(t, /Konkurrenten \(antakelse\) 7,20 poeng 1 000 000 kr · prispoeng 10,00 · kvalitet 6,00/);
  // Forspranget 2 × 70 % ÷ 30 % = 4,67 prispoeng → 10 × 1 000 000 ÷ P = 5,33 → P = 1 875 000.
  assert.match(t, /Prisen der dere står likt 1 875 000 kr Så mye kan dere by og fortsatt stå likt – 87,5 % over konkurrentens antatte pris\./);
  assert.match(t, /Ett kvalitetspoeng mer \(til 9\) flytter likt-prisen fra 1 875 000 kr til 3 333 333 kr: 1 458 333 kr mer å gå på\./);
  assert.match(t, /Slik er det regnet Laveste pris: den laveste av 1 100 000 kr og 1 000 000 kr 1 000 000 kr/);
  assert.match(t, /Prispoeng, dere: 10 × 1 000 000 kr ÷ 1 100 000 kr 9,09/);
  assert.match(t, /Sum, dere: 9,09 × 30 % \+ 8,00 × 70 % 8,33/);
  assert.match(t, /Kontroll: ved 1 875 000 kr blir summen 7,20 for dere og 7,20 for konkurrenten likt/);
  assert.ok(res.body.includes('href="https://www.anskaffelser.no/veileder-i-evaluering-av-tilbud/regne-om-pris-til-poeng"'), 'kilden');
  assert.match(t, /Konkurrentens pris og poeng er deres egne antakelser\. Simulatoren vet ikke hva andre byr\./);
  // Videre til lønnsomhetssjekken, og tallene står igjen i skjemaet.
  assert.match(res.body, /href="\/kalkulator"[^>]*>Til lønnsomhetssjekken/);
  assert.match(res.body, /name="ourPrice"[^>]*value="1 100 000"/);
  assert.deepEqual(await stored(), before, 'ingenting er lagret');
});

test('/tildeling regner lineært: lavere likt-pris, og hvert kvalitetspoeng er verdt det samme', async () => {
  const c = new Client(server.base);
  const res = await c.post('/tildeling', { ...NUMBERS, model: 'lineaer' }, { from: '/tildeling' });
  assert.equal(res.status, 200);
  const t = text(res.body);
  // 10 − 10 × 100 000 ÷ 1 000 000 = 9 → 8,30. Likt: 1 000 000 × (1 + 4,67 ÷ 10) = 1 466 667.
  assert.match(t, /vinner dere med 1,10 poeng/);
  assert.match(t, /1 466 667 kr Så mye kan dere by/);
  assert.match(t, /233 333 kr mer å gå på/);
  assert.match(t, /Prispoeng, dere: 10 − 10 × \(1 100 000 kr − 1 000 000 kr\) ÷ 1 000 000 kr 9,00/);
  assert.match(res.body, checkedRadio('lineaer'), 'valgt modell står igjen');
});

test('/tildeling: dårligere kvalitet viser hvor lavt dere må by, og forholdsmessig kan gi «aldri på pris»', async () => {
  const c = new Client(server.base);
  const lower = text((await c.post('/tildeling', { ...NUMBERS, ourQuality: '5', theirQuality: '7', pricePct: '40', ourPrice: '1 500 000', theirPrice: '2 000 000' }, { from: '/tildeling' })).body);
  assert.match(lower, /taper dere med 0,20 poeng/);
  assert.match(lower, /1 400 000 kr Så lavt må dere by for å stå likt – 30 % under konkurrentens antatte pris\./);
  const never = text((await c.post('/tildeling', { ...NUMBERS, pricePct: '20', ourQuality: '5', theirQuality: '10' }, { from: '/tildeling' })).body);
  assert.match(never, /kan dere ikke ta igjen konkurrentens kvalitetsforsprang på pris/);
  assert.doesNotMatch(never, /mer å gå på/);
});

test('/tildeling: ugyldige tall gir feil per felt – ingenting regnes', async () => {
  const c = new Client(server.base);
  const res = await c.post('/tildeling', { ...NUMBERS, pricePct: '0', ourPrice: 'mye', theirQuality: '12' }, { from: '/tildeling' });
  assert.equal(res.status, 422);
  const body = clean(res.body);
  assert.match(body, /Vekt på pris: må være over 0 og høyst 100\./);
  assert.match(body, /Deres pris: skriv et tall\./);
  assert.match(body, /Konkurrentens kvalitetspoeng: må være mellom 0 og 10\./);
  assert.match(body, /id="ourPrice"[^>]*aria-invalid="true"[^>]*aria-describedby="ourPrice-error"|aria-invalid="true" aria-describedby="ourPrice-error"[^>]*id="ourPrice"/);
  assert.doesNotMatch(body, /id="resultat"/);
  assert.match(body, /name="ourPrice"[^>]*value="mye"/, 'det som ble skrevet, står igjen');
});

test('/tildeling for et anbud: vekten på pris fylles inn fra kunngjøringen og merkes', async () => {
  const get = await page(`/tildeling?anbud=${ids.weights}`);
  assert.equal(get.status, 200);
  assert.match(get.body, /<meta name="robots" content="noindex/);
  assert.ok(get.body.includes(`action="/tildeling?anbud=${ids.weights}"`));
  const t = text(get.body);
  assert.match(t, /Anbudet dere regner på Drift av svømmehall \(tildeling-test\)/);
  assert.match(t, /Tildelingskriterier fra kunngjøringen Pris 30 % Kvalitet 40 % Miljø 30 %/);
  assert.match(get.body, /name="pricePct"[^>]*value="30"/);
  assert.match(t, /Vekt på pris \(%\) Fra kunngjøringen/);
  // Beholdes vekten, står merket; endres den, er det brukerens eget tall.
  const c = new Client(server.base);
  const path = `/tildeling?anbud=${ids.weights}`;
  const kept = await c.post(path, NUMBERS, { from: path });
  assert.equal(kept.status, 200);
  assert.match(text(kept.body), /Vekt på pris \(%\) Fra kunngjøringen/);
  assert.ok(kept.body.includes(`href="/kalkulator?anbud=${ids.weights}"`), 'videre til lønnsomhetssjekken for samme anbud');
  const changed = await c.post(path, { ...NUMBERS, pricePct: '40' }, { from: path });
  assert.doesNotMatch(text(changed.body), /Fra kunngjøringen/);
});

test('/tildeling: uten sikre vekter fylles ingenting inn, og ukjente anbud gir vanlig simulator', async () => {
  const none = await page(`/tildeling?anbud=${ids.noWeights}`);
  assert.match(text(none.body), /Kunngjøringen har ikke vekter vi kan lese sikkert\./);
  assert.match(none.body, /name="pricePct"[^>]*value=""/);
  for (const p of [`/tildeling?anbud=${randomUUID()}`, '/tildeling?anbud=ikke-en-id']) {
    const r = await page(p);
    assert.equal(r.status, 200, p);
    assert.doesNotMatch(r.body, /Anbudet dere regner på/);
  }
  assert.equal((await page('/en/tildeling')).status, 404, 'bare norsk');
});

test('lenker: anbudssiden (offentlig og i appen), kalkulatoren, metodesiden, bunnteksten og nettstedskartet', async () => {
  const pub = await page(`/anbud/${ids.weights}`);
  const pt = text(pub.body);
  assert.match(pt, /Slik velges vinneren Tildelingskriteriene og vektene fra kunngjøringen\. Fakta – står ordrett i kunngjøringen Pris 30 % Kvalitet 40 % Miljø 30 %/);
  assert.ok(pub.body.includes(`href="/tildeling?anbud=${ids.weights}"`));
  // Uten vekter vises verken boksen eller lenken.
  for (const id of [ids.noWeights, ids.none]) {
    const b = (await page(`/anbud/${id}`)).body;
    assert.doesNotMatch(b, /Slik velges vinneren/);
    assert.ok(!b.includes('/tildeling?anbud='), id);
  }
  // I appen står kriteriene fra kunngjøringen i faktalisten, med lenke.
  const app = await clientFor(server.base, await createAccount());
  const inApp = (await app.get(`/app/anbud/${ids.weights}`)).body;
  assert.match(text(inApp), /Tildelingskriterier Pris – 30 % Kvalitet – 40 % Miljø – 30 %/);
  assert.ok(clean(inApp).includes(`href="/tildeling?anbud=${ids.weights}"`));
  const noWeightsInApp = text((await app.get(`/app/anbud/${ids.noWeights}`)).body);
  assert.match(noWeightsInApp, /Tildelingskriterier Pris Kvalitet Regn på vektene/, 'kriteriene uten vekt, og lenken (vektene skrives inn selv)');
  assert.doesNotMatch(text((await app.get(`/app/anbud/${ids.none}`)).body), /Regn på vektene/);
  // Kalkulatoren, metodesiden, bunnteksten og nettstedskartet.
  assert.match((await page('/kalkulator')).body, /href="\/tildeling"[^>]*>tildelingssimulatoren/);
  const method = await page('/metode');
  assert.match(method.body, /<details id="tildeling"/, "temaet (sammenfoldet) har samme id");
  assert.match(text(method.body), /Forholdsmessig 10 × laveste pris ÷ tilbudets pris\. Ingen får 0 eller minuspoeng\./);
  assert.ok(method.body.includes('href="https://www.anskaffelser.no/veileder-i-evaluering-av-tilbud/regne-om-pris-til-poeng"'));
  assert.match(method.body, /href="\/tildeling"[^>]*>Prøv tildelingssimulatoren/);
  assert.match((await page('/')).body, /href="\/tildeling"[^>]*>Tildelingssimulator<\/a>/, 'bunnteksten');
  assert.match(await (await fetch(`${server.base}/sitemap.xml`)).text(), /<loc>[^<]+\/tildeling<\/loc>/);
});

test('/tildeling begrenses per besøkende', async () => {
  const c = new Client(server.base);
  assert.equal((await c.post('/tildeling', NUMBERS, { from: '/tildeling' })).status, 200);
  await systemSql()`update rate_limits set count = 60 where key like 'tildeling:%'`;
  assert.equal((await c.post('/tildeling', NUMBERS, { from: '/tildeling' })).status, 429);
  await systemSql()`delete from rate_limits where key like 'tildeling:%'`;
});

test('PUBLIC_TOOLS=false: simulatoren og lenkene finnes ikke', async () => {
  const c = new Client(server.base);
  mutableEnv.PUBLIC_TOOLS = false;
  try {
    assert.equal((await page('/tildeling')).status, 404);
    assert.equal((await page(`/tildeling?anbud=${ids.weights}`)).status, 404);
    assert.equal((await c.post('/tildeling', NUMBERS, { from: '/logg-inn' })).status, 404);
    const pub = (await page(`/anbud/${ids.weights}`)).body;
    assert.match(pub, /Slik velges vinneren/, 'vektene er fakta og vises fortsatt');
    assert.ok(!pub.includes('/tildeling'), 'men uten lenke');
    assert.ok(!(await page('/')).body.includes('href="/tildeling"'));
    assert.ok(!(await page('/metode')).body.includes('href="/tildeling"'));
    const app = await clientFor(server.base, await createAccount());
    assert.ok(!(await app.get(`/app/anbud/${ids.weights}`)).body.includes('/tildeling'));
    assert.doesNotMatch(await (await fetch(`${server.base}/sitemap.xml`)).text(), /\/tildeling</);
  } finally {
    mutableEnv.PUBLIC_TOOLS = true;
  }
});

test('uten offentlige anbudssider henter ikke simulatoren anbud', async () => {
  mutableEnv.PUBLIC_TENDER_PAGES = false;
  try {
    const r = await page(`/tildeling?anbud=${ids.weights}`);
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.body, /Anbudet dere regner på/);
    assert.match(r.body, /name="pricePct"[^>]*value=""/);
  } finally {
    mutableEnv.PUBLIC_TENDER_PAGES = true;
  }
});
