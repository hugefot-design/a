import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, computeLine, maxLiquidatedDamages, priceForMargin, workingCapital, type CalcInputs, type CostLine } from '../../src/domain/profit/calculator';
import { scanContractTerms } from '../../src/domain/profit/terms-scan';
import { analyzeCapacity } from '../../src/domain/profit/capacity';
import { recommend } from '../../src/domain/profit/recommendation';

/** Intl (nb-NO) bruker hårfine/ikke-brytende mellomrom i tall – normaliser for sammenligning. */
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

const line = (over: Partial<CostLine>): CostLine => ({
  id: Math.random().toString(36).slice(2),
  category: 'arbeid',
  description: 'Vektere',
  quantity: 100,
  unit: 'timer',
  unitCost: 500,
  period: 'total',
  basis: 'bruker',
  ...over,
});

const base = (over: Partial<CalcInputs> = {}): CalcInputs => ({
  contractValue: 1_000_000,
  contractValueBasis: 'dokument',
  durationMonths: 12,
  durationBasis: 'dokument',
  isFramework: false,
  lines: [line({ quantity: 1000, unitCost: 600 })], // 600 000
  overheadPct: 10,
  riskBufferPct: 5,
  targetMarginPct: 15,
  minMarginPct: 8,
  ...over,
});

test('kalkulator: selvkost, risikopåslag, minstepris, målpris og fortjeneste ved kontraktsverdi', () => {
  const r = calculate(base());
  assert.equal(r.directCost, 600_000);
  assert.equal(r.overhead, 60_000);
  assert.equal(r.breakEven, 660_000);
  assert.equal(r.riskBuffer, 33_000);
  assert.equal(r.costWithBuffer, 693_000);
  // Pris for margin m = (selvkost + risikopåslag) ÷ (1 − m)
  assert.equal(r.minPrice, Math.round((693_000 / 0.92) * 100) / 100);
  assert.equal(r.targetPrice, Math.round((693_000 / 0.85) * 100) / 100);
  assert.deepEqual(r.recommendedRange, { low: r.minPrice, high: r.targetPrice });
  assert.equal(r.atContractValue?.profit, 340_000);
  assert.equal(r.atContractValue?.marginPct, 34);
  assert.equal(r.atContractValue?.basis, 'dokument');
  assert.equal(r.totalHours, 1000);
  assert.equal(r.hoursPerYear, 1000);
  // Hvert hovedtall har en formel
  assert.ok(r.formulas.some((f) => f.label.startsWith('Selvkost') && plain(f.formula).includes('600 000 kr') && f.value === 660_000));
});

test('kalkulator: linjer per måned og per år ganges med varigheten – og formelen viser det', () => {
  const l = computeLine(line({ quantity: 2, unit: 'stk', unitCost: 1500, period: 'per_maaned' }), 24);
  assert.equal(l.total, 72_000);
  assert.equal(plain(l.formula), '2 stk × 1 500 kr × 24 mnd = 72 000 kr');
  const y = computeLine(line({ quantity: 1600, unit: 'timer', unitCost: 520, period: 'per_aar' }), 36);
  assert.equal(y.total, 1600 * 520 * 3);
  assert.equal(y.hours, 4800);
});

test('kalkulator finner aldri på tall: manglende verdier holdes utenfor og varsles', () => {
  const r = calculate(
    base({
      contractValue: null,
      contractValueBasis: 'mangler',
      durationMonths: null,
      targetMarginPct: null,
      minMarginPct: null,
      overheadPct: null,
      lines: [
        line({ quantity: 10, unitCost: 1000 }),
        line({ description: 'Materialer', category: 'materialer', unitCost: null }),
        line({ description: 'Leie per måned', category: 'utstyr', period: 'per_maaned', quantity: 1, unitCost: 5000 }),
      ],
    }),
  );
  assert.equal(r.directCost, 10_000, 'bare linjen med alle tall er med');
  assert.equal(r.completeness.linesMissing, 2);
  assert.equal(r.atContractValue, null);
  assert.equal(r.minPrice, null);
  assert.equal(r.recommendedRange, null);
  assert.ok(r.warnings.some((w) => /2 linjer mangler/.test(w)));
  assert.ok(r.warnings.some((w) => /Kontraktsverdi er ikke oppgitt/.test(w)));
  assert.ok(r.warnings.some((w) => /margin og minstemargin er ikke satt/.test(w)));
  assert.equal(r.lines[1]!.problem, 'Enhetskost mangler');
  assert.match(r.lines[2]!.problem ?? '', /varighet mangler/);
});

