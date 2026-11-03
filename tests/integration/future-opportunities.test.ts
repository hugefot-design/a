/**
 * Future Opportunities: henting fra eInnsyn (ekte svar som testgrunnlag), tilgang bare for
 * Enterprise (håndhevet i ruteren), fakta og vurdering vist hver for seg, følging per organisasjon,
 * og varsel når en fulgt planlagt anskaffelse faktisk blir utlyst.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeDb, systemSql } from '../../src/lib/db';
import { ingestEinnsyn } from '../../src/connectors/einnsyn';
import { runNotificationCycle } from '../../src/domain/notifications/engine';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const fixture = readFileSync(join(process.cwd(), 'tests/fixtures/einnsyn/moetesak-konkurranseutsetting.json'), 'utf8');
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fakeEinnsyn = async (url: string) => {
  const u = new URL(url);
  if (u.pathname === '/search') return u.searchParams.get('query') === 'konkurranseutsetting' ? new Response(fixture, { status: 200 }) : json({ items: [] });
  if (u.pathname.startsWith('/enhet/')) return json({ navn: 'Bergen kommune', orgnummer: '964338531', kommunenummer: '4601', parent: null });
  if (u.hostname === 'data.brreg.no') return json({ forretningsadresse: { kommunenummer: '4601' } });
  return new Response('{}', { status: 404 });
};

test('eInnsyn: politiske saker lagres én gang, med fylke og bransje; referater og orienteringer utelates', async () => {
  await systemSql()`delete from opportunity_signals where source = 'einnsyn'`;
  await systemSql()`update opportunity_sources set last_success_at = null where id = 'einnsyn'`;
  const first = await ingestEinnsyn({ fetchImpl: fakeEinnsyn, delayMs: 0 });
  assert.equal(first.stored, 4, `lagret ${first.stored}`);
  const rows = (await systemSql()`select title, region_codes, industry_ids, matched_terms, url from opportunity_signals where source = 'einnsyn' order by title`) as unknown as {
    title: string;
    regionCodes: string[];
    industryIds: string[];
    matchedTerms: string[];
    url: string;
  }[];
  const titles = rows.map((r) => r.title).join(' | ');
  assert.match(titles, /Ferje Hordaland 2030 - mandat for konkurranseutsetting/);
  assert.doesNotMatch(titles, /Orientering|Svar på|Oversendel/);
  const ferje = rows.find((r) => r.title.startsWith('Ferje'))!;
  assert.deepEqual(ferje.regionCodes, ['46']);
  assert.ok(ferje.industryIds.includes('transport'));
  assert.ok(ferje.matchedTerms.includes('konkurranseutsetting'));
  assert.match(ferje.url, /^https:\/\/einnsyn\.no\/moetesak\//);
  // Ny kjøring gir ingen duplikater.
  const second = await ingestEinnsyn({ fetchImpl: fakeEinnsyn, delayMs: 0 });
  assert.equal(second.stored, 0);
  const [src] = (await systemSql()`select last_success_at from opportunity_sources where id = 'einnsyn'`) as unknown as { lastSuccessAt: Date | null }[];
  assert.ok(src?.lastSuccessAt);
});

test('bare Enterprise har tilgang – også ved direkte lenke og skjemainnsending', async () => {
  for (const plan of ['free', 'professional', 'business'] as const) {
    const acc = await createAccount({ plan });
    const c = await clientFor(server.base, acc);
    const page = await c.get('/app/fremtidige');
    assert.equal(page.status, 403, plan);
    assert.match(page.body, /Future Opportunities er ikke med i planen din/);
    const [sig] = (await systemSql()`select id from opportunity_signals limit 1`) as unknown as { id: string }[];
    const post = await c.post('/app/fremtidige/folg', { kind: 'political_case', id: sig!.id, tilbake: '/app' }, { from: '/app' });
    assert.equal(post.status, 403, `${plan} kan ikke følge`);
  }
  const ent = await createAccount({ plan: 'enterprise' });
  assert.equal((await (await clientFor(server.base, ent)).get('/app/fremtidige')).status, 200);
});

test('Enterprise: fakta og vurdering hver for seg, følging per organisasjon og varsel når prosjektet utlyses', async () => {
  const acc = await createAccount({ plan: 'enterprise' });
  const other = await createAccount({ plan: 'enterprise' });
  const c = await clientFor(server.base, acc);
  // En politisk sak i profilens bransje og fylke (testprofilen: vakthold i Trøndelag).
  const [sig] = (await systemSql()`
    insert into opportunity_signals (source, source_ref, country_code, kind, title, publisher, region_codes, industry_ids, matched_terms, published_at, url)
    values ('einnsyn', ${`test:${acc.orgId}`}, 'NO', 'political_case', 'Konkurranseutsetting av vakthold ved rådhuset (test)', 'Testkommune', '{50}', '{security}',
      '{konkurranseutsetting}', now(), 'https://einnsyn.no/moetesak/test')
    returning id
  `) as unknown as { id: string }[];
  const planned = makeNotice({ lifecycle: 'planned', title: `Planlagt vakthold (test ${acc.orgId.slice(0, 6)})`, deadlineAt: null, estimatedValue: null });
  await ingest([planned]);
  const plannedId = await tenderIdFor(planned.source, planned.sourceNoticeId);

  const match = (await c.get('/app/fremtidige')).body.replaceAll('<!-- -->', '');
  assert.match(match, /Konkurranseutsetting av vakthold ved rådhuset/);
  assert.match(match, /Fra kilden/);
  assert.match(match, /Vår vurdering/);
  assert.match(match, /Bransje i profilen: Vakt og sikkerhet|Bransje i profilen/);
  assert.match(match, /Tatt med fordi tittelen nevner: «konkurranseutsetting»/);

  const all = (await c.get('/app/fremtidige?visning=alle')).body.replaceAll('<!-- -->', '');
  assert.ok(all.includes(planned.title), 'planlagt kunngjøring vises under Alle');
  assert.match(all, /kilden oppgir ikke dato/, 'ingen oppdiktet utlysningsdato');
  assert.doesNotMatch(all.slice(all.indexOf(planned.title), all.indexOf(planned.title) + 3000), /Anslått verdi/, 'ingen verdi når kilden ikke har en');

  const follow = await c.post('/app/fremtidige/folg', { kind: 'planned_notice', id: plannedId, tilbake: '/app/fremtidige?visning=folger' }, { from: '/app/fremtidige' });
  assert.equal(follow.status, 303);
  await c.post('/app/fremtidige/folg', { kind: 'political_case', id: sig!.id, tilbake: '/app/fremtidige' }, { from: '/app/fremtidige' });
  const followingPage = (await c.get('/app/fremtidige?visning=folger')).body;
  assert.ok(followingPage.includes(planned.title));
  // En annen organisasjon ser ikke disse følgingene.
  const otherPage = (await (await clientFor(server.base, other)).get('/app/fremtidige?visning=folger')).body;
  assert.ok(!otherPage.includes(planned.title));

  // Samme anskaffelse blir utlyst som konkurranse → varsel «Utlyst».
  await ingest([{ ...planned, lifecycle: 'competition', noticeType: 'competition', deadlineAt: new Date(Date.now() + 20 * 86_400_000).toISOString(), publishedAt: new Date().toISOString() }]);
  await runNotificationCycle();
  const notes = (await systemSql()`select type, title from notifications where org_id = ${acc.orgId} and type = 'opportunity'`) as unknown as { type: string; title: string }[];
  assert.ok(notes.some((n) => n.title === `Utlyst: ${planned.title}`), JSON.stringify(notes));
  const otherNotes = (await systemSql()`select count(*)::int as n from notifications where org_id = ${other.orgId} and title like 'Utlyst:%'`) as unknown as { n: number }[];
  assert.equal(otherNotes[0]?.n, 0, 'bare organisasjoner som følger prosjektet, får varsel');

  // Slutte å følge.
  await c.post('/app/fremtidige/slutt-a-folge', { kind: 'political_case', id: sig!.id, tilbake: '/app/fremtidige' }, { from: '/app/fremtidige' });
  const [cnt] = (await systemSql()`select count(*)::int as n from opportunity_follows where org_id = ${acc.orgId}`) as unknown as { n: number }[];
  assert.equal(cnt?.n, 1);
});
