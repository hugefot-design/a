/**
 * «Vis mer» i ekte nettleser (Chromium): en lenke til noe som er foldet sammen, åpner det, og det som er åpnet, lukkes
 * ikke når man klikker et annet sted på siden. Uten JavaScript virker <details> som vanlig.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { startServer } from '../helpers';

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

test('lenke til et sammenfoldet tema (/metode#treff) åpner det', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/metode#treff`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('details#treff').getAttribute('open'), '', 'temaet er åpent');
  assert.equal(await page.locator('details#kilder').getAttribute('open'), null, 'de andre er lukket');
  assert.ok(await page.getByText('ikke sjansen for å vinne').isVisible());
  // Etter at siden er lastet: en lenke til et annet tema åpner det også.
  await page.evaluate(() => (location.hash = '#markedspris'));
  await page.waitForFunction(() => (document.getElementById('markedspris') as HTMLDetailsElement | null)?.open === true);
  assert.deepEqual(errors, []);
  await page.close();
});

test('«Vis mer» lukkes ikke av klikk andre steder (men menyer gjør det fortsatt)', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/priser`, { waitUntil: 'networkidle' });
  const compare = page.locator('details:has(h2:text("Sammenlign planer"))');
  await compare.locator('summary').click();
  assert.equal(await compare.getAttribute('open'), '');
  await page.locator('h1').click();
  assert.equal(await compare.getAttribute('open'), '', 'fortsatt åpen');
  await page.close();
});
