import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProfitNumbers, mockProfitAnalysis, numberInText, numbersInText, profitAnalysisZ, type ProfitAnalysis } from '../../src/domain/profit/ai';
import { parseCalcForm, parseNumber, buildRiskView, type StoredInputs } from '../../src/domain/profit/service';
import { rankPartners, hasGaps, type PartnerCard } from '../../src/domain/profit/partners';
import { calculate } from '../../src/domain/profit/calculator';
import { scanContractTerms } from '../../src/domain/profit/terms-scan';
import { verifyAllRefs, type AnalysisSource } from '../../src/domain/ai/sources';

const doc: AnalysisSource = {
  id: 'D1',
  kind: 'document',
  title: 'Kontrakt.pdf',
  pages: [
    { page: 2, text: 'Ved forsinkelse påløper dagbot på 1 promille av kontraktssummen per dag, begrenset til 10 % av kontraktssummen.' },
    { page: 4, text: 'Estimert årlig volum er 2,5 MNOK. Det skal stilles bankgaranti på 5 %.' },
    { page: 5, text: 'Betalingsfrist er 30 dager. Det kreves tre mannskaper på hver vakt.' },
  ],
  totalPages: 6,
  isPrivate: true,
};

test('tall i tekst: norske og engelske skrivemåter', () => {
  assert.ok(numberInText(1_500_000, 'Verdi: 1 500 000 kr'));
  assert.ok(numberInText(1_500_000, 'Verdi: 1.500.000 kr'));
  assert.ok(numberInText(1_500_000, 'Verdi: NOK 1,5 mill.'));
  assert.ok(numberInText(2_500_000, 'Estimert årlig volum er 2,5 MNOK.'));
  assert.ok(numberInText(0.1, 'dagbot på 1 promille'), '1 promille = 0,1 %');
  assert.ok(numberInText(45, 'Payment within 45 days'));
  assert.ok(numberInText(3, 'Det kreves tre mannskaper'));
  assert.ok(numbersInText('1 200 000 kr').includes(1_200_000), 'hårfine/ikke-brytende mellomrom');
  // Negative: tallet står ikke der.
  assert.equal(numberInText(2_000_000, 'Estimert årlig volum er 2,5 MNOK.'), false);
  assert.equal(numberInText(15, 'begrenset til 10 % av kontraktssummen'), false);
  assert.equal(numberInText(5, null), false);
});

