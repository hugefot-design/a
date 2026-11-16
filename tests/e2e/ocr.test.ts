/**
 * OCR i ekte nettleser (Chromium): en skannet PDF (bilde av norsk tekst, uten tekstlag) leses med Tesseract.js i
 * nettleseren, teksten sendes med opplastingen og blir med i ordsøket. Alt hentes fra vår egen server – ingen
 * forespørsler til andre nettsteder. En PDF med tekst gir ingen OCR.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { createSession, SESSION_COOKIE } from '../../src/domain/auth/auth';
import { createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';
import { imagePdf } from '../pdf-fixtures';

let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
const BASE = new URL(env.APP_URL).origin;

before(async () => {
  server = await startServer(Number(new URL(env.APP_URL).port));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
});
after(async () => {
  await browser?.close();
  await server.close();
  await closeDb();
});

/** «Skanner» en side: norsk tekst gjengitt som bilde (JPEG), slik en skanner leverer den. */
async function scannedPage(lines: string[]): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: 1 });
  const body = lines.map((l) => `<p>${l}</p>`).join('');
  await page.setContent(`<html><body style="margin:120px;background:#fff;color:#111;font:34px/1.5 'DejaVu Sans',Arial,sans-serif">${body}</body></html>`);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
  await page.close();
  return jpeg;
}

test('skannet PDF: OCR i nettleseren, teksten lagres og ordsøket finner den – uten eksterne forespørsler', async () => {
  const notice = makeNotice({ title: 'Renhold av kulturhuset (ocr-e2e)' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const acc = await createAccount();
  const { token } = await createSession(acc.user.id, { userAgent: 'e2e-ocr' });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });

  const pdf = imagePdf([
    await scannedPage([
      'KONKURRANSEGRUNNLAG',
      'Det er obligatorisk befaring 2. desember kl. 10.00.',
      'Leverandøren skal ha et miljøledelsessystem sertifisert etter ISO 14001.',
      'Tilbudsfristen er 15. januar 2027 kl. 12.00.',
    ]),
  ]);

  await page.goto(`${BASE}/app/anbud/${tenderId}`, { waitUntil: 'networkidle' });
  await page.setInputFiles('form[data-ocr] input[type="file"]', { name: 'Skannet konkurransegrunnlag.pdf', mimeType: 'application/pdf', buffer: pdf });
  const status = page.locator('[data-ocr-status]');
  await status.getByText(/Ferdig:/).waitFor({ timeout: 180_000 });
  assert.match(await status.innerText(), /1 side lest med OCR/);
  const ocr = JSON.parse(await page.locator('form[data-ocr] input[name="ocr"]').inputValue()) as { pages: { page: number; text: string }[] };
  assert.equal(ocr.pages.length, 1);
  assert.match(ocr.pages[0]!.text, /befaring/i, `OCR-teksten: ${ocr.pages[0]!.text.slice(0, 200)}`);

  await Promise.all([page.waitForURL(`${BASE}/app/anbud/${tenderId}`), page.locator('form[data-ocr] button').click()]);
  const text = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
  assert.match(text, /1 side er lest med OCR i nettleseren/);
  assert.match(text, /1 side lest – 1 med OCR i nettleseren, kan inneholde lesefeil/);
  const pages = (await systemSql()`
    select p.content from tender_document_pages p join tender_documents d on d.id = p.document_id
    where d.org_id = ${acc.orgId} and d.tender_id = ${tenderId} and d.ocr_pages = 1
  `) as unknown as { content: string }[];
  const stored = pages.map((p) => p.content).join('\n');
  assert.match(stored, /obligatorisk befaring/i, `lagret OCR-tekst: ${stored.slice(0, 400)}`);
  // Målt: alt leses riktig, også æ/ø, datoer og klokkeslett – men «ISO» blir ofte «150» (vanlig OCR-feil med I/O mot 1/0).
  // Derfor sier siden at teksten kan inneholde lesefeil, og at viktige tall må sjekkes mot dokumentet.
  assert.match(stored, /obligatorisk befaring 2\. desember kl\. 10\.00/);
  assert.match(stored, /miljøledelsessystem sertifisert/);
  assert.match(stored, /Tilbudsfristen er 15\. januar 2027 kl\. 12\.00/);

  assert.deepEqual(foreign, [], 'ingen forespørsler til andre nettsteder (motor, språkdata og pdf.js hentes fra oss)');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('PDF med tekst: ingen OCR', async () => {
  const notice = makeNotice({ title: 'Renhold av svømmehallen (ocr-e2e)' });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const acc = await createAccount();
  const { token } = await createSession(acc.user.id, { userAgent: 'e2e-ocr' });
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app/anbud/${tenderId}`, { waitUntil: 'networkidle' });
  const pdf = readFileSync(new URL('../fixtures/konkurransegrunnlag-eksempel.pdf', import.meta.url));
  await page.setInputFiles('form[data-ocr] input[type="file"]', { name: 'Med tekst.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('[data-ocr-status]').isHidden(), true, 'ingen OCR-melding');
  assert.equal(await page.locator('form[data-ocr] input[name="ocr"]').inputValue(), '');
  await ctx.close();
});
