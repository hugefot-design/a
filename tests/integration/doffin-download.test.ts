/**
 * Doffin-nedlasting per ID mot ekte database (Doffin-API-et simuleres):
 *  - felles tempo-luke i databasen (gjelder alle prosesser),
 *  - dry-run lagrer ingen kunngjøringsdata,
 *  - import per ID flytter ikke `last_success_at` (styrer neste planlagte sveip),
 *  - rettelse (samme notice-id, ny versjon) og tildeling (samme prosedyre-id) havner på samme anbud,
 *  - søketreff overskriver ikke en XML-beriket kunngjøring, men kan melde avlysning,
 *  - første berikelse av et søketreff gir ingen falske endringsvarsler,
 *  - TED-integrasjonen er ikke berørt (egne tester i sources.test.ts).
 */
import { after, afterEach, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { dbSlots } from '../../src/lib/api-slots';
import { runConnector } from '../../src/connectors';
import { mapDoffinHit, setDoffinDownloadDeps, type DoffinHit } from '../../src/connectors/doffin';
import { finishImportRun, ingestNotices, startImportRun } from '../../src/domain/tenders/ingest';

// Unike ID-er per kjøring, så testen kan kjøres flere ganger mot samme database.
const RUN = randomUUID().slice(0, 6);
const NOTICE_ID = randomUUID();
const PROC_ID = randomUUID();
const AWARD_NOTICE_ID = randomUUID();
const ID_V1 = `2026-${RUN}1`.replace(/[a-f]/g, '7');
const ID_V2 = `2026-${RUN}2`.replace(/[a-f]/g, '7');
const ID_AWARD = `2027-${RUN}3`.replace(/[a-f]/g, '7');
const ID_MISSING = `2026-${RUN}9`.replace(/[a-f]/g, '7');

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/eforms/${name}`, import.meta.url), 'utf8')
    .replaceAll('8b3e1f20-1c2d-4e5f-8a9b-0c1d2e3f4a51', NOTICE_ID)
    .replaceAll('5f0c2b1e-7a44-4d6b-9a10-2c3d4e5f6a71', PROC_ID)
    .replaceAll('3c9d8e7f-6a5b-4c3d-9e2f-1a0b9c8d7e61', AWARD_NOTICE_ID)
    .replaceAll('Vintervedlikehold av kommunale veier 2027–2029 (test)', `Vintervedlikehold ${RUN} (test)`);
}

const SERVED: Record<string, () => Response> = {
  [ID_V1]: () => new Response(fixture('n16-konkurranse-v1.xml'), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }),
  [ID_V2]: () => new Response(fixture('n16-konkurranse-v2-rettelse.xml'), { status: 200 }),
  [ID_AWARD]: () => new Response(fixture('n29-tildeling.xml'), { status: 200 }),
};

let realFetch: typeof fetch;
let downloads: string[] = [];

before(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const id = decodeURIComponent(String(input).split('/download/')[1] ?? '');
    downloads.push(id);
    return SERVED[id]?.() ?? new Response('{"message":"Notice was not found."}', { status: 404 });
  }) as typeof fetch;
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = 'test-nokkel';
});
beforeEach(() => {
  downloads = [];
  // Ekte database-luker, men kort intervall så testene går raskt.
  setDoffinDownloadDeps({ intervalMs: 5 });
});
afterEach(() => setDoffinDownloadDeps(null));
after(async () => {
  globalThis.fetch = realFetch;
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = undefined;
  await closeDb();
});

const tenderFor = async (doffinId: string): Promise<Record<string, any>> =>
  ((await systemSql()`
    select t.id, t.lifecycle, t.deadline_at, t.documents_url, t.submission_url, t.duration_months, t.is_framework, t.procedure_id,
           t.award_criteria, s.notice_identifier, s.notice_version, s.raw->>'format' as raw_format
    from tender_sources s join tenders t on t.id = s.tender_id
    where s.source = 'doffin' and s.source_notice_id = ${doffinId}
  `) as unknown as Record<string, any>[])[0]!;

test('felles tempo-luke i databasen: samtidige kallere får hver sin luke med minst intervallet mellom', async () => {
  const key = `test:${RUN}`;
  const sql = systemSql();
  const [{ start }] = (await sql`select extract(epoch from clock_timestamp()) * 1000 as start`) as unknown as [{ start: number }];
  const waits = (await Promise.all(Array.from({ length: 5 }, () => dbSlots.reserve(key, 1000)))).sort((a, b) => a - b);
  // Hver kaller venter fra sitt eget «nå», så forskjellen mellom ventetidene er intervallet minus
  // de få millisekundene mellom kallene. Lukene selv (i databasen) ligger nøyaktig ett intervall fra hverandre.
  for (let i = 1; i < waits.length; i++) assert.ok(waits[i]! - waits[i - 1]! >= 900 && waits[i]! - waits[i - 1]! <= 1100, `ventetider ${waits.join(', ')}`);
  const [{ nextAt }] = (await sql`select extract(epoch from next_at) * 1000 as next_at from api_slots where key = ${key}`) as unknown as [{ nextAt: number }];
  assert.ok(Math.abs(nextAt - start - 5000) < 250, `fem luker à 1 s etter hverandre (neste ledige ${Math.round(nextAt - start)} ms etter start)`);
  await dbSlots.defer(key, 60_000);
  const after429 = await dbSlots.reserve(key, 1000);
  assert.ok(after429 >= 59_000, `etter 429 venter neste kaller ${after429} ms`);
});

test('dry-run per ID: henter og viser, men lagrer ingen kunngjøringsdata', async () => {
  const sql = systemSql();
  const count = async () =>
    ((await sql`
      select (select count(*) from tenders)::int as t, (select count(*) from tender_sources)::int as s,
             (select count(*) from import_runs)::int as r, (select count(*) from import_errors)::int as e
    `) as unknown as { t: number; s: number; r: number; e: number }[])[0]!;
  const before = await count();
  const result = await runConnector('doffin', { trigger: 'cli', ids: [ID_V1, ID_MISSING], dryRun: true, force: true });
  assert.deepEqual(
    result.downloads?.map((d) => [d.id, d.outcome]),
    [
      [ID_V1, 'ok'],
      [ID_MISSING, 'not_found'],
    ],
  );
  assert.equal(result.stats?.fetched, 1);
  assert.deepEqual(await count(), before, 'ingenting er lagret eller endret');
});

test('import per ID: full XML lagres, og neste planlagte sveip påvirkes ikke', async () => {
  const sql = systemSql();
  const [src] = (await sql`select last_success_at, verified_live from data_sources where id = 'doffin'`) as unknown as {
    lastSuccessAt: Date | null;
    verifiedLive: boolean;
  }[];
  const result = await runConnector('doffin', { trigger: 'cli', ids: [ID_V1], force: true });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.stats?.created, 1);
  const t = await tenderFor(ID_V1);
  assert.ok(t, 'anbudet er lagret');
  assert.equal(t.rawFormat, 'eforms-xml');
  assert.equal(t.noticeIdentifier, NOTICE_ID);
  assert.equal(t.procedureId, PROC_ID);
  assert.equal(t.documentsUrl, 'https://konkurranse.example.no/fj-2026-041');
  assert.equal(t.submissionUrl, 'https://konkurranse.example.no/fj-2026-041/levering');
  assert.equal(t.durationMonths, 36);
  assert.equal(t.isFramework, true);
  assert.equal(t.deadlineAt.toISOString(), '2027-01-15T11:00:00.000Z');
  assert.ok((t.awardCriteria as { type: string }[]).some((c) => c.type === 'quality-nor-env-criteria'));
  const [srcAfter] = (await sql`select last_success_at, verified_live from data_sources where id = 'doffin'`) as unknown as {
    lastSuccessAt: Date | null;
    verifiedLive: boolean;
  }[];
  assert.equal(srcAfter!.lastSuccessAt?.getTime() ?? null, src!.lastSuccessAt?.getTime() ?? null, 'last_success_at er uendret');
  assert.equal(srcAfter!.verifiedLive, src!.verifiedLive, 'kilden markeres ikke som verifisert av en enkeltkunngjøring');
});

test('rettelse (ny Doffin-ID, samme notice-id) og tildeling (samme prosedyre-id) havner på samme anbud', async () => {
  const sql = systemSql();
  const original = await tenderFor(ID_V1);
  assert.ok(original);
  const r1 = await runConnector('doffin', { trigger: 'cli', ids: [ID_V2], force: true });
  assert.equal(r1.ok, true);
  const v2 = await tenderFor(ID_V2);
  assert.equal(v2.id, original.id, 'ikke et nytt anbud');
  assert.equal(v2.deadlineAt.toISOString(), '2027-01-22T11:00:00.000Z', 'ny frist');
  const events = (await sql`select change_type from tender_updates where tender_id = ${original.id}`) as unknown as { changeType: string }[];
  assert.ok(events.some((e) => e.changeType === 'deadline_changed'), 'kundene varsles om ny frist');

  const r2 = await runConnector('doffin', { trigger: 'cli', ids: [ID_AWARD], force: true });
  assert.equal(r2.ok, true);
  const award = await tenderFor(ID_AWARD);
  assert.equal(award.id, original.id, 'tildelingen kobles til konkurransen');
  assert.equal(award.lifecycle, 'awarded');
  const winners = (await sql`select supplier_name, awarded_value, award_date from contract_awards where tender_id = ${original.id}`) as unknown as {
    supplierName: string;
    awardedValue: number;
    awardDate: Date;
  }[];
  assert.deepEqual(
    winners.map((w) => [w.supplierName, w.awardedValue]),
    [['Brøyting og Bil AS (test)', 1_350_000]],
  );
  const after = (await sql`select change_type from tender_updates where tender_id = ${original.id}`) as unknown as { changeType: string }[];
  assert.ok(after.some((e) => e.changeType === 'awarded'));
});

function searchHit(id: string, over: Partial<DoffinHit> = {}): DoffinHit {
  return {
    id,
    heading: `Vintervedlikehold ${RUN} (test)`,
    description: 'Søketreff fra Doffin.',
    buyer: [{ id: 'x', name: 'Fjordvik kommune (test)', organizationId: '912000001' }],
    locationId: ['NO0A2'],
    estimatedValue: { amount: 2_400_000, currencyCode: 'NOK' },
    type: 'ANNOUNCEMENT_OF_COMPETITION',
    allTypes: ['ANNOUNCEMENT_OF_COMPETITION'],
    status: 'ACTIVE',
    issueDate: '2026-11-02T08:00:00Z',
    deadline: '2027-01-15T11:00:00Z',
    publicationDate: '2026-11-02',
    cpvCodes: ['90620000'],
    lots: [],
    ...over,
  };
}

async function ingestSearch(hits: DoffinHit[]) {
  const run = await startImportRun('doffin', 'cli', { test: RUN });
  const stats = await ingestNotices(hits.map(mapDoffinHit), run);
  await finishImportRun(run, stats, undefined, false, { updateSource: false });
  return stats;
}

test('søketreff overskriver ikke XML-dataene for samme Doffin-ID, men kan melde avlysning', async () => {
  const sql = systemSql();
  const before = await tenderFor(ID_V1);
  const stats = await ingestSearch([searchHit(ID_V1)]);
  assert.equal(stats.unchanged, 1);
  const after = await tenderFor(ID_V1);
  assert.equal(after.rawFormat, 'eforms-xml', 'XML-versjonen beholdes');
  assert.equal(after.documentsUrl, before.documentsUrl);

  const cancelled = await ingestSearch([searchHit(ID_V1, { status: 'CANCELLED' })]);
  assert.equal(cancelled.updated, 1);
  const t = await tenderFor(ID_V1);
  assert.equal(t.lifecycle, 'cancelled');
  assert.equal(t.rawFormat, 'eforms-xml');
  const events = (await sql`select change_type from tender_updates where tender_id = ${t.id} and change_type = 'cancelled'`) as unknown as unknown[];
  assert.equal(events.length, 1);
});

test('første berikelse av et søketreff med XML gir rikere data uten falske endringsvarsler', async () => {
  const sql = systemSql();
  const id = `2026-${RUN}5`.replace(/[a-f]/g, '7');
  const notice = randomUUID();
  const proc = randomUUID();
  SERVED[id] = () =>
    new Response(
      fixture('n16-konkurranse-v1.xml').replaceAll(NOTICE_ID, notice).replaceAll(PROC_ID, proc).replaceAll(`Vintervedlikehold ${RUN} (test)`, `Berikelse ${RUN} (test)`),
      { status: 200 },
    );
  // Først kun søketreffet (frist uten klokkeslett, ingen dokumentlenke) …
  await ingestSearch([searchHit(id, { heading: `Berikelse ${RUN} (test)`, deadline: '2027-01-15' })]);
  const thin = await tenderFor(id);
  assert.equal(thin.documentsUrl, null);
  // … så samme kunngjøring som full XML i en senere kjøring.
  const result = await runConnector('doffin', { trigger: 'cli', ids: [id], force: true });
  assert.equal(result.ok, true);
  const rich = await tenderFor(id);
  assert.equal(rich.id, thin.id);
  assert.equal(rich.documentsUrl, 'https://konkurranse.example.no/fj-2026-041');
  assert.equal(rich.rawFormat, 'eforms-xml');
  const events = (await sql`select change_type from tender_updates where tender_id = ${rich.id}`) as unknown as unknown[];
  assert.equal(events.length, 0, 'ingen varsler – oppdragsgiver har ikke endret noe');
});

test('import per ID: 404 registreres som feil på kunngjøringen, resten av kjøringen fortsetter', async () => {
  const sql = systemSql();
  const result = await runConnector('doffin', { trigger: 'cli', ids: [ID_MISSING, ID_V1], force: true });
  assert.equal(result.ok, false, 'kjøringen er delvis vellykket');
  assert.deepEqual(
    result.downloads?.map((d) => d.outcome),
    ['not_found', 'ok'],
  );
  const [run] = (await sql`select status from import_runs where id = ${result.runId!}`) as unknown as { status: string }[];
  assert.equal(run!.status, 'partial');
  const errors = (await sql`select stage, source_notice_id from import_errors where run_id = ${result.runId!}`) as unknown as {
    stage: string;
    sourceNoticeId: string;
  }[];
  assert.deepEqual(errors.map((e) => [e.stage, e.sourceNoticeId]), [['fetch', ID_MISSING]]);
  assert.deepEqual(downloads, [ID_MISSING, ID_V1]);
});
