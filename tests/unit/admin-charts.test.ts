/**
 * Diagrammene i admin: runde aksetall, norske datoer og status for datakildene.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, niceScale } from '../../src/ui/charts';
import { sourceState, staleAfterMs } from '../../src/domain/admin/overview';

test('aksen får runde tall som dekker høyeste verdi, aldri brøker for antall', () => {
  assert.deepEqual(niceScale(0), { top: 1, step: 1, ticks: [0, 1] });
  assert.deepEqual(niceScale(1).ticks, [0, 1]);
  assert.deepEqual(niceScale(3).ticks, [0, 1, 2, 3]);
  assert.deepEqual(niceScale(7).ticks, [0, 2, 4, 6, 8]);
  assert.deepEqual(niceScale(10).ticks, [0, 5, 10]);
  assert.deepEqual(niceScale(140).ticks, [0, 50, 100, 150]);
  for (const max of [1, 2, 3, 7, 9, 13, 99, 101, 1234]) {
    const s = niceScale(max);
    assert.ok(s.top >= max, `${max}: toppen dekker verdien`);
    assert.ok(s.ticks.every((t) => Number.isInteger(t)), `${max}: hele tall`);
    assert.ok(s.ticks.length <= 6, `${max}: få aksetall`);
  }
});

test('datoer vises på norsk uten tidssoneforskyvning', () => {
  assert.equal(dayLabel('2026-11-03'), '3. nov.');
  assert.equal(dayLabel('2026-05-17'), '17. mai');
  assert.equal(dayLabel('2026-12-31'), '31. des.');
});

test('status for datakilder: feil, gammel, av og ok', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const ted = { id: 'ted', enabled: true };
  assert.equal(sourceState({ ...ted, lastSuccessAt: ago(60_000), lastErrorAt: null }, now), 'ok');
  assert.equal(sourceState({ ...ted, lastSuccessAt: ago(3_600_000), lastErrorAt: ago(60_000) }, now), 'feil', 'feil etter siste suksess');
  assert.equal(sourceState({ ...ted, lastSuccessAt: ago(60_000), lastErrorAt: ago(3_600_000) }, now), 'ok', 'gammel feil teller ikke');
  assert.equal(sourceState({ ...ted, lastSuccessAt: ago(staleAfterMs() + 60_000), lastErrorAt: null }, now), 'gammel');
  assert.equal(sourceState({ ...ted, lastSuccessAt: null, lastErrorAt: null }, now), 'gammel', 'aldri hentet');
  assert.equal(sourceState({ ...ted, enabled: false, lastSuccessAt: null, lastErrorAt: null }, now), 'av');
  // Manuell import har ingen automatisk henting og blir aldri «gammel».
  assert.equal(sourceState({ id: 'manual', enabled: true, lastSuccessAt: null, lastErrorAt: null }, now), 'ok');
});
