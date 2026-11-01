import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeDb, systemSql, withTenant } from '../../src/lib/db';
import { createSavedSearch } from '../../src/domain/search/saved';
import { EMPTY_QUERY } from '../../src/domain/search/filters';
import { loadOrgContext } from '../../src/domain/org/org';
import { toggleBookmark } from '../../src/domain/tenders/bookmarks';
import { dispatchNotificationEmails, runNotificationCycle } from '../../src/domain/notifications/engine';
import { searchTenders } from '../../src/domain/tenders/queries';
import { createAccount, ingest, makeNotice, tenderIdFor, type TestAccount } from '../helpers';

after(async () => {
  await closeDb();
});

async function notificationsFor(acc: TestAccount, tenderId: string) {
  return (await systemSql()`
    select type, dedupe_key, body from notifications where user_id = ${acc.user.id} and tender_id = ${tenderId} order by created_at
  `) as unknown as { type: string; dedupeKey: string; body: string | null }[];
}

async function bookmark(acc: TestAccount, tenderId: string) {
  const org = (await loadOrgContext(acc.user))!;
  const r = await withTenant({ userId: acc.user.id, orgId: acc.orgId }, (tx) => toggleBookmark(tx, org, acc.user.id, tenderId));
  assert.ok(r.ok && r.bookmarked);
}

test('import: ny, uendret og oppdatert kunngjøring, uten duplikater', async () => {
  const n = makeNotice();
  const first = await ingest([n]);
  assert.equal(first.created, 1);
  const again = await ingest([n]);
  assert.equal(again.unchanged, 1);
  assert.equal(again.created, 0);

  const tenderId = await tenderIdFor('manual', n.sourceNoticeId);
  const newDeadline = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const updated = await ingest([{ ...n, deadlineAt: newDeadline, publishedAt: new Date().toISOString(), noticeType: 'corrigendum' }]);
  assert.equal(updated.updated, 1);
  const updates = (await systemSql()`select change_type from tender_updates where tender_id = ${tenderId}`) as unknown as { changeType: string }[];
  assert.ok(updates.some((u) => u.changeType === 'deadline_changed'));
});

test('import: samme anskaffelse fra en annen kilde kobles til samme anbud', async () => {
  const token = randomUUID().slice(0, 8);
  const manual = makeNotice({ title: `Renhold av rådhus og bibliotek ${token} (test)`, buyerName: `Duplikatkommune ${token}` });
  await ingest([manual]);
  const fromTed = makeNotice({ ...manual, source: 'ted', sourceNoticeId: `${Math.floor(Math.random() * 1e6)}-2026`, sourceUrl: 'https://ted.europa.eu/en/notice/-/detail/test' });
  const stats = await ingest([fromTed]);
  assert.equal(stats.duplicates, 1);
  const tenderId = await tenderIdFor('manual', manual.sourceNoticeId);
  assert.equal(await tenderIdFor('ted', fromTed.sourceNoticeId), tenderId);
  const sources = await systemSql()`select source from tender_sources where tender_id = ${tenderId}`;
  assert.equal(sources.length, 2);
});

test('import: ugyldige kunngjøringer avvises og logges', async () => {
  const stats = await ingest([makeNotice({ title: '' }), makeNotice({ cpvCodes: ['ikke-cpv'] as unknown as string[] })]);
  assert.equal(stats.errors, 2);
  assert.equal(stats.created, 0);
});

