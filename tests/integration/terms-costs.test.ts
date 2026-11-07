/** Skjulte kostnader i vilkårssøket vises under Lønnsomhet med kilde og et tips til kalkylen. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId: string;
before(async () => {
  server = await startServer();
  const n = makeNotice({
    title: 'Renhold av skoler (vilkår-test)',
    description:
      'Minst én lærling skal være tilknyttet oppdraget. Alle kjøretøy skal være utslippsfrie fra oppstart. ' +
      'Leverandøren skal levere månedlig rapport om timeforbruk. Det vil ikke bli ilagt dagbot.',
  });
  await ingest([n]);
  tenderId = await tenderIdFor('manual', n.sourceNoticeId);
});
after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/[  ]|&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('vilkårssøket viser lønns-/arbeidsvilkår, miljøkrav og rapportering med tips til kalkylen', async () => {
  const c = await clientFor(server.base, await createAccount({ plan: 'professional' }));
  const page = text((await c.get(`/app/anbud/${tenderId}/lonnsomhet`)).body);
  assert.match(page, /Lønns- og arbeidsvilkår, lærlinger og seriøsitet \(1\) Til kalkylen: Regn med tarifflønn/);
  assert.match(page, /Miljø- og klimakrav \(f\.eks\. utslippsfrie kjøretøy\) \(1\) Til kalkylen: Utslippsfrie kjøretøy/);
  assert.match(page, /Rapportering og oppfølging \(1\) Til kalkylen: Rapporter, timelister og møter/);
  assert.match(page, /Dagbøter og sanksjoner \(1\) Ser ut til å ikke gjelde/, 'nektelsen merkes fortsatt');
  assert.match(page, /Ikke funnet: .*oppstart, innfasing og virksomhetsoverdragelse/);
});
