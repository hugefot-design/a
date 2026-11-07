/**
 * AnbudRadar Intelligence med realistiske data: et norsk skoleanbud (totalentreprise), et privat
 * konkurransegrunnlag på fire sider, tildelinger hos samme oppdragsgiver og egne resultater. Tre organisasjoner:
 *   A (Bedrift)  – har profil, sentral godkjenning, kalkyle og resultater  → «Gå videre»
 *   B (Bedrift)  – mangler sentral godkjenning (lovpålagt)                  → «Ikke gå videre», ser ikke A sine data
 *   C (Gratis)   – planen har ikke treff, kalkyle eller konkurranse         → låste deler, «For lite grunnlag»
 * Sjekker også PDF-en (tekst lest ut med samme PDF-leser som appen bruker) og tilgang uten innlogging.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb, systemSql } from '../../src/lib/db';
import { addMonths } from '../../src/domain/competitors/expiry';
import { extractPdfPages } from '../../src/domain/documents/extract';
import type { NoticeAward } from '../../src/domain/tenders/normalize';
import { Client, clientFor, createAccount, ingest, makeNotice, startServer, type TestAccount } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let tenderId = '';
let a: TestAccount;
let b: TestAccount;
let c: TestAccount;
const DAY = 86_400_000;
const TITLE = 'Rehabilitering av Nordby skole – totalentreprise (intelligence-test)';
const BUYER = { buyerName: 'Fjellvik kommune (intelligence-test)', buyerOrgNumber: '999888777' };
const SCHOOL = { cpvCodes: ['45214200'], mainCpv: '45214200', contractNature: 'works' as const, nutsCodes: ['NO081'] };
const DOC = 'Konkurransegrunnlag Nordby skole.pdf';
const WINNER = 'Byggmester Hansen AS (intelligence-test)';
const day = (months: number) => addMonths(new Date(), months).toISOString().slice(0, 10);
const award = (supplierName: string, value: number, months: number): NoticeAward[] => [{ lotTitle: null, supplierName, supplierOrgNumber: null, value, currency: 'NOK', awardDate: day(months) }];
const text = (html: string) => html.replaceAll('<!-- -->', '');
/** Teksten i anbefalingsoverskriften (h2#anbefaling). */
const verdictOf = (html: string) => /<h2 id="anbefaling"[^>]*>([\s\S]*?)<\/h2>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';

const PROFILE = {
  companyName: 'Nordbygg Entreprenør AS (test)',
  description: 'Totalentreprenør for rehabilitering og nybygg av offentlige bygg på Østlandet.',
  industries: ['construction'],
  services: 'Totalentreprise, rehabilitering av skoler og offentlige bygg',
  keywords: 'rehabilitering, skole, totalentreprise',
  cpvCodes: '45214200, 45210000',
  regions: ['03'],
  certifications: ['sentral_godkjenning', 'iso14001'],
  contractTypes: ['works'],
  annualRevenue: '120 000 000',
  minDaysToDeadline: '10',
};

