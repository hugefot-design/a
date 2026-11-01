import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTedQuery, lotDateTimes, mapTedNotice, tedAwardCriteria, tedLifecycle, tedScalar, tedTitle } from '../../src/connectors/ted';
import {
  dayRange,
  doffinLifecycle,
  fetchDoffin,
  guessLanguage,
  mapDoffinHit,
  setDoffinPacing,
  type DoffinHit,
} from '../../src/connectors/doffin';
import { backoffMs, retryAfterMs, setRetryDelayFactor } from '../../src/connectors/types';
import { dataQuality } from '../../src/connectors';
import { parseCsv, parseImportFile } from '../../src/connectors/manual';
import { env } from '../../src/lib/env';
import { cleanNutsCodes, durationFrom, mostSpecificCpv, normalizedNoticeSchema, regionCodesFor } from '../../src/domain/tenders/normalize';

// ---------------------------------------------------------------------------
// TED – EKTE svar fra TEDs søke-API (hentet 1.11.2026, se fiksturfilen for kilde)
// ---------------------------------------------------------------------------
const tedLive = JSON.parse(readFileSync(new URL('../fixtures/ted-live-2026-11-01.json', import.meta.url), 'utf8')) as {
  notices: Record<string, unknown>[];
};
const live = (id: string) => {
  const hit = tedLive.notices.find((n) => n['publication-number'] === id);
  assert.ok(hit, `fiksturen mangler ${id}`);
  return mapTedNotice(hit);
};

test('TED (ekte data): alle fiksturer oversettes til gyldig felles format', () => {
  assert.equal(tedLive.notices.length, 6);
  for (const hit of tedLive.notices) {
    const n = mapTedNotice(hit);
    const parsed = normalizedNoticeSchema.safeParse(n);
    assert.ok(parsed.success, `${n.sourceNoticeId}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`);
    assert.equal(n.source, 'ted');
    assert.equal(n.countryCode, 'NO');
  }
});

test('TED (ekte data): tilbudsfrist er BT-131, ikke spørsmålsfristen (feilen i forrige versjon)', () => {
  // 718790-2026: spørsmålsfrist 18.10, tilbudsfrist forlenget til 26.10 kl. 12:00 norsk tid.
  const n = live('718790-2026');
  assert.equal(n.lifecycle, 'competition');
  assert.equal(n.deadlineAt, '2026-10-26T11:00:58.000Z');
  assert.equal(n.deadlineTimeKnown, true);
  assert.equal(n.details?.deadlineKind, 'tender');
  assert.equal(n.details?.questionsDeadlineAt, '2026-10-18T22:00:00.000Z');
  assert.ok(new Date(n.deadlineAt!).getTime() > new Date(n.publishedAt!).getTime(), 'fristen er etter publisering');
  assert.equal(n.documentsUrl, 'https://tendsign.com/doc.aspx?MeFormsNoticeId=99972');
  assert.deepEqual(n.nutsCodes, [], '«anyw» er ikke en NUTS-kode');
  assert.match(n.details?.changeDescription ?? '', /extended to 26\.10\.2026/);
  assert.equal(n.details?.language, 'en');
});

test('TED (ekte data): landsdekkende kunngjøring med NUTS 2024 gir alle 15 fylker', () => {
  const n = live('722733-2026');
  assert.equal(n.buyerName, 'SYKEHUSINNKJØP HF');
  assert.equal(n.buyerOrgNumber, '916879067');
  assert.equal(n.estimatedValue, 40_000_000);
  assert.equal(n.currency, 'NOK');
  assert.equal(n.deadlineAt, '2026-11-27T10:00:00.000Z');
  assert.equal(n.details?.durationText, '48 måneder');
  assert.equal(n.details?.isFramework, true);
  assert.equal(n.documentsUrl, 'https://sykehusinnkjop.ivalua.app/page.aspx/nb/rfp/request_browse_public');
  assert.equal(regionCodesFor(n).length, 15);
  assert.equal(n.mainCpv, '24455000', 'mest spesifikke CPV-kode');
});

