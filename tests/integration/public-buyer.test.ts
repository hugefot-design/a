/**
 * Offentlig side per oppdragsgiver (/oppdragsgiver/<navn>-<orgnr>): åpne anbud, hva de kjøper mest og kontrakter som
 * snart utløper – uten leverandørnavn. Stabil adresse på organisasjonsnummeret, noindex på tynne sider, lenke fra
 * anbudssiden, og bryteren PUBLIC_BUYER_PAGES.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { CPV_DIVISIONS } from '../../src/domain/reference';
import { addMonths } from '../../src/domain/competitors/expiry';
import { buyerPath, orgNumberFromSlug, resetBuyerCache, slugify } from '../../src/domain/tenders/buyer-page';
import { resetExpiringCache } from '../../src/domain/tenders/expiring';
import { resetPublicTenderCache } from '../../src/domain/tenders/public-page';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const ORG = '912345688'; // Gyldig MOD11 – ugyldige numre lagres ikke.
const SMALL = '987654325';
const NAME = 'Testby kommune (oppdragsgiver-test)';
const PATH = buyerPath(NAME, ORG);
let firstId = '';
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const monthDay = (m: number) => addMonths(new Date(), m).toISOString().slice(0, 10);

before(async () => {
  server = await startServer();
  const big = (id: string, title: string, over: Parameters<typeof makeNotice>[0] = {}) => makeNotice({ sourceNoticeId: id, title, buyerName: NAME, buyerOrgNumber: ORG, ...over });
  await ingest([
    big('BUY-1', 'Vakthold ved rådhuset (oppdragsgiver-test)', { deadlineAt: days(10) }),
    big('BUY-2', 'Vakthold ved skolene (oppdragsgiver-test)', { deadlineAt: days(12) }),
    big('BUY-3', 'Resepsjon ved biblioteket (oppdragsgiver-test)', { deadlineAt: days(14) }),
    big('BUY-4', 'Renhold av rådhuset (oppdragsgiver-test)', { cpvCodes: ['90910000'], mainCpv: '90910000', deadlineAt: days(16) }),
    big('BUY-5', 'Vinduspuss på skolene (oppdragsgiver-test)', { cpvCodes: ['90911300'], mainCpv: '90911300', deadlineAt: days(18) }),
    big('BUY-AW', 'Nattvakt ved havna (oppdragsgiver-test)', {
      lifecycle: 'awarded',
      noticeType: 'award',
      details: { contractEnd: monthDay(3) },
      awards: [{ lotTitle: null, supplierName: 'Hemmelig Vinner AS', supplierOrgNumber: null, value: 2_500_000, currency: 'NOK', awardDate: monthDay(-30) }],
    }),
    // Åpen, men uten frist: telles ikke som åpen på siden, fordi listen bare viser anbud med frist.
    big('BUY-NODL', 'Rammeavtale uten frist (oppdragsgiver-test)', { deadlineAt: null }),
    makeNotice({ sourceNoticeId: 'BUY-SMALL', title: 'Brøyting (oppdragsgiver-test)', buyerName: 'Liten kommune (oppdragsgiver-test)', buyerOrgNumber: SMALL, deadlineAt: days(9) }),
  ]);
  firstId = await tenderIdFor('manual', 'BUY-1');
  resetBuyerCache();
  resetExpiringCache();
  resetPublicTenderCache();
});

after(async () => {
  mutableEnv.PUBLIC_BUYER_PAGES = true;
  await server.close();
  await closeDb();
});

const page = async (path: string) => {
  const res = await fetch(`${server.base}${path}`, { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (test)' } });
  return { status: res.status, location: res.headers.get('location'), body: (await res.text()).replaceAll('<!-- -->', '').replaceAll('&amp;', '&') };
};
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

test('adressen: navn og organisasjonsnummer, uten æøå', () => {
  assert.equal(slugify('Sykehusinnkjøp HF'), 'sykehusinnkjop-hf');
  assert.equal(slugify('Bærum kommune – Vann og avløp'), 'baerum-kommune-vann-og-avlop');
  assert.equal(PATH, '/oppdragsgiver/testby-kommune-oppdragsgiver-test-912345688');
  assert.equal(orgNumberFromSlug('statsbygg-971278374'), '971278374');
  assert.equal(orgNumberFromSlug('971278374'), '971278374');
  assert.equal(orgNumberFromSlug('statsbygg'), null);
  assert.equal(orgNumberFromSlug('statsbygg-1234567890'), null);
});

test('oppdragsgiversiden viser åpne anbud, hva de kjøper mest og kontrakter som snart utløper – uten leverandørnavn', async () => {
  const { status, body } = await page(PATH);
  assert.equal(status, 200);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  const t = text(body);
  assert.match(t, /Testby kommune \(oppdragsgiver-test\)/);
  assert.match(t, /org\.nr\. 912 345 688/);
  assert.match(t, /5 åpne anbud akkurat nå/);
  assert.match(t, /7 anbud og tildelinger siste 12 måneder/);
  assert.doesNotMatch(t, /Viser de \d+ nærmeste/, 'telleren og listen viser det samme');
  for (const title of ['Vakthold ved rådhuset', 'Vakthold ved skolene', 'Resepsjon ved biblioteket', 'Renhold av rådhuset', 'Vinduspuss på skolene']) assert.ok(t.includes(title), title);
  assert.ok(body.indexOf('Vakthold ved rådhuset') < body.indexOf('Vinduspuss på skolene'), 'nærmeste frist først');
  // Hva de kjøper mest: CPV-hovedgrupper med antall.
  assert.match(t, /Dette kjøper de mest/);
  assert.ok(t.includes(`${CPV_DIVISIONS['79']} 5`), 'vakthold og resepsjon (79), også den uten frist');
  assert.ok(t.includes(`${CPV_DIVISIONS['90']} 2`), 'renhold (90)');
  // Kontrakter som snart utløper – uten hvem som har dem.
  assert.match(body, /aria-labelledby="utlop"/);
  assert.match(t, /Nattvakt ved havna/);
  assert.ok(!body.includes('Hemmelig Vinner'), 'ingen leverandørnavn');
  // Videre til appen: søket på oppdragsgiveren (kan lagres og gi varsel).
  assert.ok(body.includes(`/registrer?neste=${encodeURIComponent(`/app/anbud?oppdragsgiver=${encodeURIComponent(NAME)}`)}`), 'varsel via søk på oppdragsgiveren');
  // Hvem som vinner, er med i Bedrift: besøkende sendes til prisene – ikke gjennom registreringen til en låst side.
  assert.match(t, /er med i Bedrift-planen/);
  assert.ok(!body.includes('/app/konkurrenter/'), 'ingen lenke til låste sider for besøkende');
  assert.match(body, /href="\/priser"[^>]*>Se planene/);
  // Nok innhold: indekseres, med kanonisk adresse.
  assert.doesNotMatch(body, /noindex/);
  assert.ok(body.includes(`<link rel="canonical" href="${new URL(env.APP_URL).origin}${PATH}"`));
});

test('innlogget går lenkene rett inn i appen (planen står i teksten)', async () => {
  const c = await clientFor(server.base, await createAccount({ plan: 'business' }));
  const b = (await c.get(PATH)).body.replaceAll('<!-- -->', '').replaceAll('&amp;', '&');
  assert.match(b, /href="\/app\/konkurrenter\/oppdragsgiver\/[0-9a-f-]{36}"/);
  assert.match(b, /href="\/app\/konkurrenter\/utlop"/);
  assert.ok(b.includes(`href="/app/anbud?oppdragsgiver=${encodeURIComponent(NAME)}"`));
  assert.match(b, /er med i Bedrift-planen/);
});

test('feil eller kort adresse sendes videre; ukjente og andre språk gir 404', async () => {
  for (const p of [`/oppdragsgiver/${ORG}`, `/oppdragsgiver/feil-navn-${ORG}`]) {
    const r = await page(p);
    assert.equal(r.status, 301, p);
    assert.equal(r.location, PATH);
  }
  for (const p of ['/oppdragsgiver/ukjent-111111111', '/oppdragsgiver/ikke-et-nummer', `/en/oppdragsgiver/testby-kommune-oppdragsgiver-test-${ORG}`]) assert.equal((await page(p)).status, 404, p);
});

test('tynne sider får noindex og står ikke i nettstedskartet', async () => {
  const small = await page(buyerPath('Liten kommune (oppdragsgiver-test)', SMALL));
  assert.equal(small.status, 200);
  assert.match(small.body, /<meta name="robots" content="noindex/);
  const sitemap = await (await fetch(`${server.base}/sitemap.xml`)).text();
  assert.ok(sitemap.includes(`${PATH}</loc>`), 'den store oppdragsgiveren står i kartet');
  assert.ok(!sitemap.includes(`-${SMALL}</loc>`), 'den lille gjør ikke det');
});

test('anbudssiden lenker til oppdragsgiveren', async () => {
  const { body } = await page(`/anbud/${firstId}`);
  assert.ok(body.includes(`href="${PATH}"`));
});

test('PUBLIC_BUYER_PAGES=false: ingen sider, ingen lenker, ikke i kartet', async () => {
  mutableEnv.PUBLIC_BUYER_PAGES = false;
  resetPublicTenderCache();
  try {
    assert.equal((await page(PATH)).status, 404);
    assert.ok(!(await page(`/anbud/${firstId}`)).body.includes('/oppdragsgiver/'));
    assert.ok(!(await (await fetch(`${server.base}/sitemap.xml`)).text()).includes('/oppdragsgiver/'));
  } finally {
    mutableEnv.PUBLIC_BUYER_PAGES = true;
    resetPublicTenderCache();
  }
});
