/**
 * Offentlige sider: alle svarer, har nøyaktig én hovedoverskrift, illustrasjoner er merket som
 * fiktive, og prøveperioden i teksten følger innstillingen (TRIAL_DAYS) i stedet for å være hardkodet.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const savedTrialDays = env.TRIAL_DAYS;

before(async () => {
  server = await startServer();
});
after(async () => {
  (env as { TRIAL_DAYS: number }).TRIAL_DAYS = savedTrialDays;
  await server.close();
  await closeDb();
});

const get = async (path: string) => {
  const res = await fetch(`${server.base}${path}`);
  return { status: res.status, body: await res.text() };
};

test('alle offentlige sider svarer og har nøyaktig én h1', async () => {
  for (const path of ['/', '/funksjoner', '/priser', '/bransjer', '/om', '/kontakt', '/personvern', '/vilkar']) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.equal((page.body.match(/<h1[\s>]/g) ?? []).length, 1, `én h1 på ${path}`);
  }
});

test('forsiden merker produktbildet og eksemplene som fiktive', async () => {
  const page = await get('/');
  assert.match(page.body, /Finn anbudene som passer/);
  assert.match(page.body, /Illustrasjon · fiktive data/);
  assert.ok((page.body.match(/>Eksempel</g) ?? []).length >= 5, 'hvert eksempel i funksjonsoversikten er merket');
  // Ingen påstander om kunder eller omtaler vi ikke kan dokumentere.
  assert.doesNotMatch(page.body, /fornøyde kunder|kundene våre sier|★/i);
});

test('prøveperioden i markedsteksten følger TRIAL_DAYS', async () => {
  (env as { TRIAL_DAYS: number }).TRIAL_DAYS = 30;
  const home = await get('/');
  const pricing = await get('/priser');
  const register = await get('/registrer');
  for (const page of [home, pricing, register]) {
    assert.match(page.body, /30 dager/);
    assert.doesNotMatch(page.body, /14 dager/);
  }
});