test('tallkontroll: et beløp AI-en påstår, men som ikke står i sitatet, blir ikke godkjent', () => {
  const base = mockProfitAnalysis([doc]);
  const fabricated: ProfitAnalysis = {
    ...base,
    stated_values: [
      { label: 'Riktig', amount: 2_500_000, currency: 'NOK', period: 'per_aar', includes_options: null, source: { source_id: 'D1', page: 4, quote: 'Estimert årlig volum er 2,5 MNOK.' } },
      { label: 'Diktet beløp', amount: 9_000_000, currency: 'NOK', period: 'total', includes_options: null, source: { source_id: 'D1', page: 4, quote: 'Estimert årlig volum er 2,5 MNOK.' } },
      { label: 'Diktet sitat', amount: 2_500_000, currency: 'NOK', period: 'total', includes_options: null, source: { source_id: 'D1', page: 4, quote: 'Total verdi er 2,5 MNOK over fire år.' } },
    ],
    cost_drivers: [
      { category: 'arbeid', description: 'Mannskap', quantity: 3, unit: 'personer', period: 'total', quantity_basis: 'kilde', calculation: null, source: { source_id: 'D1', page: 5, quote: 'Det kreves tre mannskaper på hver vakt.' } },
      { category: 'arbeid', description: 'Timer', quantity: 8760, unit: 'timer', period: 'per_aar', quantity_basis: 'kilde', calculation: null, source: { source_id: 'D1', page: 5, quote: 'Det kreves tre mannskaper på hver vakt.' } },
    ],
    contract_risks: [
      { category: 'dagbot', title: 'Dagbot', finding: 'x', economic_impact: 'y', severity: 'høy', basis: 'kilde', percent: 10, days: null, amount: null, source: { source_id: 'D1', page: 2, quote: 'begrenset til 10 % av kontraktssummen' } },
      { category: 'garanti', title: 'Garanti', finding: 'x', economic_impact: 'y', severity: 'middels', basis: 'kilde', percent: 15, days: null, amount: null, source: { source_id: 'D1', page: 4, quote: 'Det skal stilles bankgaranti på 5 %.' } },
      { category: 'betalingsvilkar', title: 'Betaling', finding: 'x', economic_impact: 'y', severity: 'lav', basis: 'kilde', percent: null, days: 30, amount: null, source: { source_id: 'D1', page: 9, quote: 'Betalingsfrist er 30 dager.' } },
      { category: 'betalingsvilkar', title: 'Diktet', finding: 'x', economic_impact: 'y', severity: 'lav', basis: 'kilde', percent: null, days: 60, amount: null, source: { source_id: 'D1', page: 5, quote: 'Betalingsfrist er 60 dager.' } },
    ],
  };
  const checks = checkProfitNumbers(fabricated, [doc]);
  assert.deepEqual(checks.statedValues, [true, false, false]);
  assert.deepEqual(checks.costDrivers, [true, false]);
  assert.equal(checks.risks[0]!.percent, true);
  assert.equal(checks.risks[1]!.percent, false, 'garanti 15 % står ikke i sitatet (5 %)');
  assert.equal(checks.risks[2]!.quote, true, 'sitatet finnes i dokumentet (men på en annen side)');
  assert.equal(checks.risks[2]!.days, true);
  assert.equal(checks.risks[3]!.quote, false, 'sitatet står ikke i dokumentet');
  assert.equal(checks.risks[3]!.days, false, 'tall fra et diktet sitat godkjennes aldri');

  // Feil sidetall vises ikke: visningen bruker bare kontrollerte sidetall.
  const verification = verifyAllRefs(fabricated, [doc]);
  const inputs = { contractValue: 1_000_000, contractValueBasis: 'dokument', durationMonths: 12, durationBasis: 'dokument', isFramework: false, lines: [], overheadPct: null, riskBufferPct: null, targetMarginPct: null, minMarginPct: null, userRiskLevel: null, termsReviewedByUser: false, notes: null, importedAnalysisId: null } satisfies StoredInputs;
  const view = buildRiskView(
    { id: 'x', createdAt: new Date(), data: fabricated, verification, checks, coverage: [], documentsAnalyzed: 1, isMock: true, model: 'mock-1' },
    scanContractTerms([doc]),
    inputs,
    calculate(inputs),
  );
  const pay = view.findings.find((f) => f.title === 'Betaling')!;
  assert.equal(pay.source?.page, null, 'side 9 finnes ikke og vises ikke');
  const fake = view.findings.find((f) => f.title === 'Diktet')!;
  assert.equal(fake.source?.verified, false);
  assert.deepEqual(fake.unverifiedNumbers, ['60 dager']);
  assert.equal(fake.consequence, null, 'ingen beregning fra ukontrollerte tall');
  const garanti = view.findings.find((f) => f.title === 'Garanti')!;
  assert.equal(garanti.consequence, null);
  assert.deepEqual(garanti.unverifiedNumbers, ['15 %']);
});

test('AI-svar: «ukjent» mengde fjernes alltid, og ugyldige verdier avvises', () => {
  const base = mockProfitAnalysis([doc]);
  const parsed = profitAnalysisZ.parse({
    ...base,
    cost_drivers: [{ category: 'materialer', description: 'Strøsand', quantity: 500, unit: 'tonn', period: 'per_aar', quantity_basis: 'ukjent', calculation: null, source: null }],
  });
  assert.equal(parsed.cost_drivers[0]!.quantity, null, 'en mengde merket «ukjent» kan aldri bli et tall i kalkylen');
  assert.equal(profitAnalysisZ.safeParse({ ...base, contract_risks: [{ ...base.contract_risks[0]!, severity: 'kritisk' }] }).success, false);
  assert.equal(profitAnalysisZ.safeParse({ ...base, stated_values: [{ label: 'x', amount: -5, currency: null, period: 'total', includes_options: null, source: { source_id: 'S0', page: null, quote: null } }] }).success, false);
});

