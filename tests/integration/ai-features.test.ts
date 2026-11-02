/**
 * AI-funksjonene gjennom nettsidene (AI_PROVIDER=mock – svarene er simulerte, men hele flyten,
 * planstyringen, kildekontrollen og lagringen er ekte).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId: string;

/** Synlig tekst fra HTML (uten tagger og Reacts <!-- -->-markører). */
function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

before(async () => {
  server = await startServer();
  const notice = makeNotice({
    title: 'Vakthold og resepsjon ved kulturhuset (test)',
    description:
      'Oppdragsgiver skal inngå avtale om stasjonært vakthold og resepsjon. Leverandøren må ha tillatelse etter vaktvirksomhetsloven. Tilbudet skal leveres elektronisk.',
    documentsUrl: 'https://permalink.mercell.com/123456.aspx',
    details: {
      selectionCriteria: ['Leverandøren skal ha en årlig omsetning på minst 10 millioner kroner.', 'Leverandøren skal ha relevant erfaring fra tilsvarende oppdrag (referanser).'],
      awardCriteria: [
        { name: 'Pris', type: 'cost', weight: '40 %' },
        { name: 'Kvalitet', type: 'quality', weight: '60 %' },
      ],
      durationText: '24 måneder',
      questionsDeadlineAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      language: 'nb',
    },
  });
  await ingest([notice]);
  tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
});

after(async () => {
  await server.close();
  await closeDb();
});

test('anbudssiden viser dokumentlenke, krav og kriterier fra kunngjøringen (uten AI)', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const page = await (await clientFor(server.base, acc)).get(`/app/anbud/${tenderId}`);
  assert.equal(page.status, 200);
  const t = text(page.body);
  assert.match(t, /Åpne konkurransedokumentene hos permalink\.mercell\.com/);
  assert.match(t, /Krav og kriterier i kunngjøringen/);
  assert.match(t, /omsetning på minst 10 millioner kroner/);
  assert.match(t, /Kvalitet\s*– 60 %/);
  assert.match(t, /Spørsmålsfrist/);
  assert.match(t, /24 måneder/);
  // Matchforklaringen v2: omsetningskravet sammenlignes med profilen (som mangler omsetning).
  assert.match(t, /Opplysninger som mangler/);
  assert.match(t, /legg inn omsetning i profilen/);
});

test('AI-analyse v2: skiller «står i kilden» fra tolkning og viser hva som ikke er lest', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, acc);
  const res = await c.post(`/app/anbud/${tenderId}/analyse`, {}, { from: `/app/anbud/${tenderId}` });
  assert.equal(res.location, `/app/anbud/${tenderId}/analyse`);
  const page = await c.get(`/app/anbud/${tenderId}/analyse`);
  assert.equal(page.status, 200);
  const t = text(page.body);
  assert.match(t, /Står i kilden/);
  assert.match(t, /AI-tolkning/);
  assert.match(t, /Ikke lest av AI/);
  assert.match(t, /Konkurransegrunnlaget og vedleggene \(hos permalink\.mercell\.com\)/);
  assert.match(t, /Simulert svar fra testmodus/);
});

test('egnethetsvurdering: med i Profesjonell, låst i Start, og bruker AI-kvoten', async () => {
  const pro = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, pro);
  const res = await c.post(`/app/anbud/${tenderId}/egnethet`, {}, { from: `/app/anbud/${tenderId}` });
  assert.equal(res.status, 303);
  const page = await c.get(`/app/anbud/${tenderId}`);
  assert.match(text(page.body), /Kan vi delta\? \(AI-vurdering\)/);
  assert.match(text(page.body), /Opplysninger dere bør legge inn eller avklare/);
  const usage = (await systemSql()`select kind from usage_records where org_id = ${pro.orgId}`) as unknown as { kind: string }[];
  assert.deepEqual(usage.map((u) => u.kind), ['ai_fit_assessment']);
  const stored = (await systemSql()`select org_id from ai_analyses where kind = 'match_explanation' and tender_id = ${tenderId} and org_id = ${pro.orgId}`) as unknown as { orgId: string }[];
  assert.equal(stored.length, 1, 'lagres privat for organisasjonen (inneholder bedriftsdata)');

  const start = await createAccount({ plan: 'starter' });
  const sc = await clientFor(server.base, start);
  const locked = await sc.post(`/app/anbud/${tenderId}/egnethet`, {}, { from: `/app/anbud/${tenderId}` });
  assert.equal(locked.status, 303);
  assert.match(text((await sc.get(locked.location!)).body), /Egnethetsvurdering er med i Profesjonell og Bedrift/);
  const none = await systemSql()`select 1 from ai_analyses where kind = 'match_explanation' and org_id = ${start.orgId}`;
  assert.equal(none.length, 0);
});

test('tilbudsassistent: AI-disposisjon legger til kapitler, og siden sier tydelig at utkast må kontrolleres', async () => {
  const biz = await createAccount({ plan: 'business' });
  const c = await clientFor(server.base, biz);
  const ws = await c.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` });
  const wsPath = ws.location!;
  const before = (await systemSql()`select count(*)::int as n from bid_sections where org_id = ${biz.orgId}`) as unknown as { n: number }[];
  const res = await c.post(`${wsPath}/struktur/ai`, {}, { from: wsPath });
  assert.equal(res.status, 303);
  const afterRows = (await systemSql()`select title from bid_sections where org_id = ${biz.orgId}`) as unknown as { title: string }[];
  assert.ok(afterRows.length > before[0]!.n, 'nye kapitler er lagt til');
  assert.ok(afterRows.some((r) => r.title === 'Pris'));
  const page = await c.get(wsPath);
  assert.match(text(page.body), /kan ikke garantere at tilbudet er komplett/);
});