before(async () => {
  server = await startServer();
  // Tidligere tildelinger hos samme oppdragsgiver (med antall tilbud, som i tildelingskunngjøringene).
  const history = [
    { title: 'Ny barnehage Fjellvik sentrum (intelligence-test)', winner: WINNER, value: 35_000_000, months: -8, received: 4 },
    { title: 'Utvidelse av Fjellvik ungdomsskole (intelligence-test)', winner: WINNER, value: 52_000_000, months: -14, received: 6 },
    { title: 'Rehabilitering av Fjellvik rådhus (intelligence-test)', winner: 'Fjellvik Bygg AS (intelligence-test)', value: 41_000_000, months: -20, received: 3 },
  ];
  await ingest(
    history.map((h) =>
      makeNotice({ ...SCHOOL, ...BUYER, title: h.title, lifecycle: 'awarded', noticeType: 'award', awards: award(h.winner, h.value, h.months), receivedTenders: h.received }),
    ),
  );
  await ingest([
    makeNotice({
      ...SCHOOL,
      ...BUYER,
      title: TITLE,
      estimatedValue: 48_000_000,
      currency: 'NOK',
      deadlineAt: new Date(Date.now() + 20 * DAY).toISOString(),
      documentsUrl: 'https://kgv.example.no/fjellvik/nordby-skole',
      description:
        'Fjellvik kommune skal rehabilitere Nordby skole (4 200 m²) som totalentreprise, med nytt ventilasjonsanlegg, nye vinduer og universell utforming. ' +
        'Tilbud som leveres etter fristen, vil bli avvist. Leverandøren skal ha sentral godkjenning for ansvarsrett i tiltaksklasse 3. ' +
        'Leverandøren må dokumentere ISO 14001 eller tilsvarende miljøledelse. Det er obligatorisk befaring 18. november kl. 10.00 på Nordby skole. ' +
        'Kontrakten er NS 8407. Ved forsinkelse påløper dagbot på 1 promille av kontraktssummen per dag. ' +
        'Leverandøren skal stille bankgaranti på 10 % av kontraktssummen i utførelsesperioden.',
      details: {
        questionsDeadlineAt: new Date(Date.now() + 10 * DAY).toISOString(),
        submissionUrl: 'https://kgv.example.no/fjellvik/lever',
        durationMonths: 14,
        durationText: '14 måneder',
        language: 'nb',
      },
    }),
  ]);
  const sql = systemSql();
  tenderId = ((await sql`select id from tenders where title = ${TITLE}`) as unknown as { id: string }[])[0]!.id;
  const pastIds = (await sql`select id, title from tenders where title like '%(intelligence-test)' and id <> ${tenderId} order by title`) as unknown as { id: string; title: string }[];

  // A: Bedrift med alt på plass. B: mangler sentral godkjenning. C: gratisplan.
  a = await createAccount({ plan: 'business', profile: PROFILE, orgName: 'Intelligence A (test)' });
  b = await createAccount({ plan: 'business', profile: { ...PROFILE, certifications: ['iso14001'] }, orgName: 'Intelligence B (test)' });
  c = await createAccount({ plan: 'free', profile: PROFILE, orgName: 'Intelligence C (test)' });

  // A sitt private konkurransegrunnlag (som etter opplasting og tekstlesing).
  const [doc] = (await sql`
    insert into tender_documents (tender_id, org_id, title, text_status, page_count, uploaded_by)
    values (${tenderId}, ${a.orgId}, ${DOC}, 'extracted', 4, ${a.user.id}) returning id
  `) as unknown as { id: string }[];
  const pages = [
    'Konkurransegrunnlag. Oppdragsgiver er Fjellvik kommune. Konkurransen gjennomføres som åpen anbudskonkurranse. Frist for spørsmål er ti dager før tilbudsfristen.',
    'Kvalifikasjonskrav. Leverandøren skal ha en omsetning på minimum 60 000 000 kroner det siste regnskapsåret. Leverandøren skal ha sentral godkjenning i tiltaksklasse 3 for utførende foretak. Skatteattest og firmaattest skal legges ved.',
    'Tildelingskriterier: pris vektes 60 % og kvalitet 40 %. Tilbud som ikke oppfyller minstekravene i kravspesifikasjonen, vil bli avvist.',
    'Kontraktsbestemmelser. NS 8407 gjelder. Dagmulkt er 1 promille av kontraktssummen per kalenderdag. Leverandøren skal stille sikkerhet i form av bankgaranti på 10 % av kontraktssummen.',
  ];
  for (const [i, content] of pages.entries()) {
    await sql`insert into tender_document_pages (document_id, org_id, page_number, content) values (${doc!.id}, ${a.orgId}, ${i + 1}, ${content})`;
  }

  // A sin kalkyle (lagres som i Lønnsomhet): 36 mill. i direkte kostnader, 48 mill. i kontraktsverdi.
  const ca = await clientFor(server.base, a);
  const saved = await ca.post(
    `/app/anbud/${tenderId}/lonnsomhet`,
    {
      contractValue: '48 000 000',
      durationMonths: '14',
      l_id: ['', '', ''],
      l_category: ['arbeid', 'materialer', 'underleverandor'],
      l_description: ['Håndverkere og prosjektledelse', 'Vinduer, ventilasjon og byggevarer', 'Elektro (underentreprenør)'],
      l_quantity: ['40000', '1', '1'],
      l_unit: ['timer', 'stk', 'stk'],
      l_unitCost: ['600', '9 000 000', '3 000 000'],
      l_period: ['total', 'total', 'total'],
      overheadPct: '8',
      riskBufferPct: '5',
      targetMarginPct: '10',
      minMarginPct: '5',
      hourlyCost: '',
      bidCostHours: '',
      userRiskLevel: '',
      notes: '',
    },
    { from: `/app/anbud/${tenderId}/lonnsomhet` },
  );
  assert.equal(saved.status, 303, 'kalkylen er lagret');

  // A sine resultater hos oppdragsgiveren: 2 vunnet, 1 tapt på pris mot Byggmester Hansen.
  const outcomes = [
    { status: 'won', ourPrice: 35_000_000, winningPrice: null, winner: null, reason: 'kvalitet' },
    { status: 'won', ourPrice: 41_000_000, winningPrice: null, winner: null, reason: 'pris' },
    { status: 'lost', ourPrice: 56_000_000, winningPrice: 52_000_000, winner: WINNER, reason: 'pris' },
  ];
  for (const [i, o] of outcomes.entries()) {
    await sql`
      insert into bookmarks (org_id, tender_id, created_by, status, our_price, winning_price, winner_name, outcome_reason, outcome_source, submitted_at, decided_at)
      values (${a.orgId}, ${pastIds[i]!.id}, ${a.user.id}, ${o.status}, ${o.ourPrice}, ${o.winningPrice}, ${o.winner}, ${o.reason}, 'bruker', now() - interval '60 days', now() - interval '30 days')
    `;
  }
});

