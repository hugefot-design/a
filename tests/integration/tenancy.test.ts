/**
 * Organisasjonsisolasjon: data fra én kunde skal aldri være synlig for en annen –
 * verken via nettsidene eller direkte i databasen (radnivåsikkerhet).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDb, systemSql, withTenant } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let a: TestAccount;
let b: TestAccount;
let tenderId: string;
let workspaceId: string;
let documentId: string;
let savedSearchId: string;

before(async () => {
  server = await startServer();
  a = await createAccount({ plan: 'business', orgName: 'Org A (test)' });
  b = await createAccount({ plan: 'business', orgName: 'Org B (test)' });
  const notice = makeNotice();
  await ingest([notice]);
  tenderId = await tenderIdFor('manual', notice.sourceNoticeId);

  // Org A lagrer anbudet, lagrer et søk, laster opp et dokument, analyserer og starter tilbudsarbeid.
  const ca = await clientFor(server.base, a);
  assert.equal((await ca.post(`/app/anbud/${tenderId}/bokmerke`, {}, { from: `/app/anbud/${tenderId}` })).status, 303);
  assert.equal((await ca.post('/app/sok', { name: 'Hemmelig søk A', filters: 'q=vakthold', alert: 'daily' })).status, 303);
  const form = new FormData();
  form.append('file', new File([readFileSync(new URL('../fixtures/konkurransegrunnlag-eksempel.pdf', import.meta.url))], 'a-sitt-grunnlag.pdf', { type: 'application/pdf' }));
  const up = await ca.postMultipart(`/app/anbud/${tenderId}/dokumenter`, form, `/app/anbud/${tenderId}`);
  assert.equal(up.status, 303);
  const an = await ca.post(`/app/anbud/${tenderId}/analyse`, {}, { from: `/app/anbud/${tenderId}` });
  assert.equal(an.location, `/app/anbud/${tenderId}/analyse`);
  const ws = await ca.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` });
  assert.match(ws.location ?? '', /^\/app\/tilbud\/[0-9a-f-]{36}$/);
  workspaceId = ws.location!.split('/').pop()!;

  const sql = systemSql();
  documentId = ((await sql`select id from tender_documents where org_id = ${a.orgId}`) as unknown as { id: string }[])[0]!.id;
  savedSearchId = ((await sql`select id from saved_searches where org_id = ${a.orgId}`) as unknown as { id: string }[])[0]!.id;
});

after(async () => {
  await server.close();
  await closeDb();
});

test('nettsidene viser ikke en annen organisasjons data', async () => {
  const cb = await clientFor(server.base, b);
  assert.ok(!(await cb.get('/app/lagret')).body.includes(tenderId), 'lagrede anbud');
  assert.ok(!(await cb.get('/app/sok')).body.includes('Hemmelig søk A'), 'lagrede søk');
  assert.equal((await cb.get(`/app/tilbud/${workspaceId}`)).status, 404, 'tilbudsarbeid');
  assert.equal((await cb.get(`/app/tilbud/${workspaceId}/eksport?format=md`)).status, 404, 'eksport');
  const tenderPage = await cb.get(`/app/anbud/${tenderId}`);
  assert.equal(tenderPage.status, 200);
  assert.ok(!tenderPage.body.includes('a-sitt-grunnlag.pdf'), 'opplastede dokumenter');
  // A sin analyse bygger på et privat dokument og skal ikke vises for B
  const analysis = await cb.get(`/app/anbud/${tenderId}/analyse`);
  assert.equal(analysis.status, 303);
});

test('en organisasjon kan ikke endre eller slette en annens data', async () => {
  const cb = await clientFor(server.base, b);
  await cb.post(`/app/sok/${savedSearchId}/slett`, {});
  await cb.post(`/app/anbud/${tenderId}/dokumenter/${documentId}/slett`, {}, { from: `/app/anbud/${tenderId}` });
  await cb.post(`/app/tilbud/${workspaceId}/status`, { status: 'archived' });
  const sql = systemSql();
  assert.equal((await sql`select 1 from saved_searches where id = ${savedSearchId}`).length, 1);
  assert.equal((await sql`select 1 from tender_documents where id = ${documentId}`).length, 1);
  assert.equal(((await sql`select status from bid_workspaces where id = ${workspaceId}`) as unknown as { status: string }[])[0]!.status, 'draft');
});

const TENANT_TABLES = [
  'bookmarks',
  'saved_searches',
  'company_profiles',
  'match_results',
  'tender_documents',
  'tender_document_pages',
  'bid_workspaces',
  'bid_sections',
  'bid_checklist_items',
  'usage_records',
  'notifications',
  'audit_logs',
];

async function countForOrg(ctx: { userId: string; orgId: string | null }, table: string, orgId: string): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const rows = (await tx.unsafe(`select count(*)::int as n from ${table} where org_id = $1`, [orgId])) as unknown as { n: number }[];
    return rows[0]!.n;
  });
}

test('databasen (RLS) skjuler andre organisasjoners rader', async () => {
  // Sjekk at A faktisk har data, ellers tester vi ingenting
  for (const table of ['bookmarks', 'saved_searches', 'company_profiles', 'tender_documents', 'bid_workspaces', 'usage_records']) {
    assert.ok((await countForOrg({ userId: a.user.id, orgId: a.orgId }, table, a.orgId)) > 0, `A skal ha rader i ${table}`);
  }
  for (const table of TENANT_TABLES) {
    assert.equal(await countForOrg({ userId: b.user.id, orgId: b.orgId }, table, a.orgId), 0, `B ser A sine rader i ${table}`);
  }
  // Private AI-analyser (med opplastede dokumenter)
  const privateAnalyses = await withTenant({ userId: b.user.id, orgId: b.orgId }, (tx) => tx`select id from ai_analyses where org_id = ${a.orgId}`);
  assert.equal(privateAnalyses.length, 0);
});

test('forfalsket organisasjonskontekst gir ingen tilgang', async () => {
  // B sin bruker med A sin org-id (f.eks. ved en feil i applikasjonskoden): B er ikke medlem → ingenting
  for (const table of TENANT_TABLES) {
    assert.equal(await countForOrg({ userId: b.user.id, orgId: a.orgId }, table, a.orgId), 0, `forfalsket kontekst ga tilgang til ${table}`);
  }
  await assert.rejects(
    withTenant({ userId: b.user.id, orgId: a.orgId }, (tx) => tx`insert into bookmarks (org_id, tender_id) values (${a.orgId}, ${tenderId})`),
    /row-level security/,
  );
  // Uten kontekst: ingenting
  assert.equal(await countForOrg({ userId: b.user.id, orgId: null }, 'bookmarks', a.orgId), 0);
});

test('app-rollen kan ikke lese hemmelige tabeller eller endre abonnement', async () => {
  await withTenant({ userId: b.user.id, orgId: b.orgId }, async (tx) => {
    const own = (await tx`select plan from subscriptions where org_id = ${b.orgId}`) as unknown as { plan: string }[];
    assert.equal(own[0]?.plan, 'business');
    assert.equal((await tx`select 1 from subscriptions where org_id = ${a.orgId}`).length, 0);
  });
  await assert.rejects(
    withTenant({ userId: b.user.id, orgId: b.orgId }, (tx) => tx`update subscriptions set plan = 'enterprise' where org_id = ${b.orgId}`),
    /permission denied/,
  );
  await assert.rejects(withTenant({ userId: b.user.id, orgId: b.orgId }, (tx) => tx`select * from email_outbox limit 1`), /permission denied/);
  await assert.rejects(withTenant({ userId: b.user.id, orgId: b.orgId }, (tx) => tx`select * from stripe_events limit 1`), /permission denied/);
});