test('varsler: lagret søk, nye treff, endringer, avlysning og frister – uten duplikater', async () => {
  const acc = await createAccount({ plan: 'business' });
  const org = (await loadOrgContext(acc.user))!;
  const token = `radar${randomUUID().slice(0, 6)}`;
  const saved = await withTenant({ userId: acc.user.id, orgId: acc.orgId }, (tx) =>
    createSavedSearch(tx, org, acc.user.id, { name: 'Testsøk', filters: { ...EMPTY_QUERY, q: token }, nlQuery: null, alertEnabled: true, alertFrequency: 'instant' }),
  );
  assert.ok(saved.ok);
  // Søket ble lagret før kunngjøringen kom inn
  await systemSql()`update saved_searches set created_at = now() - interval '1 minute' where org_id = ${acc.orgId}`;

  const n = makeNotice({ title: `Vakthold ${token} ved testbygget (test)` });
  await ingest([n]);
  const tenderId = await tenderIdFor('manual', n.sourceNoticeId);
  await runNotificationCycle();
  let list = await notificationsFor(acc, tenderId);
  assert.ok(list.some((x) => x.type === 'saved_search'), 'varsel for lagret søk');
  assert.ok(list.some((x) => x.type === 'new_match'), 'varsel for nytt treff');
  const count = list.length;
  await runNotificationCycle();
  assert.equal((await notificationsFor(acc, tenderId)).length, count, 'ingen duplikater');

  // Lagret anbud blir avlyst
  await bookmark(acc, tenderId);
  await ingest([{ ...n, lifecycle: 'cancelled', noticeType: 'cancellation', publishedAt: new Date().toISOString() }]);
  await runNotificationCycle();
  list = await notificationsFor(acc, tenderId);
  assert.ok(list.some((x) => x.type === 'cancellation'));
  const t = (await systemSql()`select tender_status(lifecycle, deadline_at, published_at) as status from tenders where id = ${tenderId}`) as unknown as { status: string }[];
  assert.equal(t[0]!.status, 'cancelled');
  // Status kan ikke gå «baklengs» om en eldre kunngjøring importeres på nytt
  await ingest([n]);
  const t2 = (await systemSql()`select tender_status(lifecycle, deadline_at, published_at) as status from tenders where id = ${tenderId}`) as unknown as { status: string }[];
  assert.equal(t2[0]!.status, 'cancelled');

  // Fristpåminnelse for lagret anbud
  const soon = makeNotice({ deadlineAt: new Date(Date.now() + 2.5 * 86_400_000).toISOString() });
  await ingest([soon]);
  const soonId = await tenderIdFor('manual', soon.sourceNoticeId);
  await bookmark(acc, soonId);
  await runNotificationCycle();
  const reminders = (await notificationsFor(acc, soonId)).filter((x) => x.type === 'deadline');
  assert.equal(reminders.length, 1);
  assert.match(reminders[0]!.dedupeKey, /:3d$/);

  // E-post: varsler samles i e-poster etter valgt frekvens, og hvert varsel sendes bare én gang
  await systemSql()`update notification_preferences set email_frequency = 'instant' where user_id = ${acc.user.id}`;
  await dispatchNotificationEmails();
  const unsent = await systemSql()`
    select 1 from notifications where user_id = ${acc.user.id} and emailed_at is null and not email_skipped and type <> 'weekly_summary'
  `;
  assert.equal(unsent.length, 0, 'alle varsler er sendt på e-post');
  const digests = async () => (await systemSql()`select 1 from email_outbox where to_email = ${acc.email} and kind = 'notification_digest'`).length;
  const sent = await digests();
  assert.ok(sent >= 1);
  await dispatchNotificationEmails();
  assert.equal(await digests(), sent, 'ingen nye e-poster uten nye varsler');
});

test('varsler: gratisplan får ingen varsler', async () => {
  const acc = await createAccount({ plan: 'free' });
  const n = makeNotice();
  await ingest([n]);
  const tenderId = await tenderIdFor('manual', n.sourceNoticeId);
  await runNotificationCycle();
  assert.equal((await notificationsFor(acc, tenderId)).length, 0);
});

test('søk: fritekst, filtre og standardstatus', async () => {
  const acc = await createAccount();
  const token = `sok${randomUUID().slice(0, 6)}`;
  await ingest([
    makeNotice({ title: `Snøbrøyting ${token} i Bodø`, cpvCodes: ['90620000'], nutsCodes: ['NO071'], estimatedValue: 800_000 }),
    makeNotice({ title: `Snøbrøyting ${token} i Trondheim`, cpvCodes: ['90620000'], nutsCodes: ['NO060'], estimatedValue: 3_000_000 }),
    makeNotice({ title: `Snøbrøyting ${token} avsluttet`, cpvCodes: ['90620000'], deadlineAt: new Date(Date.now() - 86_400_000).toISOString() }),
  ]);
  const run = (q: Partial<typeof EMPTY_QUERY>) =>
    withTenant({ userId: acc.user.id, orgId: acc.orgId }, (tx) => searchTenders(tx, { ...EMPTY_QUERY, q: token, ...q }, { orgId: acc.orgId, matching: false }));
  assert.equal((await run({})).total, 2, 'utløpte vises ikke som standard');
  assert.equal((await run({ statuses: ['closed'] })).total, 1);
  assert.equal((await run({ regions: ['50'] })).total, 1);
  assert.equal((await run({ valueMin: 1_000_000 })).total, 1);
  assert.equal((await run({ excludeKeywords: ['Bodø'] })).total, 1);
});
