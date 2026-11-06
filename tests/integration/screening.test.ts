/**
 * Forhåndsvurdering av treff (uten AI) på anbudssiden, på Oversikt og i søket – og at planer uten matching
 * får vurderingen av frist og kunngjøring, men ingen merkelapper i listene.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let risky: string;
let urgent: string;
const tag = `fv${Date.now().toString(36)}`;

before(async () => {
  server = await startServer();
  const a = makeNotice({
    title: `Vakthold ved kulturhuset ${tag}`,
    description:
      'Vakthold og resepsjon ved kulturhuset. Det er obligatorisk befaring 2. desember kl. 10.00. ' +
      'Ved forsinket oppstart påløper dagbot på 1 promille per dag. Leverandøren må ha tillatelse etter vaktvirksomhetsloven.',
    deadlineAt: new Date(Date.now() + 25 * 86_400_000).toISOString(),
  });
  const b = makeNotice({ title: `Vakthold ved lageret ${tag}`, deadlineAt: new Date(Date.now() + 20 * 3_600_000).toISOString() });
  await ingest([a, b]);
  risky = await tenderIdFor('manual', a.sourceNoticeId);
  urgent = await tenderIdFor('manual', b.sourceNoticeId);
});

after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#x27;/g, '"')
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

test('anbudssiden: forhåndsvurdering med befaring, vilkår og frist – alvorligst først', async () => {
  const c = await clientFor(server.base, await createAccount({ plan: 'professional' }));
  const page = text((await c.get(`/app/anbud/${risky}`)).body);
  assert.match(page, /Forhåndsvurdering Sjekk først/);
  assert.match(page, /Obligatorisk befaring: «Det er obligatorisk befaring 2\. desember kl\. 10\.00\.»/);
  assert.match(page, /Nevnt i kunngjøringen: dagbøter og sanksjoner\./);
  assert.match(page, /2[45] dager til fristen\./);

  const soon = text((await c.get(`/app/anbud/${urgent}`)).body);
  assert.match(soon, /Forhåndsvurdering Passer trolig ikke/);
  assert.match(soon, /Under ett døgn til fristen\./);
});

test('listene: merkelapp og viktigste grunn på Oversikt og i søket (med matching)', async () => {
  const c = await clientFor(server.base, await createAccount({ plan: 'professional' }));
  const search = text((await c.get(`/app/anbud?q=${tag}`)).body);
  assert.match(search, new RegExp(`Vakthold ved kulturhuset ${tag} .*?Sjekk først Obligatorisk befaring`));
  assert.match(search, new RegExp(`Vakthold ved lageret ${tag} .*?Passer trolig ikke Under ett døgn til fristen`));
  const dashboard = text((await c.get('/app')).body);
  assert.match(dashboard, /(Sjekk først|Passer trolig ikke|Verdt å se på)/, 'beste treff på Oversikt har vurdering');
});

test('uten matching (Start): vurdering av frist og kunngjøring på anbudssiden, ingen merkelapper i søket', async () => {
  const c = await clientFor(server.base, await createAccount({ plan: 'starter' }));
  assert.match(text((await c.get(`/app/anbud/${risky}`)).body), /Forhåndsvurdering Sjekk først .*Obligatorisk befaring/);
  const search = text((await c.get(`/app/anbud?q=${tag}`)).body);
  assert.match(search, new RegExp(`Vakthold ved kulturhuset ${tag}`));
  assert.doesNotMatch(search, /Sjekk først|Passer trolig ikke/);
});
