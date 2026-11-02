/**
 * Doffin-nedlasting (GET /v2/download/{doffinId}) og eForms-parseren – uten nettverk og database.
 * API-et simuleres slik Doffins API-portal beskriver det (10 kall/min, 429 + Retry-After, 404).
 */
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextEnrichmentState } from '../../src/connectors/doffin-enrich';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { env } from '../../src/lib/env';
import { memorySlots } from '../../src/lib/api-slots';
import { durationFromPeriod, EformsError, eformsLifecycle, eformsToNotice, parseEformsXml } from '../../src/connectors/eforms';
import {
  DOFFIN_DOWNLOAD_INTERVAL_MS,
  downloadDoffinNotice,
  fetchDoffinByIds,
  setDoffinDownloadDeps,
  sniffFormat,
} from '../../src/connectors/doffin';
import { ConnectorError } from '../../src/connectors/types';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/eforms/${name}`, import.meta.url), 'utf8');
const meta = (id = '2026-100001') => ({ sourceNoticeId: id, sourceUrl: `https://doffin.no/notices/${id}`, sha256: 'x', bytes: 1 });
const plain = (s: string | null | undefined) => (s ?? '').replace(/[  ]/g, ' ');

// ---------------------------------------------------------------- eForms-parseren
test('eForms N16: frister, lenker, varighet, rammeavtale, kriterier og rettsgrunnlag fra XML', () => {
  const p = parseEformsXml(fixture('n16-konkurranse-v1.xml'));
  assert.equal(p.variant, 'national');
  assert.equal(p.noticeSubtype, 'N16');
  assert.equal(p.lots.length, 2);
  const n = eformsToNotice(p, meta());
  assert.equal(n.source, 'doffin');
  assert.equal(n.lifecycle, 'competition');
  assert.equal(n.title, 'Vintervedlikehold av kommunale veier 2027–2029 (test)');
  assert.equal(n.buyerName, 'Fjordvik kommune (test)');
  assert.equal(n.buyerOrgNumber, '912000001', 'organisasjonsnummer renset og kontrollert');
  assert.equal(n.deadlineAt, '2027-01-15T11:00:00.000Z', 'tidligste tilbudsfrist, 12:00 norsk tid');
  assert.equal(n.deadlineTimeKnown, true);
  assert.equal(n.details?.deadlineKind, 'tender');
  assert.equal(n.details?.lotDeadlinesDiffer, true);
  assert.equal(n.details?.questionsDeadlineAt, '2027-01-05T11:00:00.000Z');
  assert.equal(n.documentsUrl, 'https://konkurranse.example.no/fj-2026-041');
  assert.equal(n.details?.submissionUrl, 'https://konkurranse.example.no/fj-2026-041/levering');
  assert.equal(n.details?.durationMonths, 36, 'lengste delkontrakt');
  assert.equal(n.details?.isFramework, true, 'én delkontrakt er rammeavtale');
  assert.equal(n.estimatedValue, 2_400_000);
  assert.equal(n.currency, 'NOK');
  assert.equal(n.procedureType, 'open');
  assert.equal(n.contractNature, 'services');
  assert.deepEqual(n.cpvCodes, ['90620000', '90630000']);
  assert.deepEqual(n.nutsCodes, ['NO0A2']);
  assert.equal(n.details?.noticeIdentifier, '8b3e1f20-1c2d-4e5f-8a9b-0c1d2e3f4a51');
  assert.equal(n.details?.noticeVersion, 1);
  assert.equal(n.procedureId, '5f0c2b1e-7a44-4d6b-9a10-2c3d4e5f6a71');
  assert.equal(n.buyerReference, 'FJ-2026-041');
  assert.deepEqual(
    n.details?.awardCriteria?.map((c) => [c.name, c.type, plain(c.weight)]),
    [
      ['Pris', 'price', '40 %'],
      ['Klima- og miljøhensyn (tildelingskriterium)', 'quality-nor-env-criteria', '30 %'],
      ['Gjennomføringsplan', 'quality', '30 %'],
    ],
  );
  assert.deepEqual(n.details?.selectionCriteria, ['Leverandøren skal ha en årlig omsetning på minst 3 millioner kroner.']);
  assert.equal(n.details?.lots?.length, 2);
  assert.equal(n.details?.language, 'nb');
  const raw = n.raw as Record<string, unknown>;
  assert.equal(raw.format, 'eforms-xml');
  assert.equal(raw.noticeSubtype, 'N16');
  assert.deepEqual(raw.legalBasis, [{ id: 'https://lovdata.no/eli/forskrift/2016/8/12/974', description: 'NOR — Anskaffelsesforskriften Del 1 og 2' }]);
  assert.deepEqual(raw.strategicProcurement, ['env-imp']);
  assert.ok(!JSON.stringify(raw).includes('<ContractNotice'), 'hele XML-en lagres ikke');
});