test('testmodus-svaret bygges fra kildene og har kontrollerbare sitater', () => {
  const m = mockProfitAnalysis([doc]);
  const dagbot = m.contract_risks.find((r) => r.category === 'dagbot');
  assert.ok(dagbot);
  assert.equal(dagbot.percent, 10);
  const checks = checkProfitNumbers(m, [doc]);
  const idx = m.contract_risks.indexOf(dagbot);
  assert.equal(checks.risks[idx]!.quote, true);
  assert.match(m.summary, /Simulert svar fra testmodus/);
  assert.ok(m.documents_not_read.length === 0, 'dokumentet er lest');
  assert.deepEqual(mockProfitAnalysis([]).documents_not_read, ['Konkurransegrunnlaget og kontraktsvilkårene (ikke lastet opp)']);
});

test('skjematall: norsk format, og ugyldige verdier gir «invalid» i stedet for et gjettet tall', () => {
  assert.equal(parseNumber('1 500,50'), 1500.5);
  assert.equal(parseNumber('1.500'), 1500);
  assert.equal(parseNumber('1.5'), 1.5);
  assert.equal(parseNumber('12 %'), 12);
  assert.equal(parseNumber('650 kr'), 650);
  assert.equal(parseNumber('1.234.567,8'), 1234567.8);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('ca. 500'), 'invalid');
  assert.equal(parseNumber('5e6'), 'invalid');
});

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

test('opphav i kalkyleskjemaet: dokument-/AI-tall beholder opphavet til brukeren endrer dem', () => {
  const previous: StoredInputs = {
    contractValue: 1_000_000,
    contractValueBasis: 'dokument',
    durationMonths: 12,
    durationBasis: 'dokument',
    isFramework: false,
    lines: [
      { id: 'a', category: 'arbeid', description: 'Vakthold', quantity: 8760, unit: 'timer', unitCost: 500, period: 'per_aar', basis: 'ai', sourceRef: { sourceId: 'D1', page: 3, quote: 'q' }, calculation: '24 × 365', origin: 'ai_import' },
      { id: 'b', category: 'utstyr', description: 'Bil', quantity: 1, unit: 'stk', unitCost: 5000, period: 'per_maaned', basis: 'dokument', sourceRef: null, origin: 'ai_import' },
    ],
    overheadPct: null,
    riskBufferPct: null,
    targetMarginPct: null,
    minMarginPct: null,
    userRiskLevel: null,
    termsReviewedByUser: false,
    notes: null,
    importedAnalysisId: 'x',
  };
  const f = form([
    ['contractValue', '1000000'],
    ['durationMonths', '12'],
    ['l_id', 'a'], ['l_category', 'arbeid'], ['l_description', 'Vakthold'], ['l_quantity', '8760'], ['l_unit', 'timer'], ['l_unitCost', '520'], ['l_period', 'per_aar'],
    ['l_id', 'b'], ['l_category', 'utstyr'], ['l_description', 'Bil'], ['l_quantity', '2'], ['l_unit', 'stk'], ['l_unitCost', '5000'], ['l_period', 'per_maaned'],
    ['l_id', ''], ['l_category', 'annet'], ['l_description', ''], ['l_quantity', ''], ['l_unit', ''], ['l_unitCost', ''], ['l_period', 'total'],
    ['l_id', 'forfalsket'], ['l_category', 'hackers'], ['l_description', 'Ny linje'], ['l_quantity', '3'], ['l_unit', ''], ['l_unitCost', '100'], ['l_period', 'evig'],
  ]);
  const { inputs, errors } = parseCalcForm(f, previous, { contractValue: null, contractValueNote: null, durationMonths: 12 });
  assert.deepEqual(errors, []);
  assert.equal(inputs.lines.length, 3, 'tomme linjer hoppes over');
  assert.equal(inputs.lines[0]!.basis, 'ai', 'ny enhetskost endrer ikke opphavet til mengden');
  assert.equal(inputs.lines[0]!.calculation, '24 × 365');
  assert.equal(inputs.lines[1]!.basis, 'bruker', 'endret mengde blir brukerens tall');
  assert.equal(inputs.lines[2]!.basis, 'bruker');
  assert.equal(inputs.lines[2]!.category, 'annet', 'ukjent kategori avvises');
  assert.equal(inputs.lines[2]!.period, 'total');
  assert.equal(inputs.lines[2]!.unit, 'enheter');
  assert.notEqual(inputs.lines[2]!.id, 'forfalsket', 'ukjent id gir ny id');
  assert.equal(inputs.contractValueBasis, 'dokument', 'uendret dokumentverdi beholder opphavet');
  assert.equal(inputs.durationBasis, 'dokument');
});

