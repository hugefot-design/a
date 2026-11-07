import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipAround, exampleProfile, scanCandidate } from '../../src/domain/tenders/showcase';

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
