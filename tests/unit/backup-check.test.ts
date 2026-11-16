/**
 * Admin viser om det finnes en fersk sikkerhetskopi av databasen (Supabase sin gratisplan tar ingen selv). Kontrollen
 * ser bare på navn og tidspunkt i den private bøtta, og sier fra når den ikke kan kontrollere – i stedet for å gjette.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../../src/lib/env';
import { checkBackups } from '../../src/lib/storage';

const saved = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
const NOW = new Date('2026-11-16T12:00:00Z');
let realFetch: typeof fetch;
let listing: { status: number; body: unknown } = { status: 200, body: [] };
const calls: { url: string; body: unknown }[] = [];

before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(listing.body), { status: listing.status });
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  Object.assign(env, { SUPABASE_URL: saved.url, SUPABASE_SERVICE_ROLE_KEY: saved.key });
});

test('uten Supabase-nøkler i appen: «kan ikke kontrolleres», og ingen kall', async () => {
  Object.assign(env, { SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined });
  calls.length = 0;
  const r = await checkBackups(NOW);
  assert.equal(r.state, 'ukjent');
  assert.match(r.detail, /Kan ikke kontrolleres herfra/);
  assert.match(r.detail, /docs\/DRIFT\.md/);
  assert.equal(calls.length, 0);
});

test('med nøkler: fersk kopi er ok, gammel eller ingen kopi er feil – og bare navn og tidspunkt leses', async () => {
  Object.assign(env, { SUPABASE_URL: 'https://prosjekt.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-nokkel' });
  listing = {
    status: 200,
    body: [
      { name: 'annen-fil.txt', created_at: '2026-11-16T11:00:00Z' },
      { name: 'anbudradar-2026-11-15T0223Z.dump.gpg', created_at: '2026-11-15T02:30:00Z' },
      { name: 'anbudradar-2026-11-16T0223Z.dump.gpg', created_at: '2026-11-16T02:30:00Z' },
    ],
  };
  calls.length = 0;
  const ok = await checkBackups(NOW);
  assert.equal(ok.state, 'ok');
  assert.equal(ok.detail, 'Siste kopi for 10 timer siden.');
  assert.equal(calls[0]!.url, 'https://prosjekt.supabase.co/storage/v1/object/list/sikkerhetskopier');

  listing = { status: 200, body: [{ name: 'anbudradar-2026-11-12T0223Z.dump.gpg', created_at: '2026-11-12T02:30:00Z' }] };
  const old = await checkBackups(NOW);
  assert.equal(old.state, 'feil');
  assert.match(old.detail, /Siste kopi er 4 døgn gammel – den nattlige kopien har stoppet\./);

  listing = { status: 200, body: [] };
  assert.match((await checkBackups(NOW)).detail, /Ingen sikkerhetskopi funnet/);
  listing = { status: 400, body: { statusCode: '404', error: 'Bucket not found' } };
  assert.equal((await checkBackups(NOW)).state, 'feil', 'bøtta finnes ikke');
  listing = { status: 500, body: {} };
  assert.match((await checkBackups(NOW)).detail, /Bøtta kunne ikke leses \(500\)/);
});