test('eForms N16 versjon 02: samme kunngjøring, ny frist og beskrivelse av endringen', () => {
  const n = eformsToNotice(parseEformsXml(fixture('n16-konkurranse-v2-rettelse.xml')), meta('2026-100002'));
  assert.equal(n.details?.noticeIdentifier, '8b3e1f20-1c2d-4e5f-8a9b-0c1d2e3f4a51');
  assert.equal(n.details?.noticeVersion, 2);
  assert.equal(n.deadlineAt, '2027-01-22T11:00:00.000Z');
  assert.equal(n.details?.changeDescription, 'Tilbudsfristen er forlenget med én uke.');
});

test('eForms N29: vinner med beløp og dato, antall tilbud og ingen estimert verdi', () => {
  const n = eformsToNotice(parseEformsXml(fixture('n29-tildeling.xml')), meta('2027-100003'));
  assert.equal(n.lifecycle, 'awarded');
  assert.equal(n.procedureId, '5f0c2b1e-7a44-4d6b-9a10-2c3d4e5f6a71', 'samme prosedyre som konkurransen');
  assert.deepEqual(n.awards, [
    { lotTitle: null, supplierName: 'Brøyting og Bil AS (test)', supplierOrgNumber: '933000001', value: 1_350_000, currency: 'NOK', awardDate: '2027-02-10' },
  ]);
  assert.equal(n.receivedTenders, 4);
  assert.equal(n.estimatedValue, null);
  assert.equal(n.deadlineAt, null, 'tildelinger har ingen tilbudsfrist');
});

test('eForms E3 begrenset konkurranse, N4 veiledende og E4 uten vinner', () => {
  const e3 = eformsToNotice(parseEformsXml(fixture('e3-begrenset.xml')), meta());
  assert.equal(e3.lifecycle, 'competition');
  assert.equal(e3.details?.deadlineKind, 'participation');
  assert.equal(e3.deadlineAt, '2027-02-01T09:00:00.000Z');
  assert.equal(e3.details?.participationDeadlineAt, '2027-02-01T09:00:00.000Z');
  assert.equal((e3.raw as { variant: string }).variant, 'national-e');

  const pin = eformsToNotice(parseEformsXml(fixture('n4-veiledende.xml')), meta());
  assert.equal(pin.lifecycle, 'planned');
  assert.equal(pin.procedureId, null, 'planlegging etablerer ikke en prosedyre (DFØ R-15)');
  assert.equal(pin.deadlineAt, null);

  const e4 = parseEformsXml(fixture('e4-ingen-vinner.xml'));
  assert.equal(eformsLifecycle(e4), 'cancelled');
  assert.deepEqual(eformsToNotice(e4, meta()).awards, []);
});

test('eForms: avviser DOCTYPE/ENTITY, ugyldig XML og ukjente dokumenttyper', () => {
  assert.throws(() => parseEformsXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><ContractNotice/>'), EformsError);
  assert.throws(() => parseEformsXml('<ContractNotice><uavsluttet></ContractNotice>'), EformsError);
  assert.throws(() => parseEformsXml('<Invoice xmlns="urn:x"/>'), /Ukjent dokumenttype/);
});

test('formatgjenkjenning: XML, eForms-XML, ZIP, JSON og ukjent', () => {
  assert.equal(sniffFormat(Buffer.from(fixture('n16-konkurranse-v1.xml')), 'application/octet-stream'), 'eforms-xml');
  assert.equal(sniffFormat(Buffer.from('﻿<?xml version="1.0"?><annet/>'), null), 'xml');
  assert.equal(sniffFormat(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), null), 'zip');
  assert.equal(sniffFormat(Buffer.from('{"id":"2026-1"}'), 'application/json'), 'json');
  assert.equal(sniffFormat(Buffer.from('%PDF-1.7'), 'application/octet-stream'), 'unknown');
});

