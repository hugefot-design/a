import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipAround, exampleProfile, exampleQuality, goodQuote, readableTitle, scanCandidate, splitOutliers } from '../../src/domain/tenders/showcase';
import { displayBuyer } from '../../src/domain/tenders/market';
import { scanRequirements } from '../../src/domain/documents/requirements';
import { scanContractTerms } from '../../src/domain/profit/terms-scan';

test('clipAround: kort utdrag rundt treffordet, kuttet ved hele ord', () => {
  const long = `${'Innledende tekst om oppdraget. '.repeat(8)}Tilbud som ikke oppfyller kravene vil bli avvist uten videre vurdering. ${'Avsluttende tekst. '.repeat(8)}`;
  const out = clipAround(long, 'avvist', 120);
  assert.ok(out.includes('avvist'), out);
  assert.ok(out.length <= 126, `${out.length}`);
  assert.ok(out.startsWith('… ') && out.endsWith(' …'), out);
  assert.equal(clipAround('Kort setning.', 'Kort'), 'Kort setning.');
});

test('scanCandidate: samme ordsøk som appen – krav, avvisning og kostbare vilkår, ikke nektelser', () => {
  const r = scanCandidate({
    description:
      'Tilbud som leveres for sent, vil bli avvist. Leverandøren må dokumentere ISO 14001. Det er obligatorisk befaring 3. desember. ' +
      'Ved forsinkelse påløper dagbot på 1 promille per dag. Det vil ikke bli krevd bankgaranti.',
    selectionCriteria: null,
  });
  const kinds = r.requirements.map((x) => x.kind);
  assert.ok(kinds.includes('avvisning') && kinds.includes('kvalifikasjon') && kinds.includes('befaring'), kinds.join(','));
  assert.ok(r.requirements.every((x) => x.text.includes(x.match)), 'treffordet står i utdraget');
  assert.deepEqual(
    r.terms.map((t) => t.kind),
    ['dagbot'],
    'nektelsen («vil ikke bli krevd bankgaranti») vises ikke som kostbart vilkår',
  );
});

test('exampleProfile: bare bransje og fylke – ingen ekte kundedata', () => {
  const p = exampleProfile('construction', '46');
  assert.deepEqual(p.industries, ['construction']);
  assert.deepEqual(p.regions, ['46']);
  assert.deepEqual(p.certifications, []);
  assert.equal(p.keywords.length, 0);
});

// Standardtekst og henvisninger slik de ofte står i ekte kunngjøringer: ordsøket i appen treffer, men setningene
// sier ikke kunden noe om kravet. Forsiden skal ikke vise dem (og ikke kalle en standardkontrakt et kostbart vilkår).
const BOILERPLATE =
  'I denne anskaffelsen benyttes eBevis for å innhente opplysninger knyttet til kvalifikasjonskrav og avvisningsgrunner. ' +
  'Kvalifikasjonskrav med tilhørende dokumentasjonskrav følger under kravspesifikasjonen. ' +
  'En eventuell forlengelse av tilbudets vedståelsesfrist kan bare skje dersom leverandøren godkjenner dette. ' +
  'Følgende kontraktsvilkår legges til grunn for rammeavtalen: SSA-R med bilag 1-7.';

test('goodQuote: bare setninger som sier noe konkret – ikke henvisninger og standardtekst', () => {
  // «Avvisning» bare når setningen sier at noe avvises – ikke når ordet «avvisningsgrunner» bare nevnes.
  assert.equal(goodQuote('avvisning', 'I denne anskaffelsen benyttes eBevis for å innhente opplysninger knyttet til kvalifikasjonskrav og avvisningsgrunner.'), false);
  assert.equal(goodQuote('avvisning', 'Opplysninger om avvisningsgrunner gis i egenerklæringen.'), false);
  assert.equal(goodQuote('avvisning', 'Tilbud som leveres etter fristen, vil bli avvist.'), true);
  assert.equal(goodQuote('avvisning', 'Oppdragsgiver skal avvise tilbud som inneholder vesentlige avvik.'), true);
  // Kvalifikasjon: konkret innhold, ikke en henvisning.
  assert.equal(goodQuote('kvalifikasjon', 'Kvalifikasjonskrav med tilhørende dokumentasjonskrav følger under kravspesifikasjonen.'), false);
  assert.equal(goodQuote('kvalifikasjon', 'Leverandøren må beskrive sin tekniske og faglige kapasitet.'), true, '«må» gjenkjennes (\\b virker ikke for å)');
  assert.equal(goodQuote('kvalifikasjon', 'Det stilles kvalifikasjonskrav til leverandøren.'), false, 'for vagt');
  // Befaring og frister: dato, tall eller obligatorisk – ikke «befaring ved behov» eller en generell setning.
  assert.equal(goodQuote('befaring', 'En eventuell forlengelse av tilbudets vedståelsesfrist kan bare skje dersom leverandøren godkjenner dette.'), false);
  assert.equal(goodQuote('befaring', 'Oppdraget omfatter befaring og teknisk rådgivning ved behov.'), false);
  assert.equal(goodQuote('befaring', 'Det er obligatorisk befaring 3. desember kl. 10.00.'), true);
  assert.equal(goodQuote('befaring', 'Vedståelsesfristen er 3 måneder etter tilbudsfristen.'), true);
});

