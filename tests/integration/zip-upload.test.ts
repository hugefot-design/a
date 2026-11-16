/**
 * Hele pakken fra portalen som én ZIP-fil (pakke 5): hver PDF-, Word-, Excel- og tekstfil blir ett dokument, kravene
 * i Excel-filen blir med i ordsøket, og det som hoppes over, står i meldingen. Farlige filnavn, kryptert ZIP, tom ZIP,
 * for stor utpakket og grensen på ti dokumenter – og at filnavn fra ZIP-filen aldri brukes som lagringssti.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDb, systemSql } from '../../src/lib/db';
import { clientFor, createAccount, ingest, makeNotice, startServer, tenderIdFor } from '../helpers';
import { docx, emptyZip, lieAboutSize, markEncrypted, xlsx, zipOf } from '../zip-fixtures';

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  server = await startServer();
});
after(async () => {
  await server.close();
  await closeDb();
});

type C = Awaited<ReturnType<typeof clientFor>>;
const PDF = readFileSync(new URL('../fixtures/konkurransegrunnlag-eksempel.pdf', import.meta.url));
const text = (html: string) =>
  html
    .replaceAll('<!-- -->', '')
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|[  ]/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

async function newTender(): Promise<string> {
  const notice = makeNotice({ title: 'Drift av kommunale bygg (zip-test)' });
  await ingest([notice]);
  return tenderIdFor('manual', notice.sourceNoticeId);
}
/** Laster opp filen og returnerer teksten på siden brukeren sendes til (med meldingen). */
async function upload(c: C, tenderId: string, data: Buffer, name: string, type = 'application/zip'): Promise<string> {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(data)], name, { type }));
  const res = await c.postMultipart(`/app/anbud/${tenderId}/dokumenter`, form, `/app/anbud/${tenderId}`);
  assert.equal(res.status, 303);
  return text((await c.get(res.location!)).body);
}
const docs = async (orgId: string, tenderId: string) =>
  (await systemSql()`
    select title, mime_type, storage_key, text_status, page_count from tender_documents where org_id = ${orgId} and tender_id = ${tenderId} order by created_at, title
  `) as unknown as { title: string; mimeType: string; storageKey: string; textStatus: string; pageCount: number | null }[];

