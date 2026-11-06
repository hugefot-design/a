import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpvLevels, marketStats, pickCpv, pricePositions, quantile, shareAbove, summarizeMarket, type MarketPrice } from '../../src/domain/profit/market';
import { niceRange } from '../../src/ui/charts';
import { cpvPrefixes } from '../../src/domain/tenders/normalize';

const row = (value: number, over: Partial<Parameters<typeof summarizeMarket>[0][number]> = {}) => ({
  tenderId: `t${value}`,
  title: `Kontrakt ${value}`,
  buyerName: 'Kommunen',
  supplierName: 'Vinner AS',
  value,
  currency: 'NOK',
  awardDate: new Date('2026-01-01'),
  durationMonths: 24,
  isFramework: false,
  ...over,
});

test('kvartiler og andel dyrere: samme metode som regneark', () => {
  const s = [1, 2, 3, 4];
  assert.equal(quantile(s, 0.5), 2.5);
  assert.equal(quantile(s, 0.25), 1.75);
  assert.deepEqual(marketStats([4, 1, 3, 2]), { n: 4, min: 1, p25: 1.75, median: 2.5, p75: 3.25, max: 4 });
  assert.equal(marketStats([1, 2]), null, 'færre enn tre gir ingen statistikk');
  assert.equal(shareAbove([1, 2, 3, 4], 2.5), 50);
  assert.equal(shareAbove([1, 2, 3, 4], 0), 100);
  assert.equal(shareAbove([1, 2, 3, 4], 9), 0);
});

test('CPV-nivåer: kategori, klasse og gruppe – aldri bare hovedgruppe', () => {
  assert.deepEqual(cpvLevels('79713000'), ['79713', '7971', '797']);
  assert.deepEqual(cpvLevels('90910000'), ['9091', '909']);
  assert.deepEqual(cpvLevels('45000000'), [], 'for bred kode (bygg og anlegg) sammenlignes ikke');
  assert.deepEqual(cpvLevels(null), []);
  assert.deepEqual(cpvLevels('ukjent'), []);
  // Prefiksene må finnes i det som lagres på anbudene, ellers finner søket ingenting.
  for (const code of ['79713000', '90910000', '45233141', '50700000']) {
    const stored = new Set(cpvPrefixes([code]));
    for (const level of cpvLevels(code)) assert.ok(stored.has(level), `${level} lagres for ${code}`);
  }
});

test('CPV-valg: spesifikk hovedkode, ellers den mest spesifikke av de andre', () => {
  assert.equal(pickCpv('79713000', ['79710000']), '79713000');
  assert.equal(pickCpv('45000000', ['45233141', '45200000']), '45233141');
  assert.equal(pickCpv(null, ['90910000']), '90910000');
  assert.equal(pickCpv(null, []), null);
});

test('markedsgrunnlag: rammeavtaler og annen valuta holdes utenfor og telles, per år krever varighet', () => {
  const m = summarizeMarket(
    [
      row(2_000_000),
      row(3_000_000, { durationMonths: 36 }),
      row(4_000_000, { durationMonths: null }),
      row(9_000_000, { isFramework: true }),
      row(1_000_000, { currency: 'EUR' }),
      row(2_400_000, { durationMonths: 12, awardDate: new Date('2026-06-01') }),
    ],
    'NOK',
  );
  assert.deepEqual(m.excluded, { frameworks: 1, otherCurrency: 1 });
  assert.equal(m.awards.length, 4);
  assert.equal(m.awards[0]!.value, 2_400_000, 'nyeste først');
  assert.deepEqual(
    m.awards.map((a) => a.perYear),
    [2_400_000, 1_000_000, 1_000_000, null],
  );
  assert.deepEqual(m.perYear, { n: 3, min: 1_000_000, p25: 1_000_000, median: 1_000_000, p75: 1_700_000, max: 2_400_000 });
  assert.equal(m.total?.n, 4);
});

test('prisposisjon: per år når varigheten er kjent, ellers totalt; priser som mangler hoppes over', () => {
  const base = summarizeMarket([row(2_000_000), row(4_000_000), row(6_000_000), row(8_000_000)], 'NOK');
  const market: MarketPrice = { match: { prefix: '7971', code: '79710000', label: 'Vakttjenester' }, ...base };
  const perYear = pricePositions(market, 24, [
    { key: 'malpris', label: 'Målpris', total: 6_000_000 },
    { key: 'testpris', label: 'Testpris', total: null },
  ]);
  assert.equal(perYear?.unit, 'per_year');
  assert.deepEqual(perYear?.positions, [{ key: 'malpris', label: 'Målpris', value: 3_000_000, cheaperThanPct: 25 }]);
  const total = pricePositions(market, null, [{ key: 'malpris', label: 'Målpris', total: 5_000_000 }]);
  assert.equal(total?.unit, 'total');
  assert.equal(total?.positions[0]?.cheaperThanPct, 50);
  const tooFew = summarizeMarket([row(1), row(2)], 'NOK');
  assert.equal(pricePositions({ match: null, ...tooFew }, 12, []), null);
});

test('akse: runde verdier som dekker hele intervallet', () => {
  assert.deepEqual(niceRange(1_150_000, 2_900_000), { start: 1_000_000, end: 3_000_000, ticks: [1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_000_000] });
  const same = niceRange(500, 500);
  assert.ok(same.start < 500 && same.end > 500, 'ett punkt får luft på begge sider');
});
