/**
 * Automatisk Doffin-XML-berikelse mot ekte database (Doffin-API-et simuleres):
 *  - av som standard: ingen kall mot Doffin før DOFFIN_ENRICH_XML er slått på,
 *  - kandidater: åpne konkurranser først; gamle avsluttede og allerede berikede hoppes over,
 *  - plan og dry-run lagrer ingenting,
 *  - vellykket nedlasting → full XML lagret og «ok»; 404 → nytt forsøk om 24 t, gir opp etter tre,
 *  - 429 stopper kjøringen uten å telle forsøk,
 *  - planlagt sveip (last_success_at) påvirkes ikke.
 */
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { memorySlots } from '../../src/lib/api-slots';
import { runConnector } from '../../src/connectors';
import { mapDoffinHit, setDoffinDownloadDeps, type DoffinHit } from '../../src/connectors/doffin';
import { enrichDoffinXml, enrichmentOverview, selectEnrichmentCandidates } from '../../src/connectors/doffin-enrich';
import { runScheduledTask } from '../../src/domain/ops/tasks';
import { finishImportRun, ingestNotices, startImportRun } from '../../src/domain/tenders/ingest';
import { clientFor, createAccount, startServer, tenderIdFor, makeAdmin } from '../helpers';

const RUN = randomUUID().slice(0, 6).replace(/[a-f]/g, '7');
const id = (n: number) => `2026-${RUN}${n}`;
const OPEN = id(1);
const PLANNED = id(2);
const AWARD = id(3);
const OLD_CLOSED = id(4);
const ENRICHED = id(5);
const MISSING = id(6);
const LIMITED = id(7);
const MINE = [OPEN, PLANNED, AWARD, OLD_CLOSED, ENRICHED, MISSING, LIMITED];

const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

function xmlFor(title: string): string {
  return readFileSync(new URL('../fixtures/eforms/n16-konkurranse-v1.xml', import.meta.url), 'utf8')
    .replaceAll('8b3e1f20-1c2d-4e5f-8a9b-0c1d2e3f4a51', randomUUID())
    .replaceAll('5f0c2b1e-7a44-4d6b-9a10-2c3d4e5f6a71', randomUUID())
    .replaceAll('Vintervedlikehold av kommunale veier 2027–2029 (test)', title);
}

const SERVED: Record<string, () => Response> = {
  [OPEN]: () => new Response(xmlFor(`Berikes ${RUN} (test)`), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
  [ENRICHED]: () => new Response(xmlFor(`Allerede beriket ${RUN} (test)`), { status: 200 }),
};

let realFetch: typeof fetch;
let downloads: string[] = [];
let rateLimitAll = false;
const saved = { enrich: env.DOFFIN_ENRICH_XML, max: env.DOFFIN_ENRICH_MAX_PER_RUN };

before(async () => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Bare Doffin simuleres – testklientens kall mot den lokale serveren går som normalt.
    if (!String(input).startsWith(env.DOFFIN_API_BASE_URL)) return realFetch(input, init);
    const docId = decodeURIComponent(String(input).split('/download/')[1] ?? '');
    downloads.push(docId);
    if (rateLimitAll) return new Response('{"message":"Rate limit is exceeded."}', { status: 429, headers: { 'Retry-After': '600' } });
    return SERVED[docId]?.() ?? new Response('{"message":"Notice was not found."}', { status: 404 });
  }) as typeof fetch;
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = 'test-nokkel';
  // Plass til eventuelle kandidater fra andre testfiler i samme database.
  (env as { DOFFIN_ENRICH_MAX_PER_RUN: number }).DOFFIN_ENRICH_MAX_PER_RUN = 60;

  const hits: DoffinHit[] = [
    searchHit(OPEN, { heading: `Berikes ${RUN} (test)`, deadline: `${isoDay(60)}T11:00:00Z` }),
    searchHit(PLANNED, { heading: `Planlagt ${RUN} (test)`, type: 'ADVISORY_NOTICE', allTypes: ['ADVISORY_NOTICE'], deadline: undefined }),
    searchHit(AWARD, { heading: `Tildelt ${RUN} (test)`, type: 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT', allTypes: ['ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT'], deadline: undefined }),
    searchHit(OLD_CLOSED, {
      heading: `Gammel ${RUN} (test)`,
      deadline: `${isoDay(-10)}T11:00:00Z`,
      publicationDate: isoDay(-60),
      issueDate: `${isoDay(-60)}T08:00:00Z`,
    }),
    searchHit(ENRICHED, { heading: `Allerede beriket ${RUN} (test)`, deadline: `${isoDay(60)}T11:00:00Z` }),
    searchHit(MISSING, { heading: `Mangler ${RUN} (test)`, deadline: `${isoDay(45)}T11:00:00Z` }),
  ];
  const run = await startImportRun('doffin', 'cli', { test: RUN });
  const stats = await ingestNotices(hits.map(mapDoffinHit), run);
  await finishImportRun(run, stats, undefined, false, { updateSource: false });
  assert.equal(stats.created, hits.length, 'hvert søketreff blir eget anbud');
  // ENRICHED har allerede full XML (hentet med --id).
  setDoffinDownloadDeps({ intervalMs: 5 });
  const pre = await runConnector('doffin', { trigger: 'cli', ids: [ENRICHED], force: true });
  assert.equal(pre.ok, true);
  assert.equal(await rawFormat(ENRICHED), 'eforms-xml');
  setDoffinDownloadDeps(null);
});
beforeEach(() => {
  downloads = [];
  rateLimitAll = false;
  setDoffinDownloadDeps({ intervalMs: 5 });
});
afterEach(() => setDoffinDownloadDeps(null));
after(async () => {
  globalThis.fetch = realFetch;
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = undefined;
  (env as { DOFFIN_ENRICH_XML: boolean }).DOFFIN_ENRICH_XML = saved.enrich;
  (env as { DOFFIN_ENRICH_MAX_PER_RUN: number }).DOFFIN_ENRICH_MAX_PER_RUN = saved.max;
  await closeDb();
});

