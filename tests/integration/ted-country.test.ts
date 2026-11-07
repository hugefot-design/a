/**
 * Flere land i TED – bare måling: den vanlige hentingen spør fortsatt bare etter Norge, et annet land kan
 * måles med dry-run (volum og plassbehov), og ingenting fra andre land kan lagres.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { runConnector } from '../../src/connectors';

const mutableEnv = env as unknown as Record<string, unknown>;
const savedEnv = { ...env };
const fixture = JSON.parse(readFileSync(new URL('../fixtures/ted-live-2026-11-01.json', import.meta.url), 'utf8')) as { notices: Record<string, unknown>[] };
const queries: string[] = [];
let server: Server;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const q = String((JSON.parse(body) as { query: string }).query);
      queries.push(q);
      // Svar med de ekte kunngjøringene, merket med landet det ble spurt etter.
      const country = /buyer-country=([A-Z]{3})/.exec(q)?.[1] ?? 'NOR';
      const notices = fixture.notices.map((n) => ({ ...n, 'buyer-country': [country] }));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ notices, iterationNextToken: null, totalNoticeCount: notices.length }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  mutableEnv.TED_API_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  Object.assign(mutableEnv, savedEnv);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeDb();
});

async function snapshot() {
  const [row] = (await systemSql()`
    select (select count(*)::int from import_runs where source = 'ted') as runs,
           (select count(*)::int from tenders where country_code <> 'NO') as foreign_tenders,
           (select last_success_at from data_sources where id = 'ted') as last_success
  `) as unknown as { runs: number; foreignTenders: number; lastSuccess: Date | null }[];
  return row!;
}

test('den vanlige hentingen spør bare etter Norge (uendret)', async () => {
  queries.length = 0;
  const r = await runConnector('ted', { trigger: 'cli', dryRun: true, force: true, since: new Date('2026-10-01T00:00:00Z') });
  assert.equal(r.ok, true, r.error);
  assert.ok(queries.length >= 1);
  assert.ok(queries.every((q) => q.startsWith('buyer-country=NOR AND publication-date>=20261001')), queries.join(' | '));
});

test('Sverige kan måles med dry-run: volum og plassbehov, ingenting lagres', async () => {
  const before0 = await snapshot();
  queries.length = 0;
  const r = await runConnector('ted', { trigger: 'cli', dryRun: true, force: true, country: 'swe', since: new Date('2026-10-08T00:00:00Z'), until: new Date('2026-11-07T00:00:00Z') });
  assert.equal(r.ok, true, r.error);
  assert.ok(queries[0]!.startsWith('buyer-country=SWE AND'), queries[0]);
  assert.equal(r.stats?.fetched, fixture.notices.length);
  const v = r.volume!;
  assert.equal(v.notices, fixture.notices.length);
  assert.equal(v.days, 30);
  assert.equal(v.perMonth, fixture.notices.length);
  assert.ok(v.avgRawKb > 0 && v.estimatedMbPerMonth > 0, JSON.stringify(v));
  assert.ok(r.sample?.every((n) => (n as { countryCode: string }).countryCode === 'SE'), 'tolket som svenske');
  const after0 = await snapshot();
  assert.deepEqual(after0, before0, 'ingen kjøring, ingen anbud og ingen endring i siste vellykkede henting');
});

test('andre land kan ikke lagres, og ukjente land avvises', async () => {
  const before0 = await snapshot();
  queries.length = 0;
  const save = await runConnector('ted', { trigger: 'cli', force: true, country: 'SWE' });
  assert.equal(save.ok, false);
  assert.match(save.error ?? '', /bare måles med --dry-run/);
  const doffin = await runConnector('doffin', { trigger: 'cli', dryRun: true, force: true, country: 'SWE' });
  assert.equal(doffin.ok, false);
  const unknown = await runConnector('ted', { trigger: 'cli', dryRun: true, force: true, country: 'XYZ' });
  assert.match(unknown.error ?? '', /Ukjent land/);
  assert.equal(queries.length, 0, 'ingen kall mot TED');
  assert.deepEqual(await snapshot(), before0);
});
