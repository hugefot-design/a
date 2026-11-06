import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, expectedEnd, monthsUntil } from '../../src/domain/competitors/expiry';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | undefined) => x?.toISOString().slice(0, 10);

test('måneder legges til uten å hoppe over månedsslutt', () => {
  assert.equal(iso(addMonths(d('2026-01-31'), 1)), '2026-02-28');
  assert.equal(iso(addMonths(d('2028-01-31'), 1)), '2028-02-29', 'skuddår');
  assert.equal(iso(addMonths(d('2026-03-15'), 24)), '2028-03-15');
  assert.equal(iso(addMonths(d('2026-03-15'), -3)), '2025-12-15');
  assert.equal(monthsUntil(d('2027-03-01'), d('2026-03-01')), 12);
  assert.equal(monthsUntil(d('2026-01-01'), d('2026-03-01')), -2);
});

test('utløp: oppgitt sluttdato først, ellers oppstart eller tildeling + varighet – aldri gjettet', () => {
  assert.deepEqual(
    expectedEnd({ contractEnd: d('2027-06-30'), contractStart: null, durationMonths: null, awardDate: null }),
    { end: d('2027-06-30'), basis: 'oppgitt', start: null, durationMonths: null },
  );
  assert.equal(iso(expectedEnd({ contractEnd: null, contractStart: d('2026-01-01'), durationMonths: 24, awardDate: d('2025-11-01') })?.end), '2028-01-01', 'oppstart foran tildelingsdato');
  assert.equal(iso(expectedEnd({ contractEnd: null, contractStart: null, durationMonths: 12, awardDate: d('2025-11-01') })?.end), '2026-11-01');
  assert.equal(expectedEnd({ contractEnd: null, contractStart: null, durationMonths: 12, awardDate: null }), null, 'uten dato');
  assert.equal(expectedEnd({ contractEnd: null, contractStart: d('2026-01-01'), durationMonths: null, awardDate: null }), null, 'uten varighet');
  assert.equal(expectedEnd({ contractEnd: null, contractStart: d('2026-01-01'), durationMonths: 600, awardDate: null }), null, 'urimelig varighet');
});