// ---------------------------------------------------------------- Nedlastingsklienten
let realFetch: typeof fetch;
let clock = 0;
let sleeps: number[] = [];
let calls: { url: string; at: number; key: string | undefined }[] = [];

function installFake(responses: (() => Response)[]) {
  let i = 0;
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), at: clock, key: (init?.headers as Record<string, string>)['Ocp-Apim-Subscription-Key'] });
    const make = responses[Math.min(i, responses.length - 1)]!;
    i++;
    return make();
  }) as typeof fetch;
}

beforeEach(() => {
  realFetch = globalThis.fetch;
  clock = 1_000_000;
  sleeps = [];
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = 'test-nokkel';
  setDoffinDownloadDeps({
    slots: memorySlots(() => clock),
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setDoffinDownloadDeps(null);
  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = undefined;
});

const xmlOk = () => new Response(fixture('n16-konkurranse-v1.xml'), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } });

test('nedlasting: riktig adresse og nøkkel i header, sjekksum og format', async () => {
  installFake([xmlOk]);
  const r = await downloadDoffinNotice('2026-100001');
  assert.ok(r.ok);
  assert.equal(calls[0]!.url, `${env.DOFFIN_API_BASE_URL.replace(/\/$/, '')}/download/2026-100001`);
  assert.equal(calls[0]!.key, 'test-nokkel', 'nøkkelen sendes bare som header');
  assert.ok(!calls[0]!.url.includes('test-nokkel'), 'nøkkelen står aldri i adressen');
  assert.equal(r.format, 'eforms-xml');
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.attempts, 1);
});

test('nedlasting: 404 gir «finnes ikke» uten nye forsøk', async () => {
  installFake([() => new Response('{"message":"Notice was not found."}', { status: 404, headers: { 'Content-Type': 'application/json' } })]);
  const r = await downloadDoffinNotice('2026-999999');
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'not_found');
  assert.equal(calls.length, 1);
});

test('nedlasting: 429 respekterer Retry-After (sekunder og HTTP-dato) før neste forsøk', async () => {
  installFake([() => new Response('', { status: 429, headers: { 'Retry-After': '7' } }), xmlOk]);
  const r = await downloadDoffinNotice('2026-100001');
  assert.ok(r.ok);
  assert.equal(r.attempts, 2);
  assert.ok(calls[1]!.at - calls[0]!.at >= 7000, `ventet ${calls[1]!.at - calls[0]!.at} ms`);

  // HTTP-dato tolkes mot ekte klokke (Retry-After er absolutt tid hos Doffin).
  const later = new Date(Date.now() + 12_000).toUTCString();
  installFake([() => new Response('', { status: 429, headers: { 'Retry-After': later } }), xmlOk]);
  assert.ok((await downloadDoffinNotice('2026-100001')).ok);
  const waited = calls[1]!.at - calls[0]!.at;
  assert.ok(waited >= 10_500 && waited <= 13_000, `HTTP-dato i Retry-After følges (ventet ${waited} ms)`);
});

test('nedlasting: 429 uten Retry-After venter ett minutt; lang Retry-After stopper med «prøv senere»', async () => {
  installFake([() => new Response('', { status: 429 }), xmlOk]);
  assert.ok((await downloadDoffinNotice('2026-100001')).ok);
  assert.ok(calls[1]!.at - calls[0]!.at >= 60_000);

  installFake([() => new Response('', { status: 429, headers: { 'Retry-After': '600' } })]);
  const r = await downloadDoffinNotice('2026-100001');
  assert.equal(!r.ok && r.reason, 'rate_limited');
  assert.equal(!r.ok && r.retryAfterMs, 600_000);
  assert.equal(calls.length, 1, 'venter ikke ti minutter i samme kjøring');
});

