/**
 * Ordene bedriften skriver mot ordene i kunngjøringen (src/domain/matching/terms.ts). Eksemplene er fra
 * kundesimuleringen 16.11.2026 (docs/KUNDESIMULERING.md): «vakthold» fant ikke «vakttjenester», og
 * «elektroinstallasjon» fant ikke «elektriske».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandTerms, matchedWord, significantWords, stemExclusions } from '../../src/domain/matching/terms';

test('et ord treffer ord som begynner med det, og lange ord også inne i sammensatte ord', () => {
  assert.equal(matchedWord('Rammeavtale vakttjenester', 'vakttjenest'), 'vakttjenester');
  assert.equal(matchedWord('Renholdstjenester til tingretten', 'renhold'), 'renholdstjenester');
  assert.equal(matchedWord('Snøbrøyting og strøing 2027', 'brøyting'), 'snøbrøyting', 'langt ord inne i et sammensatt ord');
  assert.equal(matchedWord('Kontorrenhold for skolene', 'renhold'), 'kontorrenhold');
  assert.equal(matchedWord('Trykte skolebøker', 'bøker'), null, 'korte ord teller ikke inne i andre ord');
  assert.equal(matchedWord('El-installasjoner i formålsbygg', 'el-install'), 'el-installasjoner');
  assert.equal(matchedWord('Vakthold', 'drift'), null);
});

test('vanlige fagord kjennes igjen i flere former – men bare innen samme fag', () => {
  const vakt = expandTerms(['vakthold']);
  for (const s of ['vakttjenest', 'vekter']) assert.ok(vakt.includes(s), s);
  assert.ok(expandTerms(['vakt']).includes('vakttjenest'), '«vakt» alene hører til vakt');
  assert.deepEqual(expandTerms(['vaktmester']), [], '«vaktmester» er ikke vakthold');
  assert.ok(expandTerms(['elektroinstallasjon']).includes('elektr'));
  assert.ok(!expandTerms(['elektronikk']).includes('elinstall'), 'elektronikk er ikke elektroarbeid');
  assert.ok(expandTerms(['snøbrøyting']).includes('vinterdrift'));
  assert.ok(expandTerms(['kontorrenhold']).includes('rengjøring'));
  assert.ok(!expandTerms(['construction']).includes('prosjektering'), 'et generelt ord gir ikke en hel faggruppe');
  assert.ok(!expandTerms(['vakthold']).includes('vakthold'), 'ordene bedriften selv har, kommer ikke to ganger');
  assert.deepEqual(expandTerms(['regnskap']), []);
});

test('«elektr» fra faggruppen treffer ikke «elektronisk» – nesten alle kunngjøringer sier at tilbudet leveres elektronisk', () => {
  const not = stemExclusions('elektr');
  assert.deepEqual(not, ['elektron']);
  assert.equal(matchedWord('Tilbudet skal leveres elektronisk i KGV.', 'elektr', not), null);
  assert.equal(matchedWord('Tilbud leveres elektronisk. Omfatter elektriske arbeider.', 'elektr', not), 'elektriske', 'neste ord som er lov');
  assert.equal(matchedWord('Elektronikk', 'elektronikk'), 'elektronikk', 'bedriftens egne ord teller som de er');
  assert.deepEqual(stemExclusions('vakthold'), []);
});

test('ordene som betyr noe i en setning', () => {
  assert.deepEqual(significantWords('daglig renhold av kontorer og skoler'), ['daglig', 'renhold', 'kontorer', 'skoler']);
  assert.deepEqual(significantWords('resepsjon og alarmrespons'), ['resepsjon', 'alarmrespons']);
  assert.deepEqual(significantWords('Vi leverer tjenester'), []);
});