test('kalkulator: følsomhet for kostnadsøkning, rammeavtale og minstepris over kontraktsverdi', () => {
  const r = calculate(base({ contractValue: 700_000, isFramework: true }));
  const plus20 = r.sensitivity.find((s) => s.increasePct === 20)!;
  assert.equal(plus20.cost, 792_000, '600 000 × 1,2 × 1,1 (påslag)');
  assert.equal(plus20.profitAtContractValue, Math.round((700_000 - 792_000) * 100) / 100);
  assert.ok(plus20.profitAtContractValue! < 0, '20 % dyrere gir tap ved kontraktsverdien');
  assert.ok(r.warnings.some((w) => /Rammeavtale/.test(w)));
  assert.ok(r.warnings.some((w) => /Minsteprisen .* er høyere enn kontraktsverdien/.test(w)));
  assert.equal(r.atContractValue?.note, 'Rammeavtale: verdien er et anslag eller tak, ikke garantert omsetning.');
});

test('kalkulator: testpris, tilbudskostnad, dagbot og kapitalbinding', () => {
  const r = calculate(base({ testPrice: 800_000, hourlyCost: 600, bidCostHours: 40 }));
  const tp = r.scenarios.find((s) => s.key === 'testpris')!;
  assert.equal(tp.profit, 140_000);
  assert.equal(tp.basis, 'bruker');
  assert.equal(r.bidCost, 24_000);
  assert.equal(priceForMargin(850, 15), 1000);
  assert.equal(priceForMargin(850, 100), null);
  assert.equal(maxLiquidatedDamages(10, 1_000_000), 100_000);
  assert.equal(maxLiquidatedDamages(null, 1_000_000), null, 'ukjent tak gir ingen beregning');
  assert.equal(workingCapital(1_200_000, 12, 60), 200_000);
  assert.equal(workingCapital(1_200_000, null, 60), null);
});

test('kontraktsvilkår finnes med side og utdrag – uten AI', () => {
  const scan = scanContractTerms([
    { id: 'S0', kind: 'notice', title: 'Kunngjøringen', pages: [{ page: null, text: 'Rammeavtale for vakthold. Estimert volum er ikke bindende.' }], totalPages: null, isPrivate: false },
    {
      id: 'D1',
      kind: 'document',
      title: 'Kontraktsvilkår.pdf',
      pages: [
        { page: 3, text: 'Ved forsinkelse påløper dagbot på 1 promille av kontraktssummen per dag, begrenset til 10 %.' },
        { page: 7, text: 'Betalingsfrist er 45 dager etter mottatt faktura. Prisene er faste i hele avtaleperioden.' },
        { page: 9, text: 'Leverandøren skal stille bankgaranti på 10 % av kontraktsverdien. Kontrakten bygger på SSA-D.' },
      ],
      totalPages: 12,
      isPrivate: true,
    },
  ]);
  const dagbot = scan.byCategory.dagbot![0]!;
  assert.deepEqual([dagbot.sourceId, dagbot.page], ['D1', 3]);
  assert.match(dagbot.snippet, /dagbot på 1 promille/);
  assert.equal(scan.byCategory.betalingsvilkar![0]!.page, 7);
  assert.equal(scan.byCategory.prisregulering![0]!.page, 7, '«faste priser» er et prisreguleringsfunn');
  assert.equal(scan.byCategory.garanti![0]!.page, 9);
  assert.ok(scan.byCategory.standardkontrakt);
  assert.ok(scan.notFound.includes('erstatningsansvar'));
  assert.equal(scan.noticeOnly, false);
  assert.equal(scanContractTerms([{ id: 'S0', kind: 'notice', title: 'K', pages: [{ page: null, text: 'Kort tekst.' }], totalPages: null, isPrivate: false }]).noticeOnly, true);
});

