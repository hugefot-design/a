/**
 * Metodesiden (/metode) beskriver reglene i treffmotoren. Disse testene sjekker at beskrivelsen (SCORE_PARTS og
 * SCORE_CAPS) stemmer med det motoren faktisk gjør – så siden ikke kan komme i utakt med koden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISQUALIFIED_MAX, SCORE_CAPS, SCORE_PARTS, scoreTender, type MatchProfile, type MatchTender } from '../../src/domain/matching/engine';

const now = new Date('2026-11-15T10:00:00Z');
const profile: MatchProfile = {
  industries: ['security'],
  cpvCodes: ['79713000'],
  keywords: ['vakthold', 'resepsjon'],
  services: null,
  regions: ['50'],
  countries: ['NO'],
  certifications: ['iso9001', 'vaktvirksomhet'],
  minContractValue: 1_000_000,
  maxContractValue: 5_000_000,
  contractTypes: ['services'],
  excludedCpv: [],
  excludedKeywords: [],
  minDaysToDeadline: 3,
  annualRevenue: 50_000_000,
  referenceCount: 3,
};
const tender: MatchTender = {
  id: 't1',
  title: 'Vakthold og resepsjon ved rådhuset',
  description: 'Leverandøren må ha tillatelse etter vaktvirksomhetsloven og være sertifisert etter ISO 9001.',
  cpvCodes: ['79713000'],
  industryIds: ['security'],
  regionCodes: ['50'],
  countryCode: 'NO',
  estimatedValue: 2_000_000,
  currency: 'NOK',
  contractNature: 'services',
  deadlineAt: new Date(now.getTime() + 20 * 86_400_000),
  lifecycle: 'competition',
};

test('delene i poengsummen summerer til 100, og et perfekt treff gir full pott i hver del', () => {
  assert.equal(
    SCORE_PARTS.reduce((sum, p) => sum + p.max, 0),
    100,
  );
  const r = scoreTender(profile, tender, now);
  for (const part of SCORE_PARTS) assert.equal(r.breakdown.components[part.key], part.max, part.key);
  assert.equal(r.score, 100);
});

test('ingen del gir mer enn det metodesiden sier', () => {
  const variants: [Partial<MatchProfile>, Partial<MatchTender>][] = [
    [{}, {}],
    [{ cpvCodes: [], keywords: ['vakthold', 'resepsjon', 'rådhuset', 'adgangskontroll'] }, { description: 'Vakthold, resepsjon og adgangskontroll ved rådhuset. Referanser fra tilsvarende oppdrag.' }],
    [{ regions: [] }, { regionCodes: [] }],
    [{ minContractValue: null, maxContractValue: null }, { estimatedValue: null }],
    [{ contractTypes: [] }, { contractNature: null }],
  ];
  for (const [p, t] of variants) {
    const r = scoreTender({ ...profile, ...p }, { ...tender, ...t }, now);
    for (const part of SCORE_PARTS) assert.ok(r.breakdown.components[part.key] <= part.max, `${part.key}: ${r.breakdown.components[part.key]}`);
  }
});

test('takene på poengsummen er de samme som metodesiden viser', () => {
  const cap = (text: string) => SCORE_CAPS.find((c) => c.text === text)!;
  const check = (r: ReturnType<typeof scoreTender>, text: string) => {
    const c = cap(text);
    assert.ok(r.breakdown.caps.includes(`${c.text} – maks ${c.max}`), `${text}: ${r.breakdown.caps.join(' | ')}`);
    assert.ok(r.score <= c.max, `${text}: ${r.score}`);
  };
  const it = { industries: ['it'], cpvCodes: ['72000000'] };
  check(scoreTender({ ...profile, ...it, keywords: ['programvare'] }, tender, now), 'Ingen faglige treff');
  check(scoreTender({ ...profile, ...it, keywords: ['vakthold'] }, tender, now), 'Bare søkeordtreff, ingen bransje- eller CPV-treff');
  check(scoreTender({ ...profile, industries: [], cpvCodes: ['79000000'], keywords: [] }, tender, now), 'Bare treff på overordnet CPV-gruppe');
  check(scoreTender({ ...profile, cpvCodes: [], keywords: ['kameraovervåking'] }, tender, now), 'Samme bransje, men ingen av ordene for det dere leverer står i kunngjøringen');
  check(scoreTender({ ...profile, certifications: ['iso9001'] }, tender, now), 'Mulig absolutt krav som ikke er oppfylt');
  check(
    scoreTender({ ...profile, annualRevenue: 1_000_000 }, { ...tender, description: `${tender.description} Leverandøren må ha en årlig omsetning på minst 10 millioner kroner.` }, now),
    'Omsetningskravet er ikke oppfylt',
  );
  assert.equal(SCORE_CAPS.length, 6);
});

test('utenfor landene profilen dekker, eller etter fristen: aldri mer enn grensen metodesiden viser', () => {
  assert.ok(scoreTender({ ...profile, countries: ['SE'] }, tender, now).score <= DISQUALIFIED_MAX);
  assert.ok(scoreTender(profile, { ...tender, deadlineAt: new Date(now.getTime() - 86_400_000) }, now).score <= DISQUALIFIED_MAX);
});
