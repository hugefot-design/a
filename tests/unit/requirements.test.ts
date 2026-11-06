import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnalysisSource } from '../../src/domain/ai/sources';
import { scanRequirements, sourceLabel, splitSentences } from '../../src/domain/documents/requirements';

const notice: AnalysisSource = {
  id: 'S0',
  kind: 'notice',
  title: 'Kunngjøringen',
  totalPages: null,
  isPrivate: false,
  pages: [{ page: null, text: 'Tittel: Vakthold\n\nBeskrivelse:\nTilbud som ikke er levert innen fristen, vil bli avvist.' }],
};

const doc: AnalysisSource = {
  id: 'S1',
  kind: 'document',
  title: 'Konkurransegrunnlag.pdf',
  documentId: 'd1',
  totalPages: 3,
  isPrivate: true,
  pages: [
    { page: 1, text: 'Innhold\nAvvisning ........................ 12\nKvalifikasjonskrav ................ 8' },
    {
      page: 2,
      text:
        'Tilbud som ikke er levert innen fristen, vil bli avvist.\nOppdragsgiver skal avvise tilbud som inneholder vesentlige avvik fra\nkonkurransedokumentene.\n\n' +
        'Leverandøren skal ha en omsetning på minst 5 millioner kroner. Skatteattest skal vedlegges.\n' +
        '• ISO 9001-sertifikat eller tilsvarende for kvalitetsstyring.\n• Minstekrav: Alle vektere skal ha godkjent vekterutdanning.\n\nPrisen skal være oppgitt eks. mva.',
    },
    { page: 3, text: 'Det avholdes obligatorisk befaring 12. mai kl. 10.00 på rådhuset.\nTildelingskriterier: Pris 60 %, Kvalitet 40 %.\nTilbudet skal inneholde utfylt prisskjema (vedlegg 2).' },
  ],
};

test('kravsjekk: avvisning, minstekrav, kvalifikasjon, befaring, tildeling og krav til tilbudet – med side', () => {
  const scan = scanRequirements([notice, doc]);
  const texts = (k: keyof typeof scan.byKind) => scan.byKind[k].map((h) => h.text);
  assert.deepEqual(texts('avvisning'), [
    'Tilbud som ikke er levert innen fristen, vil bli avvist.',
    'Oppdragsgiver skal avvise tilbud som inneholder vesentlige avvik fra konkurransedokumentene.',
  ]);
  assert.equal(scan.byKind.avvisning[0]!.sourceId, 'S0', 'samme setning i kunngjøring og dokument vises én gang');
  assert.equal(scan.byKind.avvisning[1]!.page, 2);
  assert.deepEqual(texts('minstekrav'), ['• Minstekrav: Alle vektere skal ha godkjent vekterutdanning.']);
  assert.deepEqual(texts('kvalifikasjon'), [
    'Leverandøren skal ha en omsetning på minst 5 millioner kroner.',
    'Skatteattest skal vedlegges.',
    '• ISO 9001-sertifikat eller tilsvarende for kvalitetsstyring.',
  ]);
  assert.deepEqual(texts('befaring'), ['Det avholdes obligatorisk befaring 12. mai kl. 10.00 på rådhuset.']);
  assert.deepEqual(texts('tildeling'), ['Tildelingskriterier: Pris 60 %, Kvalitet 40 %.']);
  assert.deepEqual(texts('innlevering'), ['Tilbudet skal inneholde utfylt prisskjema (vedlegg 2).']);
  assert.ok(!JSON.stringify(scan).includes('......'), 'innholdsfortegnelsen er ikke krav');
  assert.ok(!JSON.stringify(scan).includes('eks. mva'), 'vanlige «skal»-setninger uten krav-ord er ikke med');
  assert.equal(scan.documents, 1);
  assert.equal(sourceLabel(scan.byKind.befaring[0]!), 'Konkurransegrunnlag.pdf, s. 3');
});

test('kravsjekk: kriteriene fra kunngjøringens egne felt kommer først og er merket', () => {
  const scan = scanRequirements([notice], { selectionCriteria: ['Omsetning siste år minst 10 MNOK'], awardCriteria: [{ name: 'Pris', weight: '60 %' }, { name: 'Kvalitet' }] });
  assert.deepEqual(scan.byKind.kvalifikasjon.map((h) => [h.text, h.structured]), [['Omsetning siste år minst 10 MNOK', true]]);
  assert.deepEqual(scan.byKind.tildeling.map((h) => h.text), ['Pris – vekt 60 %', 'Kvalitet']);
  assert.equal(sourceLabel(scan.byKind.tildeling[0]!), 'Kunngjøringen (eget felt)');
});

test('kravsjekk: vanlige formuleringer for økonomi og vekting', () => {
  const src: AnalysisSource = {
    ...doc,
    pages: [
      {
        page: 4,
        text:
          'Krav til økonomisk kapasitet: omsetning over 5 millioner kroner siste år.\nPris vektes 40 %. Kvalitet vektes 60 %.\n' +
          'Leverandøren må ha tillatelse etter vaktvirksomhetsloven.\n2. Kvalifikasjonskrav',
      },
    ],
  };
  const scan = scanRequirements([src]);
  assert.deepEqual(scan.byKind.kvalifikasjon.map((h) => h.text), ['Krav til økonomisk kapasitet: omsetning over 5 millioner kroner siste år.']);
  assert.deepEqual(scan.byKind.tildeling.map((h) => h.text), ['Pris vektes 40 %.', 'Kvalitet vektes 60 %.'], 'korte setninger med vekt er med');
  assert.deepEqual(scan.byKind.innlevering.map((h) => h.text), ['Leverandøren må ha tillatelse etter vaktvirksomhetsloven.']);
  assert.equal(scan.total, 4, 'overskriften «2. Kvalifikasjonskrav» er ikke et krav');
  assert.equal(scan.pages, 1);
});

test('kravsjekk: setninger deles riktig og store dokumenter går raskt', () => {
  assert.deepEqual(splitSentences('Linje én fortsetter\npå neste linje. Ny setning her.\n\n1. Punkt én\n2. Punkt to'), [
    'Linje én fortsetter på neste linje.',
    'Ny setning her.',
    '1. Punkt én',
    '2. Punkt to',
  ]);
  const huge: AnalysisSource = { ...doc, pages: [{ page: 1, text: 'a '.repeat(300_000) + 'skal avvises' }] };
  const started = Date.now();
  scanRequirements([huge]);
  assert.ok(Date.now() - started < 2000, 'ingen katastrofal tilbakesporing');
  const many: AnalysisSource = { ...doc, pages: Array.from({ length: 50 }, (_, i) => ({ page: i + 1, text: `Tilbudet avvises dersom vedlegg ${i} mangler.` })) };
  const scan = scanRequirements([many]);
  assert.equal(scan.byKind.avvisning.length, 30, 'maks 30 vises per kategori');
  assert.equal(scan.counts.avvisning, 50, 'men alle telles');
});
