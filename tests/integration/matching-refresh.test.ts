/**
 * Daglig oppdatering av treff (kostnadsgjennomgangen): bare anbud der tiden endrer treffet (frist innen 14 dager eller
 * profilens minimum), og bare endrede rader skrives. Resultatet skal være nøyaktig det samme som en full omregning:
 * passerte frister fjernes, nærmere frister gir ny tekst, og et treff som ikke lenger holder, blir ikke liggende.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { recomputeMatchesForOrg, refreshTimeSensitiveMatches } from '../../src/domain/matching/service';
import { createAccount, ingest, makeNotice, tenderIdFor } from '../helpers';

before(async () => {});
after(async () => {
  await closeDb();
});

const day = 86_400_000;
type Row = { tenderId: string; score: number; excluded: boolean; breakdown: unknown; xmin: string };
const snapshot = async (orgId: string) =>
  (await systemSql()`
    select tender_id, score, excluded, breakdown, xmin::text as xmin from match_results where org_id = ${orgId} order by tender_id
  `) as unknown as Row[];
const content = (rows: Row[]) => rows.map(({ tenderId, score, excluded, breakdown }) => ({ tenderId, score, excluded, breakdown: JSON.stringify(breakdown) }));

test('daglig oppdatering: samme resultat som full omregning, og uendrede treff skrives ikke på nytt', async () => {
  const acc = await createAccount({ profile: { minDaysToDeadline: '10' } });
  const notices = {
    far: makeNotice({ title: 'Vakthold ved rådhuset (treff-oppdatering, langt fram)', deadlineAt: new Date(Date.now() + 40 * day).toISOString() }),
    near: makeNotice({ title: 'Vakthold ved skolen (treff-oppdatering, nær frist)', deadlineAt: new Date(Date.now() + 9 * day).toISOString() }),
    ending: makeNotice({ title: 'Vakthold ved biblioteket (treff-oppdatering, frist passerer)', deadlineAt: new Date(Date.now() + 2 * day).toISOString() }),
  };
  await ingest(Object.values(notices));
  const ids = {
    far: await tenderIdFor('manual', notices.far.sourceNoticeId),
    near: await tenderIdFor('manual', notices.near.sourceNoticeId),
    ending: await tenderIdFor('manual', notices.ending.sourceNoticeId),
  };
  await recomputeMatchesForOrg(acc.orgId);
  const before = await snapshot(acc.orgId);
  const mine = (rows: Row[], id: string) => rows.find((r) => r.tenderId === id);
  assert.ok(mine(before, ids.far) && mine(before, ids.near) && mine(before, ids.ending), 'alle tre gir treff');

  // Tiden går: én frist passerer, én kommer nærmere. Et gammelt treff som ikke lenger holder, er lagt inn for hånd.
  await systemSql()`update tenders set deadline_at = now() - interval '1 hour' where id = ${ids.ending}`;
  await systemSql()`update tenders set deadline_at = now() + interval '5 days' where id = ${ids.near}`;
  const unrelated = makeNotice({ title: 'Asfaltering av riksvei (treff-oppdatering, passer ikke)', description: 'Asfaltarbeid.', cpvCodes: ['45233252'], mainCpv: '45233252', deadlineAt: new Date(Date.now() + 6 * day).toISOString() });
  await ingest([unrelated]);
  const unrelatedId = await tenderIdFor('manual', unrelated.sourceNoticeId);
  await systemSql()`
    insert into match_results (org_id, tender_id, score, breakdown, excluded, profile_version, computed_at)
    values (${acc.orgId}, ${unrelatedId}, 99, '{}'::jsonb, false, 1, now())
    on conflict (org_id, tender_id) do update set score = 99, breakdown = '{}'::jsonb
  `;

  await refreshTimeSensitiveMatches();
  const after1 = await snapshot(acc.orgId);
  assert.equal(mine(after1, ids.ending), undefined, 'passert frist: treffet er fjernet');
  assert.notEqual(mine(after1, unrelatedId)?.score, 99, 'et gammelt treff som ikke holder, blir rettet eller fjernet');
  assert.match(JSON.stringify(mine(after1, ids.near)!.breakdown), /5 dager/, 'nær frist: ny tekst');
  assert.equal(mine(after1, ids.far)!.xmin, mine(before, ids.far)!.xmin, 'frist langt fram: raden er ikke skrevet på nytt');

  // Samme som en full omregning.
  await recomputeMatchesForOrg(acc.orgId);
  assert.deepEqual(content(await snapshot(acc.orgId)), content(after1));

  // En ny oppdatering samme dag skriver ingenting.
  const stable = await snapshot(acc.orgId);
  await refreshTimeSensitiveMatches();
  assert.deepEqual(
    (await snapshot(acc.orgId)).map((r) => r.xmin),
    stable.map((r) => r.xmin),
    'ingen rader skrevet når ingenting er endret',
  );
});