test('TED (ekte data): tildeling med to delkontrakter og org.nr. for vinnerne', () => {
  const n = live('711382-2026');
  assert.equal(n.lifecycle, 'awarded');
  assert.equal(n.estimatedValue, null);
  assert.deepEqual(
    n.awards.map((a) => [a.supplierName, a.supplierOrgNumber, a.lotTitle, a.value]),
    [
      ['Lilltech AS', '985991359', 'Baton and baton holder', null],
      ['Defendo AS', '985699135', 'Protective Suits', null],
    ],
    'verdien fordeles ikke når det er flere vinnere',
  );
  assert.equal(n.details?.lots?.length, 2);
  assert.deepEqual(n.details?.lots?.map((l) => l.estimatedValue), [67_500_000, 7_500_000]);
  assert.deepEqual(regionCodesFor(n), ['34']);
});

test('TED (ekte data): begrenset konkurranse bruker fristen for å be om å delta', () => {
  const n = live('718825-2026');
  assert.equal(n.details?.deadlineKind, 'participation');
  assert.equal(n.deadlineAt, n.details?.participationDeadlineAt);
  assert.deepEqual(regionCodesFor(n), ['39'], 'Færder ligger i Vestfold (NO093)');
});

test('TED (ekte data): feil hos kilden stopper ikke kunngjøringen', () => {
  const dot = live('676431-2026'); // tittel, oppdragsgiver og beskrivelse er «.»
  assert.equal(dot.title, 'Refrigerating and freezing equipment');
  assert.equal(dot.buyerName, null);
  assert.equal(dot.description, null);
  const year = live('735170-2026'); // varighet oppgitt som «2026 YEAR»
  assert.equal(year.details?.durationText, null);
  assert.deepEqual(year.details?.awardCriteria, [{ name: 'Price', type: 'cost', weight: '100 %' }]);
});

test('TED: hjelpefunksjoner', () => {
  assert.equal(tedScalar({ eng: ['English'], nor: ['Norsk'] }), 'Norsk');
  assert.equal(tedLifecycle('pin-only'), 'planned');
  assert.equal(tedLifecycle('pin-cfc-standard'), 'competition');
  assert.equal(tedLifecycle('pmc'), 'planned');
  assert.equal(tedLifecycle('cn-social'), 'competition');
  assert.equal(tedLifecycle('can-modif'), 'awarded');
  assert.equal(tedLifecycle('veat'), 'direct_award');
  assert.equal(tedLifecycle('corr'), 'other');
  assert.equal(buildTedQuery({ since: new Date('2026-10-01T00:00:00Z') }), 'buyer-country=NOR AND publication-date>=20261001');
  assert.throws(() => mapTedNotice({}), /publication-number/);
  // Ulike frister per delkontrakt: hver dato får sitt klokkeslett.
  assert.deepEqual(lotDateTimes(['2026-11-30+01:00', '2026-11-24+01:00'], ['12:00:00+01:00', '10:00:00+01:00']), [
    '2026-11-30T11:00:00.000Z',
    '2026-11-24T09:00:00.000Z',
  ]);
  assert.deepEqual(tedTitle({ 'title-proc': { eng: '.' }, 'notice-title': { eng: 'Norway – Lockers – Bike boxes' } }), { text: 'Lockers – Bike boxes', lang: 'en' });
  // Kriterier kobles bare til vekt når listene har samme lengde.
  assert.deepEqual(tedAwardCriteria({ 'award-criterion-name-lot': { eng: ['Quality', 'Cost'] }, 'award-criterion-type-lot': ['quality'], 'award-criterion-number-lot': ['60'] }), [
    { name: 'Quality', type: null, weight: null },
    { name: 'Cost', type: null, weight: null },
  ]);
});

