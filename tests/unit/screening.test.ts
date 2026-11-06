import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noticeSignals, screenTender } from '../../src/domain/matching/screening';
import type { MatchBreakdown } from '../../src/domain/matching/engine';

const now = new Date('2026-11-06T12:00:00Z');
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);
const breakdown = (over: Partial<MatchBreakdown> = {}): MatchBreakdown => ({
  reasons: ['Samme CPV-gruppe som profilen (vakthold).'],
  gaps: [],
  disqualifiers: [],
  nextSteps: [],
  components: { cpv: 40, keywords: 10, geography: 15, value: 5, type: 5, deadline: 5, requirements: 5 },
  requiredCertifications: [],
  fulfilled: [],
  unfulfilled: [],
  missingInfo: [],
  uncertainty: 'lav',
  uncertaintyReasons: [],
  caps: [],
  version: 2,
  ...over,
});
const none = noticeSignals(null);

test('signaler fra kunngjøringen: obligatorisk befaring og kostbare vilkår – nektelser teller ikke', () => {
  const s = noticeSignals(
    'Vakthold ved rådhuset. Det er obligatorisk befaring 3. desember kl. 10.00. Tilbud som leveres for sent, vil bli avvist. ' +
      'Ved forsinkelse påløper dagbot på 1 promille per dag.',
  );
  assert.equal(s.mandatoryVisit, 'Det er obligatorisk befaring 3. desember kl. 10.00.');
  assert.deepEqual(s.costlyTerms, ['dagbot']);
  assert.equal(s.rejectionClauses, 1);
  const negated = noticeSignals('Det vil ikke bli ilagt dagbot i denne kontrakten. Befaring er frivillig.');
  assert.deepEqual(negated.costlyTerms, [], '«ikke … dagbot» er ikke et vilkår');
  assert.equal(negated.mandatoryVisit, null, 'frivillig befaring er ikke obligatorisk');
});

test('vurdering: det alvorligste punktet avgjør, og alvorligste står først', () => {
  const clean = screenTender({ match: { score: 82, excluded: false, breakdown: breakdown() }, deadlineAt: inDays(20), minDaysToDeadline: 10, signals: none, now });
  assert.equal(clean.verdict, 'se_paa');
  assert.equal(clean.label, 'Verdt å se på');
  assert.deepEqual(
    clean.points.map((p) => p.tone),
    ['info', 'ok'],
  );

  const visit = screenTender({
    match: { score: 82, excluded: false, breakdown: breakdown() },
    deadlineAt: inDays(20),
    minDaysToDeadline: 10,
    signals: { ...none, mandatoryVisit: 'Det er obligatorisk befaring 3. desember.' },
    now,
  });
  assert.equal(visit.verdict, 'sjekk');
  assert.equal(visit.points[0]!.text, 'Obligatorisk befaring: «Det er obligatorisk befaring 3. desember.»');

  const short = screenTender({ match: null, deadlineAt: inDays(5), minDaysToDeadline: 10, signals: none, now });
  assert.equal(short.verdict, 'sjekk');
  assert.equal(short.points[0]!.text, 'Bare 5 dager til fristen (profilen sier minst 10).');

  const unmet = screenTender({
    match: { score: 70, excluded: false, breakdown: breakdown({ unfulfilled: ['Krever godkjenning etter vaktvirksomhetsloven – står ikke i profilen.'] }) },
    deadlineAt: inDays(20),
    minDaysToDeadline: 10,
    signals: { ...none, mandatoryVisit: 'Obligatorisk befaring.' },
    now,
  });
  assert.equal(unmet.verdict, 'passer_ikke');
  assert.equal(unmet.points[0]!.text, 'Krever godkjenning etter vaktvirksomhetsloven – står ikke i profilen.');

  assert.equal(screenTender({ match: null, deadlineAt: inDays(-1), minDaysToDeadline: 10, signals: none, now }).verdict, 'passer_ikke');
  assert.equal(screenTender({ match: null, deadlineAt: new Date(now.getTime() + 20 * 3_600_000), minDaysToDeadline: 10, signals: none, now }).points[0]!.text, 'Under ett døgn til fristen.');
});

test('vurdering: eldre lagrede forklaringer (versjon 1) og manglende frist håndteres', () => {
  const old = { reasons: ['CPV'], gaps: [], disqualifiers: [], nextSteps: [], components: breakdown().components } as unknown as MatchBreakdown;
  const r = screenTender({ match: { score: 60, excluded: false, breakdown: old }, deadlineAt: null, minDaysToDeadline: 10, signals: none, now });
  assert.equal(r.verdict, 'se_paa');
  assert.ok(r.points.some((p) => p.text === 'Fristen er ikke oppgitt i kunngjøringen.'));
  const excluded = screenTender({ match: { score: 0, excluded: true, breakdown: breakdown({ disqualifiers: ['Ekskludert kode i profilen.'] }) }, deadlineAt: inDays(30), minDaysToDeadline: 10, signals: none, now });
  assert.equal(excluded.verdict, 'passer_ikke');
  assert.ok(!excluded.points.some((p) => p.tone === 'ok'), 'ingen «hvorfor det passer» når anbudet er utelukket');
});
