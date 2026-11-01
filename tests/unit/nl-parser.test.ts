import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNaturalQuery } from '../../src/domain/search/nl-parser';

test('engelsk eksempel fra kravspesifikasjonen tolkes til filtre', () => {
  const r = parseNaturalQuery('Find construction contracts in Norway worth more than 5 million NOK with deadlines at least 30 days away.');
  assert.deepEqual(r.query.industries, ['construction']);
  assert.deepEqual(r.query.countries, ['NO']);
  assert.equal(r.query.valueMin, 5_000_000);
  assert.equal(r.query.deadlineMinDays, 30);
  assert.ok(r.interpretations.length >= 4, 'alt som tolkes skal vises for brukeren');
});

test('norsk: fylke, beløp og frist', () => {
  const r = parseNaturalQuery('byggekontrakter i Trøndelag over 5 millioner med frist om minst 30 dager');
  assert.deepEqual(r.query.regions, ['50']);
  assert.equal(r.query.valueMin, 5_000_000);
  assert.equal(r.query.deadlineMinDays, 30);
});

test('beløp med mellomrom og «kr» blir ikke tolket som millioner', () => {
  const r = parseNaturalQuery('åpne anbud på programvare under 500 000 kr');
  assert.equal(r.query.valueMax, 500_000);
  assert.deepEqual(r.query.statuses, ['open']);
  assert.deepEqual(r.query.industries, ['it']);
});

test('intervall, landsdel og publiseringsperiode', () => {
  const r = parseNaturalQuery('vakthold mellom 1 og 3 mill i Midt-Norge publisert siste 2 uker');
  assert.equal(r.query.valueMin, 1_000_000);
  assert.equal(r.query.valueMax, 3_000_000);
  assert.equal(r.query.publishedWithinDays, 14);
  assert.deepEqual([...(r.query.regions ?? [])].sort(), ['15', '50']);
  assert.deepEqual(r.query.industries, ['security']);
});

test('sted som ikke er fylke blir stedsfilter, resten søkeord', () => {
  const r = parseNaturalQuery('renhold av skoler i Trondheim');
  assert.equal(r.query.place, 'Trondheim');
  assert.deepEqual(r.query.industries, ['cleaning']);
  assert.equal(r.query.q, 'skoler');
});

test('standarder beholdes som søkeord', () => {
  const r = parseNaturalQuery('ISO 27001 pentest');
  assert.equal(r.query.q, 'iso 27001');
  assert.deepEqual(r.query.industries, ['cybersecurity']);
});

test('frist innen N dager og status «tildelte»', () => {
  assert.equal(parseNaturalQuery('IT-sikkerhet med frist innen 14 dager').query.deadlineMaxDays, 14);
  assert.deepEqual(parseNaturalQuery('tildelte kontrakter for vekter i Oslo').query.statuses, ['awarded']);
});

test('tom eller meningsløs tekst gir ingen filtre', () => {
  assert.deepEqual(parseNaturalQuery('').query, {});
  const r = parseNaturalQuery('   ');
  assert.equal(r.interpretations.length, 0);
});
