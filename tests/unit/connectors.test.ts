import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTedQuery, mapTedNotice, tedLifecycle, tedScalar } from '../../src/connectors/ted';
import { doffinLifecycle, mapDoffinHit } from '../../src/connectors/doffin';
import { parseCsv, parseImportFile } from '../../src/connectors/manual';
import { normalizedNoticeSchema } from '../../src/domain/tenders/normalize';

// Konstruerte fiksturer i samme form som TEDs søke-API (feltnavn fra TED_FIELDS).
// Innholdet er fiktivt og brukes bare til å teste oversettelsen.
const tedCompetition = {
  'publication-number': '123456-2026',
  'notice-type': 'cn-standard',
  'notice-title': { eng: ['Norway – Security services – Guarding'], nor: ['Norge – Vakttjenester – Vakthold'] },
  'title-proc': { nor: ['Vakthold ved rådhuset (fiktiv test)'] },
  'description-proc': { nor: ['<p>Stasjonært vakthold.</p>'] },
  'buyer-name': { nor: ['Testkommune'] },
  'buyer-city': { nor: ['Trondheim'] },
  'buyer-country': ['NOR'],
  'organisation-identifier-buyer': ['974760673'],
  'publication-date': '2026-10-29+01:00',
  'procedure-type': ['open'],
  'contract-nature': ['services'],
  'classification-cpv': ['79713000', '79710000', '79713000'],
  'place-of-performance': ['NO060', 'NOR'],
  'deadline-date-lot': ['2026-11-30+01:00', '2026-11-24+01:00'],
  'deadline-receipt-tender-time-lot': ['12:00:00+01:00'],
  'estimated-value-proc': '4200000',
  'estimated-value-cur-lot': ['NOK'],
  links: { html: { ENG: 'https://ted.europa.eu/en/notice/-/detail/123456-2026' } },
};

test('TED: konkurransekunngjøring oversettes riktig', () => {
  const n = mapTedNotice(tedCompetition);
  assert.equal(n.source, 'ted');
  assert.equal(n.sourceNoticeId, '123456-2026');
  assert.equal(n.lifecycle, 'competition');
  assert.equal(n.title, 'Vakthold ved rådhuset (fiktiv test)');
  assert.equal(n.description, 'Stasjonært vakthold.');
  assert.equal(n.buyerOrgNumber, '974760673');
  assert.deepEqual(n.cpvCodes, ['79713000', '79710000']);
  assert.deepEqual(n.nutsCodes, ['NO060']);
  assert.equal(n.deadlineAt, '2026-11-24T11:00:00.000Z', 'tidligste delkontraktfrist brukes');
  assert.equal(n.deadlineTimeKnown, true);
  assert.equal(n.estimatedValue, 4_200_000);
  assert.equal(n.currency, 'NOK');
  assert.equal(n.sourceUrl, 'https://ted.europa.eu/en/notice/-/detail/123456-2026');
  assert.ok(normalizedNoticeSchema.safeParse(n).success);
});

test('TED: tildeling med flere vinnere fordeler ikke verdien', () => {
  const n = mapTedNotice({
    ...tedCompetition,
    'publication-number': '200000-2026',
    'notice-type': 'can-standard',
    'winner-name': { nor: ['Leverandør A AS', 'Leverandør B AS'] },
    'total-value': '9000000',
    'total-value-cur': 'NOK',
    'winner-decision-date': ['2026-09-01+02:00'],
  });
  assert.equal(n.lifecycle, 'awarded');
  assert.equal(n.estimatedValue, null);
  assert.equal(n.awards.length, 2);
  assert.ok(n.awards.every((a) => a.value === null));
  assert.equal(n.awards[0]!.awardDate, '2026-09-01');
});

test('TED: hjelpefunksjoner', () => {
  assert.equal(tedScalar({ eng: ['English'], nor: ['Norsk'] }), 'Norsk');
  assert.equal(tedLifecycle('pin-only'), 'planned');
  assert.equal(tedLifecycle('veat'), 'direct_award');
  assert.equal(buildTedQuery({ since: new Date('2026-10-01T00:00:00Z') }), 'buyer-country=NOR AND publication-date>=20261001');
  assert.throws(() => mapTedNotice({}), /publication-number/);
});

test('Doffin: treff oversettes, og avlysning vinner over andre typer', () => {
  const n = mapDoffinHit({
    id: '2026-100001',
    heading: 'Renhold av skoler (fiktiv test)',
    description: 'Daglig renhold.',
    buyer: [{ name: 'Testkommune', organizationId: '974760673' }],
    locationId: ['NO081', 'anywhere'],
    estimatedValue: { amount: 2_500_000, currencyCode: 'nok' },
    type: 'ANNOUNCEMENT_OF_COMPETITION',
    status: 'ACTIVE',
    deadline: '2026-12-01T12:00:00',
    publicationDate: '2026-10-20',
    cpvCodes: ['90911200-8'],
  });
  assert.equal(n.sourceUrl, 'https://doffin.no/notices/2026-100001');
  assert.equal(n.lifecycle, 'competition');
  assert.deepEqual(n.nutsCodes, ['NO081']);
  assert.deepEqual(n.cpvCodes, ['90911200']);
  assert.equal(n.currency, 'NOK');
  assert.equal(n.deadlineAt, '2026-12-01T11:00:00.000Z', 'tid uten sone tolkes som norsk tid');
  assert.equal(n.deadlineTimeKnown, true);
  assert.equal(doffinLifecycle({ type: 'ANNOUNCEMENT_OF_COMPETITION', status: 'CANCELLED' }), 'cancelled');
  assert.equal(doffinLifecycle({ type: 'RESULT', allTypes: ['ANNOUNCEMENT_OF_COMPETITION', 'RESULT'] }), 'awarded');
});

test('manuell import: CSV med semikolon, anførselstegn og tomme celler', () => {
  const csv = 'id;title;buyer_name;cpv;estimated_value;currency;deadline_at;status\n' +
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
  assert.equal(parseImportFile('ted.json', JSON.stringify({ notices: [tedCompetition] })).format, 'ted-api');
  const doffin = parseImportFile('doffin.json', JSON.stringify({ hits: [{ id: 'X1', heading: 'Test' }] }));
  assert.equal(doffin.format, 'doffin-api');
  assert.equal(doffin.notices.length, 1);
  assert.equal(parseImportFile('feil.json', '{ikke json').errors.length, 1);
});