test('risikonivå: AI-funn, brukerens vurdering og «ukjent» uten dokumenter', () => {
  const inputs: StoredInputs = {
    contractValue: 1_000_000,
    contractValueBasis: 'dokument',
    durationMonths: 12,
    durationBasis: 'dokument',
    isFramework: false,
    lines: [{ id: 'a', category: 'arbeid', description: 'x', quantity: 100, unit: 'timer', unitCost: 500, period: 'total', basis: 'bruker' }],
    overheadPct: null,
    riskBufferPct: null,
    targetMarginPct: null,
    minMarginPct: null,
    userRiskLevel: null,
    termsReviewedByUser: false,
    notes: null,
    importedAnalysisId: null,
  };
  const calc = calculate(inputs);
  const scan = scanContractTerms([doc]);
  const none = buildRiskView(null, scan, inputs, calc);
  assert.equal(none.level, 'ukjent');
  assert.equal(none.contractTermsAnalyzed, false);
  const reviewed = buildRiskView(null, scan, { ...inputs, userRiskLevel: 'middels', termsReviewedByUser: true }, calc);
  assert.equal(reviewed.level, 'middels');
  assert.equal(reviewed.levelSource, 'bruker');
  assert.equal(reviewed.contractTermsAnalyzed, true);

  const data = mockProfitAnalysis([doc]);
  const analysis = {
    id: 'x',
    createdAt: new Date(),
    data,
    verification: {},
    checks: checkProfitNumbers(data, [doc]),
    coverage: [{ sourceId: 'D1', title: 'Kontrakt.pdf', kind: 'document' as const, includedPages: [2, 4, 5], totalPages: 6, truncated: false }],
    documentsAnalyzed: 1,
    isMock: true,
    model: 'mock-1',
  };
  const ai = buildRiskView(analysis, scan, inputs, calc);
  assert.equal(ai.level, 'høy', 'dagbot er vurdert som høy risiko i testmodus');
  assert.equal(ai.levelSource, 'ai');
  assert.ok(ai.highRisks.length > 0);
  const dagbot = ai.findings.find((f) => f.category === 'dagbot')!;
  assert.match(dagbot.consequence ?? '', /Maks samlet dagbot ved 1\s000\s000 kr: 100\s000 kr/);
  const pay = ai.findings.find((f) => f.category === 'betalingsvilkar')!;
  assert.match(pay.consequence ?? '', /Kapital bundet/);
});

test('partnerforslag: forklart rangering, og bare bransje/område er ikke nok', () => {
  const p = (over: Partial<PartnerCard>): PartnerCard => ({
    orgId: Math.random().toString(36).slice(2),
    displayName: 'P',
    summary: null,
    capabilities: null,
    industries: [],
    regions: [],
    certifications: [],
    partnerRoles: ['underleverandor'],
    employeeCount: null,
    updatedAt: new Date(),
    ...over,
  });
  const gaps = { certifications: ['iso14001'], equipment: ['Hjullaster med skjær'], competencies: [], regions: ['50'], industries: ['construction'], capacityHours: 400 };
  const ranked = rankPartners(
    [
      p({ displayName: 'Bare bransje', industries: ['construction'] }),
      p({ displayName: 'Sertifisert', certifications: ['iso14001'], regions: ['50'] }),
      p({ displayName: 'Maskin og kapasitet', capabilities: 'Vi har hjullaster og traktor.', regions: ['ALL'], industries: ['construction'] }),
    ],
    gaps,
  );
  assert.deepEqual(ranked.map((r) => r.partner.displayName), ['Maskin og kapasitet', 'Sertifisert']);
  assert.ok(ranked[0]!.reasons.includes('Nevner «Hjullaster» i profilen'), ranked[0]!.reasons.join(' | '));
  assert.ok(ranked[1]!.reasons.some((r) => /ISO 14001/.test(r)));
  assert.equal(hasGaps({ certifications: [], equipment: [], competencies: [], regions: ['50'], industries: [], capacityHours: 0 }), false);
});
