/**
 * Færre tokens til AI uten tap av innhold (kostnadsgjennomgangen): topp- og bunntekst som går igjen på hver side,
 * sidetallslinjer og prikkledere fjernes, og en side som står ordrett i et dokument tidligere (samme fil som PDF og
 * Word), erstattes med en henvisning. Brødteksten, sidetallene og kunngjøringen beholdes, og sitater kontrolleres mot
 * den samme kompakte teksten.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceBlock, checkRef, compactForAi, type AnalysisSource } from '../../src/domain/ai/sources';

const HEADER = 'Konkurransegrunnlag – Drift og vedlikehold av kommunale bygg – Saksnr. 2026/1234';
const TOPICS = ['Innledning', 'Kvalifikasjonskrav', 'Tekniske krav', 'Tildelingskriterier', 'Kontraktsvilkår', 'Prisskjema'];
const WORDS = ['ventilasjon', 'brannalarm', 'renhold', 'snømåking', 'heis', 'tak'];
const body = (n: number) =>
  `${n}. ${TOPICS[n - 1]}\nLeverandøren skal ha erfaring med ${WORDS[n - 1]} i formålsbygg og dokumentere dette med referanser fra de siste tre årene. ` +
  `Tilbud som ikke oppfyller kravene i punkt ${n}.1 til ${n}.4 om ${WORDS[n - 1]}, vil bli avvist. Oppdragsgiver kan kontrollere opplysningene.`;
const toc = 'Innhold\n1. Innledning ........................................ 2\n2. Kvalifikasjonskrav ................................ 3\n3. Tildelingskriterier _______________ 5';

function document(id: string, pages = 6): AnalysisSource {
  return {
    id,
    kind: 'document',
    title: `${id}.pdf`,
    totalPages: pages,
    isPrivate: true,
    pages: Array.from({ length: pages }, (_, i) => ({
      page: i + 1,
      text: `${HEADER}\n${i === 1 ? toc : body(i + 1)}\nSide ${i + 1} av ${pages}`,
    })),
  };
}
const notice: AnalysisSource = {
  id: 'S0',
  kind: 'notice',
  title: 'Kunngjøringen',
  totalPages: null,
  isPrivate: false,
  pages: [{ page: null, text: `Tittel: Drift av kommunale bygg\n${HEADER}\nSide 1 av 1` }],
};

test('topp- og bunntekst står bare på første side, sidetall og prikkledere forsvinner – brødteksten er uendret', () => {
  const [, d1] = compactForAi([notice, document('D1')]);
  assert.ok(d1!.pages[0]!.text.includes(HEADER), 'første side beholder topptekst');
  for (const p of d1!.pages.slice(1)) assert.ok(!p.text.includes(HEADER), `side ${p.page} uten topptekst`);
  for (const p of d1!.pages) assert.ok(!/Side \d+ av 6/.test(p.text), `side ${p.page} uten sidetallslinje`);
  assert.match(d1!.pages[1]!.text, /1\. Innledning … 2/);
  assert.ok(!d1!.pages[1]!.text.includes('....') && !d1!.pages[1]!.text.includes('____'));
  for (const [i, p] of d1!.pages.entries()) if (i !== 1) assert.ok(p.text.includes(body(i + 1).split('\n')[1]!), `brødtekst side ${p.page}`);
  assert.deepEqual(d1!.pages.map((p) => p.page), [1, 2, 3, 4, 5, 6], 'sidetallene beholdes');
});

test('kunngjøringen endres ikke, og korte dokumenter (under tre sider) beholder topptekst', () => {
  const [s0, short] = compactForAi([notice, document('D1', 2)]);
  assert.equal(s0, notice);
  assert.ok(short!.pages.every((p) => p.text.includes(HEADER)));
});

test('samme dokument lastet opp to ganger (PDF og Word): andre gang er en henvisning, ikke teksten på nytt', () => {
  const sources = compactForAi([notice, document('D1'), document('D2')]);
  const d2 = sources[2]!;
  assert.equal(d2.pages[2]!.text, '[Samme tekst som D1 side 3]');
  assert.equal(d2.pages.length, 6, 'sidene finnes fortsatt (henvisningene stemmer)');
  const before = buildSourceBlock([notice, document('D1'), document('D2')], 1_000_000).block.length;
  const after = buildSourceBlock(sources, 1_000_000).block.length;
  assert.ok(after < before * 0.55, `kildeteksten krymper: ${before} → ${after} tegn`);
});

test('sitater i brødteksten kontrolleres mot den kompakte teksten', () => {
  const sources = compactForAi([notice, document('D1')]);
  const check = checkRef({ source_id: 'D1', page: 4, quote: 'Tilbud som ikke oppfyller kravene i punkt 4.1 til 4.4 om snømåking, vil bli avvist' }, sources);
  assert.ok(check?.quoteVerified && check.pageValid);
});
