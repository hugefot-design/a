import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesAnyIndustry, measureVolume } from '../../src/connectors/volume';
import type { NormalizedNotice } from '../../src/domain/tenders/normalize';

const notice = (cpv: string[], lifecycle: string, currency: string | null, rawSize: number) =>
  ({ title: 'x', cpvCodes: cpv, lifecycle, currency, raw: { text: 'a'.repeat(rawSize) } }) as unknown as NormalizedNotice;

test('measureVolume: per måned, åpne konkurranser, bransjetreff og plass', () => {
  const since = new Date('2026-10-08T00:00:00Z');
  const until = new Date('2026-10-18T00:00:00Z'); // 10 dager
  const notices = [
    notice(['45210000'], 'competition', 'SEK', 4000),
    notice(['72000000'], 'competition', 'SEK', 4000),
    notice(['03100000'], 'awarded', 'EUR', 4000), // landbruk: ingen bransje i AnbudRadar
    notice([], 'planned', null, 4000),
  ];
  const v = measureVolume(notices, since, until);
  assert.equal(v.notices, 4);
  assert.equal(v.days, 10);
  assert.equal(v.perMonth, 12);
  assert.equal(v.competitionsPerMonth, 6);
  assert.equal(v.relevantPct, 50);
  assert.deepEqual(v.currencies, { SEK: 2, EUR: 1 });
  assert.ok(v.avgRawKb >= 3.9 && v.avgRawKb <= 4.0, String(v.avgRawKb));
  assert.ok(v.estimatedMbPerMonth > 0);
  assert.equal(v.topCpvDivisions[0]!.count, 1);
  assert.equal(measureVolume([], since, until).relevantPct, 0);
});

test('matchesAnyIndustry: bygg og IT passer, landbruk ikke', () => {
  assert.equal(matchesAnyIndustry(['45000000']), true);
  assert.equal(matchesAnyIndustry(['72212000']), true);
  assert.equal(matchesAnyIndustry(['03100000']), false);
  assert.equal(matchesAnyIndustry([]), false);
});