function searchHit(docId: string, over: Partial<DoffinHit> = {}): DoffinHit {
  return {
    id: docId,
    heading: `Søketreff ${docId} (test)`,
    description: 'Søketreff fra Doffin.',
    buyer: [{ id: 'x', name: `Oppdragsgiver ${docId} (test)`, organizationId: '912000001' }],
    locationId: ['NO0A2'],
    estimatedValue: { amount: 2_400_000, currencyCode: 'NOK' },
    type: 'ANNOUNCEMENT_OF_COMPETITION',
    allTypes: ['ANNOUNCEMENT_OF_COMPETITION'],
    status: 'ACTIVE',
    issueDate: `${isoDay(0)}T08:00:00Z`,
    publicationDate: isoDay(0),
    cpvCodes: ['90620000'],
    lots: [],
    ...over,
  };
}

async function rawFormat(docId: string): Promise<string | null> {
  const rows = (await systemSql()`select raw->>'format' as raw_format from tender_sources where source = 'doffin' and source_notice_id = ${docId}`) as unknown as {
    rawFormat: string | null;
  }[];
  return rows[0]?.rawFormat ?? null;
}

async function stateOf(docId: string) {
  const rows = (await systemSql()`
    select status, attempts, last_outcome, extract(epoch from (next_attempt_at - now())) / 3600 as hours_to_next
    from doffin_enrichment where doffin_id = ${docId}
  `) as unknown as { status: string; attempts: number; lastOutcome: string; hoursToNext: number | null }[];
  return rows[0] ?? null;
}

const mineIn = (ids: string[]) => ids.filter((x) => MINE.includes(x));

test('av som standard: planlagt oppgave gjør ingen kall mot Doffin', async () => {
  (env as { DOFFIN_ENRICH_XML: boolean }).DOFFIN_ENRICH_XML = false;
  const result = (await runScheduledTask('enrich-doffin', 'schedule')) as { ok: boolean; skipped?: string };
  assert.equal(result.ok, true);
  assert.match(result.skipped ?? '', /DOFFIN_ENRICH_XML/);
  assert.deepEqual(downloads, []);
});

