/**
 * Ende-til-ende i ekte nettleser: administrator logger inn med passord og kode (kodeboksen sender
 * selv ved seks siffer), legger til Face ID / fingeravtrykk (virtuell autentikator i Chromium),
 * logger ut og inn igjen med passkey, og bekrefter med passkey etter 12 timer.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { ageMfaVerification, createAccount, makeAdmin, startServer, testTotpCode } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
const BASE = new URL(env.APP_URL).origin;
const SHOTS = process.env.E2E_SCREENSHOT_DIR;

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

function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 40[13]/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test('admin: kode, legg til Face ID / fingeravtrykk, logg inn med passkey', async () => {
  const admin = await createAccount();
  await makeAdmin(admin.user.id);
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = watch(page);

  // Virtuell autentikator: oppfører seg som Touch ID / Windows Hello som alltid godkjenner.
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // 1. Passord, så kode. Kodeboksen sender skjemaet selv når seks siffer er skrevet.
  await page.goto(`${BASE}/logg-inn`);
  await page.fill('#email', admin.email);
  await page.fill('#password', admin.password);
  await Promise.all([page.waitForURL('**/logg-inn'), page.getByRole('button', { name: 'Logg inn', exact: true }).click()]);
  await page.locator('#code').waitFor();
  assert.equal(await page.locator('[data-passkey-start]').count(), 0, 'ingen passkey-knapp før en passkey er lagt til');
  await shot(page, '1-kodeside');
  await Promise.all([page.waitForURL('**/admin'), page.locator('#code').pressSequentially(await testTotpCode(admin.user.id))]);

  // 2. Legg til passkey fra totrinnssiden.
  await page.goto(`${BASE}/konto/totrinn`);
  const add = page.getByRole('button', { name: /Legg til Face ID/ });
  await add.waitFor({ state: 'visible' });
  await shot(page, '2-status');
  await page.fill('#passkey-name', 'Testmaskin');
  await Promise.all([page.waitForURL('**/konto/totrinn**'), add.click()]);
  await page.getByText('«Testmaskin» er lagt til').waitFor();
  assert.match((await page.locator('#passkeys').textContent()) ?? '', /Testmaskin/);

  // 3. Logg ut og inn igjen: passord, så Face ID / fingeravtrykk i stedet for kode.
  await context.clearCookies();
  await page.goto(`${BASE}/logg-inn`);
  await page.fill('#email', admin.email);
  await page.fill('#password', admin.password);
  await Promise.all([page.waitForURL('**/logg-inn'), page.getByRole('button', { name: 'Logg inn', exact: true }).click()]);
  const passkeyButton = page.getByRole('button', { name: /Bruk Face ID/ });
  await passkeyButton.waitFor({ state: 'visible' });
  await shot(page, '3-kodeside-med-passkey');
  await Promise.all([page.waitForURL('**/admin'), passkeyButton.click()]);
  assert.match((await page.locator('h1').first().textContent()) ?? '', /\S/);

  // 4. Etter 12 timer: «bekreft at det er deg» med passkey.
  await ageMfaVerification(admin.user.id, 13 * 60);
  await page.goto(`${BASE}/admin/brukere`);
  await page.waitForURL('**/konto/bekreft**');
  await shot(page, '4-bekreft');
  await Promise.all([page.waitForURL('**/admin/brukere'), page.getByRole('button', { name: /Bruk Face ID/ }).click()]);

  assert.deepEqual(errors, []);
  await context.close();
});

test('mobil: kodesiden og bekreftelsessiden uten horisontal rulling', async () => {
  const admin = await createAccount();
  await makeAdmin(admin.user.id);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(`${BASE}/logg-inn`);
  await page.fill('#email', admin.email);
  await page.fill('#password', admin.password);
  await Promise.all([page.waitForURL('**/logg-inn'), page.getByRole('button', { name: 'Logg inn', exact: true }).click()]);
  await page.locator('#code').waitFor();
  assert.equal(await page.locator('#code').getAttribute('inputmode'), 'numeric', 'talltastatur på mobil');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(page, '5-mobil-kode');
  await Promise.all([page.waitForURL('**/admin'), page.locator('#code').fill(await testTotpCode(admin.user.id))]);
  await page.goto(`${BASE}/konto/totrinn`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(page, '6-mobil-status');
  assert.deepEqual(errors, []);
  await context.close();
});