test('en vanlig ZIP: hver fil blir ett dokument, kravene i Excel-filen blir med i ordsøket, og resten hoppes over med grunn', async () => {
  const tenderId = await newTender();
  const acc = await createAccount(); // Profesjonell (prøveperiode): opplasting
  const c = await clientFor(server.base, acc);
  const pkg = await zipOf({
    'Konkurransegrunnlag.pdf': PDF,
    'Vedlegg/Bilag 1 Kravspesifikasjon.docx': await docx(['Leverandøren skal ha et miljøledelsessystem sertifisert etter ISO 14001.']),
    'Vedlegg/Bilag 2 Prisskjema.xlsx': await xlsx([{ name: 'Vilkår', rows: [['Nr', 'Vilkår'], [1, 'Ved forsinkelse påløper dagbot på 0,2 % av kontraktssummen per dag.']] }]),
    'Tegning.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'Mer.zip': await zipOf({ 'inni.txt': 'x' }),
  });
  const page = await upload(c, tenderId, pkg, 'Konkurransegrunnlag fra portalen.zip');
  assert.match(page, /3 dokumenter lest fra ZIP-filen \(\d+ sider\)\./);
  assert.match(page, /Hoppet over: Tegning\.png \(bilde – skannede dokumenter og bilder støttes ikke ennå\); Mer\.zip \(ZIP i ZIP pakkes ikke ut – pakk den ut og last opp filene\)\./);
  const rows = await docs(acc.orgId, tenderId);
  assert.deepEqual(
    rows.map((r) => [r.title, r.mimeType, r.textStatus]),
    [
      ['Konkurransegrunnlag.pdf', 'application/pdf', 'extracted'],
      ['Bilag 1 Kravspesifikasjon.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'extracted'],
      ['Bilag 2 Prisskjema.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'extracted'],
    ],
  );
  // Lagringsstien lages av oss – filnavnet fra ZIP-filen er aldri med.
  for (const r of rows) assert.match(r.storageKey, new RegExp(`^orgs/${acc.orgId}/tenders/${tenderId}/[0-9a-f-]{36}\\.(pdf|docx|xlsx)$`));
  // Dokumentene står på siden, og ordsøket har lest Word- og Excel-filen.
  for (const title of ['Konkurransegrunnlag.pdf', 'Bilag 1 Kravspesifikasjon.docx', 'Bilag 2 Prisskjema.xlsx']) assert.ok(page.includes(title), title);
  assert.match(page, /Sjekket kunngjøringen og 3 dokumenter/);
  assert.match(page, /ISO 14001/);
  assert.match(page, /Bilag 1 Kravspesifikasjon\.docx, s\. 1/);
  // En annen organisasjon ser ikke dokumentene.
  const other = await clientFor(server.base, await createAccount());
  assert.ok(!text((await other.get(`/app/anbud/${tenderId}`)).body).includes('Bilag 2 Prisskjema.xlsx'));
});

test('en Excel-fil alene kan lastes opp, og vilkårene i den blir funnet', async () => {
  const tenderId = await newTender();
  const acc = await createAccount({ plan: 'business' });
  const c = await clientFor(server.base, acc);
  const file = await xlsx([{ name: 'Krav', rows: [['Krav'], ['Tilbud som ikke oppfyller minstekravene, vil bli avvist.']] }]);
  const page = await upload(c, tenderId, file, 'Kravspesifikasjon.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(page, /Dokumentet er lest \(1 side\)\./);
  assert.match(page, /1 side lest/);
  assert.match(page, /Kravspesifikasjon\.xlsx, s\. 1/);
  assert.match(page, /vil bli avvist/);
});

test('farlige filnavn hoppes over, og ingenting lagres utenfor organisasjonens mappe', async () => {
  const tenderId = await newTender();
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  const page = await upload(c, tenderId, await zipOf({ '../../ond.txt': 'Skal ikke leses.', '/etc/passwd.txt': 'Skal ikke leses.', 'Krav.txt': 'Leverandøren skal ha ISO 9001.' }), 'pakke.zip');
  assert.match(page, /1 dokument lest fra ZIP-filen \(1 side\)\./);
  assert.match(page, /Hoppet over: \.\.\/\.\.\/ond\.txt \(farlig filnavn \(peker ut av mappen\)\); \/etc\/passwd\.txt \(farlig filnavn \(peker ut av mappen\)\)\./);
  const rows = await docs(acc.orgId, tenderId);
  assert.deepEqual(rows.map((r) => r.title), ['Krav.txt']);
  assert.match(rows[0]!.storageKey, new RegExp(`^orgs/${acc.orgId}/tenders/${tenderId}/[0-9a-f-]{36}\\.txt$`));
});

test('kryptert ZIP, tom ZIP og ZIP som er for stor utpakket avvises – ingenting lagres', async () => {
  const tenderId = await newTender();
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  assert.match(await upload(c, tenderId, markEncrypted(await zipOf({ 'Hemmelig.pdf': PDF })), 'kryptert.zip'), /ZIP-filen er kryptert \(passordbeskyttet\)\. Pakk den ut og last opp filene hver for seg/);
  assert.match(await upload(c, tenderId, await emptyZip(), 'tom.zip'), /ZIP-filen er tom\./);
  // Filene påstår 150 MB hver: over grensen på 200 MB til sammen, så ingenting pakkes ut.
  const big = lieAboutSize(await zipOf({ 'a.txt': 'a'.repeat(5000), 'b.txt': 'b'.repeat(5000) }), 150 * 1024 * 1024);
  assert.match(await upload(c, tenderId, big, 'stor.zip'), /ZIP-filen er for stor når den pakkes ut \(over 200 MB til sammen\)\./);
  // En fil som lyver om størrelsen (påstår 10 byte, er 30 MB): taket per fil stopper utpakkingen, og filen hoppes over.
  const liar = lieAboutSize(await zipOf({ 'bombe.txt': 'z'.repeat(30 * 1024 * 1024) }), 10);
  assert.match(await upload(c, tenderId, liar, 'bombe.zip'), /Ingen filer i ZIP-filen kunne leses\. Hoppet over: bombe\.txt \(for stor utpakket \(over 25 MB\)\)\./);
  assert.match(await upload(c, tenderId, Buffer.from('ikke en zip-fil'), 'falsk.zip'), /Filen er ikke en ZIP-fil\./);
  assert.equal((await docs(acc.orgId, tenderId)).length, 0, 'ingenting er lagret');
});

test('grensen på ti dokumenter per anbud gjelder også for ZIP, og planer uten opplasting får beskjed', async () => {
  const tenderId = await newTender();
  const acc = await createAccount();
  const c = await clientFor(server.base, acc);
  const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Vedlegg ${String(i + 1).padStart(2, '0')}.txt`, `Krav ${i + 1}: Leverandøren skal dokumentere erfaring.`]));
  const page = await upload(c, tenderId, await zipOf(twelve), 'mange.zip');
  assert.match(page, /10 dokumenter lest fra ZIP-filen \(10 sider\)\./);
  assert.match(page, /Hoppet over: Vedlegg 11\.txt \(grensen for antall dokumenter per anbud er nådd\); Vedlegg 12\.txt \(grensen for antall dokumenter per anbud er nådd\)\./);
  assert.equal((await docs(acc.orgId, tenderId)).length, 10);
  assert.match(await upload(c, tenderId, await zipOf({ 'En til.txt': 'Krav.' }), 'en-til.zip'), /Maks 10 dokumenter per kunngjøring\. Slett et dokument først\./);

  const free = await createAccount({ plan: 'starter' });
  const cf = await clientFor(server.base, free);
  assert.match(await upload(cf, tenderId, await zipOf({ 'Krav.txt': 'Krav.' }), 'pakke.zip'), /Opplasting av dokumenter er ikke med i planen din\./);
  assert.equal((await docs(free.orgId, tenderId)).length, 0);
});
