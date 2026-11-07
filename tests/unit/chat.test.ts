import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkClaims, mockTenderChat, tenderChatZ, type TenderChat } from '../../src/domain/ai/chat';
import type { AnalysisSource } from '../../src/domain/ai/sources';

const sources: AnalysisSource[] = [
  { id: 'S0', kind: 'notice', title: 'Kunngjøringen', totalPages: null, isPrivate: false, pages: [{ page: null, text: 'Vakthold ved rådhuset. Det er obligatorisk befaring 2. desember kl. 10.00.' }] },
  { id: 'D1', kind: 'document', title: 'Konkurransegrunnlag.pdf', totalPages: 2, isPrivate: true, pages: [{ page: 2, text: 'Leverandøren skal ha en årlig omsetning på minst 8 millioner kroner.' }] },
];

test('testmodus: svaret bygger på setningen som passer spørsmålet, med kilde og side', () => {
  const visit = mockTenderChat('Kreves det befaring?', sources);
  assert.equal(tenderChatZ.safeParse(visit).success, true);
  assert.equal(visit.not_in_sources, false);
  assert.deepEqual(visit.claims[0]!.source, { source_id: 'S0', page: null, quote: 'Det er obligatorisk befaring 2. desember kl. 10.00.' });
  const turnover = mockTenderChat('Hva er kravet til omsetning?', sources);
  assert.deepEqual(turnover.claims[0]!.source, { source_id: 'D1', page: 2, quote: 'Leverandøren skal ha en årlig omsetning på minst 8 millioner kroner.' });
  const unknown = mockTenderChat('Hvilken farge har logoen?', sources);
  assert.equal(unknown.not_in_sources, true);
  assert.deepEqual(unknown.claims, []);
});

test('kontroll: «står i kilden» bare når sitatet finnes ordrett – ellers ikke bekreftet; vurderinger er aldri fakta', () => {
  const data: TenderChat = {
    answer: 'Ja.',
    not_in_sources: false,
    claims: [
      { text: 'Befaring er obligatorisk.', basis: 'kilde', source: { source_id: 'S0', page: null, quote: 'obligatorisk befaring 2. desember' } },
      { text: 'Omsetningskravet er 20 millioner.', basis: 'kilde', source: { source_id: 'D1', page: 2, quote: 'omsetning på minst 20 millioner kroner' } },
      { text: 'Fra feil side.', basis: 'kilde', source: { source_id: 'D1', page: 9, quote: 'omsetning på minst 8 millioner' } },
      { text: 'Dette virker overkommelig.', basis: 'tolkning', source: { source_id: 'S0', page: null, quote: 'obligatorisk befaring 2. desember' } },
    ],
  };
  assert.deepEqual(
    checkClaims(data, sources).map((c) => c.verified),
    [true, false, false, false],
  );
});
