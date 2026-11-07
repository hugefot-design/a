/**
 * Kundereisen på forsiden viser ekte, offentlige data – ikke oppdiktede eksempler: kravene står ordrett i
 * kunngjøringen, markedsprisen er regnet ut fra lagrede tildelinger, utløpet fra kontraktsdatoene, og
 * leverandørnavn vises aldri. Simulert AI markedsføres ikke som ekte.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { addMonths } from '../../src/domain/competitors/expiry';
import { resetShowcaseCache, siteShowcase } from '../../src/domain/tenders/showcase';
import type { NoticeAward } from '../../src/domain/tenders/normalize';
import { ingest, makeNotice, startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const day = (offsetMonths: number) => addMonths(new Date(), offsetMonths).toISOString().slice(0, 10);
const SUPPLIER = 'Hemmelig Entreprenør AS (test)';
const award = (value: number, awardDate: string): NoticeAward[] => [{ lotTitle: null, supplierName: SUPPLIER, supplierOrgNumber: null, value, currency: 'NOK', awardDate }];
const COMP = 'Rehabilitering av Byskolen, utvendig fasade (visningstest)';
const EXPIRING = 'Drift og vedlikehold av kommunale bygg (visningstest)';
// Nyere og like godt eksempel, men i en bransje uten tildelinger: ingen markedspris og ingen kontrakter som utløper.
const HEALTH = 'Bedriftshelsetjeneste for kommunens ansatte (visningstest)';
// Nyest, men bare standardtekst og henvisninger: ordsøket treffer, men det er ikke gode eksempler.
const BOILERPLATE = 'Rammeavtale for vaktmestertjenester (visningstest)';
const deadline = () => new Date(Date.now() + 25 * 86_400_000).toISOString();

before(async () => {
  server = await startServer();
  const construction = { cpvCodes: ['45210000'], mainCpv: '45210000', contractNature: 'works' as const };
  await ingest([
    makeNotice({
      ...construction,
      title: COMP,
      description:
        'Kommunen skal rehabilitere den utvendige fasaden på Byskolen. Tilbud som leveres etter fristen, vil bli avvist. ' +
        'Leverandøren skal ha sentral godkjenning og dokumentere ISO 14001 eller tilsvarende miljøledelse. ' +
        'Det er obligatorisk befaring 3. desember kl. 10.00. Ved forsinket ferdigstillelse påløper dagbot på 1 promille av kontraktssummen per dag. ' +
        'Faktura betales innen 30 dager. Arbeidet skal utføres i skolens ferier.',
      deadlineAt: new Date(Date.now() + 25 * 86_400_000).toISOString(),
    }),
    ...[1_000_000, 2_000_000, 3_000_000].map((v, i) =>
      makeNotice({ ...construction, title: `Fasadearbeid ${i + 1} (visningstest)`, lifecycle: 'awarded', noticeType: 'award', awards: award(v, day(-(i + 2))) }),
    ),
    makeNotice({
      ...construction,
      title: EXPIRING,
      lifecycle: 'awarded',
      noticeType: 'award',
      details: { contractStart: day(-30), contractEnd: day(5) },
      awards: award(4_000_000, day(-31)),
    }),
  ]);
  // Hver for seg, så de blir nyere enn eksempelet over (gamle regler valgte det nyeste ved likt resultat).
  await ingest([
    makeNotice({
      cpvCodes: ['85147000'],
      mainCpv: '85147000',
      contractNature: 'services' as const,
      title: HEALTH,
      description:
        'Kommunen skal anskaffe bedriftshelsetjeneste for alle ansatte i fire år. Tilbud som leveres etter fristen, vil bli avvist. ' +
        'Leverandøren må dokumentere ISO 45001 eller tilsvarende og legge ved skatteattest. ' +
        'Det er obligatorisk befaring 4. desember kl. 12.00. Ved forsinket oppstart påløper dagbot på 1 promille av kontraktssummen per dag. ' +
        'Faktura betales innen 30 dager.',
      deadlineAt: deadline(),
    }),
  ]);
  await ingest([
    makeNotice({
      ...construction,
      title: BOILERPLATE,
      description:
        'Rammeavtalen gjelder vaktmestertjenester for kommunens bygg. ' +
        'I denne anskaffelsen benyttes eBevis for å innhente opplysninger knyttet til kvalifikasjonskrav og avvisningsgrunner. ' +
        'Kvalifikasjonskrav med tilhørende dokumentasjonskrav følger under kravspesifikasjonen. ' +
        'En eventuell forlengelse av tilbudets vedståelsesfrist kan bare skje dersom leverandøren godkjenner dette. ' +
        'Følgende kontraktsvilkår legges til grunn for rammeavtalen: SSA-R med bilag 1-7.',
      deadlineAt: deadline(),
    }),
  ]);
  resetShowcaseCache();
});

after(async () => {
  await server.close();
  await closeDb();
});

test('kundereisen bygger på ekte, lagrede kunngjøringer og tildelinger', async () => {
  const s = await siteShowcase();
  assert.ok(s, 'fant et eksempel');
  // Ikke standardteksten (nyest), og ikke det like gode helseanbudet uten markedspris og kontraktsutløp (nyere).
  assert.equal(s.notice.title, COMP);
  assert.ok(s.requirements.every((r) => !/eBevis|følger under/.test(r.text)), JSON.stringify(s.requirements));
  assert.ok(s.terms.every((t) => t.kind !== 'standardkontrakt'), JSON.stringify(s.terms));
  assert.equal(s.industry.id, 'construction');
  const kinds = s.requirements.map((r) => r.kind);
  for (const k of ['avvisning', 'kvalifikasjon', 'befaring']) assert.ok(kinds.includes(k as never), `${k} i ${kinds.join(',')}`);
  // Hvert utdrag står ordrett i kunngjøringen.
  for (const r of s.requirements) assert.ok(r.text.replace(/^… | …$/g, '').length > 10 && r.text.includes(r.match));
  assert.ok(s.terms.some((t) => t.kind === 'dagbot'), 'dagbøter funnet');
  // Markedsprisen er regnet ut fra de lagrede tildelingene.
  assert.ok(s.market && s.market.n >= 3, JSON.stringify(s.market));
  for (const v of [1_000_000, 2_000_000, 3_000_000]) assert.ok(s.market!.values.includes(v), `${v} er med`);
  assert.ok(s.market!.p25 <= s.market!.median && s.market!.median <= s.market!.p75);
  assert.ok(s.award && s.award.value > 0);
  assert.ok(s.expiring.some((e) => e.title === EXPIRING && e.basis === 'oppgitt'), JSON.stringify(s.expiring));
  assert.ok(s.matches.length > 0 && s.matches.every((m) => m.score >= 0 && m.score <= 100));
  // Mellomlagres: samme svar uten nye spørringer.
  assert.equal(await siteShowcase(), s);
});

test('forsiden viser de ekte eksemplene – uten leverandørnavn og uten AI-løfter', async () => {
  const res = await fetch(`${server.base}/`);
  const body = (await res.text()).replaceAll('<!-- -->', '');
  assert.equal(res.status, 200);
  assert.ok(body.includes(COMP), 'kunngjøringen vises');
  assert.ok(body.includes(EXPIRING), 'kontrakten som utløper vises');
  assert.match(body, /Ekte kunngjøring/);
  assert.match(body, /<mark[^>]*>[^<]+<\/mark>/, 'treffordet er uthevet');
  assert.match(body, /Eksempelprofil/);
  assert.ok(!body.includes(SUPPLIER), 'leverandørnavn vises ikke på nettsiden');
  // Simulert AI (testmiljøet) skal ikke markedsføres.
  const features = await (await fetch(`${server.base}/funksjoner`)).text();
  assert.doesNotMatch(features, />AI-analyse</);
  assert.match(features, /Risiko før tilbud/);
  const pricing = await (await fetch(`${server.base}/priser`)).text();
  assert.match(pricing, /AI-funksjonene i planene \(sammendrag, analyse og utkast\) er ikke slått på ennå/);
  // Andre språk: samme ekte eksempler og ærlig om at appen er på norsk.
  const en = await (await fetch(`${server.base}/en`)).text();
  assert.match(en, /Don’t just find the tender/);
  assert.match(en, /The app, emails and documents are in Norwegian/);
});