test('felles: NUTS-rensing, mest spesifikke CPV og varighet', () => {
  assert.deepEqual(cleanNutsCodes(['NO083', 'NO083', 'anyw', 'NOR', 'NOZZZ', 'ANYW-EEA', 'no060', 42]), ['NO060', 'NO083']);
  assert.equal(mostSpecificCpv(['79000000', '79410000', '79400000']), '79410000');
  assert.equal(mostSpecificCpv([]), null);
  assert.deepEqual(durationFrom('48', 'MONTH'), { months: 48, text: '48 måneder' });
  assert.deepEqual(durationFrom('2', 'YEAR'), { months: 24, text: '2 år' });
  assert.equal(durationFrom('2026', 'YEAR'), null, 'urimelig lang varighet behandles som ukjent');
  assert.equal(durationFrom('x', 'MONTH'), null);
  assert.equal(durationFrom('3', 'FORTNIGHT'), null);
});

test('dry-run-sammendrag: datakvalitet regnes ut fra kunngjøringene', () => {
  const q = dataQuality(tedLive.notices.map((h) => mapTedNotice(h)));
  assert.equal(q.notices, 6);
  assert.equal(q.byLifecycle.competition, 4);
  assert.equal(q.coverage.deadlineOfCompetitions, 100);
  assert.equal(q.languages.en, 6);
});

// ---------------------------------------------------------------------------
// Doffin – oversettelse etter API-ets dokumenterte modell (PublicNoticeHitDto)
// ---------------------------------------------------------------------------
const doffinCompetition: DoffinHit = {
  id: '2026-100002',
  heading: 'Renhold av skoler og barnehager',
  description: 'Kommunen skal inngå rammeavtale om daglig renhold av skoler og barnehager.',
  buyer: [{ id: 'abc', name: 'Testkommune', organizationId: '974 760 673' }],
  locationId: ['NO081', 'anyw'],
  estimatedValue: { amount: 2_500_000.5, currencyCode: 'NOK' },
  type: 'ANNOUNCEMENT_OF_COMPETITION',
  allTypes: ['ANNOUNCEMENT_OF_COMPETITION', 'COMPETITION'],
  status: 'ACTIVE',
  issueDate: '2026-10-20T08:12:00Z',
  deadline: '2026-12-01T11:00:00Z',
  publicationDate: '2026-10-20',
  cpvCodes: ['90000000', '90911200-8', '90910000'],
  lots: [{ heading: 'Renhold', description: 'd', winner: [] }],
};

test('Doffin: konkurranse oversettes etter API-modellen', () => {
  const n = mapDoffinHit(doffinCompetition);
  assert.equal(n.sourceUrl, 'https://doffin.no/notices/2026-100002');
  assert.equal(n.lifecycle, 'competition');
  assert.deepEqual(n.nutsCodes, ['NO081'], '«anyw» fjernes');
  assert.equal(n.buyerOrgNumber, '974760673', 'org.nr. med mellomrom normaliseres');
  assert.equal(n.mainCpv, '90911200', 'Doffin legger til overordnede koder – den mest spesifikke er hovedkoden');
  assert.equal(n.estimatedValue, 2_500_000.5);
  assert.equal(n.currency, 'NOK');
  assert.equal(n.deadlineAt, '2026-12-01T11:00:00.000Z');
  assert.equal(n.deadlineTimeKnown, true);
  assert.equal(n.details?.language, 'nb');
  assert.ok(normalizedNoticeSchema.safeParse(n).success);
});

