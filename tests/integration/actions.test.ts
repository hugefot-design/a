/** «Til handling» på Oversikt: frister, spørsmålsfrister, befaring, godkjenning, resultat og sterke treff – bare egne data. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const DAY = 86_400_000;
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const ids: Record<string, string> = {};

before(async () => {
  server = await startServer();
  const notices = {
    frist: makeNotice({ title: 'Frist snart (handling-test)', deadlineAt: iso(1.2) }),
    sporsmal: makeNotice({ title: 'Spørsmålsfrist snart (handling-test)', deadlineAt: iso(20), details: { questionsDeadlineAt: iso(3.5) } }),
    befaring: makeNotice({ title: 'Befaring kreves (handling-test)', deadlineAt: iso(15), description: 'Vakthold. Det er obligatorisk befaring 1. desember kl. 09.00.' }),
    godkjenning: makeNotice({ title: 'Til godkjenning (handling-test)', deadlineAt: iso(10) }),
    treff: makeNotice({ title: 'Sterkt treff som ikke er lagret (handling-test)', deadlineAt: iso(25) }),
    resultat: makeNotice({
      title: 'Tildelt etter levering (handling-test)',
      lifecycle: 'awarded',
      noticeType: 'award',
      awards: [{ lotTitle: null, supplierName: 'Konkurrent AS', supplierOrgNumber: null, value: null, currency: 'NOK', awardDate: iso(-5).slice(0, 10) }],
    }),
  };
  await ingest(Object.values(notices));
  for (const [k, n] of Object.entries(notices)) ids[k] = await tenderIdFor('manual', n.sourceNoticeId);
});

after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/[  ]|&nbsp;/g, ' ').replace(/\s+/g, ' ');

test('Oversikt viser en arbeidsliste fra egne data – det som haster først – og ingenting fra andre organisasjoner', async () => {
  const acc = await createAccount({ plan: 'business' });
  const c = await clientFor(server.base, acc);
  for (const k of ['frist', 'sporsmal', 'befaring', 'resultat']) await c.post(`/app/anbud/${ids[k]}/bokmerke`, {}, { from: `/app/anbud/${ids[k]}` });
  await systemSql()`update bookmarks set status = 'submitted', submitted_at = now() - interval '20 days' where org_id = ${acc.orgId} and tender_id = ${ids.resultat!}`;
  const ws = await c.post('/app/tilbud', { tenderId: ids.godkjenning! }, { from: `/app/anbud/${ids.godkjenning}` });
  await systemSql()`update bid_workspaces set status = 'in_review' where id = ${ws.location!.split('/').pop()!}`;

  const page = text((await c.get('/app')).body);
  const section = page.slice(page.indexOf('Til handling'), page.indexOf('Anbefalt for dere'));
  // Kalenderdager i norsk tid: 1,2 døgn er «i morgen» eller «om 2 dager» avhengig av klokkeslett.
  const fristText = /Tilbudsfrist(?:en er i morgen| om 2 dager) Frist snart \(handling-test\)/.exec(page)?.[0] ?? 'mangler tilbudsfrist';
  const spText = /Spørsmålsfrist om [34] dager Spørsmålsfrist snart \(handling-test\)/.exec(page)?.[0] ?? 'mangler spørsmålsfrist';
  const order = [
    fristText,
    spText,
    'Tilbud venter på godkjenning Til godkjenning (handling-test)',
    'Obligatorisk befaring – sjekk dato og meld dere på Befaring kreves (handling-test)',
    'Tildelingen er publisert – registrer resultatet Tildelt etter levering (handling-test)',
  ];
  for (const o of order) assert.ok(section.includes(o), `mangler: ${o}`);
  assert.ok(section.indexOf(order[0]!) < section.indexOf(order[1]!), 'haster (frist i morgen/om 2 dager) før snart');
  assert.match(section, /Nytt sterkt treff \(\d+ av 100\) – vurder å lagre Sterkt treff som ikke er lagret \(handling-test\)/, 'sterke nye treff som ikke er lagret');
  assert.ok(!/Nytt sterkt treff \(\d+ av 100\) – vurder å lagre Frist snart/.test(section), 'lagrede anbud foreslås ikke som nye treff');

  // En annen organisasjon ser ingen av arbeidspunktene (de offentlige anbudene kan dukke opp som egne treff for dem).
  const other = text((await (await clientFor(server.base, await createAccount({ plan: 'business' }))).get('/app')).body);
  const otherSection = other.slice(other.indexOf('Til handling'), other.indexOf('Anbefalt for dere'));
  for (const o of order) assert.ok(!otherSection.includes(o), `lekker: ${o}`);
  assert.doesNotMatch(otherSection, /Tilbudsfrist om|Spørsmålsfrist om|venter på godkjenning|registrer resultatet|Obligatorisk befaring/);
});

test('uten noe som haster: en rolig forklaring i stedet for en tom liste', async () => {
  const c = await clientFor(server.base, await createAccount({ plan: 'starter' }));
  assert.match(text((await c.get('/app')).body), /Til handling .*Ingenting haster akkurat nå/);
});
