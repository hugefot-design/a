/**
 * Hvilken modell prøves først (src/domain/ai/routing.ts): ga kvalitetsmodellen det siste svaret på nøyaktig de samme
 * kildene for under 5 minutter siden, går neste forespørsel rett dit. Private forespørsler har organisasjonen i
 * nøkkelen, og minnet er begrenset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WARM_CACHE_MS, qualityIsWarm, rememberAnswer, resetRoutingMemory, sourcesKey } from '../../src/domain/ai/routing';

const Q = 'claude-sonnet-5-5';
const H = 'claude-haiku-5-5';

test('varm buffer: kvalitetsmodellen i 5 minutter etter siste svar, ikke etter et billig svar', () => {
  resetRoutingMemory();
  const key = sourcesKey('system', '<kilder>A</kilder>', 'org-1');
  const t0 = 1_000_000;
  assert.equal(qualityIsWarm(key, Q, t0), false, 'ukjent kilde');
  rememberAnswer(key, Q, t0);
  assert.equal(qualityIsWarm(key, Q, t0 + WARM_CACHE_MS - 1), true);
  assert.equal(qualityIsWarm(key, Q, t0 + WARM_CACHE_MS), false, 'bufferen hos leverandøren er utløpt');
  rememberAnswer(key, Q, t0 + 4 * 60_000);
  assert.equal(qualityIsWarm(key, Q, t0 + 8 * 60_000), true, 'nytt svar forlenger');
  rememberAnswer(key, H, t0 + 9 * 60_000);
  assert.equal(qualityIsWarm(key, Q, t0 + 9 * 60_000), false, 'den billige modellen svarte sist – prøv den igjen');
});

test('nøkkelen: per organisasjon for private forespørsler, felles for delte; andre kilder eller instrukser gir ny nøkkel', () => {
  const k = (scope: string | null, system = 'system', prefix = '<kilder>A</kilder>') => sourcesKey(system, prefix, scope);
  assert.notEqual(k('org-1'), k('org-2'));
  assert.notEqual(k('org-1'), k(null));
  assert.equal(k(null), k(null));
  assert.notEqual(k(null), k(null, 'annen instruks'));
  assert.notEqual(k(null), k(null, 'system', '<kilder>B</kilder>'));
  assert.match(k('org-1'), /^[0-9a-f]{64}$/, 'bare et hash – ingen tekst');
});

test('minnet er begrenset: de eldste glemmes først', () => {
  resetRoutingMemory();
  const t = 5_000_000;
  const keys = Array.from({ length: 5_001 }, (_, i) => sourcesKey('s', `kilde ${i}`, null));
  keys.forEach((key) => rememberAnswer(key, Q, t));
  assert.equal(qualityIsWarm(keys[0]!, Q, t), false, 'den eldste er glemt');
  assert.equal(qualityIsWarm(keys[1]!, Q, t), true);
  assert.equal(qualityIsWarm(keys[5_000]!, Q, t), true);
  resetRoutingMemory();
});
