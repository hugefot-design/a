/**
 * OCR-tekst fra kundens nettleser: serveren tar den bare inn for sider uten tekst som finnes i PDF-en, og avviser alt
 * som ikke har riktig form eller er for stort.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_OCR_PAGES, MAX_OCR_PAYLOAD_CHARS, mergeOcrPages, parseOcrPayload } from '../../src/domain/documents/ocr';

const payload = (pages: { page: number; text: string }[]) => JSON.stringify({ engine: 'tesseract.js 7.0.0', languages: 'nor+eng', pages });

test('gyldig OCR-svar leses; feil form, ugyldig JSON, for mange sider og for stort svar avvises', () => {
  assert.equal(parseOcrPayload(payload([{ page: 1, text: 'Tilbudsfrist 1. desember' }]))?.pages.length, 1);
  assert.equal(parseOcrPayload(''), null);
  assert.equal(parseOcrPayload(null), null);
  assert.equal(parseOcrPayload('{ikke json'), null);
  assert.equal(parseOcrPayload(JSON.stringify({ pages: [] })), null, 'mangler motor og språk');
  assert.equal(parseOcrPayload(payload([{ page: 0, text: 'x' }])), null, 'sidetall fra 1');
  assert.equal(parseOcrPayload(payload(Array.from({ length: MAX_OCR_PAGES + 1 }, (_, i) => ({ page: i + 1, text: 'x' })))), null);
  assert.equal(parseOcrPayload(payload([{ page: 1, text: 'x'.repeat(20_001) }])), null, 'for lang side');
  assert.equal(parseOcrPayload('x'.repeat(MAX_OCR_PAYLOAD_CHARS + 1)), null);
});

test('OCR brukes bare for sider uten tekst, og bare for sider som finnes i PDF-en', () => {
  const extracted = {
    totalPages: 3,
    pages: [
      { page: 1, text: 'Konkurransegrunnlag for drift av kommunale bygg – side med ekte tekst fra PDF-en.' },
      { page: 2, text: '' },
      { page: 3, text: '  ' },
    ],
  };
  const ocr = parseOcrPayload(
    payload([
      { page: 1, text: 'OCR skal ikke erstatte ekte tekst' },
      { page: 2, text: 'Det er obligatorisk befaring 2. desember.\u0007' },
      { page: 3, text: '   ' },
      { page: 9, text: 'Side som ikke finnes' },
    ]),
  );
  const merged = mergeOcrPages(extracted, ocr);
  assert.equal(merged.ocrPages, 1);
  assert.deepEqual(
    merged.pages.map((p) => [p.page, p.text]),
    [
      [1, 'Konkurransegrunnlag for drift av kommunale bygg – side med ekte tekst fra PDF-en.'],
      [2, 'Det er obligatorisk befaring 2. desember.'],
      [3, '  '],
    ],
  );
  assert.deepEqual(mergeOcrPages(extracted, null), { pages: extracted.pages, ocrPages: 0 });
});
