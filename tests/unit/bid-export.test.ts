/** Eksport av tilbudsutkast (Word og Markdown) – sikrer at docx-biblioteket fungerer etter oppgraderinger. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { toDocx, toMarkdown } from '../../src/domain/bids/export';
import type { Section, Workspace } from '../../src/domain/bids/bids';

const ws = {
  id: 'w',
  tenderId: 't',
  title: 'Tilbud',
  status: 'draft',
  ownerUserId: null,
  reviewRequestedAt: null,
  approvedBy: null,
  approvedAt: null,
  approvedByName: null,
  submittedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tenderTitle: 'Vintervedlikehold av kommunale veier (test)',
  buyerName: 'Fjordvik kommune (test)',
  deadlineAt: null,
  deadlineTimeKnown: false,
  sourceUrl: null,
  isSample: false,
} satisfies Workspace;

const sections: Section[] = [
  { id: 's1', title: 'Gjennomføring', requirement: 'Beskriv bemanning', content: 'Vi stiller med to mannskaper.\nBeredskap hele døgnet.\n\n[FYLL INN: referanser]', aiAssisted: true, updatedAt: new Date(), updatedByName: null },
  { id: 's2', title: 'Pris', requirement: null, content: '', aiAssisted: false, updatedAt: new Date(), updatedByName: null },
];

test('Word-eksport: gyldig .docx med tittel, utkastmerking, krav, linjeskift og tomme kapitler', async () => {
  const buf = await toDocx(ws, sections);
  assert.equal(buf.subarray(0, 2).toString(), 'PK', 'docx er en ZIP-fil');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  assert.match(xml, /Vintervedlikehold av kommunale veier \(test\)/);
  assert.match(xml, /UTKAST – ikke godkjent/, 'utkast merkes tydelig');
  assert.match(xml, /Krav: Beskriv bemanning/);
  assert.match(xml, /<w:br\/>/, 'linjeskift i avsnitt bevares');
  assert.match(xml, /\(tom\)/);
  assert.ok(zip.file('docProps/core.xml'), 'metadata finnes');
});

test('Markdown-eksport: kapitler, krav og sjekkliste', () => {
  const md = toMarkdown(ws, sections, [{ id: 'c', label: 'Skatteattest', isDone: true } as never]);
  assert.match(md, /^# Vintervedlikehold/);
  assert.match(md, /> UTKAST – ikke godkjent/);
  assert.match(md, /- \[x\] Skatteattest/);
});