test('nedlasting: gjentatt 429 gir opp etter fire forsøk; 5xx prøves igjen; ugyldig ID sendes aldri', async () => {
  installFake([() => new Response('', { status: 429, headers: { 'Retry-After': '1' } })]);
  const r = await downloadDoffinNotice('2026-100001');
  assert.equal(!r.ok && r.reason, 'rate_limited');
  assert.equal(calls.length, 4);

  installFake([() => new Response('feil', { status: 503 }), xmlOk]);
  assert.ok((await downloadDoffinNotice('2026-100001')).ok);
  assert.equal(calls.length, 2);

  installFake([xmlOk]);
  const bad = await downloadDoffinNotice('../../admin');
  assert.equal(!bad.ok && bad.reason, 'invalid_id');
  assert.equal(calls.length, 0);
});

test('tempo: aldri mer enn 10 nedlastinger i noe 60-sekundersvindu, også når 429 skyver lukene', async () => {
  let n = 0;
  installFake([
    () => {
      n++;
      return n === 5 ? new Response('', { status: 429, headers: { 'Retry-After': '20' } }) : xmlOk();
    },
  ]);
  for (let i = 0; i < 25; i++) assert.ok((await downloadDoffinNotice(`2026-${100001 + i}`)).ok);
  const times = calls.map((c) => c.at);
  for (let i = 0; i < times.length; i++) {
    const inWindow = times.filter((t) => t >= times[i]! && t < times[i]! + 60_000).length;
    assert.ok(inWindow <= 10, `${inWindow} kall i ett minutt`);
  }
  for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= DOFFIN_DOWNLOAD_INTERVAL_MS);
});

test('per ID: ZIP med XML pakkes ut, JSON gir tydelig melding, 401 stopper kjøringen', async () => {
  const zip = new JSZip();
  zip.file('2026-100001.xml', fixture('n16-konkurranse-v1.xml'));
  const zipped = await zip.generateAsync({ type: 'nodebuffer' });
  installFake([() => new Response(new Uint8Array(zipped), { status: 200 }), () => new Response('{"id":"2026-100002"}', { status: 200 })]);
  const errors: string[] = [];
  const res = await fetchDoffinByIds(['2026-100001', '2026-100002', '2026-100001'], async (_id, e) => {
    errors.push(e);
  });
  assert.equal(res.notices.length, 1, 'duplikater i ID-listen hentes én gang');
  assert.equal(res.notices[0]!.details?.noticeIdentifier, '8b3e1f20-1c2d-4e5f-8a9b-0c1d2e3f4a51');
  assert.deepEqual(
    res.outcomes.map((o) => [o.id, o.outcome]),
    [
      ['2026-100001', 'ok'],
      ['2026-100002', 'unsupported_format'],
    ],
  );
  assert.match(errors[0]!, /Uventet format/);

  installFake([() => new Response('', { status: 401 })]);
  const outcomes: string[] = [];
  await assert.rejects(
    fetchDoffinByIds(['2026-1', '2026-2'], async (id) => {
      outcomes.push(id ?? '');
    }),
    (e: unknown) => e instanceof ConnectorError && /avviste nøkkelen/.test(e.message),
  );
  assert.equal(calls.length, 1, 'stopper etter første 401');

  (env as { DOFFIN_API_KEY?: string }).DOFFIN_API_KEY = undefined;
  await assert.rejects(fetchDoffinByIds(['2026-1'], async () => {}), /DOFFIN_API_KEY/);
});

// DFØs egne eksempelkunngjøringer (eForms SDK NOR) ligger ikke i repoet (uavklart lisens).
// Har du SDK-et lokalt, kjøres de med: EFORMS_SDK_NOR_DIR=/sti/til/eforms-sdk-nor npm run test:unit
const sdkDir = process.env.EFORMS_SDK_NOR_DIR;
test('DFØs eksempelkunngjøringer (N4/N16/N29, E2/E3/E4 og EU) kan leses', { skip: sdkDir ? false : 'EFORMS_SDK_NOR_DIR er ikke satt' }, async () => {
  const { readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dirs = ['src/tests/national/test', 'src/tests/eu/test', 'src/tests/national-e'].map((d) => join(sdkDir!, d));
  let checked = 0;
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.xml') && !f.startsWith('INVALID'))) {
      const p = parseEformsXml(readFileSync(join(dir, file), 'utf8'));
      assert.ok(p.noticeSubtype, `${file}: skjematype mangler`);
      assert.notEqual(p.variant, 'unknown', `${file}: variant`);
      const n = eformsToNotice(p, meta());
      assert.ok(n.title.length > 0, `${file}: tittel`);
      checked++;
    }
  }
  assert.ok(checked >= 8, `bare ${checked} eksempler funnet`);
});