test('plan: viser kandidatene i prioritert rekkefølge uten kall mot Doffin og uten å lagre noe', async () => {
  const result = await enrichDoffinXml({ trigger: 'cli', plan: true, limit: 200 });
  const order = mineIn((result.plan ?? []).map((c) => c.doffinId));
  assert.deepEqual(new Set(order.slice(0, 2)), new Set([OPEN, MISSING]), 'åpne konkurranser først');
  assert.deepEqual(order.slice(2), [PLANNED, AWARD], 'så planlagte, så andre nylig publiserte');
  assert.ok(!order.includes(OLD_CLOSED), 'gammel, avsluttet konkurranse hentes ikke');
  assert.ok(!order.includes(ENRICHED), 'har allerede full XML');
  assert.deepEqual(downloads, []);
  const rows = (await systemSql()`select 1 from doffin_enrichment where doffin_id = any(${MINE}::text[])`) as unknown as unknown[];
  assert.equal(rows.length, 0);
});

test('dry-run: laster ned, men lagrer verken kunngjøringsdata eller forsøk', async () => {
  const result = await enrichDoffinXml({ trigger: 'cli', dryRun: true, force: true, limit: 200 });
  assert.ok(mineIn(downloads).includes(OPEN));
  assert.equal(result.recorded, undefined);
  assert.equal(await rawFormat(OPEN), null, 'fortsatt bare søketreffet');
  assert.equal(await stateOf(OPEN), null);
  assert.equal(await stateOf(MISSING), null);
});

test('planlagt kjøring: full XML lagres, 404 prøves igjen om ett døgn, sveipet påvirkes ikke', async () => {
  (env as { DOFFIN_ENRICH_XML: boolean }).DOFFIN_ENRICH_XML = true;
  const sql = systemSql();
  const [source] = (await sql`select last_success_at from data_sources where id = 'doffin'`) as unknown as { lastSuccessAt: Date | null }[];
  const result = (await runScheduledTask('enrich-doffin', 'schedule')) as Awaited<ReturnType<typeof enrichDoffinXml>>;
  assert.ok((result.candidates ?? 0) >= 4);
  assert.deepEqual(mineIn(downloads).slice(0, 2).sort(), [OPEN, MISSING].sort());
  assert.ok(!downloads.includes(OLD_CLOSED) && !downloads.includes(ENRICHED));

  assert.equal(await rawFormat(OPEN), 'eforms-xml');
  const ok = await stateOf(OPEN);
  assert.deepEqual([ok?.status, ok?.attempts, ok?.lastOutcome], ['ok', 1, 'ok']);
  const missing = await stateOf(MISSING);
  assert.deepEqual([missing?.status, missing?.attempts, missing?.lastOutcome], ['retry', 1, 'not_found']);
  assert.ok(missing!.hoursToNext! > 23.9 && missing!.hoursToNext! <= 24, `neste forsøk om ${missing!.hoursToNext} t`);

  const [after] = (await sql`select last_success_at from data_sources where id = 'doffin'`) as unknown as { lastSuccessAt: Date | null }[];
  assert.equal(after!.lastSuccessAt?.getTime() ?? null, source!.lastSuccessAt?.getTime() ?? null, 'styrer neste sveip – skal ikke flyttes');
  const [run] = (await sql`select trigger, status from import_runs where id = ${result.runId!}`) as unknown as { trigger: string; status: string }[];
  assert.deepEqual([run!.trigger, run!.status], ['schedule', 'partial']);

  // Ingen av dem er kandidater igjen før ventetiden er ute.
  const again = await selectEnrichmentCandidates(200);
  assert.deepEqual(mineIn(again.map((c) => c.doffinId)), []);
});

test('404 tre ganger: gir opp og vises i admin-oversikten', async () => {
  const sql = systemSql();
  for (const expected of [
    { status: 'retry', attempts: 2 },
    { status: 'gave_up', attempts: 3 },
  ]) {
    await sql`update doffin_enrichment set next_attempt_at = now() - interval '1 minute' where doffin_id = ${MISSING}`;
    await enrichDoffinXml({ trigger: 'schedule', limit: 200 });
    const s = await stateOf(MISSING);
    assert.deepEqual([s?.status, s?.attempts], [expected.status, expected.attempts]);
  }
  assert.equal((await stateOf(MISSING))!.hoursToNext, null, 'ingen nye forsøk');
  await sql`update doffin_enrichment set next_attempt_at = now() - interval '1 minute' where doffin_id = ${MISSING}`;
  const candidates = await selectEnrichmentCandidates(200);
  assert.ok(!candidates.some((c) => c.doffinId === MISSING), 'oppgitt – hentes ikke igjen');

  const overview = await enrichmentOverview();
  assert.equal(overview.enabled, true);
  assert.ok(overview.enriched >= 2);
  assert.ok(overview.recentProblems.some((p) => p.doffinId === MISSING && p.status === 'gave_up' && p.lastOutcome === 'not_found'));
});

