/**
 * Skannet PDF med tekst fra OCR i kundens nettleser: serveren lagrer OCR-teksten for sidene uten tekst, merker
 * dokumentet, og ordsøket finner teksten. Uten OCR-tekst får kunden beskjed om hvordan det løses. OCR-tekst for en
 * PDF som har tekst, brukes ikke.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';
import { TINY_JPEG, imagePdf } from '../pdf-fixtures';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

const text = (html: string) => html.replaceAll('<!-- -->', '').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const ocrJson = (pages: { page: number; text: string }[]) => JSON.stringify({ engine: 'tesseract.js 7.0.0', languages: 'nor+eng', pages });

async function upload(c: Awaited<ReturnType<typeof clientFor>>, tenderId: string, pdf: Buffer, name: string, ocr?: string) {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(pdf)], name, { type: 'application/pdf' }));
  if (ocr !== undefined) form.append('ocr', ocr);
  const res = await c.postMultipart(`/app/anbud/${tenderId}/dokumenter`, form, `/app/anbud/${tenderId}`);
  assert.equal(res.status, 303);
  return text((await c.get(res.location!)).body);
}

test('skannet PDF med OCR-tekst: lagres, merkes og blir med i ordsøket', async () => {
  const notice = makeNotice({ title: 'Renhold av rådhuset (ocr-test)' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  const scanned = imagePdf([TINY_JPEG, TINY_JPEG]);
  const page = await upload(
    c,
    tenderId,
    scanned,
    'Skannet konkurransegrunnlag.pdf',
    ocrJson([
      { page: 1, text: 'Leverandøren skal ha et miljøledelsessystem sertifisert etter ISO 14001.' },
      { page: 2, text: 'Tilbudet skal leveres innen fristen. Tilbud som ikke oppfyller kravene, vil bli avvist.' },
    ]),
  );
  assert.match(page, /Dokumentet er lest \(2 sider\)\. 2 sider er lest med OCR i nettleseren – sjekk viktige tall mot dokumentet\./);
  assert.match(page, /2 sider lest – 2 med OCR i nettleseren, kan inneholde lesefeil/);
  assert.match(page, /ISO 14001/, 'ordsøket fant teksten');
  const [doc] = (await systemSql()`select text_status, ocr_pages, page_count from tender_documents where org_id = ${acc.orgId} and tender_id = ${tenderId}`) as unknown as {
    textStatus: string;
    ocrPages: number;
    pageCount: number;
  }[];
  assert.deepEqual([doc!.textStatus, doc!.ocrPages, doc!.pageCount], ['extracted', 2, 2]);
});

test('skannet PDF uten OCR-tekst: tydelig beskjed om hvordan det løses', async () => {
  const notice = makeNotice({ title: 'Renhold av skolen (ocr-test)' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const c = await clientFor(server.base, await createAccount());
  const page = await upload(c, tenderId, imagePdf([TINY_JPEG]), 'Skannet.pdf');
  assert.match(page, /Fant ingen tekst i dokumentet – det ser skannet ut\. Last opp PDF-en alene \(ikke i ZIP\), så leser nettleseren teksten med OCR\./);
  // Ugyldig OCR-felt behandles som om det ikke var der.
  assert.match(await upload(c, tenderId, imagePdf([TINY_JPEG]), 'Skannet2.pdf', '{"pages": "feil"}'), /det ser skannet ut/);
});

test('OCR-tekst for en PDF som har tekst, brukes ikke', async () => {
  const notice = makeNotice({ title: 'Renhold av biblioteket (ocr-test)' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  const pdf = readFileSync(new URL('../fixtures/konkurransegrunnlag-eksempel.pdf', import.meta.url));
  const page = await upload(c, tenderId, pdf, 'Med tekst.pdf', ocrJson([{ page: 1, text: 'OCR-tekst som ikke skal brukes for en side med ekte tekst.' }]));
  assert.ok(!/er lest med OCR i nettleseren|med OCR i nettleseren, kan inneholde lesefeil/.test(page), 'ingen sider lest med OCR');
  const pages = (await systemSql()`
    select p.content from tender_document_pages p join tender_documents d on d.id = p.document_id where d.org_id = ${acc.orgId} and d.tender_id = ${tenderId}
  `) as unknown as { content: string }[];
  assert.ok(pages.length > 0 && pages.every((p) => !p.content.includes('OCR-tekst som ikke skal brukes')));
});
