/**
 * Enkle sider (docs/SPRAK.md, eier 16.11.2026: «alt for komplisert med så mange tekster»): hver offentlig side holder
 * seg under en grense for synlige ord – det som vises uten å åpne «Vis mer». Innholdet i «Vis mer» er fortsatt i siden
 * (for dem som vil lese og for søkemotorer), og ingenting er fjernet.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const get = async (path: string) => {
  const res = await fetch(`${server.base}${path}`);
  assert.equal(res.status, 200, path);
  return res.text();
};

/** Ord i <main> som vises uten å åpne noe: innholdet i <details> telles ikke, bare overskriften (summary). */
function visibleWords(html: string): number {
  const text = (html.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '')
    .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<details[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, ' $1 ')
    .replace(/<select[\s\S]*?<\/select>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
}

const BUDGET: [path: string, words: number][] = [
  ['/', 450],
  ['/en', 500],
  ['/sv', 500],
  ['/da', 500],
  ['/funksjoner', 350],
  ['/priser', 400],
  ['/metode', 150],
  ['/bransjer', 300],
  ['/fylker', 300],
  ['/oppdragsgivere', 250],
  ['/kalkulator', 250],
  ['/tildeling', 300],
];

test('de offentlige sidene holder seg under grensen for synlige ord', async () => {
  for (const [path, max] of BUDGET) {
    const words = visibleWords(await get(path));
    assert.ok(words < max, `${path}: ${words} synlige ord (grense ${max})`);
  }
});

test('«Vis mer» skjuler ikke innhold for søkemotorer: detaljene står i siden og kan åpnes', async () => {
  const features = await get('/funksjoner');
  // Punktene i funksjonskortene og hele sammenligningen ligger i <details> – og er der.
  assert.match(features, /<details[^>]*data-keep-open="true"/);
  assert.match(features, /Søk som du snakker/);
  assert.match(features, /Læring fra egne vunne og tapte tilbud/);
  const pricing = await get('/priser');
  assert.match(pricing, /Sammenlign planer/);
  assert.match(pricing, /Lagrede søk med e-postvarsel/, 'tabellen med alle planene er i siden');
  const method = await get('/metode');
  for (const id of ['kilder', 'treff', 'markedspris', 'vet-ikke']) assert.match(method, new RegExp(`<details id="${id}"`), id);
  assert.match(method, /ikke sjansen for å vinne/, 'innholdet i temaene er i siden');
});
