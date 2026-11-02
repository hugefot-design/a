import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTender, type MatchProfile, type MatchTender } from '../../src/domain/matching/engine';

const NOW = new Date('2026-11-01T10:00:00Z');

const profile: MatchProfile = {
  industries: ['security'],
  cpvCodes: ['79713000'],
  keywords: ['vakthold', 'resepsjon'],
  services: 'Stasjonært vakthold og resepsjonstjenester',
  regions: ['50'],
  countries: ['NO'],
  certifications: ['vaktvirksomhet', 'iso9001'],
  minContractValue: 1_000_000,
  maxContractValue: 10_000_000,
  contractTypes: ['services'],
  excludedCpv: [],
  excludedKeywords: [],
  minDaysToDeadline: 7,
};

const tender: MatchTender = {
  id: 't1',
  title: 'Vakthold og resepsjonstjenester ved rådhuset',
  description: 'Leverandøren må ha tillatelse etter vaktvirksomhetsloven. Kvalitetssystem tilsvarende ISO 9001.',
  cpvCodes: ['79713000'],
  industryIds: ['security'],
  regionCodes: ['50'],
  countryCode: 'NO',
  estimatedValue: 4_200_000,
  currency: 'NOK',
  contractNature: 'services',
  deadlineAt: new Date('2026-11-24T11:00:00Z'),
  lifecycle: 'competition',
};

test('godt treff får høy score med begrunnelser', () => {
  const r = scoreTender(profile, tender, NOW);
  assert.equal(r.score, 100);
  assert.equal(r.excluded, false);
  assert.ok(r.breakdown.reasons.some((x) => x.includes('CPV-kode 79713000')));
  assert.deepEqual(r.breakdown.disqualifiers, []);
  assert.ok(r.breakdown.requiredCertifications.includes('vaktvirksomhet'));
});

test('lovpålagt godkjenning som mangler i profilen blir et mulig absolutt krav', () => {
  const r = scoreTender({ ...profile, certifications: [] }, tender, NOW);
  assert.ok(r.breakdown.disqualifiers.some((d) => d.includes('vaktvirksomhetsloven')));
  assert.ok(r.breakdown.nextSteps.some((s) => s.startsWith('Avklar om dere har')));
  assert.ok(!r.breakdown.nextSteps.includes('Start tilbudsarbeid og fordel oppgavene i teamet.'));
});

test('ekskluderte ord gir lav score og forklaring', () => {
  const r = scoreTender({ ...profile, excludedKeywords: ['rådhuset'] }, tender, NOW);
  assert.equal(r.excluded, true);
  assert.ok(r.score <= 10);
  assert.match(r.breakdown.reasons[0]!, /Ekskludert/);
});

test('uten faglig treff blir scoren lav selv om sted og verdi passer', () => {
  const r = scoreTender(profile, { ...tender, title: 'Levering av kontormøbler', description: null, cpvCodes: ['39130000'], industryIds: ['manufacturing'] }, NOW);
  assert.ok(r.score <= 25, `score ${r.score}`);
});

test('utløpt og kort frist', () => {
  assert.ok(scoreTender(profile, { ...tender, deadlineAt: new Date('2026-10-30T10:00:00Z') }, NOW).breakdown.disqualifiers.includes('Fristen har gått ut'));
  const short = scoreTender(profile, { ...tender, deadlineAt: new Date('2026-11-04T10:00:00Z') }, NOW);
  assert.ok(short.breakdown.disqualifiers.some((d) => d.startsWith('Kort frist: 3 dager')));
});

test('utenfor landene profilen dekker begrenses kraftig', () => {
  const r = scoreTender(profile, { ...tender, countryCode: 'SE', regionCodes: [] }, NOW);
  assert.ok(r.score <= 20);
  assert.ok(r.breakdown.disqualifiers.includes('Oppdraget er utenfor landene du dekker'));
});

