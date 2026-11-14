/**
 * Verktøyene uten konto: lønnsomhetssjekken bruker appens formler og gjetter aldri, og «Prøv uten konto»
 * bygger en profil av bare det besøkende velger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_QUICK_CALC, parseQuickCalc, quickCalc } from '../../src/domain/profit/quick-calc';
import { placeText, quickProfile } from '../../src/domain/matching/quick';

const form = (over: Partial<typeof EMPTY_QUICK_CALC>) => ({ ...EMPTY_QUICK_CALC, ...over });

test('lønnsomhetssjekken: selvkost, målpris og margin ved kontraktsverdien – med appens formler', () => {
  const parsed = parseQuickCalc(form({ hours: '18 000', hourlyCost: '620 kr', materials: '32.000.000', other: '4 500 000', overheadPct: '8 %', marginPct: '10', contractValue: '52 000 000' }));
  assert.ok(parsed.ok);
  const r = quickCalc(parsed.input);
  // (18 000 × 620 + 32 000 000 + 4 500 000) × 1,08
  assert.equal(r.calc.directCost, 47_660_000);
  assert.equal(r.calc.breakEven, 51_472_800);
  // 51 472 800 ÷ (1 − 0,10)
  assert.equal(r.calc.targetPrice, 57_192_000);
  assert.equal(r.calc.atContractValue?.profit, 527_200);
  assert.equal(r.calc.atContractValue?.marginPct, 1.01);
  assert.equal(r.verdict, 'under_target');
  assert.deepEqual(r.contractValue, { value: 52_000_000, basis: 'bruker' });
  // Følsomhet: +10 % kostnader gir tap ved samme kontraktsverdi.
  const plus10 = r.calc.sensitivity.find((s) => s.increasePct === 10)!;
  assert.equal(plus10.cost, 56_620_080);
  assert.ok(plus10.marginAtContractValue! < 0);
  // Utregningen vises steg for steg – uten risikopåslag og minstepris, som sjekken ikke har.
  assert.deepEqual(
    r.steps.map((f) => f.label),
    ['Direkte kostnader', 'Indirekte kostnader', 'Selvkost (pris uten tap)', 'Målpris (margin 10 %)'],
  );
  assert.equal(r.steps.at(-1)!.formula.replace(/[\u00a0\u202f]/g, ' '), '(51 472 800 kr) ÷ (1 − 10 %)');
  assert.equal(r.steps.at(-1)!.value, 57_192_000);
});

test('lønnsomhetssjekken: oppdragsgivers anslag brukes bare når besøkende ikke har skrevet egen verdi – og merkes', () => {
  const base = { hours: '100', hourlyCost: '500', marginPct: '20' };
  const fromNotice = quickCalc((parseQuickCalc(form(base)) as { ok: true; input: never }).input, { value: 100_000, isFramework: true });
  assert.deepEqual(fromNotice.contractValue, { value: 100_000, basis: 'dokument' });
  assert.equal(fromNotice.verdict, 'over_target'); // 50 000 i kostnad, 50 % margin
  assert.match(fromNotice.calc.atContractValue?.note ?? '', /Rammeavtale/);

  const own = quickCalc((parseQuickCalc(form({ ...base, contractValue: '40 000' })) as { ok: true; input: never }).input, { value: 100_000, isFramework: true });
  assert.deepEqual(own.contractValue, { value: 40_000, basis: 'bruker' });
  assert.equal(own.verdict, 'loss');

  const none = quickCalc((parseQuickCalc(form(base)) as { ok: true; input: never }).input);
  assert.equal(none.contractValue, null);
  assert.equal(none.verdict, null, 'uten kontraktsverdi gis ingen vurdering – ingenting anslås');
  assert.equal(none.calc.targetPrice, 62_500);
});

test('lønnsomhetssjekken: ugyldige og manglende tall gir feil per felt, ingen stille standardverdier', () => {
  const bad = parseQuickCalc(form({ hours: 'mange', hourlyCost: '500', marginPct: '10' }));
  assert.ok(!bad.ok && bad.errors.hours?.includes('skriv et tall'));
  const half = parseQuickCalc(form({ hours: '100', marginPct: '10' }));
  assert.ok(!half.ok && half.errors.hourlyCost?.includes('både timer og timekost'));
  const empty = parseQuickCalc(form({ marginPct: '10' }));
  assert.ok(!empty.ok && empty.errors.hours?.includes('minst én kostnad'));
  const noMargin = parseQuickCalc(form({ materials: '1000' }));
  assert.ok(!noMargin.ok && noMargin.errors.marginPct);
  const tooHigh = parseQuickCalc(form({ materials: '1000', marginPct: '120' }));
  assert.ok(!tooHigh.ok && tooHigh.errors.marginPct?.includes('mellom 0 og 95'));
  const negative = parseQuickCalc(form({ materials: '-5', marginPct: '10' }));
  assert.ok(!negative.ok && negative.errors.materials);
});

test('«Prøv uten konto»: profilen er bare valgene – ordene ryddes og begrenses, resten er tomt', () => {
  const p = quickProfile('cleaning', '50', ' Kontorrenhold, vinduspuss ,  kontorrenhold, x ');
  assert.deepEqual(p.industries, ['cleaning']);
  assert.deepEqual(p.regions, ['50']);
  assert.deepEqual(p.keywords, ['kontorrenhold', 'vinduspuss']);
  assert.deepEqual(p.certifications, []);
  assert.equal(p.minContractValue, null);
  assert.deepEqual(quickProfile('cleaning', null, '').regions, []);
  assert.equal(quickProfile('cleaning', null, 'a'.repeat(500)).services?.length, 200);
});

test('«Prøv uten konto»: stedet vises kort – ikke en liste med alle fylkene', () => {
  assert.equal(placeText({ regionCodes: ['50'], placeText: 'Trondheim' }), 'Trøndelag');
  assert.equal(placeText({ regionCodes: [], placeText: 'Bodø' }), 'Bodø');
  assert.equal(placeText({ regionCodes: [], placeText: null }), null);
  assert.equal(placeText({ regionCodes: ['03', '32', '31', '33'], placeText: null }), 'Oslo, Akershus og 2 til');
  assert.equal(placeText({ regionCodes: ['03', '32', '31', '33', '34', '39', '40', '42', '11', '46'], placeText: null }), 'Hele landet');
});
