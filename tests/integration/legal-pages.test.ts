/**
 * Juridiske sider: alle svarer med én h1, versjon og en innholdsfortegnelse som virker; utkastbanner
 * til advokat har godkjent; plassholdere for firmaopplysninger markeres i stedet for å se ekte ut;
 * security.txt (RFC 9116); og at registreringen lagrer hvilken versjon av vilkårene som ble godtatt.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { appSql, closeDb, systemSql } from '../../src/lib/db';
import { env } from '../../src/lib/env';
import { LEGAL_DOCS, LEGAL_VERSION } from '../../src/domain/legal/legal';
import { Client, clientFor, createAccount, startServer, uniqueEmail } from '../helpers';

let server: Awaited<ReturnType<typeof startServer>>;
const mutableEnv = env as unknown as Record<string, unknown>;
const savedEnv = { ...env };

const REAL = {
  COMPANY_LEGAL_NAME: 'Testfirma AS',
  COMPANY_ORG_NUMBER: '123 456 789',
  COMPANY_ADDRESS: 'Storgata 1, 0155 Oslo',
  COMPANY_CONTACT_EMAIL: 'post@testfirma.no',
};
const PLACEHOLDERS = {
  COMPANY_LEGAL_NAME: '[Selskapsnavn AS]',
  COMPANY_ORG_NUMBER: '[org.nr.]',
  COMPANY_ADDRESS: '[adresse]',
  COMPANY_CONTACT_EMAIL: 'kontakt@example.com',
};

before(async () => {
  server = await startServer();
});
after(async () => {
  Object.assign(mutableEnv, savedEnv);
  await server.close();
  await closeDb();
});

/** Henter en side; React setter inn <!-- --> mellom tekstbiter, de fjernes så tekst kan sammenlignes. */
const get = async (path: string) => {
  const res = await fetch(`${server.base}${path}`);
  return { status: res.status, type: res.headers.get('content-type') ?? '', body: (await res.text()).replaceAll('<!-- -->', '') };
};

const DRAFT = /Utkast\. Teksten er ikke juridisk gjennomgått/;

test('alle juridiske dokumenter har én h1, versjon, utkastbanner og en innholdsfortegnelse som virker', async () => {
  Object.assign(mutableEnv, PLACEHOLDERS, { LEGAL_PAGES_REVIEWED: false });
  for (const doc of LEGAL_DOCS) {
    const page = await get(doc.href);
    assert.equal(page.status, 200, doc.href);
    assert.equal((page.body.match(/<h1[\s>]/g) ?? []).length, 1, `én h1 på ${doc.href}`);
    assert.ok(page.body.includes(`Versjon ${LEGAL_VERSION}`), `versjon på ${doc.href}`);
    assert.match(page.body, DRAFT, `utkastbanner på ${doc.href}`);

    // Hver lenke i innholdsfortegnelsen peker til en seksjon som finnes på siden.
    const anchors = new Set([...page.body.matchAll(/href="#([a-z0-9-]+)"/g)].map((m) => m[1]!));
    anchors.delete('innhold'); // «Hopp til innhold»
    assert.ok(anchors.size >= 3, `innholdsfortegnelse på ${doc.href}`);
    for (const a of anchors) assert.ok(page.body.includes(`id="${a}"`), `${doc.href}#${a} finnes`);

    // Dokumentmenyen lenker til alle dokumentene og markerer gjeldende side.
    for (const other of LEGAL_DOCS) assert.ok(page.body.includes(`href="${other.href}"`), `${doc.href} lenker til ${other.href}`);
    assert.ok(page.body.includes(`href="${doc.href}" aria-current="page"`), `${doc.href} er markert som gjeldende`);
  }
});

test('utkastbanneret forsvinner når advokat har gjennomgått tekstene (LEGAL_PAGES_REVIEWED)', async () => {
  Object.assign(mutableEnv, { LEGAL_PAGES_REVIEWED: true });
  try {
    for (const doc of LEGAL_DOCS) assert.doesNotMatch((await get(doc.href)).body, DRAFT, doc.href);
  } finally {
    Object.assign(mutableEnv, { LEGAL_PAGES_REVIEWED: false });
  }
});

