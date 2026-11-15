/**
 * Poeng fra tildelingsbrevet: utregningen (regnet for hånd) av hvor dere tapte – på pris, på kvalitet og de andre
 * kriteriene, eller begge – med poeng før og etter vekting, og skjemaet som leser tallene.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeScores, isPriceName, parseScoreForm, readScoreDetails, scoreSummary, type ScoreDetails } from '../../src/domain/tenders/award-scores';

const near = (a: number | null | undefined, b: number, msg = '') => assert.ok(a !== null && a !== undefined && Math.abs(a - b) < 1e-9, `${msg} ${a} ≠ ${b}`);
const c = (name: string, weightPct: number | null, ours: number | null, winner: number | null, price = false) => ({ name, weightPct, ours, winner, price });

test('poeng før vekting: tapte på pris, foran på kvalitet', () => {
  // Pris 40 %: 6 mot 10 → −4 × 0,4 = −1,6. Kvalitet 60 %: 8 mot 7 → +1 × 0,6 = +0,6.
  const d: ScoreDetails = { ourTotal: null, winnerTotal: null, weighted: false, criteria: [c('Pris', 40, 6, 10, true), c('Kvalitet', 60, 8, 7)] };
  const a = analyzeScores(d);
  // Summene regnes ut: 6 × 0,4 + 8 × 0,6 = 7,2 mot 10 × 0,4 + 7 × 0,6 = 8,2.
  assert.equal(a.totals?.source, 'regnet');
  near(a.totals?.ours, 7.2);
  near(a.totals?.winner, 8.2);
  near(a.gap, -1);
  near(a.split?.price, -1.6);
  near(a.split?.other, 0.6);
  assert.equal(a.verdict, 'pris');
  assert.deepEqual(a.biggestLoss, { name: 'Pris', weighted: -1.6 });
  assert.equal(scoreSummary(a), 'Dere tapte på pris: 1,60 poeng bak på pris, +0,60 på de andre kriteriene.');
});

test('poeng etter vekting (som i brevet): bak på begge, og summene fra brevet brukes', () => {
  const d: ScoreDetails = { ourTotal: 78, winnerTotal: 88, weighted: true, criteria: [c('Pris', 30, 28, 30, true), c('Kvalitet', 70, 50, 58)] };
  const a = analyzeScores(d);
  assert.equal(a.totals?.source, 'brev');
  near(a.gap, -10);
  // Allerede vektet: forskjellen er bidraget – vekten brukes ikke en gang til.
  near(a.split?.price, -2);
  near(a.split?.other, -8);
  assert.equal(a.verdict, 'begge');
  assert.equal(scoreSummary(a), 'Dere lå bak både på pris (2,00 poeng) og på de andre kriteriene (8,00 poeng).');
});

test('tapte på kvalitet og de andre kriteriene – og kriteriet dere tapte mest på', () => {
  // Pris 30 %: +1 × 0,3 = +0,3. Kvalitet 50 %: −2 × 0,5 = −1,0. Miljø 20 %: 0.
  const a = analyzeScores({ ourTotal: null, winnerTotal: null, weighted: false, criteria: [c('Pris', 30, 10, 9, true), c('Kvalitet', 50, 6, 8), c('Miljø', 20, 5, 5)] });
  near(a.split?.price, 0.3);
  near(a.split?.other, -1);
  assert.equal(a.verdict, 'kvalitet');
  assert.deepEqual(a.biggestLoss, { name: 'Kvalitet', weighted: -1 });
  assert.equal(scoreSummary(a), 'Dere tapte på kvalitet og de andre kriteriene: 1,00 poeng bak der, +0,30 på pris.');
});

test('uten vekter eller uten priskriterium: ingen deling på pris og kvalitet – bare det tallene viser', () => {
  // Uvektede poeng uten vekt kan ikke regnes inn: bare summene fra brevet.
  const noWeights = analyzeScores({ ourTotal: 7.2, winnerTotal: 8.4, weighted: false, criteria: [c('Pris', null, 6, 10, true), c('Kvalitet', null, 8, 7)] });
  assert.equal(noWeights.split, null);
  assert.equal(noWeights.verdict, null);
  assert.equal(scoreSummary(noWeights), 'Dere fikk 7,20 poeng mot vinnerens 8,40 – 1,20 poeng bak.');
  // Bare kvalitetskriterier: kriteriet med størst vektet tap.
  const quality = analyzeScores({ ourTotal: null, winnerTotal: null, weighted: false, criteria: [c('Gjennomføring', 60, 6, 9), c('Kompetanse', 40, 8, 7)] });
  assert.equal(quality.split, null);
  assert.equal(scoreSummary(quality), 'Dere tapte mest på «Gjennomføring»: 1,80 vektede poeng bak.');
  // Ingen tall: ingenting å si.
  assert.equal(scoreSummary(analyzeScores({ ourTotal: null, winnerTotal: null, weighted: false, criteria: [] })), null);
});

test('skjemaet: norske tall, tomme rader hoppes over, pris fra kunngjøringen eller navnet – og feil per tall', () => {
  const form = (fields: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of fields) f.append(k, v);
    return f;
  };
  const rows = (r: [string, string, string, string, string][]) => r.flatMap(([n, w, o, v, p]) => [['scoreName', n], ['scoreWeight', w], ['scoreOurs', o], ['scoreWinner', v], ['scorePrice', p]] as [string, string][]);
  const ok = parseScoreForm(
    form([
      ['scoreOurTotal', '7,2'],
      ['scoreWinnerTotal', ''],
      ...rows([
        ['Pris', '40', '6', '10', '1'],
        ['Kvalitet og gjennomføring', '60 %', '8,5', '7', '0'],
        ['Miljø', '', '', '', '0'],
        ['Totalpris', '', '5', '', ''],
      ]),
    ]),
  );
  assert.ok(ok.ok);
  if (!ok.ok) return;
  assert.deepEqual(ok.data, {
    ourTotal: 7.2,
    winnerTotal: null,
    weighted: false,
    criteria: [
      { name: 'Pris', weightPct: 40, ours: 6, winner: 10, price: true },
      { name: 'Kvalitet og gjennomføring', weightPct: 60, ours: 8.5, winner: 7, price: false },
      { name: 'Totalpris', weightPct: null, ours: 5, winner: null, price: true },
    ],
  });
  assert.deepEqual(parseScoreForm(form([...rows([['Pris', '40', '', '', '1']])])), { ok: true, data: null }, 'ingen poeng: feltene tømmes');
  assert.equal((parseScoreForm(form(rows([['Pris', '40', 'mye', '10', '1']]))) as { error: string }).error, 'Deres poeng for Pris: «mye» er ikke et tall.');
  assert.equal((parseScoreForm(form(rows([['Pris', '140', '6', '10', '1']]))) as { error: string }).error, 'Vekt for Pris må være mellom 0 og 100.');
  assert.equal((parseScoreForm(form(rows([['', '', '6', '10', '0']]))) as { error: string }).error, 'Skriv navnet på kriterium 1.');
  assert.equal(parseScoreForm(form([['scoreWeighted', '1'], ...rows([['Pris', '', '28', '30', '1']])])).ok, true);
});

test('pris kjennes igjen på navnet bare når kunngjøringen ikke har sagt det', () => {
  for (const n of ['Pris', 'Totalpris', 'Price', 'Kostnad', 'Livsløpskostnad', 'Pris og betingelser']) assert.equal(isPriceName(n), true, n);
  for (const n of ['Kvalitet', 'Prisregulering', 'Miljø', 'Kompetanse']) assert.equal(isPriceName(n), false, n);
});

test('lagrede verdier leses robust', () => {
  assert.equal(readScoreDetails(null), null);
  assert.deepEqual(readScoreDetails({ ourTotal: 7, winnerTotal: 'x', weighted: 1, criteria: [{ name: 'Pris', weightPct: 40, ours: 6, winner: 10, price: true }, { bad: true }] }), {
    ourTotal: 7,
    winnerTotal: null,
    weighted: false,
    criteria: [{ name: 'Pris', weightPct: 40, ours: 6, winner: 10, price: true }],
  });
});