test('kapasitet: eksisterende kontrakter i perioden binder timer, og mangler vises', () => {
  const start = new Date('2027-01-01T00:00:00Z');
  const end = new Date('2028-01-01T00:00:00Z');
  const r = analyzeCapacity({
    availableHoursPerYear: 3200,
    employeeCount: 2,
    contracts: [
      { name: 'Skolerenhold', startDate: new Date('2026-01-01'), endDate: new Date('2027-07-02'), hoursPerMonth: 100 }, // halvt år overlapp
      { name: 'Ferdig kontrakt', startDate: new Date('2025-01-01'), endDate: new Date('2026-06-01'), hoursPerMonth: 300 },
    ],
    requiredHoursPerYear: 3000,
    periodStart: start,
    periodEnd: end,
    equipmentNeeds: ['Lift', 'Gulvvaskemaskin'],
    equipment: [{ name: 'Gulvvaskemaskin', quantity: 2 }],
    missingQualifications: [],
  });
  assert.equal(r.overlappingContracts.length, 1);
  assert.ok(Math.abs(r.committedHoursPerYear - 600) < 10, `bundet ${r.committedHoursPerYear}`);
  assert.ok(r.gapHoursPerYear! > 0, 'for lite kapasitet');
  assert.equal(r.status, 'mangler');
  assert.deepEqual(r.equipmentMissing, ['Lift']);
  assert.deepEqual(r.equipmentMatched, [{ need: 'Gulvvaskemaskin', have: 'Gulvvaskemaskin' }]);

  const unknown = analyzeCapacity({ ...{ availableHoursPerYear: null, employeeCount: null, contracts: [], requiredHoursPerYear: 500, periodStart: start, periodEnd: null, equipmentNeeds: [], equipment: [], missingQualifications: [] } });
  assert.equal(unknown.status, 'ukjent');
  assert.ok(unknown.notes.some((n) => /ikke registrert/.test(n)), 'ingen standardtall gjettes');
});

test('anbefaling: vurder å by bare med god margin, analyserte vilkår og kapasitet – ellers begrunnet', () => {
  const okCapacity = analyzeCapacity({
    availableHoursPerYear: 5000,
    employeeCount: 4,
    contracts: [],
    requiredHoursPerYear: 1000,
    periodStart: new Date('2027-01-01'),
    periodEnd: new Date('2028-01-01'),
    equipmentNeeds: [],
    equipment: [],
    missingQualifications: [],
  });
  const calc = calculate(base());
  const good = recommend({ calc, targetMarginPct: 15, riskLevel: 'lav', highRisks: [], missingQualifications: [], capacity: okCapacity, contractTermsAnalyzed: true, deadlinePassed: false });
  assert.equal(good.recommendation, 'bid');
  assert.equal(good.label, 'Vurder å by');

  const noDocs = recommend({ calc, targetMarginPct: 15, riskLevel: 'lav', highRisks: [], missingQualifications: [], capacity: okCapacity, contractTermsAnalyzed: false, deadlinePassed: false });
  assert.equal(noDocs.recommendation, 'investigate');
  assert.ok(noDocs.reasons.some((r) => /Kontraktsvilkårene er ikke analysert/.test(r)));

  const risky = recommend({ calc, targetMarginPct: 15, riskLevel: 'høy', highRisks: ['Dagbot uten tak'], missingQualifications: [], capacity: okCapacity, contractTermsAnalyzed: true, deadlinePassed: false });
  assert.equal(risky.recommendation, 'high_risk');
  assert.ok(risky.reasons.includes('Høy risiko: Dagbot uten tak'));

  const loss = recommend({ calc: calculate(base({ contractValue: 500_000 })), targetMarginPct: 15, riskLevel: 'lav', highRisks: [], missingQualifications: [], capacity: okCapacity, contractTermsAnalyzed: true, deadlinePassed: false });
  assert.equal(loss.recommendation, 'high_risk');
  assert.ok(loss.reasons.some((r) => /Tap ved oppdragsgivers verdi/.test(r)));

  const empty = recommend({ calc: calculate(base({ lines: [] })), targetMarginPct: 15, riskLevel: 'ukjent', highRisks: [], missingQualifications: [], capacity: okCapacity, contractTermsAnalyzed: false, deadlinePassed: false });
  assert.equal(empty.recommendation, 'insufficient_data');
});
