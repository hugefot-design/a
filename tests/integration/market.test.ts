/**
 * Markedspris fra tidligere tildelinger i Lønnsomhet: ekte tildelte verdier for samme CPV, per år, med
 * rammeavtaler og annen valuta holdt utenfor – og hvor kalkylens priser og en testpris ligger.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import type { NoticeAward } from '../../src/domain/tenders/normalize';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId: string;
const CPV = '77314000'; // Vedlikehold av grøntanlegg – brukes ikke i andre tester.

before(async () => {
  server = await startServer();
  const award = (supplierName: string, value: number | null, currency = 'NOK'): NoticeAward[] => [
    { lotTitle: null, supplierName, supplierOrgNumber: null, value, currency, awardDate: '2026-05-01' },
  ];
  const awarded = (title: string, months: number, awards: NoticeAward[], isFramework = false) =>
    makeNotice({
      title,
      lifecycle: 'awarded',
      noticeType: 'award',
      cpvCodes: [CPV],
      mainCpv: CPV,
      details: { durationMonths: months, isFramework },
      awards,
    });
  // Per år: 600 000, 700 000, 800 000, 900 000, 1 000 000, 1 200 000.
  await ingest([
    awarded('Grøntanlegg sone 1 (marked-test)', 12, award('Grønn Drift AS', 600_000)),
    awarded('Grøntanlegg sone 2 (marked-test)', 24, award('Park og Hage AS', 1_400_000)),
    awarded('Grøntanlegg sone 3 (marked-test)', 12, award('Grønn Drift AS', 800_000)),
    awarded('Grøntanlegg sone 4 (marked-test)', 36, award('Bydrift AS', 2_700_000)),
    awarded('Grøntanlegg sone 5 (marked-test)', 12, award('Park og Hage AS', 1_000_000)),
    awarded('Grøntanlegg sone 6 (marked-test)', 12, award('Bydrift AS', 1_200_000)),
    awarded('Rammeavtale grøntanlegg (marked-test)', 48, award('Stor Ramme AS', 40_000_000), true),
    awarded('Grøntanlegg i euro (marked-test)', 12, award('Euro Green GmbH', 90_000, 'EUR')),
    awarded('Grøntanlegg uten verdi (marked-test)', 12, award('Ukjent Verdi AS', null)),
  ]);
  const open = makeNotice({ title: 'Skjøtsel av parker 2027 (marked-test)', cpvCodes: [CPV], mainCpv: CPV, estimatedValue: 1_000_000, details: { durationMonths: 12 } });
  await ingest([open]);
  tenderId = await tenderIdFor('manual', open.sourceNoticeId);
});

after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[  ]|&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

/** 1000 timer à 600 kr, 10 % påslag, 5 % risiko, målmargin 15 % og minstemargin 8 % → målpris 815 294 kr. */
const calcForm = {
  contractValue: '1 000 000',
  durationMonths: '12',
  l_id: [''],
  l_category: ['arbeid'],
  l_description: ['Skjøtsel'],
  l_quantity: ['1000'],
  l_unit: ['timer'],
  l_unitCost: ['600'],
  l_period: ['total'],
  overheadPct: '10',
  riskBufferPct: '5',
  targetMarginPct: '15',
  minMarginPct: '8',
  hourlyCost: '',
  bidCostHours: '',
  userRiskLevel: '',
  notes: '',
};

