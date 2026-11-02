import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eformsFacts, isEnvironmentNonCriterion, type EformsSourceSummary } from '../../src/domain/tenders/eforms-facts';
import { eformsRawSummary, parseEformsXml } from '../../src/connectors/eforms';
import { noticeSource } from '../../src/domain/ai/analysis';
import type { TenderDetail } from '../../src/domain/tenders/queries';

const ANSKAFFELSESFORSKRIFTEN = 'https://lovdata.no/dokument/SF/forskrift/2016-08-12-974';

function summaryOf(fixture: string): EformsSourceSummary {
  const xml = readFileSync(new URL(`../fixtures/eforms/${fixture}`, import.meta.url), 'utf8');
  return eformsRawSummary(parseEformsXml(xml), { sourceNoticeId: '2026-1', sourceUrl: 'https://doffin.no/notices/2026-1', sha256: 'x', bytes: 1 });
}

test('regelverk fra nasjonal kunngjøring (N16): terskel, forskrift med Lovdata-lenke og klimakriterium', () => {
  const f = eformsFacts(summaryOf('n16-konkurranse-v1.xml'))!;
  assert.equal(f.noticeKind?.label, 'Nasjonal kunngjøring (bare i Doffin)');
  assert.match(f.noticeKind!.hint, /under EØS-terskelverdiene/);
  assert.equal(f.subtype, 'Skjema N16');
  assert.deepEqual(f.legalBasis, [{ label: 'Anskaffelsesforskriften', url: ANSKAFFELSESFORSKRIFTEN, description: 'Del 1 og 2' }]);
  assert.deepEqual(f.environment, ['Klima- og miljøhensyn (tildelingskriterium) – 30\u00a0%'], 'samme kriterium i to delkontrakter vises én gang (hardt mellomrom før %)');
  assert.deepEqual(f.strategic, ['Redusere miljøpåvirkning']);
  assert.equal(f.eSubmission, 'Påkrevd');
});

test('regelverk fra EU-kunngjøring og ukjente koder: lenker bare til kjente forskrifter', () => {
  const f = eformsFacts({
    variant: 'eu',
    noticeSubtype: '16',
    legalBasis: [
      { id: '32014L0025', description: null },
      { id: '32009L0081', description: null },
      { id: 'other', description: 'Lokal forskrift om noe annet' },
      { id: 'https://evil.example/eli/forskrift/2016/8/12/974', description: null },
      { id: '32014L0025', description: null },
    ],
    strategicProcurement: ['none', 'soc-obj', 'ukjent-kode'],
    environmentalCriteria: [{ type: 'quality-nor-env-exempt-insignificant', weight: null, weightKind: null }],
    eSubmission: 'allowed',
  })!;
  assert.equal(f.noticeKind?.label, 'EU-kunngjøring (også i TED)');
  assert.equal(f.subtype, 'Skjema 16');
  assert.deepEqual(f.legalBasis, [
    { label: 'Forsyningsforskriften', url: 'https://lovdata.no/dokument/SF/forskrift/2016-08-12-975', description: 'Direktiv 2014/25/EU (forsyningssektorene)' },
    { label: 'Direktiv 2009/81/EF (forsvar og sikkerhet)', url: null, description: null },
    { label: 'Lokal forskrift om noe annet', url: null, description: null },
    { label: 'https://evil.example/eli/forskrift/2016/8/12/974', url: null, description: null },
  ]);
  assert.deepEqual(f.environment, ['Klima- og miljøhensyn: unntak (ubetydelig miljøbelastning)']);
  assert.deepEqual(f.strategic, ['Sosiale formål'], '«none» og ukjente koder vises ikke');
  assert.equal(f.eSubmission, 'Tillatt');
});

test('uten full kunngjøring: ingen regelverksfakta; klimakrav i spesifikasjonen er ikke tildelingskriterium', () => {
  assert.equal(eformsFacts(null), null);
  const empty = eformsFacts({ variant: 'unknown', noticeSubtype: null, legalBasis: null, strategicProcurement: null, environmentalCriteria: null, eSubmission: null })!;
  assert.deepEqual(empty, { noticeKind: null, subtype: null, legalBasis: [], environment: [], strategic: [], eSubmission: null });
  assert.equal(isEnvironmentNonCriterion('quality-nor-env-spec'), true);
  assert.equal(isEnvironmentNonCriterion('quality-nor-env-exempt-critical-interest'), true);
  assert.equal(isEnvironmentNonCriterion('quality-nor-env-criteria'), false);
  assert.equal(isEnvironmentNonCriterion('price'), false);
  assert.equal(isEnvironmentNonCriterion(null), false);
});

test('AI-en får ikke klimakrav i spesifikasjonen eller unntak presentert som tildelingskriterier', () => {
  const tender = {
    title: 'Test',
    buyerName: null,
    placeText: null,
    cpvCodes: [],
    contractNature: null,
    procedureType: null,
    isFramework: null,
    estimatedValue: null,
    currency: null,
    deadlineAt: null,
    questionsDeadlineAt: null,
    durationText: null,
    contractStart: null,
    contractEnd: null,
    publishedAt: null,
    documentsUrl: null,
    description: null,
    lots: [],
    selectionCriteria: [],
    textLanguage: 'nb',
    awardCriteria: [
      { name: 'Pris', type: 'price', weight: '70 %' },
      { name: 'Klima- og miljøhensyn (krav i spesifikasjonen)', type: 'quality-nor-env-spec', weight: null },
    ],
  } as unknown as TenderDetail;
  const text = noticeSource(tender).pages[0]!.text;
  const criteria = text.split('Tildelingskriterier (fra kunngjøringen):')[1]!.split('\n\n')[0]!;
  assert.match(criteria, /- Pris – vekt 70 %/);
  assert.doesNotMatch(criteria, /krav i spesifikasjonen/);
  assert.match(text, /Klima og miljø \(fra kunngjøringen, ikke tildelingskriterium\):\n- Klima- og miljøhensyn \(krav i spesifikasjonen\)/);
});
