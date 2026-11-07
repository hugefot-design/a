/** Kapasitet per måned og sesong: vinterkontrakter og vinteroppdrag sjekkes måned for måned på Lønnsomhet. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId: string;
before(async () => {
  server = await startServer();
  const n = makeNotice({ title: 'Brøyting og strøing (sesong-test)', cpvCodes: ['90620000'], mainCpv: '90620000', details: { durationMonths: 12 } });
  await ingest([n]);
  tenderId = await tenderIdFor('manual', n.sourceNoticeId);
});
after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/[  ]|&nbsp;/g, ' ').replace(/\s+/g, ' ');
const WINTER = ['11', '12', '1', '2', '3'];

test('sesong: vinterkontrakt og vinteroppdrag gir sesongtopp selv om året går opp', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, acc);
  // 1 person × 1800 t = 150 t per måned.
  assert.equal((await c.post('/app/kapasitet/bemanning', { role: 'Sjåfør', headcount: '1', hoursPerYearEach: '1800', certifications: '', notes: '' }, { from: '/app/kapasitet' })).status, 303);
  const ct = await c.post(
    '/app/kapasitet/kontrakter',
    { name: 'Brøyting borettslag', client: '', startDate: '2026-01-01', endDate: '', hoursPerMonth: '20', activeMonths: WINTER, notes: '' },
    { from: '/app/kapasitet' },
  );
  assert.equal(ct.status, 303);
  const [row] = (await systemSql()`select active_months::int[] as m from org_contracts where org_id = ${acc.orgId}`) as unknown as { m: number[] }[];
  assert.deepEqual(row?.m, [1, 2, 3, 11, 12]);
  assert.match(text((await c.get('/app/kapasitet')).body), /20 t\/mnd · nov–mar/);

  // Oppdraget: 1000 timer per år, bare om vinteren (200 t per måned).
  const path = `/app/anbud/${tenderId}/lonnsomhet`;
  const saved = await c.post(
    path,
    {
      contractValue: '900 000',
      durationMonths: '12',
      activeMonths: WINTER,
      l_id: [''],
      l_category: ['arbeid'],
      l_description: ['Brøyting'],
      l_quantity: ['1000'],
      l_unit: ['timer'],
      l_unitCost: ['600'],
      l_period: ['per_aar'],
      overheadPct: '10',
      riskBufferPct: '5',
      targetMarginPct: '15',
      minMarginPct: '8',
      hourlyCost: '',
      bidCostHours: '',
      userRiskLevel: '',
      notes: '',
    },
    { from: path },
  );
  assert.equal(saved.status, 303, saved.body.slice(0, 300));
  const html = (await c.get(path)).body;
  const page = text(html);
  // Vinter: 150 t kapasitet − 20 t i andre kontrakter = 130 t ledig, behov 200 t → mangler 70 t.
  assert.match(page, /Sesongtopp: i nov–mar mangler dere opptil 70 timer per måned, selv om året samlet går opp\./);
  assert.match(page, /Måned for måned/);
  assert.match(page, /jan 147 % mangler 70 timer/, 'januar: (20 + 200) / 150 = 147 %');
  assert.match(page, /jul 0 %/);
  assert.match(page, /Brøyting borettslag: 100 t\/år \(100 % overlapp, nov–mar\)/);
  // Avkryssede måneder i kalkyleskjemaet (rekkefølgen på attributtene spiller ingen rolle).
  const checked = (html.match(/<input[^>]*name="activeMonths"[^>]*>/g) ?? []).filter((i) => i.includes('checked')).map((i) => /value="(\d+)"/.exec(i)![1]);
  assert.deepEqual(checked, ['1', '2', '3', '11', '12'], 'sesongen er lagret med kalkylen');
});