test('Doffin: frist leses aldri fra resultatkunngjøringer, og alle typeverdier har livssyklus', () => {
  const result = mapDoffinHit({
    id: '2026-100001',
    heading: 'Kontrakt inngått',
    type: 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT',
    allTypes: ['ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT', 'RESULT'],
    status: null,
    deadline: '2028-01-01T00:00:00Z', // betyr noe annet enn tilbudsfrist på resultater
    lots: [{ heading: 'Del 1', winner: [{ name: 'Vinner AS', organizationId: '985991359' }] }],
  });
  assert.equal(result.lifecycle, 'awarded');
  assert.equal(result.deadlineAt, null);
  assert.equal(result.awards[0]?.supplierName, 'Vinner AS');
  assert.equal(doffinLifecycle({ type: 'ANNOUNCEMENT_OF_INTENT' }), 'direct_award');
  assert.equal(doffinLifecycle({ type: 'DYNAMIC_PURCHASING_SCHEME' }), 'competition');
  assert.equal(doffinLifecycle({ type: 'PRE_ANNOUNCEMENT' }), 'planned');
  assert.equal(doffinLifecycle({ type: 'CHANGE_OF_CONCLUSION_OF_CONTRACT' }), 'awarded');
  assert.equal(doffinLifecycle({ type: 'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT' }), 'cancelled');
  assert.equal(doffinLifecycle({ type: 'ANNOUNCEMENT_OF_COMPETITION', status: 'CANCELLED' }), 'cancelled');
  assert.equal(guessLanguage('Framework agreement for the supply of services and the delivery of equipment'), 'en');
  assert.equal(guessLanguage('Rammeavtale for kjøp av renhold og vaktmestertjenester til skolene'), 'nb');
});

// Simulert Doffin-API som oppfører seg slik API-portalen og uavhengige live-tester beskriver:
// 1-baserte sider (page=0 → HTTP 400), maks 100 per side, og en midlertidig 429 med Retry-After.
interface FakeDay {
  total: number;
}
let realFetch: typeof fetch;
let requests: URL[] = [];
function installFakeDoffin(days: Record<string, FakeDay>, opts: { first429?: boolean } = {}) {
  let sent429 = false;
  requests = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push(url);
    assert.equal((init?.headers as Record<string, string>)['Ocp-Apim-Subscription-Key'], 'test-nokkel');
    if (opts.first429 && !sent429) {
      sent429 = true;
      return new Response('{"statusCode":429}', { status: 429, headers: { 'Retry-After': '0' } });
    }
    const page = Number(url.searchParams.get('page'));
    if (!Number.isInteger(page) || page < 1) return new Response('{"message":"page must be >= 1"}', { status: 400 });
    const day = url.searchParams.get('issueDateFrom')!;
    assert.equal(url.searchParams.get('issueDateTo'), day, 'ett døgn per søk');
    const per = Number(url.searchParams.get('numHitsPerPage'));
    assert.ok(per <= 100);
    const total = days[day]?.total ?? 0;
    const accessible = Math.min(total, 1000);
    const start = (page - 1) * per;
    const hits = Array.from({ length: Math.max(0, Math.min(per, accessible - start)) }, (_, i) => ({
      ...doffinCompetition,
      id: `${day}-${start + i}`,
    }));
    return new Response(JSON.stringify({ numHitsTotal: total, numHitsAccessible: accessible, hits }), { status: 200 });
  }) as typeof fetch;
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  setDoffinPacing(0);
  setRetryDelayFactor(0);
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = 'test-nokkel';
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setDoffinPacing(2100);
  setRetryDelayFactor(1);
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = undefined;
});

test('Doffin: henter døgn for døgn fra side 1, alle sider, uten duplikater, og tåler 429', async () => {
  installFakeDoffin({ '2026-10-20': { total: 250 }, '2026-10-21': { total: 0 }, '2026-10-22': { total: 40 } }, { first429: true });
  const errors: string[] = [];
  const notices = await fetchDoffin({ since: new Date('2026-10-20T05:00:00Z'), until: new Date('2026-10-22T05:00:00Z') }, async (_id, e) => {
    errors.push(e);
  });
  assert.equal(notices.length, 290);
  assert.equal(new Set(notices.map((n) => n.sourceNoticeId)).size, 290);
  assert.deepEqual(errors, []);
  assert.ok(requests.every((u) => Number(u.searchParams.get('page')) >= 1), 'aldri page=0');
  assert.equal(requests[0]!.searchParams.get('sortBy'), 'PUBLICATION_DATE_ASC');
});

