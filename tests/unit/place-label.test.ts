/**
 * Stedet i anbudslistene: et anbud som gjelder mange fylker, viser hvor mange, så det er tydelig
 * hvorfor det dukker opp når man filtrerer på et annet fylke. Navn i bare store bokstaver ryddes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLabel } from '../../src/ui/tender';

test('mange fylker: første fylke + antall, alle i verktøytipset', () => {
  assert.deepEqual(placeLabel('OSLO', ['03', '11', '46']), { label: 'Oslo + 2 fylker', all: 'Oslo, Rogaland, Vestland' });
});

test('ett eller to fylker: stedet eller fylkene', () => {
  assert.deepEqual(placeLabel('Hansnes', ['55']), { label: 'Hansnes', all: null });
  assert.deepEqual(placeLabel(null, ['46', '11']), { label: 'Vestland, Rogaland', all: null });
  assert.deepEqual(placeLabel('BERGEN', []), { label: 'Bergen', all: null });
  assert.deepEqual(placeLabel(null, []), { label: null, all: null });
});
