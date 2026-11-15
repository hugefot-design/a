/**
 * Tildelingssimulatoren: DFØs to prismodeller, summen med vekter, prisen der to tilbud står likt – regnet for hånd –
 * og vektene fra kunngjøringen, som bare fylles inn når de kan leses sikkert.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakEven, noticeWeights, parseAwardSim, pricePoints, simulateAward, type AwardSimInput } from '../../src/domain/profit/award-sim';

const near = (actual: number, expected: number, msg?: string) => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg ?? ''} ${actual} ≠ ${expected}`);
const base: AwardSimInput = { model: 'forholdsmessig', pricePct: 30, ourPrice: 1_100_000, ourQuality: 8, theirPrice: 1_000_000, theirQuality: 6 };

test('prispoeng etter DFØs formler', () => {
  // Forholdsmessig: 10 × Pb ÷ Pe.
  near(pricePoints('forholdsmessig', 1_000_000, 1_000_000), 10);
  near(pricePoints('forholdsmessig', 1_250_000, 1_000_000), 8);
  near(pricePoints('forholdsmessig', 2_000_000, 1_000_000), 5, 'aldri 0 ved dobbel pris');
  // Lineær: 10 − 10 × (Pe − Pb) ÷ Pb.
  near(pricePoints('lineaer', 1_250_000, 1_000_000), 7.5);
  near(pricePoints('lineaer', 2_000_000, 1_000_000), 0, '0 poeng ved dobbel pris');
  near(pricePoints('lineaer', 2_500_000, 1_000_000), -5, 'minuspoeng over dobbel pris');
});

test('forholdsmessig: dyrere, men bedre på kvalitet – summen og prisen der de står likt', () => {
  const r = simulateAward(base);
  assert.equal(r.lowest, 1_000_000);
  // Dere: 10 × 1 000 000 ÷ 1 100 000 = 9,0909 prispoeng; 9,0909 × 0,3 + 8 × 0,7 = 8,3273.
  near(r.ours.pricePoints, 100 / 11);
  near(r.ours.total, (100 / 11) * 0.3 + 5.6);
  // Konkurrenten: 10 × 0,3 + 6 × 0,7 = 7,2.
  near(r.theirs.total, 7.2);
  assert.equal(r.outcome, 'vinner');
  // Forspranget i prispoeng: 2 × 0,7 ÷ 0,3 = 4,6667. Likt når 10 × 1 000 000 ÷ P = 10 − 4,6667 → P = 1 875 000.
  assert.equal(r.breakEven.kind, 'pris');
  if (r.breakEven.kind === 'pris') {
    near(r.breakEven.price, 1_875_000);
    near(r.breakEven.vsTheirsPct, 87.5);
  }
  // Ett poeng mer (9): forsprang 3 × 0,7 ÷ 0,3 = 7 → P = 1 000 000 × 10 ÷ 3 = 3 333 333,33.
  assert.ok(r.qualityPoint);
  near(r.qualityPoint!.to, 10_000_000 / 3);
  near(r.qualityPoint!.kr, 10_000_000 / 3 - 1_875_000);
  // Utregningen vises med tallene.
  const labels = r.steps.map((s) => s.label);
  assert.deepEqual(labels, ['Laveste pris', 'Prispoeng, dere', 'Prispoeng, konkurrenten', 'Sum, dere', 'Sum, konkurrenten', 'Kvalitetsforsprang i prispoeng', 'Likt ved', 'Kontroll']);
  const step = (l: string) => r.steps.find((s) => s.label === l)!;
  assert.equal(step('Prispoeng, dere').formula, '10 × 1 000 000 kr ÷ 1 100 000 kr');
  assert.equal(step('Prispoeng, dere').value, '9,09');
  assert.equal(step('Sum, dere').formula, '9,09 × 30 % + 8,00 × 70 %');
  assert.equal(step('Sum, dere').value, '8,33');
  assert.equal(step('Sum, konkurrenten').value, '7,20');
  assert.equal(step('Kvalitetsforsprang i prispoeng').value, '4,67');
  assert.equal(step('Likt ved').value, '1 875 000 kr');
  assert.match(step('Kontroll').formula, /blir summen 7,20 for dere og 7,20 for konkurrenten/);
});

test('lineær: samme tall gir lavere likt-pris, og hvert kvalitetspoeng er verdt det samme', () => {
  const r = simulateAward({ ...base, model: 'lineaer' });
  // Dere: 10 − 10 × 100 000 ÷ 1 000 000 = 9; 9 × 0,3 + 5,6 = 8,3.
  near(r.ours.pricePoints, 9);
  near(r.ours.total, 8.3);
  near(r.theirs.total, 7.2);
  // Likt når 10 − 10 × (P − 1 000 000) ÷ 1 000 000 = 10 − 4,6667 → P = 1 466 666,67.
  assert.equal(r.breakEven.kind, 'pris');
  if (r.breakEven.kind === 'pris') near(r.breakEven.price, 1_000_000 * (1 + 14 / 30));
  // Ett poeng mer: 1 000 000 × 0,7 ÷ (0,3 × 10) = 233 333,33 – likt i hele den lineære modellen.
  near(r.qualityPoint!.kr, 700_000 / 3);
  assert.equal(r.steps.find((s) => s.label === 'Prispoeng, dere')!.formula, '10 − 10 × (1 100 000 kr − 1 000 000 kr) ÷ 1 000 000 kr');
});

test('dårligere kvalitet: dere må være billigere – med begge modeller', () => {
  const worse: AwardSimInput = { model: 'forholdsmessig', pricePct: 40, ourPrice: 1_500_000, ourQuality: 5, theirPrice: 2_000_000, theirQuality: 7 };
  // Forspranget er −2 × 0,6 ÷ 0,4 = −3. Forholdsmessig: 10 × P ÷ 2 000 000 = 7 → P = 1 400 000.
  const p = breakEven(worse);
  assert.equal(p.kind, 'pris');
  if (p.kind === 'pris') {
    near(p.price, 1_400_000);
    near(p.vsTheirsPct, -30);
  }
  // Kontroll: dere 10 × 0,4 + 5 × 0,6 = 7; konkurrenten 7 × 0,4 + 7 × 0,6 = 7.
  const at = simulateAward({ ...worse, ourPrice: 1_400_000 });
  near(at.ours.total, 7);
  near(at.theirs.total, 7);
  assert.equal(at.outcome, 'likt');
  // Med 1 500 000 taper dere: konkurrenten får 10 × 1,5 ÷ 2 = 7,5 prispoeng → 7,2 mot deres 7.
  const r = simulateAward(worse);
  assert.equal(r.outcome, 'taper');
  near(r.diff, -0.2);
  // Lineær: 10 − 10 × (2 000 000 − P) ÷ P = 7 → P = 2 000 000 ÷ 1,3 = 1 538 461,54.
  const l = breakEven({ ...worse, model: 'lineaer' });
  if (l.kind === 'pris') near(l.price, 2_000_000 / 1.3);
  else assert.fail('lineær gir alltid en pris');
});

test('forholdsmessig kan gi «uansett pris» og «aldri på pris» – lineær gir alltid en pris', () => {
  // Forsprang 5 × 0,8 ÷ 0,2 = 20 ≥ 10: prispoengene kan aldri falle så langt.
  const ahead: AwardSimInput = { model: 'forholdsmessig', pricePct: 20, ourPrice: 1_000_000, ourQuality: 10, theirPrice: 1_000_000, theirQuality: 5 };
  assert.deepEqual(breakEven(ahead), { kind: 'alltid' });
  const r = simulateAward(ahead);
  assert.equal(r.qualityPoint, null);
  assert.equal(r.steps.at(-1)!.value, 'ingen pris');
  // Lineær: 10 − 10 × (P − Pt) ÷ Pt = −10 → P = 3 × Pt (minuspoeng er med).
  const lin = breakEven({ ...ahead, model: 'lineaer' });
  if (lin.kind === 'pris') near(lin.price, 3_000_000);
  else assert.fail('lineær gir en pris');
  near(simulateAward({ ...ahead, model: 'lineaer', ourPrice: 3_000_000 }).ours.pricePoints, -10);
  // Motsatt vei: konkurrentens forsprang er for stort.
  assert.deepEqual(breakEven({ ...ahead, ourQuality: 5, theirQuality: 10 }), { kind: 'aldri' });
  const linBehind = breakEven({ ...ahead, model: 'lineaer', ourQuality: 5, theirQuality: 10 });
  if (linBehind.kind === 'pris') near(linBehind.price, 1_000_000 / 3);
  else assert.fail('lineær gir en pris');
});

test('lik kvalitet og bare pris: laveste pris vinner, og kvalitetspoeng trengs ikke', () => {
  const same = breakEven({ ...base, theirQuality: 8 });
  if (same.kind === 'pris') near(same.price, 1_000_000);
  const parsed = parseAwardSim({ model: 'lineaer', pricePct: '100', ourPrice: '900 000', ourQuality: '', theirPrice: '1 000 000', theirQuality: '' });
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const r = simulateAward(parsed.input);
  assert.equal(r.outcome, 'vinner');
  assert.equal(r.qualityPoint, null);
  assert.ok(!r.steps.some((s) => s.label === 'Kvalitetsforsprang i prispoeng'));
  assert.equal(r.steps.find((s) => s.label === 'Sum, dere')!.formula, '10,00 × 100 %');
});

test('skjemaet: norsk tallformat og feil per felt – ingenting gjettes', () => {
  const ok = parseAwardSim({ model: 'forholdsmessig', pricePct: '30 %', ourPrice: '1 100 000 kr', ourQuality: '8,5', theirPrice: '1.000.000', theirQuality: '6' });
  assert.deepEqual(ok, { ok: true, input: { model: 'forholdsmessig', pricePct: 30, ourPrice: 1_100_000, ourQuality: 8.5, theirPrice: 1_000_000, theirQuality: 6 } });
  const bad = parseAwardSim({ model: 'annen', pricePct: '0', ourPrice: 'mye', ourQuality: '11', theirPrice: '', theirQuality: '' });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.deepEqual(Object.keys(bad.errors).sort(), ['model', 'ourPrice', 'ourQuality', 'pricePct', 'theirPrice', 'theirQuality']);
  assert.equal(bad.errors.pricePct, 'Vekt på pris: må være over 0 og høyst 100.');
  assert.equal(bad.errors.ourPrice, 'Deres pris: skriv et tall.');
  assert.equal(bad.errors.ourQuality, 'Deres kvalitetspoeng: må være mellom 0 og 10.');
  assert.equal(bad.errors.theirPrice, 'Skriv prisen dere tror konkurrenten byr.');
  assert.equal(bad.errors.theirQuality, 'Skriv konkurrentens kvalitetspoeng fra 0 til 10.');
  const negative = parseAwardSim({ model: 'lineaer', pricePct: '30', ourPrice: '-5', ourQuality: '5', theirPrice: '0', theirQuality: '5' });
  assert.ok(!negative.ok && negative.errors.ourPrice === 'Deres pris: må være over 0.' && negative.errors.theirPrice === 'Konkurrentens pris: må være over 0.');
});

test('vektene fra kunngjøringen fylles bare inn når de kan leses sikkert', () => {
  const nb = (n: string) => n.replace(' ', ' ');
  assert.deepEqual(
    noticeWeights([
      { name: 'Pris', type: 'price', weight: nb('30 %') },
      { name: 'Kvalitet', type: 'quality', weight: nb('40 %') },
      { name: 'Miljø', type: 'quality', weight: nb('30 %') },
    ]),
    {
      pricePct: 30,
      criteria: [
        { name: 'Pris', pct: 30, price: true },
        { name: 'Kvalitet', pct: 40, price: false },
        { name: 'Miljø', pct: 30, price: false },
      ],
    },
  );
  // Desimaler med punktum (TED) og komma, kostnad som priskriterium, og summen 99,99.
  assert.equal(noticeWeights([{ name: 'Price', type: 'price', weight: '30.00 %' }, { name: 'Quality', type: 'quality', weight: '70.00 %' }])?.pricePct, 30);
  assert.equal(
    noticeWeights([
      { name: 'Livsløpskostnad', type: 'cost', weight: '33,33 %' },
      { name: 'Kvalitet', type: 'quality', weight: '33,33 %' },
      { name: 'Service', type: 'quality', weight: '33,33 %' },
    ])?.pricePct,
    33.33,
  );
  // Poeng som summerer til 100 er det samme som prosent.
  assert.equal(noticeWeights([{ name: 'Pris', type: 'price', weight: '40 poeng' }, { name: 'Kvalitet', type: 'quality', weight: '60 poeng' }])?.pricePct, 40);
  // Miljø som bare er krav i spesifikasjonen, er ikke et kriterium.
  assert.equal(
    noticeWeights([
      { name: 'Pris', type: 'price', weight: '50 %' },
      { name: 'Kvalitet', type: 'quality', weight: '50 %' },
      { name: 'Miljøkrav', type: 'quality-nor-env-spec', weight: '30 %' },
    ])?.pricePct,
    50,
  );
  // Ikke sikkert nok: ingenting fylles inn.
  for (const [why, list] of [
    ['ingen kriterier', []],
    ['vekt mangler', [{ name: 'Pris', type: 'price', weight: null }, { name: 'Kvalitet', type: 'quality', weight: '70 %' }]],
    ['summen er ikke 100', [{ name: 'Pris', type: 'price', weight: '30 %' }, { name: 'Kvalitet', type: 'quality', weight: '60 %' }]],
    ['to priskriterier', [{ name: 'Timepris', type: 'price', weight: '20 %' }, { name: 'Fastpris', type: 'price', weight: '30 %' }, { name: 'Kvalitet', type: 'quality', weight: '50 %' }]],
    ['ukjent type', [{ name: 'Price', type: null, weight: '30 %' }, { name: 'Quality', type: null, weight: '70 %' }]],
    ['blandede enheter', [{ name: 'Pris', type: 'price', weight: '30 %' }, { name: 'Kvalitet', type: 'quality', weight: '70 poeng' }]],
    ['pris uten vekt', [{ name: 'Pris', type: 'price', weight: '0 %' }, { name: 'Kvalitet', type: 'quality', weight: '100 %' }]],
    ['rekkefølge, ikke vekt', [{ name: 'Pris', type: 'price', weight: 'prioritet 1' }, { name: 'Kvalitet', type: 'quality', weight: 'prioritet 2' }]],
  ] as const) {
    assert.equal(noticeWeights(list as never), null, why);
  }
  assert.equal(noticeWeights(null), null);
});
