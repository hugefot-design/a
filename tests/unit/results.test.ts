import { test } from 'node:test';
import assert from 'node:assert/strict';
import { companyKey, comparableWinningPrice, distinctAwards, learningSummary, median, parseResultForm, type AwardRow, type ResultRow } from '../../src/domain/tenders/results';

const award = (over: Partial<AwardRow> = {}): AwardRow => ({
  tenderId: 't1',
  supplierId: 's1',
  supplierName: 'Vinner AS',
  supplierOrgNumber: '999888777',
  lotTitle: null,
  awardedValue: null,
  currency: 'NOK',
  awardDate: null,
  ...over,
});

let n = 0;
const row = (over: Partial<ResultRow> = {}): ResultRow => ({
  bookmarkId: `b${++n}`,
  tenderId: `t${n}`,
  title: `Anbud ${n}`,
  buyerName: 'Kommunen',
  authorityId: 'a1',
  status: 'lost',
  ourPrice: null,
  winningPrice: null,
  winnerName: null,
  reason: null,
  outcomeSource: null,
  decidedAt: null,
  submittedAt: null,
  deadlineAt: null,
  isFramework: false,
  currency: 'NOK',
  calcTargetPrice: null,
  awards: [],
  ...over,
});

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

test('resultatskjema: norske tall, tomme felt og ugyldige verdier', () => {
  const ok = parseResultForm(form({ ourPrice: '1 250 000', winningPrice: '1.100.000,50', winnerName: '  Vinner AS ', reason: 'pris' }));
  assert.deepEqual(ok, { ok: true, data: { ourPrice: 1_250_000, winningPrice: 1_100_000.5, winnerName: 'Vinner AS', reason: 'pris' } });
  assert.deepEqual(parseResultForm(form({ ourPrice: '', winningPrice: '', winnerName: '', reason: '' })), {
    ok: true,
    data: { ourPrice: null, winningPrice: null, winnerName: null, reason: null },
  });
  assert.equal(parseResultForm(form({ ourPrice: 'mye' })).ok, false);
  assert.equal(parseResultForm(form({ ourPrice: '-5' })).ok, false);
  assert.equal(parseResultForm(form({ reason: 'flaks' })).ok, false);
});

test('tildelinger: samme vinner i TED og Doffin telles én gang, og org.nr. viser om det er dere', () => {
  const list = distinctAwards(
    [award({ awardedValue: null }), award({ supplierName: 'VINNER AS', awardedValue: 900_000 }), award({ supplierId: 's2', supplierName: 'Oss AS', supplierOrgNumber: '123456785' })],
    '123456785',
  );
  assert.equal(list.length, 2);
  assert.equal(list[0]!.awardedValue, 900_000, 'verdien fra kilden som har den beholdes');
  assert.deepEqual(
    list.map((a) => a.isUs),
    [false, true],
  );
  assert.ok(!distinctAwards([award()], null)[0]!.isUs, 'uten org.nr. er ingen «dere»');
});

test('vinnerpris: tildelingsbrevet først, ellers én vinner uten rammeavtale', () => {
  const single = [{ ...award({ awardedValue: 800_000 }), isUs: false }];
  assert.deepEqual(comparableWinningPrice(row({ winningPrice: 750_000, awards: single })), { price: 750_000, source: 'tildelingsbrev' });
  assert.deepEqual(comparableWinningPrice(row({ awards: single })), { price: 800_000, source: 'kunngjøring' });
  assert.equal(comparableWinningPrice(row({ awards: single, isFramework: true })), null, 'rammeavtale: verdien er ofte et anslag');
  assert.equal(comparableWinningPrice(row({ awards: [...single, { ...award({ supplierId: 's3', supplierName: 'Annen AS', supplierOrgNumber: '111' }), isUs: false }] })), null, 'flere vinnere');
  assert.equal(comparableWinningPrice(row({ awards: [{ ...single[0]!, currency: 'EUR' }] })), null, 'annen valuta');
  assert.equal(comparableWinningPrice(row({ status: 'won', winningPrice: 1 })), null, 'bare tapte anbud har en annen vinner');
});

test('læring: vinnerandel, prisavvik, kalkyle mot resultat, hvem vant og oppdragsgivere', () => {
  const rows = [
    row({ status: 'won', ourPrice: 1_000_000, calcTargetPrice: 1_100_000, reason: 'kvalitet' }),
    row({ status: 'lost', ourPrice: 1_200_000, winningPrice: 1_000_000, winnerName: 'Rask AS', reason: 'pris', calcTargetPrice: 1_150_000 }),
    row({ status: 'lost', ourPrice: 900_000, reason: 'pris', awards: [{ ...award({ awardedValue: 1_000_000, supplierName: 'Rask AS', supplierOrgNumber: '222' }), isUs: false }] }),
    row({ status: 'lost', reason: 'avvist', buyerName: 'Fylket', authorityId: 'a2' }),
    row({ status: 'submitted' }),
  ];
  const l = learningSummary(rows);
  assert.equal(l.delivered, 5);
  assert.equal(l.won, 1);
  assert.equal(l.lost, 3);
  assert.equal(l.pending, 1);
  assert.equal(l.winRatePct, 25);
  assert.deepEqual(
    l.priceVsWinner.map((p) => [p.diffPct, p.source]),
    [
      [20, 'tildelingsbrev'],
      [-10, 'kunngjøring'],
    ],
  );
  assert.equal(l.medianPriceDiffPct, 5);
  assert.deepEqual(
    l.calcVsResult.map((p) => [p.diffPct, p.source]),
    [
      [10, 'egen_pris'],
      [15, 'tildelingsbrev'],
    ],
  );
  assert.equal(l.medianCalcDiffPct, 12.5);
  assert.deepEqual(
    l.reasons.map((r) => [r.reason, r.won, r.lost]),
    [
      ['pris', 0, 2],
      ['kvalitet', 1, 0],
      ['avvist', 0, 1],
    ],
  );
  // «Rask AS» fra tildelingsbrevet (bare navn) og fra kunngjøringen (med org.nr.) er samme selskap.
  assert.deepEqual(
    l.winnersAgainstUs.map((w) => [w.name, w.count, w.supplierId]),
    [['Rask AS', 2, 's1']],
  );
  assert.deepEqual(
    l.buyers.map((b) => [b.name, b.delivered, b.won, b.lost]),
    [
      ['Kommunen', 4, 1, 2],
      ['Fylket', 1, 0, 1],
    ],
  );
  assert.equal(l.awaiting.length, 1);
});

test('selskapsnavn: selskapsform og tegn betyr ikke noe', () => {
  assert.equal(companyKey('Rask Renhold AS'), companyKey('RASK RENHOLD A/S'));
  assert.equal(companyKey('Asker Vakt ASA'), 'asker vakt', '«as» inne i et ord fjernes ikke');
  assert.notEqual(companyKey('Rask AS'), companyKey('Rask Bygg AS'));
});

test('læring: ingen avgjorte gir ingen vinnerandel, og median av tom liste er null', () => {
  const l = learningSummary([row({ status: 'submitted' })]);
  assert.equal(l.winRatePct, null);
  assert.equal(l.medianPriceDiffPct, null);
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
});