test('firmaopplysninger: plassholdere markeres, ekte opplysninger vises i dokumentene og i bunnteksten', async () => {
  Object.assign(mutableEnv, PLACEHOLDERS);
  let terms = await get('/vilkar');
  assert.match(terms.body, /<mark[^>]*>\[org\.nr\.\]<\/mark>/);
  assert.match(terms.body, /<mark[^>]*>\[e-post\]<\/mark>/);
  assert.doesNotMatch(terms.body, /mailto:kontakt@example\.com/, 'ingen lenke til en oppdiktet adresse');
  assert.doesNotMatch((await get('/')).body, /Levert av/, 'bunnteksten viser ikke plassholdere som ekte opplysninger');
  assert.doesNotMatch((await get('/om')).body, /example\.com|\[Selskapsnavn|\[adresse\]/, '«Om oss» viser ikke plassholdere');

  Object.assign(mutableEnv, REAL);
  terms = await get('/vilkar');
  assert.doesNotMatch(terms.body, /<mark/);
  assert.ok(terms.body.includes('Testfirma AS, org.nr. 123 456 789, Storgata 1, 0155 Oslo, e-post'));
  assert.ok(terms.body.includes('href="mailto:post@testfirma.no"'));
  assert.ok((await get('/om')).body.includes('Testfirma AS, org.nr. 123 456 789'), 'firmaopplysninger på «Om oss»');
  for (const path of ['/', '/priser', '/vilkar']) {
    assert.ok((await get(path)).body.includes('Levert av Testfirma AS, org.nr. 123 456 789, Storgata 1, 0155 Oslo'), `firmalinje i bunnteksten på ${path}`);
  }
  Object.assign(mutableEnv, PLACEHOLDERS);
});

test('security.txt finnes først med en ekte kontaktadresse, og følger RFC 9116', async () => {
  Object.assign(mutableEnv, PLACEHOLDERS);
  assert.equal((await get('/.well-known/security.txt')).status, 404);
  assert.ok(!(await get('/sikkerhet')).body.includes('security.txt'), 'ingen lenke til en side som ikke finnes');

  Object.assign(mutableEnv, REAL);
  const txt = await get('/.well-known/security.txt');
  assert.equal(txt.status, 200);
  assert.match(txt.type, /^text\/plain/);
  assert.match(txt.body, /^Contact: mailto:post@testfirma\.no$/m);
  const expires = new Date(/^Expires: (.+)$/m.exec(txt.body)?.[1] ?? 'ugyldig');
  assert.ok(expires.getTime() > Date.now() && expires.getTime() <= Date.now() + 366 * 86_400_000, 'Expires innen ett år');
  assert.match(txt.body, /^Canonical: https?:\/\/\S+\/\.well-known\/security\.txt$/m);
  assert.match(txt.body, /^Policy: https?:\/\/\S+\/sikkerhet$/m);
  assert.ok((await get('/sikkerhet')).body.includes('href="/.well-known/security.txt"'));
  Object.assign(mutableEnv, PLACEHOLDERS);
});

test('bunnteksten og sitemap lenker til alle juridiske dokumenter', async () => {
  const home = await get('/');
  const footer = home.body.slice(home.body.lastIndexOf('<footer'));
  assert.match(footer, /aria-label="Juridisk"/);
  for (const d of LEGAL_DOCS) assert.ok(footer.includes(`href="${d.href}"`), `bunnteksten lenker til ${d.href}`);
  const sitemap = await get('/sitemap.xml');
  for (const d of LEGAL_DOCS) assert.ok(sitemap.body.includes(`${d.href}</loc>`), `sitemap har ${d.href}`);
});

test('registrering lagrer hvilken versjon av vilkårene som ble godtatt, og når', async () => {
  const form = await get('/registrer');
  for (const href of ['/vilkar', '/databehandleravtale', '/personvern']) assert.ok(form.body.includes(`href="${href}"`), `skjemaet lenker til ${href}`);

  const c = new Client(server.base);
  const email = uniqueEmail('vilkar');
  const startedAt = Date.now();
  const reg = await c.post('/registrer', { name: 'Vilkår Test', email, password: 'Et-langt-passord-123', acceptTerms: 'on' }, { from: '/registrer' });
  assert.equal(reg.status, 303);
  const [row] = (await systemSql()`select id, terms_version, terms_accepted_at from users where email = ${email}`) as unknown as {
    id: string;
    termsVersion: string | null;
    termsAcceptedAt: Date | null;
  }[];
  assert.equal(row?.termsVersion, LEGAL_VERSION);
  assert.ok(row?.termsAcceptedAt && row.termsAcceptedAt.getTime() >= startedAt - 5_000, 'tidspunktet er satt');
  const [log] = (await systemSql()`select metadata from audit_logs where action = 'auth.register' and actor_user_id = ${row!.id}`) as unknown as {
    metadata: Record<string, unknown>;
  }[];
  assert.equal(log?.metadata.termsVersion, LEGAL_VERSION, 'versjonen står også i revisjonsloggen');

  // Appen kan ikke endre beviset i ettertid.
  await assert.rejects(appSql()`update users set terms_version = 'endret' where id = ${row!.id}`, /permission denied/);

  // Uten avkrysning opprettes ingen konto.
  const email2 = uniqueEmail('vilkar');
  const noTerms = await new Client(server.base).post('/registrer', { name: 'Uten Vilkår', email: email2, password: 'Et-langt-passord-123' }, { from: '/registrer' });
  assert.equal(noTerms.status, 422);
  assert.equal((await systemSql()`select 1 from users where email = ${email2}`).length, 0);
});

test('dataeksporten viser hvilken versjon av vilkårene brukeren godtok', async () => {
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  const res = await c.get('/app/innstillinger/eksport');
  assert.equal(res.status, 200);
  assert.match(res.body, new RegExp(`"terms_?[vV]ersion":\\s*"${LEGAL_VERSION}"`), 'eksporten har vilkårsversjonen');
});