test('samme input gir samme resultat (deterministisk)', () => {
  assert.deepEqual(scoreTender(profile, tender, NOW), scoreTender(profile, tender, NOW));
});

test('søkeord alene gir aldri høy score (v2)', () => {
  // Mange søkeord i tittelen, men ingen bransje- eller CPV-treff.
  const r = scoreTender(
    { ...profile, cpvCodes: ['72000000'], industries: ['it'], keywords: ['vakthold', 'resepsjon', 'rådhuset', 'sikkerhet'] },
    { ...tender, cpvCodes: ['90911200'], industryIds: ['cleaning'] },
    NOW,
  );
  assert.ok(r.score <= 45, `score ${r.score}`);
  assert.ok(r.breakdown.caps.some((c) => /Bare søkeordtreff/.test(c)));
});

test('forklaring: oppfylte og ikke oppfylte krav, manglende opplysninger og usikkerhet', () => {
  const r = scoreTender({ ...profile, annualRevenue: 50_000_000, referenceCount: 0 }, {
    ...tender,
    selectionCriteria: [
      'The supplier must have had an average annual turnover of at least NOK 300 million for the years 2024 and 2025.',
      'Description of up to three of the supplier\'s most relevant assignments carried out within the last five years (references).',
    ],
  }, NOW);
  assert.ok(r.breakdown.fulfilled.some((f) => /vaktvirksomhetsloven/i.test(f)), JSON.stringify(r.breakdown.fulfilled));
  assert.ok(r.breakdown.unfulfilled.some((u) => /300 mill\. kr/.test(u)), JSON.stringify(r.breakdown.unfulfilled));
  assert.ok(r.breakdown.missingInfo.some((m) => /referanseprosjekter/.test(m)));
  assert.ok(r.score <= 35, `omsetningskravet er ikke oppfylt: ${r.score}`);
  assert.equal(r.breakdown.version, 2);

  const longDescription = `${tender.description} Oppdraget omfatter stasjonært vakthold, resepsjon og adgangskontroll på hverdager og i helger, med rapportering til byggets driftsleder og beredskap ved hendelser.`;
  const rich = scoreTender(
    { ...profile, annualRevenue: 400_000_000, referenceCount: 3 },
    { ...tender, description: longDescription, selectionCriteria: ['Average annual turnover of at least NOK 300 million.'] },
    NOW,
  );
  assert.ok(rich.breakdown.fulfilled.some((f) => /oppfyller kravet på 300 mill\. kr/.test(f)));
  assert.equal(rich.breakdown.uncertainty, 'lav');

  const unknown = scoreTender({ ...profile, annualRevenue: null }, { ...tender, description: 'Kort.', selectionCriteria: [], cpvCodes: [] }, NOW);
  assert.equal(unknown.breakdown.uncertainty, 'høy', 'lite tekst, ingen CPV og kvalifikasjonskrav ikke vurdert');
  assert.ok(unknown.breakdown.uncertaintyReasons.includes('Kunngjøringen har lite beskrivende tekst'));
});

test('minstekrav til omsetning tolkes fra norsk og engelsk tekst – relative krav tolkes ikke', async () => {
  const { requiredTurnover } = await import('../../src/domain/matching/engine');
  assert.equal(requiredTurnover('The supplier must have had an average annual turnover of at least NOK 300 million for the years 2024 and 2025.'), 300_000_000);
  assert.equal(requiredTurnover('Leverandøren skal ha en årlig omsetning på minst 10 millioner kroner.'), 10_000_000);
  assert.equal(requiredTurnover('Krav: omsetning på minimum kr 5 000 000 siste år.'), 5_000_000);
  assert.equal(requiredTurnover('Omsetning minst 1,5 mill. kroner'), 1_500_000);
  assert.equal(requiredTurnover('Omsetningen skal være minst 2 ganger kontraktsverdien.'), null);
  assert.equal(requiredTurnover('Leverandøren må ha god økonomi.'), null);
});
