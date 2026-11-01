/**
 * Anbudskildene mot ekte database: dry-run, lagring av ekte TED-data, sammenslåing av TED (engelsk)
 * og Doffin (norsk), og at forbedret oversettelse ikke gir falske endringsvarsler.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { closeDb, systemSql } from '../../src/lib/db';
import { CONNECTORS, runConnector } from '../../src/connectors';
import { mapTedNotice } from '../../src/connectors/ted';
import { mapDoffinHit } from '../../src/connectors/doffin';
import type { SourceConnector } from '../../src/connectors/types';
import type { NormalizedNotice } from '../../src/domain/tenders/normalize';
import { ingest, makeNotice, tenderIdFor } from '../helpers';

after(async () => {
  await closeDb();
});

const tedLive = JSON.parse(readFileSync(new URL('../fixtures/ted-live-2026-11-01.json', import.meta.url), 'utf8')) as {
  notices: Record<string, unknown>[];
};
const fixture = (id: string) => mapTedNotice(tedLive.notices.find((n) => n['publication-number'] === id)!);

/** Fingeravtrykk av hele databasen: antall rader og innholdshash per tabell. */
async function databaseFingerprint(): Promise<Record<string, string>> {
  const sql = systemSql();
  const tables = (await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`) as unknown as { tablename: string }[];
  const out: Record<string, string> = {};
  for (const { tablename } of tables) {
    const [row] = (await sql.unsafe(
      `select count(*)::text || ':' || coalesce(md5(string_agg(md5(t::text), '' order by md5(t::text))), '') as fp from public."${tablename}" t`,
    )) as unknown as { fp: string }[];
    out[tablename] = row!.fp;
  }
  return out;
}

test('dry-run endrer ingenting i databasen – heller ikke ved feil i kildedata', async () => {
  const fake: SourceConnector = {
    id: 'ted',
    name: 'TED (test)',
    status: () => ({ configured: true, message: 'test' }),
    async fetch(_window, onError) {
      await onError('999999-2026', 'Mangler publication-number', { broken: true });
      return [fixture('718790-2026'), fixture('711382-2026')];
    },
  };
  const real = CONNECTORS.ted;
  CONNECTORS.ted = fake;
  try {
    const before = await databaseFingerprint();
    const result = await runConnector('ted', { trigger: 'cli', dryRun: true, force: true });
    const afterRun = await databaseFingerprint();
    assert.equal(result.ok, true);
    assert.equal(result.stats?.fetched, 2);
    assert.equal(result.stats?.errors, 1);
    assert.equal(result.errorSample?.length, 1);
    assert.equal(result.quality?.coverage.deadlineOfCompetitions, 100);
    assert.deepEqual(afterRun, before, 'ingen tabell er endret');
  } finally {
    CONNECTORS.ted = real;
  }
});

test('ekte TED-kunngjøringer lagres med frister, dokumentlenke, varighet og kriterier', async () => {
  const notices = tedLive.notices.map((h) => {
    const n = mapTedNotice(h);
    // Unike ID-er så testen kan kjøres flere ganger mot samme database.
    const token = randomUUID();
    return { ...n, sourceNoticeId: `${n.sourceNoticeId}-${token.slice(0, 6)}`, procedureId: token, details: { ...n.details, noticeIdentifier: randomUUID() } };
  });
  const stats = await ingest(notices);
  assert.equal(stats.errors, 0);
  assert.equal(stats.created, 6);
  const id = await tenderIdFor('ted', notices.find((n) => n.sourceNoticeId.startsWith('718790-2026'))!.sourceNoticeId);
  const [t] = (await systemSql()`
    select deadline_at, questions_deadline_at, deadline_kind, documents_url, submission_url, region_codes, text_language,
           tender_status(lifecycle, deadline_at, published_at) as status
    from tenders where id = ${id}
  `) as unknown as {
    deadlineAt: Date;
    questionsDeadlineAt: Date;
    deadlineKind: string;
    documentsUrl: string;
    submissionUrl: string;
    regionCodes: string[];
    textLanguage: string;
    status: string;
  }[];
  assert.equal(t!.deadlineAt.toISOString(), '2026-10-26T11:00:58.000Z');
  assert.equal(t!.questionsDeadlineAt.toISOString(), '2026-10-18T22:00:00.000Z');
  assert.equal(t!.deadlineKind, 'tender');
  assert.equal(t!.documentsUrl, 'https://tendsign.com/doc.aspx?MeFormsNoticeId=99972');
  assert.ok(t!.submissionUrl.startsWith('https://tendsign.com/'));
  assert.deepEqual(t!.regionCodes, []);
  assert.equal(t!.textLanguage, 'en');

  const sykehus = await tenderIdFor('ted', notices.find((n) => n.sourceNoticeId.startsWith('722733-2026'))!.sourceNoticeId);
  const [s] = (await systemSql()`select duration_text, is_framework, cardinality(region_codes) as regions from tenders where id = ${sykehus}`) as unknown as {
    durationText: string;
    isFramework: boolean;
    regions: number;
  }[];
  assert.deepEqual(s, { durationText: '48 måneder', isFramework: true, regions: 15 });
});

function pair(opts: { cpv?: string[]; value?: number } = {}): { ted: NormalizedNotice; doffin: NormalizedNotice } {
  const base = fixture('722733-2026');
  // Unik frist (hele minutter) per test, så testene ikke kobles mot hverandre.
  const deadline = new Date(Math.floor((Date.now() + (12 + Math.random() * 30) * 86_400_000) / 60_000) * 60_000);
  const published = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const ted: NormalizedNotice = {
    ...base,
    sourceNoticeId: `${Math.floor(Math.random() * 9e5) + 1e5}-2026`,
    procedureId: randomUUID(),
    publishedAt: published,
    deadlineAt: deadline.toISOString(),
    details: { ...base.details, noticeIdentifier: randomUUID() },
  };
  const doffin = mapDoffinHit({
    id: `2026-${Math.floor(Math.random() * 9e5) + 1e5}`,
    heading: 'Desinfeksjons- og rengjøringsmidler til renrom for helseforetakene',
    description: 'Sykehusinnkjøp HF skal på vegne av de fire regionale helseforetakene anskaffe desinfeksjons- og rengjøringsmidler til bruk i renrom.',
    buyer: [{ name: 'Sykehusinnkjøp HF', organizationId: '916 879 067' }],
    type: 'ANNOUNCEMENT_OF_COMPETITION',
    status: 'ACTIVE',
    deadline: new Date(deadline.getTime() + 30_000).toISOString(),
    publicationDate: published.slice(0, 10),
    cpvCodes: opts.cpv ?? ['33000000', '33140000', '24455000'],
    estimatedValue: { amount: opts.value ?? 40_000_000, currencyCode: 'NOK' },
    locationId: ['anyw'],
  });
  return { ted, doffin };
}

test('TED (engelsk) og Doffin (norsk) for samme anskaffelse slås sammen, og norsk tekst vinner', async () => {
  const { ted, doffin } = pair();
  await ingest([ted]);
  const stats = await ingest([doffin]);
  assert.equal(stats.duplicates, 1, 'Doffin-kunngjøringen kobles til TED-anbudet');
  const id = await tenderIdFor('ted', ted.sourceNoticeId);
  assert.equal(await tenderIdFor('doffin', doffin.sourceNoticeId), id);
  const [t] = (await systemSql()`select title, text_language, documents_url, duration_text, source_url from tenders where id = ${id}`) as unknown as {
    title: string;
    textLanguage: string;
    documentsUrl: string;
    durationText: string;
    sourceUrl: string;
  }[];
  assert.equal(t!.title, 'Desinfeksjons- og rengjøringsmidler til renrom for helseforetakene');
  assert.equal(t!.textLanguage, 'nb');
  assert.equal(t!.documentsUrl, 'https://sykehusinnkjop.ivalua.app/page.aspx/nb/rfp/request_browse_public', 'detaljer fra TED beholdes');
  assert.equal(t!.durationText, '48 måneder');
  assert.ok(t!.sourceUrl.startsWith('https://doffin.no/notices/'), 'norsk kildelenke foretrekkes');
});

test('samme oppdragsgiver og frist, men annen bransje eller verdi, slås IKKE sammen', async () => {
  const otherCpv = pair({ cpv: ['45000000', '45210000'] });
  await ingest([otherCpv.ted]);
  assert.equal((await ingest([otherCpv.doffin])).duplicates, 0);

  const otherValue = pair({ value: 10_000_000 });
  await ingest([otherValue.ted]);
  assert.equal((await ingest([otherValue.doffin])).duplicates, 0);
});

test('ny versjon av oversettelsen retter data uten falske «fristen er endret»-varsler', async () => {
  const token = randomUUID().slice(0, 8);
  const n = makeNotice({
    source: 'ted',
    sourceNoticeId: `${Math.floor(Math.random() * 9e5) + 1e5}-2026`,
    procedureId: randomUUID(),
    title: `Brøyting og strøing ${token} (test)`,
    buyerName: `Remapkommune ${token}`,
  });
  await ingest([n]);
  const id = await tenderIdFor('ted', n.sourceNoticeId);
  // Simuler at kunngjøringen ble lagret av en eldre versjon av koden (med feil frist).
  await systemSql()`update tender_sources set normalize_version = 1, content_hash = 'gammel' where tender_id = ${id}`;
  const corrected = { ...n, deadlineAt: new Date(Date.now() + 40 * 86_400_000).toISOString() };
  await new Promise((r) => setTimeout(r, 5)); // første import er «før» denne kjøringen
  const stats = await ingest([corrected]);
  assert.equal(stats.updated, 1);
  const updates = await systemSql()`select 1 from tender_updates where tender_id = ${id}`;
  assert.equal(updates.length, 0, 'retting av egen oversettelse er ikke en endring hos oppdragsgiver');
  const [row] = (await systemSql()`select deadline_at from tenders where id = ${id}`) as unknown as { deadlineAt: Date }[];
  assert.equal(row!.deadlineAt.toISOString(), new Date(corrected.deadlineAt).toISOString(), 'fristen er rettet');

  // En ekte rettelse (ny kunngjøring for samme anskaffelse) gir fortsatt varsel.
  const change = { ...corrected, sourceNoticeId: `${n.sourceNoticeId}-v2`, publishedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 50 * 86_400_000).toISOString() };
  await ingest([change]);
  const after = (await systemSql()`select change_type from tender_updates where tender_id = ${id}`) as unknown as { changeType: string }[];
  assert.deepEqual(after.map((u) => u.changeType), ['deadline_changed']);
});
