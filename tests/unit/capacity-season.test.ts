import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCapacity, monthsLabel, parseMonths, type CapacityInput } from '../../src/domain/profit/capacity';

const base = (over: Partial<CapacityInput> = {}): CapacityInput => ({
  availableHoursPerYear: 1800, // 150 t per måned
  employeeCount: 1,
  contracts: [],
  requiredHoursPerYear: 1000,
  periodStart: new Date('2027-01-01'),
  periodEnd: new Date('2028-01-01'),
  equipmentNeeds: [],
  equipment: [],
  missingQualifications: [],
  ...over,
});

test('måneder fra skjema og som tekst – også perioder over nyttår', () => {
  assert.deepEqual(parseMonths(['11', '12', '1', '2', '3', '3', 'x', '13']), [1, 2, 3, 11, 12]);
  assert.equal(parseMonths([]), null, 'ingen = hele året');
  assert.equal(parseMonths(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']), null, 'alle = hele året');
  assert.equal(monthsLabel([11, 12, 1, 2, 3]), 'nov–mar');
  assert.equal(monthsLabel([6, 7, 8]), 'jun–aug');
  assert.equal(monthsLabel([1, 3, 6]), 'jan, mar, jun');
  assert.equal(monthsLabel([6, 7]), 'jun, jul');
  assert.equal(monthsLabel([1, 2, 5, 11, 12]), 'mai, nov–feb', 'perioder i rekkefølge etter startmåned');
  assert.equal(monthsLabel(null), 'hele året');
});

test('sesongtopp: året går opp, men vintermånedene mangler timer', () => {
  const r = analyzeCapacity(base({ requiredActiveMonths: [11, 12, 1, 2, 3] })); // 1000 t over 5 mnd = 200 t/mnd
  assert.equal(r.gapHoursPerYear! <= 0, true, 'samlet for året er det nok');
  assert.deepEqual(r.seasonalShortage, { months: [1, 2, 3, 11, 12], maxGapHours: 50 });
  assert.equal(r.status, 'mangler', '50 av 200 timer (25 %) mangler i toppmånedene');
  assert.ok(r.notes.some((n) => n.startsWith('Sesongtopp: i nov–mar mangler dere opptil 50 timer per måned')));
  const jan = r.months!.find((m) => m.month === 1)!;
  assert.deepEqual([jan.capacity, jan.required, jan.loadPct, jan.gap], [150, 200, 133, 50]);
  const jul = r.months!.find((m) => m.month === 7)!;
  assert.deepEqual([jul.required, jul.gap], [0, null], 'ingen arbeid i juli');
});

test('helårsoppdrag uten sesong: ingen sesongtopp; liten topp gir «stram»', () => {
  const even = analyzeCapacity(base());
  assert.equal(even.seasonalShortage, null);
  assert.equal(even.status, 'ok');
  // 1700 t/år + sesongkontrakt 20 t/mnd nov–mar: årlig 1800 av 1800, men i vintermånedene 141,7 + 20 > 150.
  const tight = analyzeCapacity(
    base({
      requiredHoursPerYear: 1700,
      contracts: [{ name: 'Brøyting', startDate: new Date('2026-01-01'), endDate: null, hoursPerMonth: 20, activeMonths: [11, 12, 1, 2, 3] }],
    }),
  );
  assert.equal(tight.committedHoursPerYear, 100, 'sesongkontrakt: 20 t × 5 mnd, ikke × 12');
  assert.equal(tight.seasonalShortage?.months.length, 5);
  assert.equal(tight.status, 'stram', 'toppen er under 10 % av månedens behov');
});