test('markedspris: ekte tildelinger per år, med det som er holdt utenfor – og kalkylens plass i fordelingen', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, acc);
  const path = `/app/anbud/${tenderId}/lonnsomhet`;

  const before = text((await c.get(path)).body);
  assert.match(before, /Markedspris fra tidligere tildelinger/);
  assert.match(before, /CPV-kode som begynner på 77314 \(innen landbruks-, skogbruks-, hagebruks- og akvakulturtjenester\), siste fem år/);
  assert.match(before, /0,6 mill\. .*1,2 mill\./, 'aksen bruker én enhet');
  assert.match(before, /Median per år 850 000 kr/);
  assert.match(before, /Midterste halvdel 725 000 – 975 000 kr per år/);
  assert.match(before, /Tildelinger 6 Få – tolk med forsiktighet/);
  assert.match(before, /Holdt utenfor: 1 rammeavtaler \(verdien er ofte et tak\), 1 i annen valuta/);
  assert.match(before, /Legg inn kostnadene i kalkylen/);
  assert.doesNotMatch(before, /Ukjent Verdi AS/, 'tildelinger uten verdi er ikke med');

  assert.equal((await c.post(path, calcForm, { from: path })).status, 303);
  const after = text((await c.get(path)).body);
  assert.match(after, /Minstepris: 753 261 kr per år – lavere enn 67 % av tildelingene\./);
  assert.match(after, /Målpris: 815 294 kr per år – lavere enn 50 % av tildelingene\./);
  assert.match(after, /Målprisen ligger i den midterste halvdelen av tidligere tildelinger\./);

  // Prissimulering: en testpris plasseres i samme fordeling.
  const sim = text((await c.get(`${path}?pris=1100000`)).body);
  assert.match(sim, /Testpris: 1 100 000 kr per år – lavere enn 17 % av tildelingene\./);
});

test('markedspris: for bred CPV-kode gir ingen sammenligning', async () => {
  const broad = makeNotice({ title: 'Bygg og anlegg generelt (marked-test)', cpvCodes: ['45000000'], mainCpv: '45000000' });
  await ingest([broad]);
  const id = await tenderIdFor('manual', broad.sourceNoticeId);
  const c = await clientFor(server.base, await createAccount({ plan: 'professional' }));
  const page = text((await c.get(`/app/anbud/${id}/lonnsomhet`)).body);
  assert.match(page, /ingen CPV-kode som er spesifikk nok/);
});

test('erfaring fra Resultater: hvor målprisen i tidligere kalkyler lå mot det som vant', async () => {
  const acc = await createAccount({ plan: 'professional' });
  const c = await clientFor(server.base, acc);
  // Et tidligere anbud med kalkyle (målpris 815 294 kr) som ble tapt til 700 000 kr.
  const old = makeNotice({ title: 'Tidligere skjøtsel (marked-test)', cpvCodes: ['77310000'], mainCpv: '77310000', details: { durationMonths: 12 } });
  await ingest([old]);
  const oldId = await tenderIdFor('manual', old.sourceNoticeId);
  const oldPath = `/app/anbud/${oldId}/lonnsomhet`;
  assert.equal((await c.post(oldPath, calcForm, { from: oldPath })).status, 303);
  await c.post(`/app/anbud/${oldId}/bokmerke`, {}, { from: `/app/anbud/${oldId}` });
  const [bm] = (await systemSql()`select id from bookmarks where org_id = ${acc.orgId} and tender_id = ${oldId}`) as unknown as { id: string }[];
  await c.post(`/app/lagret/${bm!.id}`, { status: 'lost', note: '', resultForm: '1', ourPrice: '815 000', winnerName: 'Bydrift AS', winningPrice: '700 000', reason: 'pris' }, { from: `/app/anbud/${oldId}` });

  // Målprisen fra den lagrede kalkylen vises som hjelp i resultatfeltet på anbudssiden.
  assert.match(text((await c.get(`/app/anbud/${oldId}`)).body), /Målpris i kalkylen: 815 294 kr/);
  const results = text((await c.get('/app/resultater')).body);
  assert.match(results, /Kalkylen mot resultatet/);
  assert.match(results, /Kalkylen 815 294 kr · vant 700 000 kr \+16,5 %/);

  const page = text((await c.get(`/app/anbud/${tenderId}/lonnsomhet`)).body);
  assert.match(page, /Erfaring: i 1 tidligere anbud lå målprisen i kalkylen deres i snitt 16,5 % over det som vant\./);
});
