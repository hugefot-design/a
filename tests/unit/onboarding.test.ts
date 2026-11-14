/** Kort oppstart: stikkord, full profil med trygge standardverdier, og hvilke mål som er lov etter oppstarten. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keywordsFromServices, quickStartProfile, quickStartSchema } from '../../src/domain/profile/profile';
import { onboardingTarget } from '../../src/routes/app/core';

test('stikkord: korte ledd skilt med komma blir nøkkelord, hele setninger blir det ikke', () => {
  assert.deepEqual(keywordsFromServices('Vakthold, alarmmottak; resepsjon'), ['vakthold', 'alarmmottak', 'resepsjon']);
  assert.deepEqual(keywordsFromServices('VVS, IT'), ['vvs'], 'under tre tegn er for kort');
  assert.deepEqual(keywordsFromServices('stasjonært vakthold, vakthold, Vakthold'), ['stasjonært vakthold', 'vakthold'], 'uten duplikater');
  assert.deepEqual(keywordsFromServices('Vi leverer vakthold og alarmmottak til kommuner i hele Trøndelag'), [], 'en setning er ikke et nøkkelord');
  assert.deepEqual(keywordsFromServices(''), []);
  assert.equal(keywordsFromServices(Array.from({ length: 30 }, (_, i) => `ord${i}`).join(', ')).length, 15);
});

test('profilen fra oppstarten har bare det kunden oppga – resten er tomt eller standard', () => {
  const q = quickStartSchema.parse({ companyName: '  Test AS ', orgNumber: '987 654 321', industries: ['cleaning', 'finnes-ikke'], regions: ['50', 'ALL'], certifications: ['renholdsregister', 'oppdiktet'], services: 'renhold, vindusvask' });
  assert.equal(q.companyName, 'Test AS');
  assert.equal(q.orgNumber, '987654321');
  assert.deepEqual(q.industries, ['cleaning'], 'ukjente bransjer fjernes');
  assert.deepEqual(q.regions, ['ALL'], '«Hele landet» går foran enkeltfylker');
  const p = quickStartProfile(q);
  assert.deepEqual(p.keywords, ['renhold', 'vindusvask']);
  assert.equal(p.services, 'renhold, vindusvask');
  assert.equal(p.minDaysToDeadline, 10);
  assert.deepEqual(p.certifications, ['renholdsregister'], 'bare kjente godkjenninger som kunden krysset av');
  assert.deepEqual(quickStartProfile(quickStartSchema.parse({ companyName: 'A', orgNumber: '', industries: ['it'], regions: ['ALL'], services: '' })).certifications, []);
  assert.deepEqual(p.cpvCodes, []);
  assert.deepEqual(p.referenceProjects, []);
  assert.equal(p.annualRevenue, null);
  assert.equal(p.minContractValue, null);
  assert.equal(p.companySize, null);
});

test('oppstarten krever firmanavn, minst én bransje og et område', () => {
  const bad = quickStartSchema.safeParse({ companyName: ' ', orgNumber: '', industries: ['x'], regions: [], services: '' });
  assert.equal(bad.success, false);
  const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join('.'));
  assert.deepEqual(paths.sort(), ['companyName', 'industries', 'regions']);
});

test('målet etter oppstarten: bare sider i appen, aldri oppstarten selv eller andre nettsteder', () => {
  assert.equal(onboardingTarget('/app/anbud/123/intelligence'), '/app/anbud/123/intelligence');
  assert.equal(onboardingTarget('/app/anbud?bransje=it'), '/app/anbud?bransje=it');
  for (const bad of [null, undefined, '', '/', '/app', '/admin', '/logg-ut', '/app/onboarding', '/app/onboarding?x=1', '//ondsinnet.example/app/', 'https://ondsinnet.example/app/x', '/\\ondsinnet.example', '/app/\tx']) {
    assert.equal(onboardingTarget(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------
// «Kom i gang» på Oversikt
// ---------------------------------------------------------------------------
import { signupPathFrom, startSteps, type Feature } from '../../src/domain/activation';

const base = { topTenderId: 'abc', used: new Set<Feature>(), savedCount: 0, hasCalculation: false, profitCalculator: true, profileSharpened: false };

test('kom i gang: profil først, så vurdering av det beste treffet, lagring, lønnsomhet og en skarpere profil', () => {
  const steps = startSteps(base);
  assert.deepEqual(steps.map((s) => s.key), ['profile', 'assessment', 'save', 'profit', 'sharpen']);
  assert.deepEqual(steps.map((s) => s.done), [true, false, false, false, false]);
  assert.equal(steps[1]!.href, '/app/anbud/abc/intelligence', 'rett til vurderingen av det beste treffet');
  assert.equal(steps[2]!.href, '/app/anbud/abc');
  assert.equal(steps[3]!.href, '/app/anbud/abc/lonnsomhet');
});

test('kom i gang: stegene krysses av fra det kunden faktisk har gjort', () => {
  const steps = startSteps({ ...base, used: new Set<Feature>(['intelligence_viewed']), savedCount: 2, hasCalculation: true, profileSharpened: true });
  assert.ok(steps.every((s) => s.done));
  // Å bare åpne anbudssiden er ikke det samme som å se vurderingen.
  assert.equal(startSteps({ ...base, used: new Set<Feature>(['tender_viewed']) })[1]!.done, false);
});

test('kom i gang: uten kalkulatoren i planen og uten treff', () => {
  const steps = startSteps({ ...base, topTenderId: null, profitCalculator: false });
  assert.deepEqual(steps.map((s) => s.key), ['profile', 'assessment', 'save', 'sharpen'], 'ikke noe steg kunden ikke kan bruke');
  assert.equal(steps[1]!.href, '/app/anbud');
  assert.equal(steps[1]!.cta, 'Finn et anbud');
});

test('signupPathFrom: bare sider på vårt eget nettsted, uten spørring, og ikke registrerings- eller innloggingssiden', () => {
  const app = 'https://anbudradar.com';
  assert.equal(signupPathFrom('https://anbudradar.com/anbud/123?utm_source=ukesbrev', app), '/anbud/123');
  assert.equal(signupPathFrom('https://anbudradar.com/', app), '/');
  assert.equal(signupPathFrom('https://anbudradar.com/en', app), '/en');
  assert.equal(signupPathFrom('https://anbudradar.com/bransjer/renhold/', app), '/bransjer/renhold');
  assert.equal(signupPathFrom('https://anbudradar.com/registrer', app), null);
  assert.equal(signupPathFrom('https://anbudradar.com/en/register', app), null);
  assert.equal(signupPathFrom('https://anbudradar.com/logg-inn', app), null);
  assert.equal(signupPathFrom('https://www.google.com/search?q=anbud', app), null);
  assert.equal(signupPathFrom('https://anbudradar.com.ondt.example/x', app), null);
  assert.equal(signupPathFrom('ikke en adresse', app), null);
  assert.equal(signupPathFrom(undefined, app), null);
});