test('Doffin: døgn med over 1 000 kunngjøringer deles opp etter type, og tap rapporteres', async () => {
  installFakeDoffin({ '2026-10-20': { total: 1500 } });
  const errors: string[] = [];
  const notices = await fetchDoffin({ since: new Date('2026-10-20T00:00:00Z'), until: new Date('2026-10-20T00:00:00Z') }, async (_id, e) => {
    errors.push(e);
  });
  assert.ok(requests.some((u) => u.searchParams.getAll('type').length > 0), 'søker per typegruppe');
  assert.ok(requests.every((u) => Number(u.searchParams.get('page')) <= 10), 'maks 10 sider');
  assert.equal(notices.length, 1000, 'den simulerte kilden gir aldri mer enn 1 000 – resten rapporteres');
  assert.ok(errors.some((e) => /bare tilgang til 1000/.test(e)));
});

test('Doffin: 401 gir tydelig feil, og manglende nøkkel stopper før kall', async () => {
  globalThis.fetch = (async () => new Response('{}', { status: 401 })) as typeof fetch;
  await assert.rejects(fetchDoffin({ since: new Date('2026-10-20T00:00:00Z'), until: new Date('2026-10-20T00:00:00Z') }, async () => {}), /avviste nøkkelen/);
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = undefined;
  await assert.rejects(fetchDoffin({ since: new Date('2026-10-20T00:00:00Z') }, async () => {}), /DOFFIN_API_KEY/);
});

test('henting: Retry-After og ventetid', () => {
  assert.equal(retryAfterMs('5'), 5000);
  assert.equal(retryAfterMs(new Date(Date.now() + 3000).toUTCString(), Date.now()) !== null, true);
  assert.equal(retryAfterMs('ugyldig'), null);
  assert.equal(retryAfterMs(null), null);
  const b = backoffMs(2);
  assert.ok(b >= 3000 && b <= 5000, `eksponentiell ventetid med spredning: ${b}`);
  assert.deepEqual(dayRange(new Date('2026-10-30T22:00:00Z'), new Date('2026-11-01T01:00:00Z')), ['2026-10-30', '2026-10-31', '2026-11-01']);
});

// ---------------------------------------------------------------------------
// Manuell import
// ---------------------------------------------------------------------------
test('manuell import: CSV med semikolon, anførselstegn og tomme celler', () => {
  const csv =
    'id;title;buyer_name;cpv;estimated_value;currency;deadline_at;status\n' +
    'M-1;"Vakthold; dag og natt";Testkommune;79713000;1 500 000;;2026-12-01;competition\n' +
    'M-2;;Testkommune;;;;;competition\n';
  assert.equal(parseCsv(csv).length, 2);
  const r = parseImportFile('import.csv', csv);
  assert.equal(r.format, 'anbudradar-csv');
  assert.equal(r.notices.length, 1, 'rad uten tittel avvises');
  assert.equal(r.errors.length, 1);
  const n = r.notices[0]!;
  assert.equal(n.title, 'Vakthold; dag og natt');
  assert.equal(n.estimatedValue, 1_500_000);
  assert.equal(n.currency, 'NOK');
  assert.equal(n.deadlineTimeKnown, false);
});

test('manuell import gjenkjenner lagrede TED- og Doffin-svar', () => {
  const ted = parseImportFile('ted.json', JSON.stringify({ notices: tedLive.notices.slice(0, 2) }));
  assert.equal(ted.format, 'ted-api');
  assert.equal(ted.notices.length, 2);
  const doffin = parseImportFile('doffin.json', JSON.stringify({ hits: [{ id: 'X1', heading: 'Test av import' }] }));
  assert.equal(doffin.format, 'doffin-api');
  assert.equal(doffin.notices.length, 1);
  assert.equal(parseImportFile('feil.json', '{ikke json').errors.length, 1);
});