test('XML-berikelse: nye forsøk med økende pause, og 429/ugyldig nøkkel teller ikke', () => {
  const steps: [Parameters<typeof nextEnrichmentState>[0], number, ReturnType<typeof nextEnrichmentState>][] = [
    ['ok', 0, { status: 'ok', attempts: 1, retryInHours: null }],
    ['not_found', 0, { status: 'retry', attempts: 1, retryInHours: 24 }],
    ['not_found', 1, { status: 'retry', attempts: 2, retryInHours: 24 }],
    ['not_found', 2, { status: 'gave_up', attempts: 3, retryInHours: null }],
    ['error', 0, { status: 'retry', attempts: 1, retryInHours: 1 }],
    ['parse_error', 1, { status: 'retry', attempts: 2, retryInHours: 6 }],
    ['unsupported_format', 2, { status: 'retry', attempts: 3, retryInHours: 24 }],
    ['too_large', 3, { status: 'gave_up', attempts: 4, retryInHours: null }],
    ['invalid_id', 0, { status: 'gave_up', attempts: 1, retryInHours: null }],
    ['rate_limited', 2, null],
    ['unauthorized', 0, null],
    ['not_attempted', 0, null],
  ];
  for (const [outcome, previous, expected] of steps) assert.deepEqual(nextEnrichmentState(outcome, previous), expected, `${outcome} etter ${previous} forsøk`);
});

test('EU-kunngjøring fra Doffin: rettsgrunnlag i RegulatoryDomain og varighet fra kontraktsdatoer (som i ekte data)', () => {
  // Slik ser ekte EU-kunngjøringer fra Doffin ut (kontrollert mot en live nedlasting 2.11.2026).
  const xml = readFileSync(new URL('../fixtures/eforms/n16-konkurranse-v1.xml', import.meta.url), 'utf8')
    .replace(':2023:eforms:national</cbc:CustomizationID>', ':2023:eforms:eu</cbc:CustomizationID>\n  <cbc:RegulatoryDomain>32014L0024</cbc:RegulatoryDomain>')
    .replaceAll(/<cbc:DurationMeasure unitCode="MONTH">\d+<\/cbc:DurationMeasure>/g, '<cbc:StartDate>2027-02-01Z</cbc:StartDate><cbc:EndDate>2028-12-31Z</cbc:EndDate>');
  const parsed = parseEformsXml(xml);
  assert.equal(parsed.variant, 'eu');
  assert.deepEqual(parsed.legalBasis[0], { id: '32014L0024', description: null });
  assert.deepEqual(parsed.lots[0]!.duration, { months: 23, text: 'ca. 23 måneder (01.02.2027–31.12.2028)' });
  const notice = eformsToNotice(parsed, { sourceNoticeId: '2026-1', sourceUrl: 'https://doffin.no/notices/2026-1', sha256: 'x', bytes: 1 });
  assert.equal(notice.details?.durationMonths, 23);
  assert.equal(notice.details?.contractStart?.slice(0, 10), '2027-02-01');
});

test('varighet fra datoer: hele måneder, og ingen gjetning ved manglende eller ugyldige datoer', () => {
  assert.equal(durationFromPeriod('2027-01-01', '2027-12-31')?.months, 12);
  assert.equal(durationFromPeriod('2027-01-01Z', '2027-01-31Z')?.months, 1);
  assert.equal(durationFromPeriod('2027-01-01', null), null);
  assert.equal(durationFromPeriod(null, '2027-12-31'), null);
  assert.equal(durationFromPeriod('2028-01-01', '2027-01-01'), null, 'slutt før start');
  assert.equal(durationFromPeriod('ugyldig', '2027-01-01'), null);
});
