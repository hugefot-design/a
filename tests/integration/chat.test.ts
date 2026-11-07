/**
 * «Spør om anbudet» (AI i testmodus): svar med kontrollerte kildehenvisninger, samme spørsmål er gratis
 * (hurtigbuffer), og spørsmål og svar er private for organisasjonen.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId: string;
before(async () => {
  server = await startServer();
  const n = makeNotice({ title: 'Vakthold ved kulturhuset (chat-test)', description: 'Vakthold og resepsjon. Det er obligatorisk befaring 2. desember kl. 10.00.' });
  await ingest([n]);
  tenderId = await tenderIdFor('manual', n.sourceNoticeId);
});
after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) =>
  html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/[  ]|&nbsp;/g, ' ').replace(/\s+/g, ' ');

async function paidQuestions(orgId: string): Promise<number> {
  const [r] = (await systemSql()`select count(*)::int as n from usage_records where org_id = ${orgId} and kind = 'ai_tender_chat' and not cached`) as unknown as { n: number }[];
  return r?.n ?? 0;
}

test('svaret viser hva som står i kilden (med sitat) og hva som er vurdering – og samme spørsmål koster ikke på nytt', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, acc);
  const page = `/app/anbud/${tenderId}`;
  assert.match(text((await c.get(page)).body), /Spør om anbudet/);

  const r = await c.post(`${page}/sporsmal`, { question: 'Kreves det befaring?' }, { from: page });
  assert.equal(r.status, 303);
  assert.equal(r.location, `${page}#sporsmal`);
  const html = text((await c.get(page)).body);
  assert.match(html, /Svaret er klart\./);
  assert.match(html, /Kreves det befaring\?/);
  assert.match(html, /Står i kilden Det er obligatorisk befaring 2\. desember kl\. 10\.00\. Kunngjøringen – «Det er obligatorisk befaring 2\. desember kl\. 10\.00\.»/);
  assert.match(html, /Vurdering Les hele avsnittet i kilden/);
  assert.match(html, /Testmodus: svarene er simulerte/);
  assert.equal(await paidQuestions(acc.orgId), 1);

  await c.post(`${page}/sporsmal`, { question: '  kreves det   befaring? ' }, { from: page });
  assert.match(text((await c.get(page)).body), /Viser lagret svar \(ingen ny kostnad\)\./);
  assert.equal(await paidQuestions(acc.orgId), 1, 'samme spørsmål (uansett mellomrom og store bokstaver) teller ikke');

  await c.post(`${page}/sporsmal`, { question: 'Hvilken farge har logoen?' }, { from: page });
  assert.match(text((await c.get(page)).body), /Hvilken farge har logoen\? .*Står ikke i kildene/);
});

test('spørsmål og svar er private: en annen organisasjon ser dem ikke', async () => {
  const a = await createAccount({ plan: 'professional' });
  const ca = await clientFor(server.base, a);
  const page = `/app/anbud/${tenderId}`;
  await ca.post(`${page}/sporsmal`, { question: 'Hemmelig spørsmål om befaring' }, { from: page });
  const b = await clientFor(server.base, await createAccount({ plan: 'professional' }));
  assert.doesNotMatch(text((await b.get(page)).body), /Hemmelig spørsmål om befaring/);
  const [row] = (await systemSql()`select org_id from ai_analyses where kind = 'tender_chat' and result->>'question' = 'Hemmelig spørsmål om befaring'`) as unknown as { orgId: string }[];
  assert.equal(row?.orgId, a.orgId, 'lagret med organisasjonen, ikke delt');
});

test('tomt eller for kort spørsmål avvises uten AI-kall', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, acc);
  const page = `/app/anbud/${tenderId}`;
  const r = await c.post(`${page}/sporsmal`, { question: ' ? ' }, { from: page });
  assert.match(text((await c.get(r.location!)).body), /Skriv et spørsmål\./);
  assert.equal(await paidQuestions(acc.orgId), 0);
});
