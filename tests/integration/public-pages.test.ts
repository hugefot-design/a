/**
 * Offentlige sider: alle svarer, har nøyaktig én hovedoverskrift, illustrasjoner er merket som
 * fiktive, og prøveperioden i teksten følger innstillingen (TRIAL_DAYS) i stedet for å være hardkodet.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { Client, startServer } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const savedTrialDays = env.TRIAL_DAYS;

before(async () => {
  server = await startServer();
});
after(async () => {
  (env as { TRIAL_DAYS: number }).TRIAL_DAYS = savedTrialDays;
  await server.close();
  await closeDb();
});

const get = async (path: string) => {
  const res = await fetch(`${server.base}${path}`);
  return { status: res.status, body: await res.text() };
};

test('alle offentlige sider svarer og har nøyaktig én h1', async () => {
  for (const path of ['/', '/funksjoner', '/priser', '/bransjer', '/om', '/kontakt', '/personvern', '/vilkar']) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.equal((page.body.match(/<h1[\s>]/g) ?? []).length, 1, `én h1 på ${path}`);
  }
});

test('forsiden bygger på ekte data og merker illustrasjonene', async () => {
  const page = await get('/');
  assert.match(page.body, /<h1[^>]*>[\s\S]*Alle offentlige anbud\.[\s\S]*Bare de som passer deg\.[\s\S]*<\/h1>/);
  // Illustrasjonene av appen er merket som eksempler; tallene og anbudene er ekte.
  assert.match(page.body, /Eksempel/);
  assert.match(page.body, /role="img" aria-label="Åpne anbud per fylke/);
  assert.doesNotMatch(page.body.replaceAll('<!-- -->', ''), />null/);
  // Forsiden skal være lett å lese: korte tekster (detaljene står på undersidene).
  const text = (page.body.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '')
    .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<details[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, ' $1 ')
    .replace(/<[^>]+>/g, ' ');
  const words = text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
  assert.ok(words < 700, `forsiden har ${words} synlige ord – hold den kort`);
  // Ingen påstander om kunder eller omtaler vi ikke kan dokumentere.
  assert.doesNotMatch(page.body, /fornøyde kunder|kundene våre sier|★/i);
});

test('prøveperioden i markedsteksten følger TRIAL_DAYS', async () => {
  (env as { TRIAL_DAYS: number }).TRIAL_DAYS = 30;
  const home = await get('/');
  const pricing = await get('/priser');
  const register = await get('/registrer');
  for (const page of [home, pricing, register]) {
    assert.match(page.body, /30 dager/);
    assert.doesNotMatch(page.body, /14 dager/);
  }
});

test('ikoner for nettleser, Google, iPhone og Android finnes og er lenket fra siden', async () => {
  for (const [path, type] of [
    ['/favicon.ico', 'image/x-icon'],
    ['/favicon.svg', 'image/svg+xml'],
    ['/favicon-96x96.png', 'image/png'],
    ['/apple-touch-icon.png', 'image/png'],
    ['/icon-192.png', 'image/png'],
    ['/icon-512.png', 'image/png'],
    ['/site.webmanifest', 'application/manifest+json'],
  ] as const) {
    const res = await fetch(`${server.base}${path}`);
    assert.equal(res.status, 200, path);
    assert.equal(res.headers.get('content-type'), type, path);
    assert.ok((await res.arrayBuffer()).byteLength > 100, `${path} er ikke tom`);
  }
  const manifest = (await (await fetch(`${server.base}/site.webmanifest`)).json()) as { icons: { src: string }[] };
  for (const icon of manifest.icons) assert.equal((await fetch(`${server.base}${icon.src}`)).status, 200, icon.src);
  const home = await get('/');
  for (const tag of ['href="/favicon.ico"', 'href="/favicon.svg"', 'href="/apple-touch-icon.png"', 'rel="manifest"']) assert.ok(home.body.includes(tag), tag);
  // Strukturerte data: nettstedets navn og logo, bare på forsiden.
  const ld = /<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/.exec(home.body)?.[1];
  assert.ok(ld, 'JSON-LD på forsiden');
  const data = JSON.parse(ld!) as { '@type': string; name: string; logo?: string }[];
  assert.deepEqual(data.map((d) => [d['@type'], d.name]), [['WebSite', 'AnbudRadar'], ['Organization', 'AnbudRadar']]);
  assert.match(data[1]!.logo!, /\/icon-512\.png$/);
  assert.doesNotMatch((await get('/priser')).body, /application\/ld\+json/);
});

test('lenker som deles, får tittel, tekst og bilde på riktig språk (ikke i appen)', async () => {
  const home = await get('/');
  assert.match(home.body, /<meta property="og:image" content="[^"]*\/assets\/og\/og-nb\.png">/);
  assert.match(home.body, /<meta property="og:title" content="[^"]+">/);
  assert.match(home.body, /<meta name="twitter:card" content="summary_large_image">/);
  const en = await get('/en/pricing');
  assert.match(en.body, /og-en\.png/);
  assert.match(en.body, /<meta property="og:url" content="[^"]*\/en\/pricing">/);
  assert.match(en.body, /<meta property="og:locale" content="en_GB">/);
  for (const l of ['nb', 'en', 'sv', 'da']) assert.equal((await fetch(`${server.base}/assets/og/og-${l}.png`)).status, 200, l);
  const login = await fetch(`${server.base}/app`, { redirect: 'manual' });
  assert.notEqual(login.status, 200, 'appen krever innlogging');
});

test('Google Search Console: bekreftelsesfilen svarer bare for eierens filnavn', async () => {
  const c = new Client(server.base);
  const ok = await c.get('/google89c7bd88c1234567.html');
  assert.equal(ok.status, 200);
  assert.equal(ok.body, 'google-site-verification: google89c7bd88c1234567.html');
  assert.equal((await c.get('/google0000000000000000.html')).status, 404);
  assert.equal((await c.get('/google89c7bd88.html')).status, 404);
});
