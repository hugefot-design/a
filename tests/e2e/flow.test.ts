/**
 * Ende-til-ende i ekte nettleser (Playwright/Chromium):
 * registrering → e-postbekreftelse → onboarding → søk → lagre → AI-analyse → tilbudsarbeid → abonnement,
 * pluss offentlige sider og mobilvisning.
 *
 * Nettleser: PLAYWRIGHT_CHROMIUM_PATH hvis satt, ellers Playwrights egen Chromium.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { ingest, makeNotice, startServer, uniqueEmail } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
let browser: Browser;
const BASE = new URL(env.APP_URL).origin;

async function launch(): Promise<Browser> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
}

/** Samler JavaScript-feil og konsollfeil for én side. */
function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

before(async () => {
  server = await startServer(Number(new URL(env.APP_URL).port));
  await ingest([
    makeNotice({ title: 'Vakthold ved E2E-rådhuset (test)', estimatedValue: 3_000_000 }),
    makeNotice({ title: 'Resepsjon og vakthold E2E-skolen (test)', estimatedValue: 1_200_000 }),
    makeNotice({ title: 'Asfaltering E2E (test)', cpvCodes: ['45233222'], nutsCodes: ['NO081'] }),
  ]);
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await server.close();
  await closeDb();
});

test('ny kunde: fra registrering til tilbudsarbeid', async () => {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = watch(page);
  const email = uniqueEmail('e2e');

  // Offentlig forside → registrering
  await page.goto(`${BASE}/`);
  assert.match((await page.locator('h1').textContent()) ?? '', /Ikke bare finn anbudet/);
  // «Start gratis» står i menyen, øverst og nederst på forsiden – bruk den i toppen av siden.
  await page.locator('main').getByRole('link', { name: /Start gratis/ }).first().click();
  await page.fill('#name', 'Eva Ende-til-ende');
  await page.fill('#email', email);
  await page.fill('#password', 'Et-sikkert-passord-2026');
  await page.locator('input[name="acceptTerms"]').check();
  await Promise.all([page.waitForURL('**/app/onboarding'), page.getByRole('button', { name: 'Opprett konto' }).click()]);

  // Bekreft e-post via lenken i utgående e-post
  const rows = (await systemSql()`select text_body from email_outbox where to_email = ${email} and kind = 'verify_email'`) as unknown as { textBody: string }[];
  const token = /token=([A-Za-z0-9_-]+)/.exec(rows[0]?.textBody ?? '')?.[1];
  assert.ok(token, 'fant bekreftelseslenke');
  await page.goto(`${BASE}/bekreft-epost?token=${token}`);

  // Onboarding: organisasjon og profil
  await page.goto(`${BASE}/app/onboarding`);
  await page.fill('#name', 'E2E Vakt AS (test)');
  await Promise.all([page.waitForURL('**/app/onboarding'), page.getByRole('button', { name: 'Fortsett' }).click()]);
  await page.getByLabel('Vakt og sikkerhet').check();
  await page.getByLabel('Trøndelag').check();
  await page.fill('#keywords', 'vakthold, resepsjon');
  await page.getByLabel('Godkjenning etter vaktvirksomhetsloven').check();
  await Promise.all([page.waitForURL('**/app?velkommen=1'), page.getByRole('button', { name: 'Lagre og finn anbud' }).click()]);

  // Søk med naturlig språk fra toppfeltet
  await page.fill('#global-search', 'vakthold i Trøndelag');
  await Promise.all([page.waitForURL('**/app/anbud?**'), page.press('#global-search', 'Enter')]);
  await assert.doesNotReject(page.getByText('Fylke: Trøndelag').first().waitFor({ timeout: 5000 }), 'tolkningen vises');
  const result = page.locator('a', { hasText: 'Vakthold ved E2E-rådhuset (test)' }).first();
  await result.waitFor();

  // Lagre anbudet (JavaScript-knapp uten sideskift)
  const row = page.locator('li, article, tr').filter({ has: result }).first();
  const bookmark = row.locator('form[data-bookmark] button');
  await bookmark.click();
  await page.waitForFunction((el) => el?.getAttribute('aria-pressed') === 'true', await bookmark.elementHandle());
  await page.goto(`${BASE}/app/lagret`);
  await page.getByText('Vakthold ved E2E-rådhuset (test)').first().waitFor();

  // Anbudssiden og AI-analyse (testmodus)
  await page.getByText('Vakthold ved E2E-rådhuset (test)').first().click();
  await page.getByText('Fra kunngjøringen').first().waitFor();
  await Promise.all([page.waitForURL('**/analyse'), page.getByRole('button', { name: 'Analyser med AI' }).click()]);
  await page.getByText('Simulert svar fra testmodus').first().waitFor();

  // Abonnement: prøveperioden vises, og betaling går via Stripe (ikke klikket her)
  await page.goto(`${BASE}/app/abonnement`);
  await page.getByText(/prøveperiode/i).first().waitFor();

  assert.deepEqual(errors, [], 'ingen JavaScript- eller konsollfeil i flyten');

  // Mobil: menyen i appen åpner seg i full høyde med alle menypunktene, og lukkes ved klikk utenfor.
  const mobileCtx = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileCtx.newPage();
  await mobile.goto(`${BASE}/app`);
  await mobile.locator('header summary[aria-label="Meny"]').click();
  const drawerLink = mobile.locator('header details[open] nav a', { hasText: 'Abonnement' });
  await drawerLink.waitFor();
  const box = await drawerLink.boundingBox();
  assert.ok(box && box.height > 0 && box.y > 100 && box.y + box.height <= 844, `menypunktet er synlig (${JSON.stringify(box)})`);
  await mobile.mouse.click(370, 400);
  assert.equal(await mobile.locator('header details[open]').count(), 0, 'menyen lukkes ved klikk utenfor');
  assert.ok(await noHorizontalScroll(mobile), 'ingen sidelengs rulling i appen på mobil');
  await mobileCtx.close();

  // Tilbudsarbeid er en Bedrift-funksjon: prøveperioden (Profesjonell) får en tydelig låst side, ikke en død knapp
  const bids = await page.goto(`${BASE}/app/tilbud`);
  assert.equal(bids?.status(), 403);
  await page.getByText(/Bedrift/).first().waitFor();

  await page.close();
});

test('offentlige sider og mobilvisning uten horisontal rulling', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = watch(page);
  for (const path of ['/', '/funksjoner', '/priser', '/bransjer', '/om', '/kontakt', '/personvern', '/vilkar', '/logg-inn', '/registrer']) {
    const res = await page.goto(`${BASE}${path}`);
    assert.equal(res?.status(), 200, path);
    assert.ok(await noHorizontalScroll(page), `horisontal rulling på ${path}`);
  }
  // Juridiske sider er tydelig merket som utkast til de er gjennomgått
  await page.goto(`${BASE}/personvern`);
  await page.getByText(/Utkast/).first().waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});
