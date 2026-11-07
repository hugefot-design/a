import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanContractTerms, type TermCategory } from '../../src/domain/profit/terms-scan';

const scan = (text: string) =>
  scanContractTerms([{ id: 'D1', kind: 'document', title: 'Vilkår.pdf', pages: [{ page: 4, text }], totalPages: 4, isPrivate: true }]);
const found = (text: string) => Object.keys(scan(text).byCategory).sort() as TermCategory[];

test('skjulte kostnader: lønns- og arbeidsvilkår, lærlinger og kontraktskjede', () => {
  for (const text of [
    'Leverandøren skal sørge for at ansatte har lønns- og arbeidsvilkår i samsvar med allmenngjort tariffavtale.',
    'Minst én lærling skal være tilknyttet oppdraget.',
    'Det tillates maksimalt to ledd i kontraktskjeden.',
    'Alle ansatte skal bære HMS-kort.',
    'Oppdragsgiver har påseplikt etter forskriften.',
  ]) {
    assert.deepEqual(found(text), ['arbeidsvilkar'], text);
  }
  const hit = scan('Leverandøren skal sørge for lønns- og arbeidsvilkår etter forskriften.').byCategory.arbeidsvilkar![0]!;
  assert.equal(hit.page, 4);
  assert.match(hit.snippet, /lønns- og arbeidsvilkår/);
});

test('skjulte kostnader: miljø- og klimakrav – uten falske treff på «hvordan» og «Euro 60 000»', () => {
  for (const text of [
    'Alle kjøretøy skal være utslippsfrie fra oppstart.',
    'Anleggsmaskiner skal være elektriske maskiner eller bruke HVO.',
    'Biler skal minst oppfylle Euro 6.',
    'Det stilles miljøkrav til renholdsmidler (Svanemerket eller tilsvarende).',
  ]) {
    assert.deepEqual(found(text), ['miljokrav'], text);
  }
  assert.deepEqual(found('Beskriv hvordan dere vil løse oppdraget innenfor Euro 60 000.'), []);
});

test('skjulte kostnader: rapportering og oppstart/virksomhetsoverdragelse', () => {
  assert.deepEqual(found('Leverandøren skal levere månedlig rapport om avvik og timeforbruk.'), ['rapportering']);
  assert.deepEqual(found('Det holdes statusmøte hver uke.'), ['rapportering']);
  assert.deepEqual(found('Oppdraget kan utgjøre en virksomhetsoverdragelse etter arbeidsmiljøloven kapittel 16.'), ['oppstart']);
  assert.deepEqual(found('Innfasingsperioden er seks uker.'), ['oppstart']);
  assert.deepEqual(found('Leverandøren må overta ansatte fra dagens leverandør.'), ['oppstart']);
});

test('de nye kategoriene står som «ikke funnet» når teksten ikke nevner dem', () => {
  const s = scan('Kort tekst om vakthold.');
  for (const c of ['arbeidsvilkar', 'miljokrav', 'rapportering', 'oppstart'] as TermCategory[]) assert.ok(s.notFound.includes(c), c);
});
