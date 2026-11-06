/**
 * Krav- og avvisningssjekk (uten AI): vises på anbudssiden med kilde og side, leser opplastede dokumenter,
 * og kan legges i sjekklisten i tilbudsarbeidet – uten duplikater og bare i egen organisasjon.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const pageText = async (c: Awaited<ReturnType<typeof clientFor>>, path: string) => (await c.get(path)).body.replaceAll('<!-- -->', '');

async function tenderWithRequirements() {
  const notice = makeNotice({
    description:
      'Rammeavtale om vakthold ved kommunale bygg.\nTilbud som leveres etter fristen, vil bli avvist.\nDet er obligatorisk befaring 3. desember kl. 10.00 ved rådhuset.',
    details: {
      selectionCriteria: ['Leverandøren skal ha en årlig omsetning på minst 8 millioner kroner'],
      awardCriteria: [
        { type: 'price', name: 'Pris', weight: '60 %' },
        { type: 'quality', name: 'Kvalitet på bemanningsplan', weight: '40 %' },
      ],
    },
  });
  await ingest([notice]);
  return tenderIdFor('manual', notice.sourceNoticeId);
}

async function checklist(workspaceId: string) {
  return (await systemSql()`
    select label, category, source, source_ref from bid_checklist_items where workspace_id = ${workspaceId} and source = 'krav' order by sort_order
  `) as unknown as { label: string; category: string; source: string; sourceRef: string | null }[];
}

test('anbudssiden viser krav fra kunngjøringen med kilde – og sier fra når bare kunngjøringen er sjekket', async () => {
  const tenderId = await tenderWithRequirements();
  const c = await clientFor(server.base, await createAccount({ plan: 'starter' })); // Start: ingen dokumentopplasting
  const html = await pageText(c, `/app/anbud/${tenderId}`);
  assert.match(html, /Krav og avvisningsrisiko/);
  assert.match(html, /Avvisningsgrunner/);
  assert.match(html, /Tilbud som leveres etter fristen, <mark[^>]*>vil bli avvist<\/mark>\./, 'setningen vises med treffordet uthevet');
  assert.match(html, /Det er obligatorisk <mark[^>]*>befaring<\/mark> 3\. desember kl\. 10\.00 ved rådhuset\./);
  assert.match(html, /Leverandøren skal ha en årlig omsetning på minst 8 millioner kroner/, 'kvalifikasjonskrav fra eget felt');
  assert.match(html, /Pris – vekt 60 %/, 'tildelingskriterium med vekt');
  assert.match(html, /Kunngjøringen \(eget felt\)/);
  assert.match(html, /Bare kunngjøringen er sjekket\. Sjekk av konkurransegrunnlaget \(opplasting\) er med i Profesjonell og Bedrift\./);
  assert.match(html, /Ordsøk finner ord, ikke betydning/);
  assert.doesNotMatch(html, /Legg i sjekklisten/, 'ingen sjekkliste uten tilbudsarbeid');
});

test('opplastet konkurransegrunnlag leses: treff vises med dokument og side', async () => {
  const tenderId = await tenderWithRequirements();
  const c = await clientFor(server.base, await createAccount()); // Profesjonell (prøveperiode): opplasting
  const form = new FormData();
  form.append('file', new File([readFileSync(new URL('../fixtures/konkurransegrunnlag-eksempel.pdf', import.meta.url))], 'grunnlag.pdf', { type: 'application/pdf' }));
  assert.equal((await c.postMultipart(`/app/anbud/${tenderId}/dokumenter`, form, `/app/anbud/${tenderId}`)).status, 303);
  const html = await pageText(c, `/app/anbud/${tenderId}`);
  assert.match(html, /Sjekket kunngjøringen og 1 dokument \(3 sider\)\./);
  // Eksempel-PDF-en er skrevet uten æøå («Leverandoren», «okonomisk»).
  assert.match(html, /Leverandoren skal ha et kvalitetssystem sertifisert etter <mark[^>]*>ISO 9001<\/mark>\./);
  assert.match(html, /grunnlag\.pdf, s\. 2/);
  assert.match(html, /Pris <mark[^>]*>vektes 40 %<\/mark>\./);
  assert.match(html, /grunnlag\.pdf, s\. 3/);
});

test('kravene legges i sjekklisten én gang, med kategori og kilde – og bare i eget tilbudsarbeid', async () => {
  const tenderId = await tenderWithRequirements();
  const owner = await createAccount({ plan: 'business' });
  const c = await clientFor(server.base, owner);
  const ws = await c.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` });
  const workspaceId = ws.location!.split('/').pop()!;
  assert.match(await pageText(c, `/app/anbud/${tenderId}`), /Legg i sjekklisten/);
  assert.match(await pageText(c, `/app/tilbud/${workspaceId}`), /Hent krav fra dokumentene/, 'knappen finnes også når AI er av');

  const first = await c.post(`/app/tilbud/${workspaceId}/sjekkliste/krav`, {}, { from: `/app/tilbud/${workspaceId}` });
  assert.equal(first.status, 303);
  assert.match(await pageText(c, first.location!), /3 krav er lagt i sjekklisten\./);
  const items = await checklist(workspaceId);
  assert.deepEqual(
    items.map((i) => [i.category, i.label, i.sourceRef]),
    [
      ['avvisning', 'Tilbud som leveres etter fristen, vil bli avvist.', 'Kunngjøringen'],
      ['befaring', 'Det er obligatorisk befaring 3. desember kl. 10.00 ved rådhuset.', 'Kunngjøringen'],
      ['kvalifikasjon', 'Leverandøren skal ha en årlig omsetning på minst 8 millioner kroner', 'Kunngjøringen (eget felt)'],
    ],
    'tildelingskriterier er ikke oppgaver og legges ikke inn',
  );
  const page = await pageText(c, `/app/tilbud/${workspaceId}`);
  assert.match(page, /Avvisningsgrunn/);
  assert.match(page, /Frist \/ befaring/);
  const md = await c.get(`/app/tilbud/${workspaceId}/eksport?format=md`);
  assert.match(md.body, /- \[ \] Tilbud som leveres etter fristen, vil bli avvist\. \(kilde: Kunngjøringen\)/, 'kilden følger med i eksporten');

  const again = await c.post(`/app/tilbud/${workspaceId}/sjekkliste/krav`, {}, { from: `/app/tilbud/${workspaceId}` });
  assert.match(await pageText(c, again.location!), /Ingen nye krav – alle står i sjekklisten fra før\./);
  assert.equal((await checklist(workspaceId)).length, 3, 'ingen duplikater');

  // En annen organisasjon kan ikke legge krav inn i dette tilbudsarbeidet.
  const other = await clientFor(server.base, await createAccount({ plan: 'business' }));
  const foreign = await other.post(`/app/tilbud/${workspaceId}/sjekkliste/krav`, {}, { from: '/app/tilbud' });
  assert.equal(foreign.status, 404);
  assert.equal((await checklist(workspaceId)).length, 3);

  // Innsendt tilbud er låst.
  await systemSql()`update bid_workspaces set status = 'submitted' where id = ${workspaceId}`;
  await systemSql()`delete from bid_checklist_items where workspace_id = ${workspaceId} and source = 'krav'`;
  const locked = await c.post(`/app/tilbud/${workspaceId}/sjekkliste/krav`, {}, { from: `/app/tilbud/${workspaceId}` });
  assert.match(await pageText(c, locked.location!), /Tilbudet er låst\./);
  assert.equal((await checklist(workspaceId)).length, 0);
  assert.doesNotMatch(await pageText(c, `/app/anbud/${tenderId}`), /Legg i sjekklisten/, 'ingen knapp for låst tilbud');
});

test('kravene i sjekklisten krever Bedrift-planen (tilbudsarbeid)', async () => {
  const tenderId = await tenderWithRequirements();
  const owner = await createAccount({ plan: 'business' });
  const c = await clientFor(server.base, owner);
  const ws = await c.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` });
  const workspaceId = ws.location!.split('/').pop()!;
  await systemSql()`update subscriptions set plan = 'professional' where org_id = ${owner.orgId}`;
  const r = await c.post(`/app/tilbud/${workspaceId}/sjekkliste/krav`, {}, { from: `/app/tilbud/${workspaceId}` });
  assert.notEqual(r.status, 303, 'stoppes av planen');
  assert.equal((await checklist(workspaceId)).length, 0);
});
