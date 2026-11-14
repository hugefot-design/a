/**
 * Offentlige sider: alle svarer, har nøyaktig én hovedoverskrift, illustrasjoner er merket som
 * fiktive, og prøveperioden i teksten følger innstillingen (TRIAL_DAYS) i stedet for å være hardkodet.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDb } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { Client, clientFor, createAccount, startServer } from '../helpers';

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
  for (const path of ['/', '/funksjoner', '/eksempel', '/priser', '/bransjer', '/om', '/kontakt', '/personvern', '/vilkar']) {
    const page = await get(path);
    assert.equal(page.status, 200, path);
    assert.equal((page.body.match(/<h1[\s>]/g) ?? []).length, 1, `én h1 på ${path}`);
  }
});

test('forsiden: tydelig posisjonering, ekte data og ingen AI-løfter når AI er av', async () => {
  const page = await get('/');
  assert.match(page.body, /<h1[^>]*>[\s\S]*Ikke bare finn anbudet\.[\s\S]*Finn ut om det er verdt å vinne\.[\s\S]*<\/h1>/);
  for (const section of ['Det som skiller AnbudRadar ut', 'Slik fungerer det', 'Forskjellen', 'Åpenhet']) assert.ok(page.body.includes(section), section);
  // Åtte fordeler – det som skiller AnbudRadar ut først – hver med planen den finnes i (regnet ut fra planene).
  for (const t of [
    'Go/No-Go med kilde på alt',
    'Lønnsomhet med egne kostnader',
    'Deres pris mot markedet',
    'Norske krav og kostbare vilkår',
    'Kapasitet måned for måned',
    'Læring fra egne resultater',
    'Intelligent anbudsmatching',
    'Hvem vinner, og hva som utløper',
  ]) {
    assert.ok(page.body.includes(t), t);
  }
  assert.match(page.body, /med kilde på alt, fra/);
  assert.match(page.body, /Go\/No-Go per anbud, med grunner og kilde/);
  // Vi selger våre egne funksjoner – ingen konkurrenter nevnes ved navn.
  assert.doesNotMatch(page.body, /Mercell|Tendium|Stotles|anbudsradar\.no/i);
  assert.match(page.body.replaceAll('<!-- -->', ''), /Med i Profesjonell og høyere/);
  // Testmiljøet bruker simulert AI: den skal ikke markedsføres som ekte – og det skal stå at AI ikke er slått på.
  assert.doesNotMatch(page.body, /AI leser kunngjøringen/);
  assert.match(page.body, /AI-sammendrag og AI-utkast er ikke slått på ennå/);
  // Sammenligningen sier ingenting om bestemte tjenester.
  assert.match(page.body, /ikke en bestemt tjeneste/);
  assert.match(page.body, /role="img" aria-label="Åpne anbud per fylke/);
  assert.doesNotMatch(page.body.replaceAll('<!-- -->', ''), />null/);
  // Forsiden skal være lett å lese: korte tekster (detaljene står på undersidene).
  const text = (page.body.match(/<main[^>]*>([\s\S]*)<\/main>/)?.[1] ?? '')
    .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<details[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>[\s\S]*?<\/details>/g, ' $1 ')
    .replace(/<[^>]+>/g, ' ');
  const words = text.split(/\s+/).filter((w) => /\p{L}|\d/u.test(w)).length;
  // Eier ba 7.11.2026 om fordeler, kundereise, sammenligning og åpenhet på forsiden – hver tekst skal likevel være kort.
  assert.ok(words < 1300, `forsiden har ${words} synlige ord – hold den kort`);
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
  // Strukturerte data: nettstedets navn og logo bare på forsiden; spørsmål og svar på forsiden og prissiden.
  type Ld = { '@type': string; name?: string; logo?: string };
  const ldBlocks = (html: string) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([^<]+)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Ld[]);
  const data = ldBlocks(home.body).find((b) => b.some((d) => d['@type'] === 'WebSite'));
  assert.ok(data, 'JSON-LD på forsiden');
  assert.deepEqual(data.map((d) => [d['@type'], d.name]), [['WebSite', 'AnbudRadar'], ['Organization', 'AnbudRadar']]);
  assert.match(data[1]!.logo!, /\/icon-512\.png$/);
  assert.deepEqual(ldBlocks(home.body).flat().map((d) => d['@type']).sort(), ['FAQPage', 'Organization', 'WebSite']);
  assert.deepEqual(ldBlocks((await get('/priser')).body).flat().map((d) => d['@type']), ['FAQPage']);
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

test('funksjonssiden starter med den samlede vurderingen – og den finnes i appen', async () => {
  const page = await get('/funksjoner');
  assert.equal(page.status, 200);
  const body = page.body.replaceAll('<!-- -->', '');
  assert.match(body, /Samlet vurdering \(Go\/No-Go\)/);
  assert.match(body, /Risikoscore 0–100 med kilde for hver faktor/);
  assert.match(body, /PDF til ledelsen/);
  assert.ok(body.indexOf('Samlet vurdering (Go/No-Go)') < body.indexOf('Finn anbud og få varsel'), 'den samlede vurderingen står først');
  // Påstanden peker på en ekte side i appen (krever innlogging).
  const app = await fetch(`${server.base}/app/anbud/00000000-0000-4000-8000-000000000000/intelligence`, { redirect: 'manual' });
  assert.ok([302, 303].includes(app.status), String(app.status));
  assert.match(app.headers.get('location') ?? '', /logg-inn/);
});

test('feilsiden: besøkende får «Til forsiden», innloggede i appen også «Til oversikten»', async () => {
  const anon = await get('/finnes-ikke');
  assert.equal(anon.status, 404);
  assert.doesNotMatch(anon.body, /Til oversikten/, 'besøkende sendes ikke til innlogging');
  assert.match(anon.body, /Til forsiden/);
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  // Et anbud som ikke finnes, inne i appen: innlogget, så «Til oversikten» vises.
  const logged = await c.get('/app/anbud/00000000-0000-4000-8000-000000000000');
  assert.equal(logged.status, 404);
  assert.match(logged.body, /href="\/app"[^>]*>Til oversikten/);
});

test('prissiden og funksjonssiden har egen beskrivelse for søk (ikke standardteksten)', async () => {
  const desc = (html: string) => /<meta name="description" content="([^"]*)">/.exec(html)?.[1] ?? '';
  const pricing = desc((await get('/priser')).body);
  assert.match(pricing, /^Gratisplan og planer fra 299 kr per måned eks\. mva\./, 'laveste pris hentes fra planene');
  assert.match(desc((await get('/funksjoner')).body), /^Samlet vurdering av hvert anbud/);
  assert.match(desc((await get('/en/pricing')).body), /from NOK 299 per month/);
});
