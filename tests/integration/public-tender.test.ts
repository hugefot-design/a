/**
 * Offentlig side per anbud (/anbud/<id>): det som står i kunngjøringen og ordsøket i appen – uten AI, med
 * kontaktopplysninger skjult, noindex på tynne og avsluttede anbud, lenker fra bransjesidene og ukesbrevet, og
 * «se om det passer dere» som tar anbudet med gjennom registreringen.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { clipText, maskContacts, resetPublicTenderCache } from '../../src/domain/tenders/public-page';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const LONG =
  'Kommunen skal anskaffe vakthold og resepsjonstjenester for rådhuset i fire år. Tilbud som leveres etter fristen, vil bli avvist. ' +
  'Leverandøren må ha godkjenning etter vaktvirksomhetsloven og dokumentere ISO 9001. Det er obligatorisk befaring 3. desember kl. 10.00. ' +
  'Ved forsinket oppstart påløper dagbot på 1 promille av kontraktssummen per dag. Spørsmål kan rettes til ola.nordmann@testkommune.no, ' +
  'tlf 22334455 eller mobil 915 12 345. Kontrakten gjelder 2026–2027 med opsjon. Anslått omfang 2 000 000 kr per år.';
let longId = '';
let shortId = '';
let closedId = '';

before(async () => {
  server = await startServer();
  await ingest([
    makeNotice({ sourceNoticeId: 'PUB-LONG', title: 'Vakthold ved rådhuset (offentlig side)', description: LONG }),
    makeNotice({ sourceNoticeId: 'PUB-SHORT', title: 'Vakthold, kort tekst (offentlig side)', description: 'Vakthold ved skolen.' }),
    makeNotice({
      sourceNoticeId: 'PUB-CLOSED',
      title: 'Vakthold, avsluttet (offentlig side)',
      description: LONG,
      publishedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
      deadlineAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
    }),
  ]);
  const ids = await Promise.all(['PUB-LONG', 'PUB-SHORT', 'PUB-CLOSED'].map((id) => tenderIdFor('manual', id)));
  [longId, shortId, closedId] = [ids[0]!, ids[1]!, ids[2]!];
  resetPublicTenderCache();
});

after(async () => {
  mutableEnv.PUBLIC_TENDER_PAGES = true;
  await server.close();
  await closeDb();
});

const page = async (path: string) => {
  const res = await fetch(`${server.base}${path}`, { headers: { 'user-agent': 'Mozilla/5.0 (test)' } });
  return { status: res.status, body: (await res.text()).replaceAll('<!-- -->', '') };
};

test('kontaktopplysninger skjules, men ikke beløp, årstall eller datoer', () => {
  const out = maskContacts(LONG + ' Ring +47 22 33 44 55 eller 22 33 44 55.');
  assert.ok(!out.includes('ola.nordmann@testkommune.no'));
  assert.ok(!/22334455|915 12 345|22 33 44 55/.test(out), out);
  assert.match(out, /\[e-post skjult\]/);
  assert.match(out, /tlf \[telefon skjult\]/);
  assert.match(out, /2 000 000 kr/);
  assert.match(out, /2026–2027/);
  assert.match(out, /3\. desember kl\. 10\.00/);
  assert.equal(clipText('Kort tekst.').clipped, false);
  const clipped = clipText(`${'Første setning er her. '.repeat(100)}Slutt.`, 200);
  assert.ok(clipped.clipped && clipped.text.length <= 205 && clipped.text.endsWith('…'));
  assert.equal(clipText('Det gjelder flystasjon.Tiltaket omfatter 9.3 km.').text, 'Det gjelder flystasjon. Tiltaket omfatter 9.3 km.');
});

test('anbudssiden viser kunngjøringen og ordsøket – merket som fakta, uten kontaktopplysninger', async () => {
  const { status, body } = await page(`/anbud/${longId}`);
  assert.equal(status, 200);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(body, /Vakthold ved rådhuset \(offentlig side\)/);
  assert.match(body, /Åpent anbud/);
  assert.match(body, /Fakta – står ordrett i kunngjøringen/);
  assert.match(body, /<mark[^>]*>vil bli avvist<\/mark>/, 'avvisningsgrunnen er sitert med treffordene uthevet');
  assert.match(body, /dagbot/i);
  assert.ok(!body.includes('ola.nordmann@testkommune.no') && !body.includes('22334455'), 'kontaktopplysninger vises ikke');
  assert.match(body, /\[e-post skjult\]/);
  assert.ok(body.includes(`/registrer?neste=${encodeURIComponent(`/app/anbud/${longId}/intelligence`)}`), 'se om det passer går via registrering med anbudet');
  assert.match(body, /<link rel="canonical" href="[^"]*\/anbud\/[0-9a-f-]+">/);
  assert.doesNotMatch(body, /noindex/, 'åpent anbud med nok tekst indekseres');
  assert.match(body, /"@type":"BreadcrumbList"/);
  assert.match(body, /href="\/eksempel"/);
  // Innloggede går rett til vurderingen.
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  assert.ok((await c.get(`/anbud/${longId}`)).body.includes(`href="/app/anbud/${longId}/intelligence"`));
});

test('tynne og avsluttede anbud får noindex og er ikke i nettstedskartet; ukjente gir 404', async () => {
  assert.match((await page(`/anbud/${shortId}`)).body, /<meta name="robots" content="noindex/);
  const closed = await page(`/anbud/${closedId}`);
  assert.equal(closed.status, 200);
  assert.match(closed.body, /Fristen har gått ut/);
  assert.match(closed.body, /<meta name="robots" content="noindex/);
  assert.equal((await page(`/anbud/${randomUUID()}`)).status, 404);
  assert.equal((await page('/anbud/ikke-en-id')).status, 404);

  const sitemap = (await page('/sitemap.xml')).body;
  assert.ok(sitemap.includes(`/anbud/${longId}<`), 'åpent anbud med nok tekst er med');
  assert.ok(!sitemap.includes(`/anbud/${shortId}<`) && !sitemap.includes(`/anbud/${closedId}<`), 'tynne og avsluttede er ikke med');
});

test('bransjesiden lenker til anbudssiden for besøkende – og besøket telles samlet', async () => {
  const body = (await page('/bransjer/vakthold')).body;
  assert.ok(body.includes(`href="/anbud/${longId}"`), 'besøkende får anbudssiden');
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  assert.ok((await c.get('/bransjer/vakthold')).body.includes(`href="/app/anbud/${longId}"`), 'innloggede går rett i appen');

  await page(`/anbud/${longId}`);
  const rows = (await systemSql()`select path from page_views_daily where path like '/anbud%'`) as unknown as { path: string }[];
  assert.ok(rows.length > 0 && rows.every((r) => r.path === '/anbud/*'), JSON.stringify(rows));
});

test('kan slås av: da finnes ikke sidene, og lenkene går til registrering som før', async () => {
  mutableEnv.PUBLIC_TENDER_PAGES = false;
  try {
    assert.equal((await page(`/anbud/${longId}`)).status, 404);
    const body = (await page('/bransjer/vakthold')).body;
    assert.ok(!body.includes(`href="/anbud/${longId}"`));
    assert.ok(body.includes(encodeURIComponent(`/app/anbud/${longId}`)));
    assert.ok(!(await page('/sitemap.xml')).body.includes('/anbud/'));
  } finally {
    mutableEnv.PUBLIC_TENDER_PAGES = true;
  }
});