test('429: kjøringen stopper, og ingen forsøk telles', async () => {
  const run = await startImportRun('doffin', 'cli', { test: RUN });
  const stats = await ingestNotices([mapDoffinHit(searchHit(LIMITED, { heading: `Begrenset ${RUN} (test)`, deadline: `${isoDay(30)}T11:00:00Z` }))], run);
  await finishImportRun(run, stats, undefined, false, { updateSource: false });
  rateLimitAll = true;
  // Tempo i minnet, så 429-pausen ikke forsinker andre tester mot samme database.
  setDoffinDownloadDeps({ intervalMs: 5, slots: memorySlots(), sleep: async () => {} });
  const result = await enrichDoffinXml({ trigger: 'schedule', limit: 200 });
  assert.equal(result.ok, false);
  assert.equal(result.downloads?.[0]?.outcome, 'rate_limited');
  assert.ok(result.downloads!.slice(1).every((d) => d.outcome === 'not_attempted'));
  assert.equal(downloads.length, 1, 'ett kall – så stopp');
  assert.equal(await stateOf(LIMITED), null, 'teller ikke som forsøk');
  assert.ok((await selectEnrichmentCandidates(200)).some((c) => c.doffinId === LIMITED), 'prøves ved neste kjøring');
});

test('admin → Datakilder viser berikelsen med siste problemer (bare for plattform-admin)', async () => {
  const server = await startServer();
  try {
    const admin = await createAccount();
    await makeAdmin(admin.user.id);
    const page = await (await clientFor(server.base, admin)).get('/admin/kilder');
    assert.equal(page.status, 200);
    assert.match(page.body, /Doffin: full kunngjøring \(eForms-XML\)/);
    assert.ok(page.body.includes(MISSING), 'oppgitt ID vises');
    assert.match(page.body, /Ga opp/);
    assert.match(page.body, /Siste forsøk: (?!aldri)/);

    const user = await createAccount();
    assert.equal((await (await clientFor(server.base, user)).get('/admin/kilder')).status, 404);
  } finally {
    await server.close();
  }
});

test('anbudssiden viser regelverk, terskel og klimakriterium fra full kunngjøring – og ingenting for bare søkedata', async () => {
  const server = await startServer();
  try {
    const user = await createAccount();
    const client = await clientFor(server.base, user);
    // Samme anbud finnes også i TED, publisert før Doffin-kunngjøringen (vanlig over EØS-terskelverdiene).
    const tenderId = await tenderIdFor('doffin', OPEN);
    await systemSql()`
      insert into tender_sources (tender_id, source, source_notice_id, published_at, raw, content_hash)
      values (${tenderId}, 'ted', ${`${RUN}-2026`}, now() - interval '1 day', '{}'::jsonb, 'test')
    `;
    const page = await client.get(`/app/anbud/${tenderId}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Nasjonal kunngjøring \(bare i Doffin\)/);
    assert.match(page.body, /Skjema N16/);
    assert.match(page.body, /href="https:\/\/lovdata\.no\/dokument\/SF\/forskrift\/2016-08-12-974"[^>]*>Anskaffelsesforskriften<\/a>/);
    assert.match(page.body, /Del 1 og 2/);
    assert.match(page.body, /Klima- og miljøhensyn \(tildelingskriterium\) – 30\u00a0%/);
    assert.match(page.body, /Elektronisk innlevering/);
    assert.match(page.body, /\(full kunngjøring\)/);

    const thin = await client.get(`/app/anbud/${await tenderIdFor('doffin', PLANNED)}`);
    assert.equal(thin.status, 200);
    for (const text of ['Nasjonal kunngjøring', 'Regelverk', 'Klima og miljø', '(full kunngjøring)']) assert.ok(!thin.body.includes(text), `ikke for søketreff: ${text}`);
  } finally {
    await server.close();
  }
});