test('scanCandidate: appen finner treff i standardtekst, men forsiden viser dem ikke', () => {
  const source = { id: 'S0', kind: 'notice' as const, title: 'K', pages: [{ page: null, text: BOILERPLATE }], totalPages: null, isPrivate: false };
  const raw = scanRequirements([source], { selectionCriteria: [] });
  for (const k of ['avvisning', 'kvalifikasjon', 'befaring'] as const) assert.ok(raw.byKind[k].length > 0, `appen finner ${k}`);
  assert.ok(scanContractTerms([source]).hits.some((h) => h.category === 'standardkontrakt'), 'appen finner standardkontrakten');
  const r = scanCandidate({ description: BOILERPLATE, selectionCriteria: null });
  assert.deepEqual(r.requirements, [], 'ingen av setningene er gode eksempler');
  assert.deepEqual(r.terms, [], 'en standardkontrakt er ikke et kostbart vilkår');
});

test('readableTitle: titler som mest er koder vises sist', () => {
  assert.equal(readableTitle('2799k ATC gruppe A16AX08'), false);
  assert.equal(readableTitle('Bedriftshelsetjenester'), true);
  assert.equal(readableTitle('Rehabilitering av E18 ved Sandvika'), true, 'én kode er greit');
  assert.equal(readableTitle('Rammeavtale 2026–2028 for renhold'), true);
});

test('exampleQuality: et norsk eksempel med to gode krav går alltid foran et engelsk', () => {
  const nbText = 'Tilbud som leveres for sent, vil bli avvist. Leverandøren må dokumentere ISO 14001 for arbeidet som skal utføres.';
  const enText =
    'Tenders received after the deadline will be rejected. The tenderer must document ISO 9001 certification. ' +
    'There is a mandatory site visit on 3 December at 10:00. Liquidated damages of 1 per mille per day apply for the delay.';
  const nb = { title: 'Rehabilitering av skole', description: nbText, ...scanCandidate({ description: nbText, selectionCriteria: null }) };
  const en = { title: 'Rehabilitation of the school', description: enText, ...scanCandidate({ description: enText, selectionCriteria: null }) };
  assert.equal(nb.requirements.length, 2, JSON.stringify(nb.requirements));
  assert.ok(en.requirements.length >= 2, JSON.stringify(en.requirements));
  // Også når det engelske i tillegg har markedspris og kontraktsutløp (+6).
  assert.ok(exampleQuality(nb) > exampleQuality(en) + 6, `${exampleQuality(nb)} mot ${exampleQuality(en)}`);
});

test('displayBuyer: navn med bare store bokstaver får små småord', () => {
  assert.equal(displayBuyer('BARNE-, UNGDOMS- OG FAMILIEDIREKTORATET'), 'Barne-, Ungdoms- og Familiedirektoratet');
  assert.equal(displayBuyer('UNIVERSITETET I OSLO'), 'Universitetet i Oslo');
  assert.equal(displayBuyer('HELSE SØR-ØST RHF'), 'Helse Sør-Øst RHF');
  assert.equal(displayBuyer('STATSBYGG'), 'Statsbygg');
  assert.equal(displayBuyer('Moss kommune'), 'Moss kommune', 'vanlig skrivemåte endres ikke');
});

test('splitOutliers: én svært stor kontrakt tegnes ikke inn, men oppgis (som i produksjonen 7.11.2026)', () => {
  const mill = 1_000_000;
  const values = [1.2, 2.1, 2.8, 3.5, 4.4, 5.0, 5.7, 6.3, 8.0, 9.9, 12, 15, 19, 24, 27.1, 31, 38, 45, 60].map((v) => v * mill);
  const { shown, hidden } = splitOutliers([...values, 11_000 * mill], 2.8 * mill, 27.1 * mill);
  assert.deepEqual(hidden, { n: 1, above: 100 * mill }, 'grensen rundes til to sifre: 27,1 + 3 × 24,3 = 100 mill.');
  assert.deepEqual(shown, values, 'alle de andre tegnes inn');
  // Midtre halvdel lik null: grensen er minst 2,5 × øvre kvartil.
  const flat = splitOutliers([5, 5, 5, 5, 50].map((v) => v * mill), 5 * mill, 5 * mill);
  assert.deepEqual(flat.hidden, { n: 1, above: 13 * mill });
  // Ingen ekstreme verdier: alt tegnes inn.
  assert.deepEqual(splitOutliers([1, 2, 3].map((v) => v * mill), 1.5 * mill, 2.5 * mill), { shown: [1, 2, 3].map((v) => v * mill), hidden: null });
});
