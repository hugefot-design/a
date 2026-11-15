/**
 * Verktøyene uten konto:
 *
 * - «Prøv uten konto» (/prov og skjemaet på forsiden): de åpne anbudene rangert med appens treffmotor – bare de
 *   fem beste, valgene følger med til registreringen, og resultatsidene indekseres ikke.
 * - Lønnsomhetssjekken (/kalkulator): egne tall inn, appens formler ut. Knyttet til et anbud brukes oppdragsgivers
 *   anslag (merket som det) og ekte tidligere tildelinger. Ingenting lagres.
 * - Begge kan slås av med PUBLIC_TOOLS=false.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { quickRanking, resetQuickCache } from '../../src/domain/matching/quick';
import { resetPublicTenderCache } from '../../src/domain/tenders/public-page';
import type { NoticeAward } from '../../src/domain/tenders/normalize';
import { Client, clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const CPV = '64210000'; // Telefon- og dataoverføringstjenester (Telekom) – brukes ikke i andre tester.
const UNIQUE = 'fiberutbygging';
let bestId = '';
let soonId = '';

const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

before(async () => {
  server = await startServer();
  const open = (sourceNoticeId: string, title: string, over: Parameters<typeof makeNotice>[0] = {}) =>
    makeNotice({ sourceNoticeId, title, description: `${title}. Fiktiv kunngjøring for automatiske tester.`, cpvCodes: [CPV], mainCpv: CPV, ...over });
  const award = (supplierName: string, value: number): NoticeAward[] => [{ lotTitle: null, supplierName, supplierOrgNumber: null, value, currency: 'NOK', awardDate: '2026-05-01' }];
  const awarded = (n: number, value: number) =>
    makeNotice({
      title: `Telefoni og datanett ${n} (verktøy-test)`,
      lifecycle: 'awarded',
      noticeType: 'award',
      cpvCodes: [CPV],
      mainCpv: CPV,
      details: { durationMonths: 12, isFramework: false },
      awards: award(`Nett ${n} AS`, value),
    });
  await ingest([
    open('TOOL-BEST', `Fiberutbygging til skolene (verktøy-test)`, { estimatedValue: 1_000_000, deadlineAt: days(20), details: { durationMonths: 12 } }),
    open('TOOL-OSLO', 'Fiberutbygging i Oslo (verktøy-test)', { nutsCodes: ['NO081'], placeText: 'Oslo', buyerCity: 'Oslo', deadlineAt: days(18) }),
    ...[1, 2, 3, 4, 5].map((n) => open(`TOOL-${n}`, `Mobilabonnement for kommunen ${n} (verktøy-test)`, { deadlineAt: days(9 + n) })),
    // Frist om få timer: for nær til å være med.
    open('TOOL-SOON', 'Fiberutbygging med frist i dag (verktøy-test)', { deadlineAt: new Date(Date.now() + 6 * 3_600_000).toISOString() }),
    awarded(1, 400_000),
    awarded(2, 600_000),
    awarded(3, 800_000),
    awarded(4, 1_000_000),
  ]);
  [bestId, soonId] = await Promise.all([tenderIdFor('manual', 'TOOL-BEST'), tenderIdFor('manual', 'TOOL-SOON')]);
  resetQuickCache();
  resetPublicTenderCache();
  await systemSql()`delete from rate_limits where key like 'prov:%' or key like 'kalkulator:%'`;
});

after(async () => {
  mutableEnv.PUBLIC_TOOLS = true;
  mutableEnv.PUBLIC_TENDER_PAGES = true;
  await systemSql()`delete from rate_limits where key like 'prov:%' or key like 'kalkulator:%'`;
  await server.close();
  await closeDb();
});

/** Skjemaet er en vanlig GET – virker uten JavaScript, og adressen kan deles. */
const PROV_FORM = /<form[^>]*action="\/prov" method="get"/;
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
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// Prøv uten konto
// ---------------------------------------------------------------------------
test('/prov uten valg: skjemaet vises, siden indekseres og ingenting rangeres', async () => {
  const { status, body } = await page('/prov');
  assert.equal(status, 200);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(body, PROV_FORM);
  assert.match(body, /<option value="telecom">Telekom<\/option>/);
  assert.match(body, /<option value="50">Trøndelag<\/option>/);
  assert.doesNotMatch(body, /noindex/);
  assert.match(body, /<link rel="canonical" href="[^"]+\/prov"/);
  assert.doesNotMatch(body, /åpne anbud i/);
});

