/**
 * Appen på telefon (iPhone 13 i Chromium): ingen vannrett rulling, ingen JavaScript-feil og ingen knapper eller
 * felt under 24 × 24 px (WCAG 2.5.8) på de viktigste sidene – og fristen og forhåndsvurderingen står øverst på
 * anbudssiden, ikke etter beskrivelsen.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices, type Browser } from 'playwright';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { createSession, SESSION_COOKIE } from '../../src/domain/auth/auth';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';

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

test('mobil: de viktigste sidene i appen uten vannrett rulling, feil eller for små trykkflater', async () => {
  const notice = makeNotice({
    title: 'Vakthold og resepsjon ved rådhuset i Trondheim kommune 2027–2029 med opsjon på forlengelse',
    description: 'Vakthold og resepsjon. '.repeat(40) + 'Det er obligatorisk befaring 1. desember. Tilbud som leveres for sent, vil bli avvist.',
    deadlineAt: new Date(Date.now() + 6 * 86_400_000).toISOString(),
  });
  await ingest([notice]);
  const tenderId = await tenderIdFor('manual', notice.sourceNoticeId);
  const acc = await createAccount({ plan: 'business' });
  const c = await clientFor(BASE, acc);
  await c.post(`/app/anbud/${tenderId}/bokmerke`, {}, { from: `/app/anbud/${tenderId}` });
  const ws = await c.post('/app/tilbud', { tenderId }, { from: `/app/anbud/${tenderId}` });
  const workspace = ws.location!;

  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const { token } = await createSession(acc.user.id, { userAgent: 'e2e-mobil' });
  // En annen innlogget enhet med lang nettlesertekst: den gjorde Innstillinger 420 px for bred på mobil (rettet 8.11.2026).
  await createSession(acc.user.id, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0' });
  await ctx.addCookies([{ name: SESSION_COOKIE, value: token, url: BASE }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const pages = ['/app', '/app/anbud', `/app/anbud/${tenderId}`, `/app/anbud/${tenderId}/lonnsomhet`, '/app/lagret', '/app/resultater', workspace, '/app/konkurrenter/utlop', '/app/kapasitet', '/app/innstillinger'];
  for (const path of pages) {
    const res = await page.goto(`${BASE}${path}`);
    assert.equal(res?.status(), 200, path);
    const r = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const small: string[] = [];
      for (const el of Array.from(document.querySelectorAll('button, select, summary, input:not([type=hidden]):not([type=checkbox]):not([type=radio])'))) {
        const box = (el as HTMLElement).getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.height < 24 || box.width < 24) small.push(`${el.tagName.toLowerCase()} «${((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().slice(0, 30)}» ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
      return { overflow: document.documentElement.scrollWidth > vw, small };
    });
    assert.equal(r.overflow, false, `vannrett rulling på ${path}`);
    assert.deepEqual(r.small, [], `for små trykkflater på ${path}`);
  }
  assert.deepEqual(errors, [], 'JavaScript-feil');

  // Anbudssiden: frist og forhåndsvurdering i første skjermbilde, ikke etter beskrivelsen.
  await page.goto(`${BASE}/app/anbud/${tenderId}`);
  // Ingen navngitte hjelpefunksjoner inne i evaluate: tsx legger inn en __name-hjelper som ikke finnes i nettleseren.
  const found = await page.evaluate((texts) => {
    const out: number[] = [];
    const els = Array.from(document.querySelectorAll('main *')) as HTMLElement[];
    for (const text of texts) {
      const el = els.find((e) => e.innerText?.trim() === text && e.offsetParent !== null);
      out.push(el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1);
    }
    return out;
  }, ['Tilbudsfrist', 'Forhåndsvurdering', 'Beskrivelse']);
  const tops = { frist: found[0]!, vurdering: found[1]!, beskrivelse: found[2]! };
  assert.ok(tops.frist > 0 && tops.vurdering > 0, JSON.stringify(tops));
  assert.ok(tops.frist < tops.beskrivelse && tops.vurdering < tops.beskrivelse, `frist og vurdering før beskrivelsen: ${JSON.stringify(tops)}`);
  assert.ok(tops.vurdering < 1400, `vurderingen innen omtrent to skjermbilder: ${tops.vurdering}px`);
  await ctx.close();
});
