/**
 * Lys og mørk modus i ekte nettleser (Playwright/Chromium):
 * - uten valg følger siden enheten (prefers-color-scheme),
 * - bryteren bytter tema, valget huskes etter ny innlasting (satt i <head>, før siden tegnes),
 * - «Automatisk» under Innstillinger fjerner valget,
 * - uten JavaScript vises ingen bryter, men siden følger fortsatt enheten,
 * - vis/skjul passord på innloggingssiden.
 *
 * Nettleser: PLAYWRIGHT_CHROMIUM_PATH hvis satt, ellers Playwrights egen Chromium.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { createSession, SESSION_COOKIE } from '../../src/domain/auth/auth';
import { createAccount, startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
const BASE = new URL(env.APP_URL).origin;
const LIGHT_SURFACE = 'rgb(255, 255, 255)';
const DARK_SURFACE = 'rgb(16, 28, 48)';

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

/** Fargen på flatene (kroppen bruker «surface»). */
const surface = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const themeAttr = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

test('uten valg følger siden enheten – lys og mørk', async () => {
  for (const [scheme, expected] of [['light', LIGHT_SURFACE], ['dark', DARK_SURFACE]] as const) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/priser`);
    assert.equal(await themeAttr(page), null, 'ingen valg lagret');
    assert.equal(await surface(page), expected, scheme);
    assert.equal(await page.locator('[data-theme-toggle]').first().getAttribute('aria-pressed'), String(scheme === 'dark'));
    await ctx.close();
  }
});

test('bryteren bytter tema, og valget huskes etter ny innlasting', async () => {
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/logg-inn`);
  const toggle = page.locator('[data-theme-toggle]').first();
  await toggle.click();
  assert.equal(await themeAttr(page), 'dark');
  assert.equal(await surface(page), DARK_SURFACE);
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => localStorage.getItem('ar-tema')), 'dark');

  // Ny side: temaet er satt før siden tegnes (skriptet i <head>).
  await page.goto(`${BASE}/funksjoner`);
  assert.equal(await themeAttr(page), 'dark');
  assert.equal(await surface(page), DARK_SURFACE);

  // Tilbake til lys.
  await page.locator('[data-theme-toggle]').first().click();
  assert.equal(await themeAttr(page), 'light');
  assert.equal(await surface(page), LIGHT_SURFACE);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('valget gjelder også i appen, og «Automatisk» under Innstillinger fjerner det', async () => {
  const acc = await createAccount();
  const { token } = await createSession(acc.user.id, { userAgent: 'e2e-tema' });
  const ctx = await browser.newContext({ colorScheme: 'dark' });
  await ctx.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/app/innstillinger`);
  assert.equal(await page.locator('input[data-theme-choice][value="system"]').isChecked(), true, 'automatisk er valgt');
  assert.equal(await surface(page), DARK_SURFACE, 'følger enheten (mørk)');

  await page.getByText('Lys', { exact: true }).click();
  assert.equal(await themeAttr(page), 'light');
  assert.equal(await surface(page), LIGHT_SURFACE);
  await page.reload();
  assert.equal(await page.locator('input[data-theme-choice][value="light"]').isChecked(), true, 'valget vises etter ny innlasting');

  await page.getByText('Automatisk', { exact: true }).click();
  assert.equal(await themeAttr(page), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('ar-tema')), null);
  assert.equal(await surface(page), DARK_SURFACE, 'tilbake til enhetens valg');
  await ctx.close();
});

test('uten JavaScript: ingen bryter, men siden følger enheten', async () => {
  const ctx = await browser.newContext({ colorScheme: 'dark', javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/logg-inn`);
  assert.equal(await page.locator('[data-theme-toggle]').first().isVisible(), false);
  assert.equal(await page.locator('[data-toggle-password]').isVisible(), false);
  assert.equal(await page.locator('#password').isVisible(), true);
  assert.equal(await surface(page), DARK_SURFACE, 'mørk uten skript');
  await ctx.close();
});

test('vis og skjul passordet på innloggingssiden', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/logg-inn`);
  await page.fill('#password', 'hemmelig-passord');
  const eye = page.getByRole('button', { name: 'Vis passord' });
  await eye.click();
  assert.equal(await page.locator('#password').getAttribute('type'), 'text');
  const hide = page.getByRole('button', { name: 'Skjul passord' });
  assert.equal(await hide.getAttribute('aria-pressed'), 'true');
  await hide.click();
  assert.equal(await page.locator('#password').getAttribute('type'), 'password');
  assert.equal(await page.locator('#password').inputValue(), 'hemmelig-passord');
  await ctx.close();
});
