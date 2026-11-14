/**
 * Intelligence – ren logikk (uten database): risikoscore, Go/No-Go, handlingsplan, læring og PDF-tekst.
 * Kravene og vilkårene lages med appens eget ordsøk på realistisk tekst, og kalkylen med kalkulatoren – ingen
 * oppdiktede mellomresultater.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanRequirements } from '../../src/domain/documents/requirements';
import { scanContractTerms } from '../../src/domain/profit/terms-scan';
import { calculate } from '../../src/domain/profit/calculator';
import type { Screening } from '../../src/domain/matching/screening';
import type { QualificationView } from '../../src/domain/profit/service';
import type { ResultRow } from '../../src/domain/tenders/results';
import { scoreRisk, type RiskInputs } from '../../src/domain/intelligence/risk';
import { decide, type DecisionInputs } from '../../src/domain/intelligence/decision';
import { buildPlan, type PlanInputs } from '../../src/domain/intelligence/plan';
import { learningFor, MIN_DECIDED, type TenderMeta } from '../../src/domain/intelligence/learning';
import { safe } from '../../src/domain/intelligence/pdf';
import type { CompetitionSection, FitSection, LearningSection, ProfitSection, RiskSection } from '../../src/domain/intelligence/types';

const DAY = 86_400_000;
const NOW = new Date('2026-11-07T10:00:00Z');

const NOTICE =
  'Fjellvik kommune skal rehabilitere Nordby skole som totalentreprise. Tilbud som leveres etter fristen, vil bli avvist. ' +
  'Leverandøren skal ha sentral godkjenning for ansvarsrett i tiltaksklasse 3. Leverandøren må dokumentere ISO 14001 eller tilsvarende. ' +
  'Det er obligatorisk befaring 18. november kl. 10.00. Ved forsinkelse påløper dagbot på 1 promille av kontraktssummen per dag. ' +
  'Leverandøren skal stille bankgaranti på 10 % av kontraktssummen. Det stilles ikke krav om forsikring.';
const source = { id: 'S0', kind: 'notice' as const, title: 'Kunngjøringen', pages: [{ page: null, text: NOTICE }], totalPages: null, isPrivate: false };
const requirements = scanRequirements([source], { selectionCriteria: [] });
const terms = scanContractTerms([source]);

const screening = (keys: { key: string; tone: 'stop' | 'warn' | 'info' | 'ok'; text: string }[]): Screening =>
  ({ verdict: keys.some((k) => k.tone === 'stop') ? 'passer_ikke' : 'se_paa', label: '', points: keys, fit: [] }) as Screening;

const quals = (missingLegal: boolean): QualificationView => ({
  required: [
    { id: 'sentral_godkjenning', label: 'Sentral godkjenning (byggesak)', legal: true, have: !missingLegal, via: missingLegal ? null : 'profil' },
    { id: 'iso14001', label: 'ISO 14001 (miljø)', legal: false, have: true, via: 'profil' },
  ],
  missing: missingLegal ? ['Sentral godkjenning (byggesak) (kan være et absolutt krav)'] : [],
  missingCertIds: missingLegal ? ['sentral_godkjenning'] : [],
  turnover: null,
  aiUnfulfilled: [],
});

const riskInputs = (over: Partial<RiskInputs> = {}): RiskInputs => ({
  screening: screening([{ key: 'deadline_ok', tone: 'info', text: '20 dager til fristen.' }]),
  requirements,
  terms,
  qualifications: quals(false),
  aiFindings: [],
  capacity: null,
  calc: null,
  targetMarginPct: null,
  documentsRead: 0,
  matchUncertainty: 'lav',
  buyerRecord: null,
  minDecided: MIN_DECIDED,
  ...over,
});

test('risiko: faktorene fra kunngjøringen har poeng, forklaring, grunnlag og kilde – nektelser teller ikke', () => {
  const r = scoreRisk(riskInputs());
  const keys = r.factors.map((f) => f.key);
  for (const k of ['rejection', 'site_visit', 'costly_terms', 'notice_only']) assert.ok(keys.includes(k), `${k} i ${keys.join(',')}`);
  const terms = r.factors.find((f) => f.key === 'costly_terms')!;
  assert.match(terms.explanation, /dagbøter/i);
  assert.match(terms.explanation, /garanti/i);
  assert.doesNotMatch(terms.explanation, /forsikring/i, '«Det stilles ikke krav om forsikring» er en nektelse');
  assert.ok(terms.sources.every((s) => s.kind === 'notice' && s.quote), 'kilde med utdrag');
  assert.equal(r.score, r.factors.reduce((s, f) => s + f.points, 0), 'scoren er summen av faktorene');
  assert.ok(r.factors.every((f) => !f.blocker));
  assert.equal(r.level, r.score >= 50 ? 'høy' : r.score >= 25 ? 'middels' : 'lav');
});

test('risiko: frist ute, lovpålagt godkjenning som mangler og tap ved kontraktsverdien er hindringer', () => {
  const passed = scoreRisk(riskInputs({ screening: screening([{ key: 'deadline_passed', tone: 'stop', text: 'Fristen har gått ut.' }]) }));
  assert.equal(passed.score, 100);
  assert.equal(passed.level, 'høy');
  assert.ok(passed.factors.find((f) => f.key === 'deadline_passed')?.blocker);

  const legal = scoreRisk(riskInputs({ qualifications: quals(true) }));
  const f = legal.factors.find((x) => x.key === 'legal_qualification')!;
  assert.ok(f.blocker);
  assert.match(f.explanation, /Sentral godkjenning/);
  assert.equal(legal.level, 'høy', 'en hindring gir alltid høy risiko');

  const calc = calculate({
    contractValue: 1_000_000,
    contractValueBasis: 'dokument',
    durationMonths: 12,
    durationBasis: 'dokument',
    isFramework: false,
    lines: [{ id: 'a', category: 'arbeid', description: 'Arbeid', quantity: 2000, unit: 'timer', unitCost: 650, period: 'total', basis: 'bruker' }],
    overheadPct: 10,
    riskBufferPct: 5,
    targetMarginPct: 12,
    minMarginPct: 5,
  });
  assert.ok(calc.atContractValue && calc.atContractValue.profit < 0, 'kalkylen gir tap');
  const loss = scoreRisk(riskInputs({ calc, targetMarginPct: 12 }));
  assert.ok(loss.factors.find((x) => x.key === 'margin_loss')?.blocker);
});

test('risiko: dokumenter lest fjerner «bare kunngjøringen»; dårlige resultater hos oppdragsgiveren teller bare med nok data', () => {
  assert.ok(!scoreRisk(riskInputs({ documentsRead: 2 })).factors.some((f) => f.key === 'notice_only'));
  assert.ok(!scoreRisk(riskInputs({ buyerRecord: { decided: 2, won: 0 } })).factors.some((f) => f.key === 'buyer_losses'), 'to avgjorte er for lite');
  const losses = scoreRisk(riskInputs({ buyerRecord: { decided: 3, won: 0 } })).factors.find((f) => f.key === 'buyer_losses');
  assert.ok(losses && losses.basis === 'fact' && losses.sources[0]?.kind === 'own');
});

// ---------------------------------------------------------------------------------------------- Beslutning
const fit = (over: Partial<FitSection> = {}): FitSection => ({
  availability: 'ok',
  score: 72,
  excluded: false,
  level: 'god',
  components: [],
  strengths: [{ text: 'CPV-kode 45214200 er den samme som i profilen din', basis: 'calculation' }],
  gaps: [],
  uncertainty: { level: 'lav', reasons: [] },
  qualifications: [{ label: 'ISO 14001 (miljø)', have: true, legal: false, via: 'profil' }],
  turnover: null,
  regions: { names: ['Oslo'], inProfile: true },
  capacity: null,
  ai: null,
  ...over,
});
const riskSection = (r: ReturnType<typeof scoreRisk>, over: Partial<RiskSection> = {}): RiskSection => ({
  ...r,
  read: { documents: 1, pages: 12, noticeOnly: false, notReadable: [] },
  deadlines: [],
  rejection: [],
  documentation: [],
  siteVisit: [],
  terms: [],
  contractFindings: [],
  counts: requirements.counts,
  ai: null,
  ...over,
});
const profit = (over: Partial<ProfitSection> = {}): ProfitSection => ({
  availability: 'no_costs',
  calc: null,
  currency: 'NOK',
  targetMarginPct: null,
  recommendation: null,
  market: null,
  calcAccuracy: null,
  ...over,
});
const competition: CompetitionSection = { availability: 'ok', buyer: null, similar: null, bids: { label: 'x', n: 6, median: 3, min: 1, max: 6 }, thisTender: [] };
const learning = (over: Partial<LearningSection> = {}): LearningSection => ({
  sameBuyer: { delivered: 0, won: 0, lost: 0, pending: 0, winRatePct: null },
  similar: { delivered: 0, won: 0, lost: 0, pending: 0, winRatePct: null },
  insights: [],
  applied: [],
  minDecided: MIN_DECIDED,
  beatUs: [],
  ...over,
});
const decision = (over: Partial<DecisionInputs> = {}) =>
  decide({
    tenderId: 't1',
    fit: fit(),
    risk: riskSection(scoreRisk(riskInputs({ documentsRead: 1 }))),
    profit: profit(),
    competition,
    learning: learning(),
    documentsEntitled: true,
    aiMode: 'off',
    aiUsed: false,
    lockedPlans: {},
    ...over,
  });

test('Go/No-Go: godt treff uten hindringer og uten høy risiko gir «Gå videre» med grunner og datagrunnlag', () => {
  const d = decision();
  assert.equal(d.verdict, 'go');
  assert.equal(d.label, 'Gå videre');
  assert.ok(d.reasons.some((r) => /Godt treff mot profilen: 72 av 100/.test(r.text)));
  assert.ok(d.reasons.some((r) => /median 3/.test(r.text) && r.basis === 'fact'), 'få tilbud i lignende konkurranser er en grunn for');
  assert.ok(d.missing.some((m) => m.href === '/app/anbud/t1/lonnsomhet'), 'kalkylen mangler – vises som noe som mangler');
  assert.equal(d.coverage.find((c) => c.key === 'ai')?.detail, 'Ikke slått på');
  assert.equal(d.confidence.max, 9);
});

test('Go/No-Go: hindring → «Ikke gå videre»; uten profil og kalkyle → «For lite grunnlag»; svakt treff → «Ikke gå videre»; ellers «Avklar først»', () => {
  const blocked = decision({ risk: riskSection(scoreRisk(riskInputs({ qualifications: quals(true), documentsRead: 1 }))) });
  assert.equal(blocked.verdict, 'no_go');
  assert.match(blocked.blockers[0]!.text, /Sentral godkjenning/);
  assert.match(blocked.headline, /^Ikke bruk tid på dette/);

  const unknown = decision({ fit: fit({ availability: 'locked', score: null, level: 'ukjent' }), lockedPlans: { fit: 'Profesjonell' } });
  assert.equal(unknown.verdict, 'insufficient');
  assert.ok(unknown.missing.some((m) => /Profesjonell/.test(m.text) && m.href === '/app/abonnement'));

  assert.equal(decision({ fit: fit({ score: 31, level: 'svak' }) }).verdict, 'no_go');
  assert.equal(decision({ fit: fit({ score: 31, level: 'svak', uncertainty: { level: 'høy', reasons: [] } }) }).verdict, 'clarify', 'svakt treff, men uklar kunngjøring');
  assert.equal(decision({ fit: fit({ score: 52, level: 'middels' }) }).verdict, 'clarify');
});

test('Go/No-Go: «Høy risiko» i Lønnsomhet og dårlige resultater hos oppdragsgiveren gir «Avklar først»', () => {
  const highRisk = decision({ profit: profit({ availability: 'ok', recommendation: { recommendation: 'high_risk', label: 'Høy risiko', reasons: ['Høy risiko: Ubegrenset ansvar'], checks: [] } }) });
  assert.equal(highRisk.verdict, 'clarify');
  assert.ok(highRisk.concerns.some((c) => /Lønnsomhet: «Høy risiko»/.test(c.text)));
  const losses = decision({ risk: riskSection(scoreRisk(riskInputs({ documentsRead: 1, buyerRecord: { decided: 4, won: 0 } }))) });
  assert.equal(losses.verdict, 'clarify');
});

// ---------------------------------------------------------------------------------------------- Handlingsplan
const planInputs = (over: Partial<PlanInputs> = {}): PlanInputs => ({
  now: NOW,
  tenderId: 't1',
  tender: {
    deadlineAt: new Date(NOW.getTime() + 20 * DAY),
    questionsDeadlineAt: new Date(NOW.getTime() + 10 * DAY),
    participationDeadlineAt: null,
    deadlineKind: 'tender',
    documentsUrl: 'https://kgv.example/doc',
    submissionUrl: 'https://kgv.example/lever',
  },
  verdict: 'go',
  risk: riskSection(scoreRisk(riskInputs()), { read: { documents: 0, pages: 0, noticeOnly: true, notReadable: [] } }),
  fit: fit(),
  profit: profit(),
  pricing: null,
  bid: null,
  bookmarkStatus: null,
  entitlements: { bidAssistant: true, documentUpload: true, partnerSearch: true, profitCalculator: true },
  ...over,
});

test('handlingsplan: steg i rekkefølge, frister fra kunngjøringen som fakta og intern godkjenning som forslag', () => {
  const plan = buildPlan(planInputs());
  const keys = plan.map((s) => s.key);
  assert.deepEqual(keys, ['documents', 'questions', 'site_visit', 'costs', 'terms', 'checklist', 'approval', 'submit', 'result']);
  const q = plan.find((s) => s.key === 'questions')!;
  assert.equal(q.dueBasis, 'fact');
  const approval = plan.find((s) => s.key === 'approval')!;
  assert.equal(approval.dueBasis, 'calculation');
  assert.equal(approval.due!.getTime(), NOW.getTime() + 18 * DAY, 'to dager før fristen');
  assert.equal(plan.find((s) => s.key === 'submit')!.href, 'https://kgv.example/lever');
  assert.match(plan.find((s) => s.key === 'site_visit')!.detail ?? '', /obligatorisk befaring 18\. november/);
});

test('handlingsplan: gjort-markering, «Velg bort» ved Ikke gå videre, og ingenting etter fristen', () => {
  const done = buildPlan(planInputs({ bid: { id: 'b1', status: 'submitted', checklistTotal: 4, checklistDone: 4 }, bookmarkStatus: 'submitted' }));
  assert.ok(done.find((s) => s.key === 'checklist')!.done);
  assert.ok(done.find((s) => s.key === 'submit')!.done);
  const noGo = buildPlan(planInputs({ verdict: 'no_go' }));
  assert.equal(noGo[0]!.key, 'decline');
  const late = planInputs({ tender: { ...planInputs().tender, deadlineAt: new Date(NOW.getTime() - DAY) } });
  assert.deepEqual(buildPlan(late), []);
  assert.deepEqual(buildPlan({ ...late, bookmarkStatus: 'submitted' }).map((s) => s.key), ['result'], 'levert: bare registrere resultatet');
});

// ---------------------------------------------------------------------------------------------- Læring
const row = (over: Partial<ResultRow>): ResultRow => ({
  bookmarkId: crypto.randomUUID(),
  tenderId: crypto.randomUUID(),
  title: 'Tidligere anbud',
  buyerName: 'Fjellvik kommune',
  authorityId: 'a1',
  status: 'lost',
  ourPrice: null,
  winningPrice: null,
  winnerName: null,
  reason: null,
  outcomeSource: 'bruker',
  decidedAt: NOW,
  submittedAt: NOW,
  deadlineAt: NOW,
  isFramework: false,
  currency: 'NOK',
  calcTargetPrice: null,
  awards: [],
  ...over,
});

test('læring: samme oppdragsgiver og lignende arbeid, innsikt først fra tre avgjorte', () => {
  const tender = { id: 'now', authorityId: 'a1', buyerName: 'Fjellvik kommune', industryIds: ['construction'], cpvCodes: ['45214200'], mainCpv: '45214200' };
  const lost = (price: number, winning: number) => row({ status: 'lost', ourPrice: price, winningPrice: winning, reason: 'pris', winnerName: 'Byggmester Hansen AS' });
  const rows = [lost(1_200_000, 1_000_000), lost(2_300_000, 2_000_000)];
  const meta: TenderMeta = new Map(rows.map((r) => [r.tenderId, { industryIds: ['construction'], cpvCodes: ['45210000'], mainCpv: '45210000' }]));
  const two = learningFor(rows, meta, tender);
  assert.equal(two.sameBuyer.lost, 2);
  assert.deepEqual(two.insights, [], 'to avgjorte er for lite');
  assert.equal(two.pricing, null);

  const third = lost(3_300_000, 3_000_000);
  meta.set(third.tenderId, { industryIds: ['construction'], cpvCodes: ['45214000'], mainCpv: '45214000' });
  const three = learningFor([...rows, third], meta, tender);
  assert.equal(three.buyerRecord.decided, 3);
  assert.ok(three.insights.some((i) => /0 av 3 avgjorte/.test(i.text)));
  assert.ok(three.insights.some((i) => /«Pris» avgjorde 3 av 3 tap/.test(i.text)));
  assert.ok(three.insights.some((i) => /over vinneren/.test(i.text)));
  assert.ok(three.pricing && three.pricing.medianDiffPct > 5);
  assert.ok(three.applied.some((a) => /lagt til som risiko/.test(a)));
  assert.equal(three.beatUs[0]?.name, 'Byggmester Hansen AS');

  // Annen bransje og annen oppdragsgiver: ikke «lignende».
  const other = row({ authorityId: 'a2', buyerName: 'Annen kommune' });
  meta.set(other.tenderId, { industryIds: ['cleaning'], cpvCodes: ['90910000'], mainCpv: '90910000' });
  const res = learningFor([other], meta, tender);
  assert.equal(res.sameBuyer.delivered + res.similar.delivered, 0);
});

test('PDF-tekst: norske tegn beholdes, tegn utenfor standardskriften byttes ut', () => {
  assert.equal(safe('Æ Ø Å – «sitat» … 10 %'), 'Æ Ø Å – «sitat» … 10 %');
  assert.equal(safe('Pris → målpris ≥ 5 ✓'), 'Pris -> målpris >= 5 OK');
  assert.equal(safe('漢字'), '??');
});