test('/prov rangerer med treffmotoren: beste treff først, bare fem, med begrunnelse og lenker videre', async () => {
  const { status, body } = await page(`/prov?bransje=telecom&fylke=50&ord=${UNIQUE}`);
  assert.equal(status, 200);
  const heading = /(\d+) åpne anbud i Telekom – her er de 5 som passer best/.exec(body);
  assert.ok(heading, 'overskriften sier hvor mange som finnes og hvor mange som vises');
  assert.ok(Number(heading[1]) >= 7, `minst de sju åpne testanbudene er vurdert (${heading[1]})`);
  assert.equal((body.match(/aria-label="Treff \d+ av 100"/g) ?? []).length, 5, 'bare de fem beste vises');
  // Riktig fylke og ordet i tittelen gir det beste treffet.
  const first = /<ol[\s\S]*?<li[\s\S]*?<\/li>/.exec(body)?.[0] ?? '';
  assert.match(first, /Fiberutbygging til skolene \(verktøy-test\)/);
  assert.match(first, /Passer fordi:/);
  assert.ok(first.includes(`href="/anbud/${bestId}"`), 'lenke til den offentlige anbudssiden');
  assert.ok(first.includes(`href="/kalkulator?anbud=${bestId}"`), 'lenke til lønnsomhetssjekken for anbudet');
  assert.match(body, /ordene «fiberutbygging»/);
  assert.match(body, /ikke sjansen for å vinne/);
  assert.ok(!body.includes(soonId) && !body.includes('frist i dag'), 'anbud med frist innen et døgn er ikke med');
  // Valgene følger med til registreringen og oppstartsskjemaet.
  const next = encodeURIComponent(`/app/onboarding?bransje=telecom&fylke=50&tjenester=${UNIQUE}`);
  assert.ok(body.includes(`href="/registrer?neste=${next}"`), 'registreringslenken tar med bransje, fylke og ordene');
  assert.match(body, /Med konto ser dere alle/);
  // Resultatsider indekseres ikke – bare selve verktøyet.
  assert.match(body, /<meta name="robots" content="noindex/);
  // Skjemaet husker valgene.
  assert.match(body, /name="ord"[^>]*value="fiberutbygging"/);
});

test('/prov: uten ord og med ukjente valg – ingenting gjettes', async () => {
  const noWords = await page('/prov?bransje=telecom');
  assert.equal(noWords.status, 200);
  assert.match(noWords.body, /åpne anbud i Telekom/);
  assert.doesNotMatch(noWords.body, /ordene «/);
  const unknown = await page('/prov?bransje=finnes-ikke&fylke=99&ord=x');
  assert.equal(unknown.status, 200);
  assert.doesNotMatch(unknown.body, /åpne anbud i/);
  assert.match(unknown.body, /<meta name="robots" content="noindex/);
});

test('/prov: en bransje uten åpne anbud – ingen råd om å bytte fylke (det hjelper ikke)', async () => {
  const { status, body } = await page('/prov?bransje=cybersecurity&fylke=50');
  assert.equal(status, 200);
  assert.match(text(body), /Ingen åpne anbud i Cybersikkerhet akkurat nå/);
  assert.doesNotMatch(body, /Prøv et annet fylke/);
});

test('/prov rangerer bare norske anbud, og antallet er det ekte', async () => {
  resetQuickCache();
  const before = await quickRanking({ industry: 'telecom', region: null, words: '' });
  await ingest([
    makeNotice({
      sourceNoticeId: 'TOOL-SE',
      title: 'Fiberutbygging i Sverige (verktøy-test)',
      countryCode: 'SE',
      nutsCodes: ['SE110'],
      placeText: 'Stockholm',
      buyerCity: 'Stockholm',
      cpvCodes: [CPV],
      mainCpv: CPV,
      deadlineAt: days(15),
    }),
  ]);
  resetQuickCache();
  const after = await quickRanking({ industry: 'telecom', region: null, words: UNIQUE });
  assert.ok(before && after);
  assert.equal(after.open, before.open, 'svenske anbud telles ikke');
  assert.ok(!after.rows.some((r) => r.title.includes('Sverige')), 'og rangeres ikke');
  assert.equal(after.ranked, after.open, 'alle åpne er rangert');
});

test('/prov begrenses per besøkende', async () => {
  await page('/prov?bransje=telecom');
  await systemSql()`update rate_limits set count = 40 where key like 'prov:%'`;
  const limited = await page('/prov?bransje=telecom');
  assert.equal(limited.status, 429);
  assert.match(limited.body, /For mange forsøk på kort tid/);
  assert.doesNotMatch(limited.body, /aria-label="Treff \d+ av 100"/);
  // Selve skjemaet (uten rangering) telles ikke.
  assert.equal((await page('/prov')).status, 200);
  await systemSql()`delete from rate_limits where key like 'prov:%'`;
});

test('valgene fra «Prøv uten konto» står ferdig utfylt i oppstartsskjemaet', async () => {
  const account = await createAccount({ profile: false });
  const c = await clientFor(server.base, account);
  const body = clean((await c.get(`/app/onboarding?bransje=telecom&fylke=50&tjenester=${encodeURIComponent('fiberutbygging, bredbånd')}`)).body);
  const checked = (name: string) =>
    [...body.matchAll(/<input\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => tag.includes(`name="${name}"`) && /\schecked(=|\s|\/|>)/.test(tag))
      .map((tag) => /value="([^"]*)"/.exec(tag)?.[1] ?? '');
  assert.deepEqual(checked('industries'), ['telecom']);
  assert.deepEqual(checked('regions'), ['50']);
  assert.match(body, /fiberutbygging, bredbånd/);
});

// ---------------------------------------------------------------------------
// Forsiden, bunnteksten og nettstedskartet
// ---------------------------------------------------------------------------
test('forsiden har skjemaet under toppen, og de tre budskapene lenker til verktøyene', async () => {
  const { body } = await page('/');
  assert.match(body, /<section id="prov"/);
  assert.match(body, PROV_FORM);
  for (const href of ['#prov', '/eksempel#risiko', '/kalkulator']) assert.ok(body.includes(`href="${href}"`), href);
  assert.match(body, /href="\/prov"[^>]*>Prøv uten konto<\/a>/, 'lenke i bunnteksten');
  assert.match(body, /href="\/kalkulator"[^>]*>Lønnsomhetssjekk<\/a>/, 'lenke i bunnteksten');
  const en = await page('/en');
  assert.match(en.body, PROV_FORM);
  assert.match(en.body, /The results are shown in Norwegian, like the app\./);
  const sitemap = await (await fetch(`${server.base}/sitemap.xml`)).text();
  assert.match(sitemap, /<loc>[^<]+\/prov<\/loc>/);
  assert.match(sitemap, /<loc>[^<]+\/kalkulator<\/loc>/);
});

// ---------------------------------------------------------------------------
// Lønnsomhetssjekken
// ---------------------------------------------------------------------------
const NUMBERS = { hours: '18 000', hourlyCost: '620', materials: '32 000 000', other: '4 500 000', overheadPct: '8', marginPct: '10', contractValue: '52 000 000' };
const stored = async () => {
  const [row] = (await systemSql()`
    select (select count(*) from tender_calculations)::int as calcs, (select count(*) from audit_logs)::int as audits, (select count(*) from reports)::int as reports
  `) as unknown as { calcs: number; audits: number; reports: number }[];
  return row!;
};

test('/kalkulator: skjemaet vises uten konto og indekseres', async () => {
  const { status, body } = await page('/kalkulator');
  assert.equal(status, 200);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(body, /Lønner anbudet seg\?/);
  assert.match(body, /<form[^>]*action="\/kalkulator"/);
  assert.match(body, /Dette får dere svar på/);
  assert.doesNotMatch(body, /noindex/);
  assert.doesNotMatch(body, /id="resultat"/);
});

test('/kalkulator regner med appens formler – selvkost, målpris, margin og følsomhet – og lagrer ingenting', async () => {
  const before = await stored();
  const c = new Client(server.base);
  const res = await c.post('/kalkulator', NUMBERS, { from: '/kalkulator' });
  assert.equal(res.status, 200);
  const t = text(res.body);
  assert.match(t, /Selvkost 51 472 800 kr/);
  assert.match(t, /Målpris 57 192 000 kr For 10 % margin/);
  assert.match(t, /1,01 % margin Fortjeneste 527 200 kr/);
  assert.match(t, /under målet på 10 %\. For å nå målet må prisen være 57 192 000 kr\./);
  assert.match(t, /Kontraktsverdien er deres eget tall/);
  // +10 % kostnader gir tap ved samme kontraktsverdi.
  assert.match(t, /\+10 % 56 620 080 kr [−-]8,88 %/);
  assert.match(t, /Slik er det regnet Direkte kostnader: Sum av 3 kostnadslinjer 47 660 000 kr/);
  assert.match(t, /Målpris \(margin 10 %\): \(51 472 800 kr\) ÷ \(1 − 10 %\) 57 192 000 kr/);
  assert.doesNotMatch(t, /Risikopåslag:|Minstepris/, 'linjer sjekken ikke har, vises ikke');
  assert.doesNotMatch(t, /Målprisen blant tidligere tildelinger/, 'uten anbud vises ingen markedspris');
  // Tallene står igjen i skjemaet.
  assert.match(clean(res.body), /name="hours"[^>]*value="18 000"/);
  assert.deepEqual(await stored(), before, 'ingenting er lagret');
});

test('/kalkulator: ugyldige tall gir feil per felt – ingenting regnes', async () => {
  const c = new Client(server.base);
  const res = await c.post('/kalkulator', { ...NUMBERS, hours: 'mange', marginPct: '' }, { from: '/kalkulator' });
  assert.equal(res.status, 422);
  const body = clean(res.body);
  assert.match(body, /Timer: skriv et tall\./);
  assert.match(body, /Skriv hvilken margin dere ønsker/);
  assert.match(body, /name="hours"[^>]*value="mange"/);
  assert.doesNotMatch(body, /id="resultat"/);
  const none = await c.post('/kalkulator', { hours: '', hourlyCost: '', materials: '', other: '', overheadPct: '', marginPct: '10', contractValue: '' }, { from: '/kalkulator' });
  assert.equal(none.status, 422);
  assert.match(clean(none.body), /Legg inn minst én kostnad/);
});

test('/kalkulator for et anbud: oppdragsgivers anslag brukes og merkes, og målprisen plasseres blant ekte tildelinger', async () => {
  const get = await page(`/kalkulator?anbud=${bestId}`);
  assert.equal(get.status, 200);
  assert.match(get.body, /Fiberutbygging til skolene \(verktøy-test\)/);
  assert.match(text(get.body), /Anslått verdi fra oppdragsgiver: 1 000 000 kr/);
  assert.ok(get.body.includes(`action="/kalkulator?anbud=${bestId}"`));
  assert.match(get.body, /<meta name="robots" content="noindex/, 'siden per anbud indekseres ikke');

  const c = new Client(server.base);
  const path = `/kalkulator?anbud=${bestId}`;
  // 1000 timer à 600 kr = 600 000 i selvkost. 20 % margin → 750 000. Ved anslaget 1 000 000: 400 000 og 40 %.
  const res = await c.post(path, { hours: '1000', hourlyCost: '600', materials: '', other: '', overheadPct: '', marginPct: '20', contractValue: '' }, { from: path });
  assert.equal(res.status, 200);
  const t = text(res.body);
  assert.match(t, /Selvkost 600 000 kr/);
  assert.match(t, /Målpris 750 000 kr For 20 % margin/);
  assert.match(t, /40 % margin Fortjeneste 400 000 kr/);
  assert.match(t, /over målet på 20 %/);
  assert.match(t, /Kontraktsverdien er oppdragsgivers anslag fra kunngjøringen/);
  // Fire ekte tildelinger: 400 000, 600 000, 800 000 og 1 000 000 → median 700 000, to av fire over målprisen.
  assert.match(t, /Målprisen blant tidligere tildelinger/);
  assert.match(t, /4 publiserte tildelinger med oppgitt verdi/);
  assert.match(t, /Median 700 000 kr/);
  assert.match(t, /lavere enn 50 % av tildelingene/);
  assert.ok(clean(res.body).includes(`href="/registrer?neste=${encodeURIComponent(`/app/anbud/${bestId}/lonnsomhet`)}"`), 'videre til kalkulatoren i appen for samme anbud');

  // Egen kontraktsverdi går foran anslaget.
  const own = text((await c.post(path, { hours: '1000', hourlyCost: '600', materials: '', other: '', overheadPct: '', marginPct: '20', contractValue: '500 000' }, { from: path })).body);
  assert.match(own, /Ved 500 000 kr taper dere 100 000 kr/);
  assert.match(own, /Kontraktsverdien er deres eget tall/);
});

test('/kalkulator: ukjent anbud gir vanlig kalkulator, og anbudssiden lenker til sjekken', async () => {
  const unknown = await page(`/kalkulator?anbud=${randomUUID()}`);
  assert.equal(unknown.status, 200);
  assert.doesNotMatch(unknown.body, /Anbudet dere regner på/);
  assert.equal((await page('/kalkulator?anbud=ikke-en-id')).status, 200);
  const tender = await page(`/anbud/${bestId}`);
  assert.ok(tender.body.includes(`href="/kalkulator?anbud=${bestId}"`));
  assert.match(tender.body, /Regn på om det lønner seg/);
});

test('/kalkulator begrenses per besøkende', async () => {
  const c = new Client(server.base);
  assert.equal((await c.post('/kalkulator', NUMBERS, { from: '/kalkulator' })).status, 200);
  await systemSql()`update rate_limits set count = 60 where key like 'kalkulator:%'`;
  assert.equal((await c.post('/kalkulator', NUMBERS, { from: '/kalkulator' })).status, 429);
  await systemSql()`delete from rate_limits where key like 'kalkulator:%'`;
});

// ---------------------------------------------------------------------------
// Bryteren
// ---------------------------------------------------------------------------
test('PUBLIC_TOOLS=false: verktøyene finnes ikke, og forsiden peker til eksempelet som før', async () => {
  mutableEnv.PUBLIC_TOOLS = false;
  try {
    assert.equal((await page('/prov')).status, 404);
    assert.equal((await page('/prov?bransje=telecom')).status, 404);
    assert.equal((await page('/kalkulator')).status, 404);
    const home = (await page('/')).body;
    assert.doesNotMatch(home, /<section id="prov"/);
    assert.doesNotMatch(home, /href="\/kalkulator"|href="\/prov"|href="#prov"/);
    for (const a of ['passer', 'risiko', 'lonnsomhet']) assert.ok(home.includes(`href="/eksempel#${a}"`), a);
    const tender = (await page(`/anbud/${bestId}`)).body;
    assert.doesNotMatch(tender, /\/kalkulator/);
    const sitemap = await (await fetch(`${server.base}/sitemap.xml`)).text();
    assert.doesNotMatch(sitemap, /\/prov<|\/kalkulator</);
  } finally {
    mutableEnv.PUBLIC_TOOLS = true;
  }
});

test('uten offentlige anbudssider henter ikke kalkulatoren anbud, og /prov lenker til registrering', async () => {
  mutableEnv.PUBLIC_TENDER_PAGES = false;
  try {
    const calc = await page(`/kalkulator?anbud=${bestId}`);
    assert.equal(calc.status, 200);
    assert.doesNotMatch(calc.body, /Anbudet dere regner på/);
    const prov = (await page(`/prov?bransje=telecom&fylke=50&ord=${UNIQUE}`)).body;
    assert.ok(!prov.includes(`href="/anbud/${bestId}"`));
    assert.ok(prov.includes(`href="/registrer?neste=${encodeURIComponent(`/app/anbud/${bestId}`)}"`));
  } finally {
    mutableEnv.PUBLIC_TENDER_PAGES = true;
  }
});
