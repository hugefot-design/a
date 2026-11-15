/**
 * Metodesiden (/metode): reglene vises med tallene fra koden (treffpoeng, tak, merking, markedspris, kalkyle),
 * AI omtales bare som aktiv når den er det, og siden er lenket fra bunnteksten og verktøyene.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { aiModeFor } from '../../src/domain/ai/provider';
import { BASIS_LEGEND } from '../../src/domain/intelligence/basis';
import { DISQUALIFIED_MAX, SCORE_CAPS, SCORE_PARTS } from '../../src/domain/matching/engine';
import { env } from '../../src/lib/env';
import { MAX_AGE_YEARS, MIN_COMPARABLES } from '../../src/domain/profit/market';
import { Client, ingest, makeNotice, startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;

before(async () => {
  server = await startServer();
  // Ett åpent anbud i bransjen, så «Prøv uten konto» har treff å forklare.
  await ingest([makeNotice({ title: 'Vakthold ved biblioteket (metode-test)' })]);
});

after(async () => {
  await server.close();
  await closeDb();
});

const page = async (path: string) => {
  const res = await fetch(`${server.base}${path}`, { headers: { 'user-agent': 'Mozilla/5.0 (test)' } });
  return { status: res.status, body: (await res.text()).replaceAll('<!-- -->', '').replaceAll('&amp;', '&') };
};
const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

test('metodesiden viser reglene med tallene fra koden', async () => {
  const { status, body } = await page('/metode');
  assert.equal(status, 200);
  assert.equal((body.match(/<h1[ >]/g) ?? []).length, 1);
  assert.match(body, /Slik regner vi\./);
  assert.match(body, /<link rel="canonical" href="[^"]+\/metode"/);
  assert.doesNotMatch(body, /noindex/);
  for (const id of ['kilder', 'treff', 'grunnlag', 'krav', 'markedspris', 'kalkyle', 'utlop', 'ai', 'vet-ikke']) assert.match(body, new RegExp(`<section id="${id}"`), id);
  const t = text(body);
  // Treffpoeng: hver del med maks, summen 100 og takene.
  for (const p of SCORE_PARTS) assert.ok(t.includes(`${p.label} ${p.max} ${p.rule}`), p.key);
  assert.match(t, /Til sammen 100/);
  for (const c of SCORE_CAPS) assert.ok(t.includes(`${c.text}: maks ${c.max}.`), c.text);
  assert.ok(t.includes(`fristen har gått ut: maks ${DISQUALIFIED_MAX}.`));
  assert.match(t, /ikke sjansen for å vinne/);
  // Merkingen er den samme som i vurderingene.
  for (const b of BASIS_LEGEND) assert.ok(t.includes(b.label), b.label);
  // Markedspris og kalkyle.
  assert.ok(t.includes(`Med færre enn ${MIN_COMPARABLES} tildelinger viser vi ingen statistikk`));
  assert.ok(t.includes(`eldre enn ${MAX_AGE_YEARS} år`));
  assert.match(t, /\(selvkost \+ risikopåslag\) ÷ \(1 − ønsket margin\)/);
  assert.match(t, /det samme med 5, 10, 20 % høyere kostnader/);
  assert.match(t, /10 % margin på 1 000 000 kr i kostnader gir en pris på 1 111 111 kr/);
  // AI omtales bare som aktiv når den er slått på (og ikke i testmodus).
  const ai = aiModeFor(null);
  if (ai.configured && !ai.isMock) assert.match(t, /alt den lager, er merket «AI-vurdering»/);
  else {
    assert.match(t, /AI er ikke slått på ennå\./);
    assert.doesNotMatch(t, /alt den lager, er merket/);
  }
});

test('metodesiden er lenket fra bunnteksten (norsk), verktøyene og nettstedskartet', async () => {
  assert.match((await page('/')).body, /href="\/metode"[^>]*>Slik regner vi<\/a>/);
  assert.doesNotMatch((await page('/en')).body, /href="\/metode"/, 'bare på norsk');
  assert.match((await page('/prov?bransje=security')).body, /href="\/metode#treff"/);
  const c = new Client(server.base);
  const calc = await c.post('/kalkulator', { hours: '100', hourlyCost: '500', materials: '', other: '', overheadPct: '', marginPct: '10', contractValue: '' }, { from: '/kalkulator' });
  assert.equal(calc.status, 200);
  assert.match(calc.body, /href="\/metode#kalkyle"/);
  const sitemap = await (await fetch(`${server.base}/sitemap.xml`)).text();
  assert.match(sitemap, /<loc>[^<]+\/metode<\/loc>/);
});

test('robots.txt peker til nettstedskartet og holder appen utenfor', async () => {
  const res = await fetch(`${server.base}/robots.txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  const body = await res.text();
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Disallow: \/app$/m);
  assert.match(body, /^Disallow: \/api$/m);
  assert.ok(body.includes(`Sitemap: ${env.APP_URL.replace(/\/$/, '')}/sitemap.xml`));
});
