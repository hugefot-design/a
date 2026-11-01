import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanCpv,
  cleanOrgNumber,
  combineDateTime,
  containsTerm,
  cpvPrefixes,
  deriveIndustries,
  isValidNorwegianOrgNumber,
  laterLifecycle,
  normalizeName,
  osloOffset,
  parseSourceDateTime,
  regionCodesFor,
  stripHtml,
} from '../../src/domain/tenders/normalize';
import { procedureLabel } from '../../src/domain/reference';

test('CPV-koder renses og gir hierarkiske prefikser', () => {
  assert.equal(cleanCpv('45000000-7'), '45000000');
  assert.equal(cleanCpv('79713000'), '79713000');
  assert.equal(cleanCpv('1234'), null);
  assert.equal(cleanCpv(null), null);
  assert.deepEqual(cpvPrefixes(['79713000']), ['79', '797', '7971', '79713']);
  assert.deepEqual(cpvPrefixes(['45000000']), ['45']);
});

test('bransje utledes fra CPV, nøkkelord brukes bare uten CPV', () => {
  assert.ok(deriveIndustries(cpvPrefixes(['90910000']), 'Renhold', null).includes('cleaning'));
  // Har CPV-koder, men ingen bransjetreff: ikke gjett ut fra tittelen
  assert.deepEqual(deriveIndustries(cpvPrefixes(['03000000']), 'Vakthold og renhold', null), []);
  assert.ok(deriveIndustries([], 'Vakthold ved rådhuset', null).includes('security'));
});

test('ordgrense ved søk etter begreper', () => {
  assert.equal(containsTerm('Renhold av skoler', 'renhold'), true);
  assert.equal(containsTerm('Vinduspuss og renholdstjenester', 'renhold'), true);
  assert.equal(containsTerm('Forrenhold', 'renhold'), false);
});

test('norske organisasjonsnumre valideres med MOD11', () => {
  assert.equal(isValidNorwegianOrgNumber('974760673'), true); // Brønnøysundregistrene
  assert.equal(isValidNorwegianOrgNumber('974760674'), false);
  assert.equal(isValidNorwegianOrgNumber('12345678'), false);
  assert.equal(cleanOrgNumber('NO 974 760 673 MVA', 'NO'), '974760673');
  assert.equal(cleanOrgNumber('123', 'NO'), null);
});

test('navn normaliseres for duplikatkontroll', () => {
  assert.equal(normalizeName('Glans Renhold AS'), normalizeName('GLANS RENHOLD A/S'.replace('A/S', 'AS')));
  assert.equal(normalizeName('Nordlys  Vakt AS.'), 'nordlys vakt');
});

test('NUTS-koder gir fylker, bare for Norge', () => {
  assert.deepEqual(regionCodesFor({ nutsCodes: ['NO060'], countryCode: 'NO' }), ['50']);
  assert.deepEqual(regionCodesFor({ nutsCodes: ['SE110'], countryCode: 'SE' }), []);
});

test('livssyklus går bare fremover', () => {
  assert.equal(laterLifecycle('competition', 'awarded'), 'awarded');
  assert.equal(laterLifecycle('awarded', 'competition'), 'awarded');
  assert.equal(laterLifecycle('competition', 'cancelled'), 'cancelled');
});

test('frister: norsk tid med sommertid, og dato uten klokkeslett', () => {
  assert.equal(osloOffset('2026-07-01'), '+02:00');
  assert.equal(osloOffset('2026-12-01'), '+01:00');
  assert.deepEqual(combineDateTime('2026-11-24+01:00', '12:00:00+01:00'), { iso: '2026-11-24T11:00:00.000Z', timeKnown: true });
  assert.deepEqual(combineDateTime('2026-07-01', '12:00'), { iso: '2026-07-01T10:00:00.000Z', timeKnown: true });
  // Bare dato: slutten av dagen norsk tid, og klokkeslettet merkes som ukjent
  assert.deepEqual(combineDateTime('2026-11-24', null), { iso: '2026-11-24T22:59:00.000Z', timeKnown: false });
  assert.deepEqual(combineDateTime('ikke en dato', null), { iso: null, timeKnown: false });
  assert.equal(parseSourceDateTime('2026-06-15T12:00'), '2026-06-15T10:00:00.000Z');
  assert.equal(parseSourceDateTime('2026-06-15T12:00:00Z'), '2026-06-15T12:00:00.000Z');
  assert.equal(parseSourceDateTime('tull'), null);
});

test('HTML fjernes fra kildetekst', () => {
  assert.equal(stripHtml('<p>Første</p><p>Andre &amp; tredje</p>'), 'Første\n\n Andre & tredje');
  assert.equal(stripHtml(''), null);
});

test('prosedyrekoder får norsk tekst', () => {
  assert.equal(procedureLabel('open'), 'Åpen anbudskonkurranse');
  assert.equal(procedureLabel('neg-w-call'), 'Konkurranse med forhandling');
  assert.equal(procedureLabel('Ukjent type'), 'Ukjent type');
});