after(async () => {
  await server.close();
  await closeDb();
});

const page = async (acc: TestAccount) => (await clientFor(server.base, acc)).get(`/app/anbud/${tenderId}/intelligence`);

/** PDF-en som bytes (testklienten leser svaret som tekst, så her brukes fetch med samme økt). */
async function pdfFor(acc: TestAccount) {
  const cl = await clientFor(server.base, acc);
  const cookie = [...cl.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${server.base}/app/anbud/${tenderId}/intelligence/pdf`, { headers: { cookie } });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

test('A: «Gå videre» med kilder, risikoscore, kalkyle, konkurranse, læring og handlingsplan', async () => {
  const res = await page(a);
  assert.equal(res.status, 200);
  const html = text(res.body);
  // Selve anbefalingen (overskriften) – ordene står også i metodeteksten nederst.
  assert.equal(verdictOf(html), 'Gå videre');
  assert.match(html, /Anbefaling · Go\/No-Go/);
  // Fakta med kilde og side fra det private dokumentet.
  assert.match(html, new RegExp(`${DOC.replace('.', '\\.')}, side [1-4]`));
  assert.match(html, /Risikoscore/);
  assert.match(html, /Kostbare kontraktsvilkår/);
  assert.match(html, /Obligatorisk befaring/);
  assert.doesNotMatch(html, /Bare kunngjøringen er lest/, 'dokumentet er lest');
  // Lønnsomhet fra kalkylen deres.
  assert.match(html, /Selvkost/);
  assert.match(html, /% margin/);
  // Konkurranse fra publiserte tildelinger – og hvem som har slått dere (fra resultatene).
  assert.match(html, /Byggmester Hansen AS \(intelligence-test\)/);
  assert.match(html, /Har slått dere 1×/);
  assert.match(html, /fikk median \d+ tilbud/);
  // Læring: tre avgjorte hos oppdragsgiveren.
  assert.match(html, /Hos denne oppdragsgiveren: 2 av 3 avgjorte tilbud vunnet/);
  // Handlingsplan med frister fra kunngjøringen og foreslått intern godkjenning.
  assert.match(html, /Send spørsmål om det som er uklart/);
  assert.match(html, /Intern godkjenning av tilbudet/);
  assert.match(html, /href="https:\/\/kgv\.example\.no\/fjellvik\/lever"/);
  // Merking og ingen sannsynlighet.
  assert.match(html, />Fakta</);
  assert.match(html, />Beregning</);
  assert.doesNotMatch(html, /sannsynlighet for å vinne:|vinnersjanse/i);
});

test('A: PDF med samme vurdering, kilder og sidetall', async () => {
  const { res, buf } = await pdfFor(a);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="intelligence-rehabilitering-av-nordby-skole/);
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  const { pages, totalPages } = await extractPdfPages(buf);
  const all = pages.map((p) => p.text).join('\n');
  assert.ok(totalPages >= 2, `${totalPages} sider`);
  assert.match(all, /Rehabilitering av Nordby skole/);
  assert.match(all, /ANBEFALING \(GO\/NO-GO\)\s+Gå videre/);
  assert.match(all, /Risikoscore: \d+ av 100/);
  assert.match(all, new RegExp(`Kilde: ${DOC.replace('.', '\\.')}, side`));
  assert.match(all, /Side 1 av \d+/);
  assert.match(all, /FAKTA/);
  assert.match(all, /BEREGNING/);
  assert.match(all, /anslår ikke sannsynligheten for å vinne/);
});

test('B: lovpålagt godkjenning mangler → «Ikke gå videre» – og B ser ingenting av A sine data', async () => {
  const html = text((await page(b)).body);
  assert.equal(verdictOf(html), 'Ikke gå videre');
  assert.match(html, /Lovpålagt godkjenning mangler/);
  assert.match(html, /Sentral godkjenning \(byggesak\)/);
  assert.match(html, /Velg bort anbudet/);
  // A sitt dokument, kalkyle og resultater er private.
  assert.doesNotMatch(html, new RegExp(DOC.replace('.', '\\.')));
  assert.match(html, /Bare kunngjøringen er lest/);
  assert.match(html, /Kostnadene er ikke lagt inn/);
  assert.doesNotMatch(html, /Har slått dere/);
  const all = (await extractPdfPages((await pdfFor(b)).buf)).pages.map((p) => p.text).join('\n');
  assert.match(all, /ANBEFALING \(GO\/NO-GO\)\s+Ikke gå videre/);
  assert.doesNotMatch(all, new RegExp(DOC.replace('.', '\\.')));
});

test('C (gratis): låste deler sier hvilken plan som trengs, og vurderingen er «For lite grunnlag»', async () => {
  const res = await page(c);
  assert.equal(res.status, 200);
  const html = text(res.body);
  assert.equal(verdictOf(html), 'For lite grunnlag');
  assert.match(html, /Treff mot bedriftsprofilen er med i Profesjonell/);
  assert.match(html, /Lønnsomhetskalkulatoren er med i Profesjonell/);
  assert.match(html, /Konkurranseinnsikt er med i Bedrift/);
  // Kravene fra kunngjøringen er med i alle planer.
  assert.match(html, /Obligatorisk befaring/);
});

test('tilgang: uten innlogging sendes man til innlogging; ukjent anbud gir 404', async () => {
  const anon = await new Client(server.base).get(`/app/anbud/${tenderId}/intelligence`);
  assert.ok([302, 303].includes(anon.status), String(anon.status));
  assert.match(anon.location ?? '', /logg-inn/);
  const pdf = await new Client(server.base).get(`/app/anbud/${tenderId}/intelligence/pdf`);
  assert.ok([302, 303].includes(pdf.status), String(pdf.status));
  const cl = await clientFor(server.base, a);
  assert.equal((await cl.get('/app/anbud/00000000-0000-4000-8000-000000000000/intelligence')).status, 404);
});

test('anbudssiden lenker til den samlede vurderingen', async () => {
  const html = (await (await clientFor(server.base, a)).get(`/app/anbud/${tenderId}`)).body;
  assert.match(html, new RegExp(`href="/app/anbud/${tenderId}/intelligence"`));
});
