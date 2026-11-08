/**
 * Google-sidene og besøkstellingen: norske adresser (/bransjer/vakthold) med videresending fra de
 * gamle, sider per fylke og per bransje i fylke med ekte anbud, tynne sider holdes utenfor Google,
 * nettstedskartet, og telling av besøk uten informasjonskapsler (roboter og innloggede telles ikke).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { clearMarketCache, industryRegionCounts } from '../../src/domain/tenders/market';
import { INDUSTRIES, REGIONS } from '../../src/domain/reference';
import { industrySlugNb, regionSlug } from '../../src/domain/slugs';
import { trafficSource } from '../../src/domain/admin/visits';
import { adminClientFor, Client, clientFor, createAccount, ingest, makeAdmin, makeNotice, startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Egne testdata i en kombinasjon andre tester ikke bruker (renhold i Finnmark), med tidlig frist og høy
// verdi, så de står først i listene uansett hva annet som ligger i testdatabasen.
const SOON = () => new Date(Date.now() + 2.25 * 86_400_000).toISOString();
const cleaningFinnmark = (title: string, buyerName: string, estimatedValue: number) =>
  makeNotice({ title, buyerName, estimatedValue, cpvCodes: ['90910000'], mainCpv: '90910000', nutsCodes: ['NO073'], placeText: 'Alta', deadlineAt: SOON() });
let thin: { industry: string; slug: string; region: string; regionSlug: string } | null = null;

before(async () => {
  server = await startServer();
  await ingest([
    cleaningFinnmark('Renhold Alta rådhus (test)', 'Altakommune Test (test)', 91_000_000),
    cleaningFinnmark('Vinduspuss Alta skoler (test)', 'Altakommune Test (test)', 92_000_000),
    cleaningFinnmark('Renhold Hammerfest helsehus (test)', 'Hammerfesttest (test)', 93_000_000),
  ]);
  clearMarketCache();
  // En bransje i et fylke uten åpne anbud får ett anbud: siden skal finnes, men holdes utenfor Google.
  const counts = await industryRegionCounts();
  for (const i of INDUSTRIES) {
    for (const r of REGIONS) {
      if (thin || (counts.get(`${i.id}|${r.code}`) ?? 0) > 0 || r.nuts.length !== 1) continue;
      const cpv = i.cpvPrefixes[0]!.padEnd(8, '0');
      await ingest([makeNotice({ title: `Testoppdrag (test) ${r.name}`, cpvCodes: [cpv], mainCpv: cpv, nutsCodes: [r.nuts[0]!], placeText: r.name, deadlineAt: SOON() })]);
      clearMarketCache();
      const n = (await industryRegionCounts()).get(`${i.id}|${r.code}`) ?? 0;
      if (n > 0 && n < 3) thin = { industry: i.id, slug: industrySlugNb(i.id), region: r.code, regionSlug: regionSlug(r.code) };
    }
  }
  clearMarketCache();
});
after(async () => {
  await server.close();
  await closeDb();
});

const get = (path: string, headers: Record<string, string> = {}) => new Client(server.base).get(path, { 'user-agent': BROWSER, ...headers });
const text = (html: string) => html.replaceAll('<!-- -->', '');

test('norske adresser: gamle engelske og ?fylke= sendes videre med 301', async () => {
  const old = await get('/bransjer/cleaning');
  assert.equal(old.status, 301);
  assert.equal(old.location, '/bransjer/renhold');
  const withRegion = await get('/bransjer/cleaning?fylke=56&utm_source=linkedin');
  assert.equal(withRegion.status, 301);
  assert.equal(withRegion.location, '/bransjer/renhold/finnmark?utm_source=linkedin');
  const page = await get('/bransjer/renhold');
  assert.equal(page.status, 200);
  assert.match(page.body, /href="\/bransjer\/renhold\/finnmark"/, 'fylkesknappene lenker til egne sider');
  assert.match(page.body, /hreflang="en" href="[^"]*\/en\/industries\/cleaning"/);
  // De andre språkene beholder ID-ene, og peker tilbake til den norske adressen.
  const en = await get('/en/industries/cleaning');
  assert.equal(en.status, 200);
  assert.match(en.body, /hreflang="nb" href="[^"]*\/bransjer\/renhold"/);
  assert.match(en.body, /rel="canonical" href="[^"]*\/en\/industries\/cleaning"/);
  // Språkvelgeren på en engelsk side med fylke lenker rett til den norske fylkessiden (ingen omdirigering).
  const enRegion = await get('/en/industries/cleaning?fylke=50');
  assert.match(enRegion.body, /<a href="\/bransjer\/renhold\/trondelag" hrefLang="nb"/i);
  assert.doesNotMatch(enRegion.body, /href="\/bransjer\/renhold\?fylke=50"/);
  assert.equal((await get('/bransjer/finnes-ikke')).status, 404);
});

test('bransje i fylke: ekte anbud, egen tittel og adresse; tynne sider holdes utenfor Google', async () => {
  const res = await get('/bransjer/renhold/finnmark');
  assert.equal(res.status, 200);
  const body = text(res.body);
  assert.match(body, /<title>Anbud: Renhold og eiendomsdrift i Finnmark – AnbudRadar<\/title>/);
  assert.match(body, /Renhold og eiendomsdrift i Finnmark<\/span>/, 'overskriften nevner fylket');
  assert.match(body, /Renhold Alta rådhus \(test\)/);
  assert.match(body, /rel="canonical" href="[^"]*\/bransjer\/renhold\/finnmark"/);
  assert.doesNotMatch(body, /noindex/, 'minst tre åpne anbud: står i Google');
  assert.match(body, /"@type":"BreadcrumbList"/);
  assert.match(body, /href="\/fylker\/finnmark"/, 'lenke til hele fylket');

  assert.ok(thin, 'fant en bransje i et fylke med ett anbud');
  const thinPage = await get(`/bransjer/${thin!.slug}/${thin!.regionSlug}`);
  assert.equal(thinPage.status, 200);
  assert.match(thinPage.body, /<meta name="robots" content="noindex, nofollow">/, 'under tre anbud: holdes utenfor Google');
  assert.equal((await get('/bransjer/renhold/atlantis')).status, 404);
  assert.equal((await get('/en/industries/cleaning/finnmark')).status, 404, 'bare på norsk');
});

test('fylkessidene: oversikt og ett fylke med frister, bransjer og oppdragsgivere', async () => {
  const all = await get('/fylker');
  assert.equal(all.status, 200);
  for (const name of ['Oslo', 'Trøndelag', 'Finnmark']) assert.match(all.body, new RegExp(`>${name}<`));
  assert.match(all.body, /href="\/fylker\/more-og-romsdal"/);

  const county = await get('/fylker/finnmark');
  assert.equal(county.status, 200);
  const body = text(county.body);
  assert.match(body, /<title>Offentlige anbud i Finnmark – AnbudRadar<\/title>/);
  assert.match(body, /Renhold Hammerfest helsehus \(test\)/, 'nærmeste frister');
  assert.match(body, /href="\/bransjer\/renhold\/finnmark"/, 'bransjene i fylket lenker videre');
  assert.match(body, /Altakommune Test \(test\)<\/span><span class="num[^"]*">2</, 'oppdragsgiver med antall åpne anbud');
  assert.match(body, /rel="canonical" href="[^"]*\/fylker\/finnmark"/);
  assert.equal((await get('/fylker/atlantis')).status, 404);
  assert.equal((await get('/en/fylker')).status, 404);
  // Lenken i bunnteksten (bare norsk).
  assert.match((await get('/priser')).body, /href="\/fylker">Anbud per fylke</);
  assert.doesNotMatch((await get('/en/pricing')).body, /href="\/fylker"/);
});

test('nettstedskartet har norske adresser, fylkene og bransje i fylke med nok anbud', async () => {
  const xml = (await get('/sitemap.xml')).body;
  assert.match(xml, /\/bransjer\/renhold</);
  assert.doesNotMatch(xml, /\/bransjer\/cleaning</, 'ikke de gamle norske adressene');
  assert.match(xml, /\/en\/industries\/cleaning</);
  assert.match(xml, /\/fylker</);
  assert.match(xml, /\/fylker\/finnmark</);
  assert.match(xml, /\/bransjer\/renhold\/finnmark</);
  assert.doesNotMatch(xml, new RegExp(`/bransjer/${thin!.slug}/${thin!.regionSlug}<`), 'tynne sider står ikke i kartet');
});

async function views(path: string, source: string): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const [row] = (await systemSql()`
      select coalesce(sum(views), 0)::int as n from page_views_daily where path = ${path} and source = ${source}
    `) as unknown as { n: number }[];
    if (row && row.n > 0) return row.n;
    await new Promise((r) => setTimeout(r, 25));
  }
  return 0;
}

test('besøkstelling: kilde fra lenke eller søkemotor; roboter og innloggede telles ikke', async () => {
  await systemSql()`delete from page_views_daily`;
  await get('/priser', { referer: 'https://www.google.no/' });
  assert.equal(await views('/priser', 'google'), 1);
  await get('/funksjoner?utm_source=LinkedIn');
  assert.equal(await views('/funksjoner', 'linkedin'), 1);
  await get('/om', { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
  await get('/kontakt', { 'user-agent': 'curl/8.5.0' });
  await get('/fylker/finnes-ikke');
  const acc = await createAccount();
  await (await clientFor(server.base, acc)).get('/priser', { 'user-agent': BROWSER, referer: 'https://www.bing.com/' });
  await new Promise((r) => setTimeout(r, 150));
  // Bare radene denne testen selv kan lage: besøk telles etter at svaret er sendt, så besøk fra testene over
  // (f.eks. /priser og /en/pricing uten kilde) kan komme inn etter slettingen på en treg maskin.
  const rows = (await systemSql()`
    select path, source, views from page_views_daily
    where path in ('/om', '/kontakt', '/fylker/finnes-ikke') or source in ('google', 'linkedin', 'bing')
    order by path
  `) as unknown as { path: string; source: string; views: number }[];
  assert.deepEqual(
    rows.map((r) => `${r.path}|${r.source}|${r.views}`),
    ['/funksjoner|linkedin|1', '/priser|google|1'],
    'roboter, skript, 404-sider og innloggede er ikke med',
  );
  // Admin-siden viser tallene.
  const admin = await createAccount();
  await makeAdmin(admin.user.id);
  const page = await (await adminClientFor(server.base, admin)).get('/admin/besok');
  assert.equal(page.status, 200);
  assert.match(text(page.body), /Hvor besøkene kommer fra/);
  assert.match(text(page.body), />Google</);
  assert.match(text(page.body), />LinkedIn</);
});

test('kilden gjenkjennes fra Referer', () => {
  assert.equal(trafficSource('https://www.google.com/', null), 'google');
  assert.equal(trafficSource('android-app://com.google.android.googlequicksearchbox/', null), 'google');
  assert.equal(trafficSource('https://www.linkedin.com/feed/', null), 'linkedin');
  assert.equal(trafficSource('https://lnkd.in/abc', null), 'linkedin');
  assert.equal(trafficSource('https://l.facebook.com/l.php?u=x', null), 'facebook');
  assert.equal(trafficSource('https://chatgpt.com/', null), 'chatgpt');
  assert.equal(trafficSource('https://www.firma.no/partnere', null), 'firma.no');
  assert.equal(trafficSource(undefined, null), 'direkte');
  assert.equal(trafficSource('ikke en adresse', null), 'direkte');
  assert.equal(trafficSource('https://www.google.com/', 'ukesbrev'), 'ukesbrev', 'utm_source går foran');
  assert.equal(trafficSource(undefined, '<script>'), 'script', 'bare trygge tegn');
});

test('LinkedIn-tekst i admin: ukens største nye anbud med målbar lenke; bare for admin', async () => {
  const admin = await createAccount();
  await makeAdmin(admin.user.id);
  const c = await adminClientFor(server.base, admin);
  const res = await c.get('/admin/linkedin?bransje=cleaning&fylke=56');
  assert.equal(res.status, 200);
  const body = text(res.body).replaceAll('&amp;', '&');
  assert.match(body, /Ukens offentlige anbud innen renhold og eiendomsdrift i Finnmark \(uke \d+\)/);
  const n = Number(/(\d+) nye anbud siste 7 dager/.exec(body)?.[1] ?? 0);
  assert.ok(n >= 3, `minst tre nye anbud (fant ${n})`);
  assert.match(body, /1\. Renhold Hammerfest helsehus \(test\)/, 'høyest verdi først');
  assert.match(body, /ca\. 93 mill\. kr/);
  assert.match(body, /\/bransjer\/renhold\/finnmark\?utm_source=linkedin/);
  assert.match(body, /#anbud #offentligeanbud #renhold #finnmark/);
  assert.match(body, /data-copy=/, 'kopier-knapp');
  const none = await c.get(`/admin/linkedin?bransje=${thin!.industry}&fylke=99`);
  assert.equal(none.status, 200, 'ukjent fylke gir hele landet');
  const user = await createAccount();
  assert.equal((await (await clientFor(server.base, user)).get('/admin/linkedin')).status, 404);
});
