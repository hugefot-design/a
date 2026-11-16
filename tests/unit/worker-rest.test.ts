/**
 * Arbeiderens hvile når det er stille: taket må ligge under tidsavbruddet for ledige databasetilkoblinger, ellers
 * kobles den til på nytt hver runde (målt: 30 s hvile mot 20 s tidsavbrudd ga flere byte enn før). En ny jobb i
 * samme prosess vekker den med en gang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOL_IDLE_TIMEOUT_S } from '../../src/lib/db';
import { WORKER_REST_MAX_MS, WORKER_REST_MIN_MS, restWorker, wakeWorker } from '../../src/lib/jobs';

test('hvilen når det er stille er kortere enn tidsavbruddet for ledige tilkoblinger', () => {
  assert.ok(WORKER_REST_MIN_MS < WORKER_REST_MAX_MS);
  assert.ok(WORKER_REST_MAX_MS <= POOL_IDLE_TIMEOUT_S * 1000 - 5_000, `${WORKER_REST_MAX_MS} ms mot ${POOL_IDLE_TIMEOUT_S} s`);
});

test('wakeWorker avbryter hvilen', async () => {
  const started = Date.now();
  const rest = restWorker(10_000);
  setTimeout(wakeWorker, 20);
  await rest;
  assert.ok(Date.now() - started < 1_000, 'vekket med en gang');
});
