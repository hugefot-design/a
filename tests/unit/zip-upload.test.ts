/**
 * ZIP-pakker og Excel (pakke 5): den trygge ZIP-leseren (hardt tak uansett hva filen påstår, sjekksum, kryptering,
 * farlige navn), utpakkingen av hele pakken (hver fil ett dokument, resten med grunn), Excel som tekst, Word lest med
 * den nye leseren, og meldingen etter opplasting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectFileType, extractDocxSections, extractXlsxSections } from '../../src/domain/documents/extract';
import { parseSharedStrings, sheetRows, xlsxToText } from '../../src/domain/documents/xlsx';
import { isZipUpload, unpackZip, zipUploadSummary } from '../../src/domain/documents/zip';
import { decodeCp865, extractZipEntry, readZipEntries, unsafePath, ZipError } from '../../src/domain/documents/zip-reader';
import { docx, emptyZip, lieAboutSize, markEncrypted, xlsx, zipOf } from '../zip-fixtures';

const PDF = readFileSync(new URL('../fixtures/konkurransegrunnlag-eksempel.pdf', import.meta.url));
const MB = 1024 * 1024;
/** Pakker ut og samler filene som sendes videre (i appen lagres de én og én). */
async function unpack(buf: Buffer, opts: Parameters<typeof unpackZip>[1]) {
  const files: { name: string; type: string; bytes: number }[] = [];
  const r = await unpackZip(buf, opts, (f) => void files.push({ name: f.name, type: f.type, bytes: f.data.length }));
  return r.ok ? { ok: true as const, files, skipped: r.skipped } : r;
}

test('ZIP-leseren: hardt tak ved utpakking – også når filen lyver om størrelsen', async () => {
  const big = await zipOf({ 'stor.txt': 'a'.repeat(2 * MB) });
  const [entry] = readZipEntries(big, 10);
  assert.equal(entry!.declaredSize, 2 * MB);
  assert.throws(() => extractZipEntry(big, entry!, MB), (e: unknown) => e instanceof ZipError && e.code === 'too_large', 'avvist før utpakking');
  // Filen påstår 100 byte, men er 2 MB: taket stopper utpakkingen likevel.
  const liar = lieAboutSize(big, 100);
  const [lying] = readZipEntries(liar, 10);
  assert.equal(lying!.declaredSize, 100);
  assert.throws(() => extractZipEntry(liar, lying!, 1000), (e: unknown) => e instanceof ZipError && e.code === 'too_large');
  // Innenfor taket: riktig innhold, og sjekksummen kontrolleres.
  const ok = await zipOf({ 'a.txt': 'Leverandøren skal ha ISO 9001.' });
  const [e] = readZipEntries(ok, 10);
  assert.equal(extractZipEntry(ok, e!, MB).toString('utf8'), 'Leverandøren skal ha ISO 9001.');
  const corrupt = Buffer.from(ok);
  corrupt.writeUInt32LE((e!.crc + 1) >>> 0, corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 16);
  assert.throws(() => extractZipEntry(corrupt, readZipEntries(corrupt, 10)[0]!, MB), (x: unknown) => x instanceof ZipError && x.code === 'damaged');
  assert.throws(() => readZipEntries(Buffer.from('ikke en zip'), 10), (x: unknown) => x instanceof ZipError && x.code === 'damaged');
});

test('farlige navn kjennes igjen, og gamle Windows-navn med æøå leses riktig', () => {
  for (const n of ['../ond.txt', 'mappe/../../ut.txt', '/etc/passwd', '\\\\server\\del.txt', 'C:\\Windows\\fil.txt', 'a\0b.txt']) assert.equal(unsafePath(n), true, n);
  for (const n of ['Konkurransegrunnlag.pdf', 'Vedlegg/Bilag 1 – Kravspesifikasjon.docx', 'mappe..navn/fil.txt']) assert.equal(unsafePath(n), false, n);
  // Norske Windows-maskiner skriver ø som 0x9B og Ø som 0x9D (cp865).
  assert.equal(decodeCp865(Buffer.from([0x42, 0x9b, 0x72, 0x75, 0x6d, 0x20, 0x9d, 0x86])), 'Børum Øå');
});

test('hele pakken: hver PDF, Word-, Excel- og tekstfil blir ett dokument – resten hoppes over med grunn', async () => {
  const pkg = await zipOf({
    'Konkurransegrunnlag.pdf': PDF,
    'Vedlegg/Bilag 1 Kravspesifikasjon.docx': await docx(['Leverandøren skal ha ISO 14001.']),
    'Vedlegg/Bilag 2 Prisskjema.xlsx': await xlsx([{ name: 'Krav', rows: [['Nr', 'Krav'], [1, 'Responstid under 4 timer']] }]),
    'Les meg.txt': 'Spørsmål sendes via portalen.',
    'Tegning.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    'Gammelt skjema.xls': Buffer.from('xls'),
    'Mer.zip': await zipOf({ 'inni.txt': 'x' }),
    '__MACOSX/._Konkurransegrunnlag.pdf': 'mac',
    'Falsk.pdf': 'dette er ikke en pdf',
  });
  const r = await unpack(pkg, { maxFiles: 10, maxFileBytes: 25 * MB });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(
    r.files.map((f) => [f.name, f.type]),
    [
      ['Konkurransegrunnlag.pdf', 'pdf'],
      ['Bilag 1 Kravspesifikasjon.docx', 'docx'],
      ['Bilag 2 Prisskjema.xlsx', 'xlsx'],
      ['Les meg.txt', 'txt'],
    ],
  );
  assert.deepEqual(r.skipped, [
    { name: 'Tegning.png', reason: 'bilde – skannede dokumenter og bilder støttes ikke ennå' },
    { name: 'Gammelt skjema.xls', reason: 'gammelt Excel-format – lagre som .xlsx og last opp' },
    { name: 'Mer.zip', reason: 'ZIP i ZIP pakkes ikke ut – pakk den ut og last opp filene' },
    { name: '._Konkurransegrunnlag.pdf', reason: 'systemfil fra Mac eller Windows' },
    { name: 'Falsk.pdf', reason: 'innholdet stemmer ikke med filtypen' },
  ]);
  // Grensen per anbud: resten hoppes over med grunn.
  const two = await unpack(pkg, { maxFiles: 2, maxFileBytes: 25 * MB });
  assert.ok(two.ok);
  if (two.ok) {
    assert.deepEqual(two.files.map((f) => f.name), ['Konkurransegrunnlag.pdf', 'Bilag 1 Kravspesifikasjon.docx']);
    assert.deepEqual(
      two.skipped.filter((s) => s.reason === 'grensen for antall dokumenter per anbud er nådd').map((s) => s.name),
      ['Bilag 2 Prisskjema.xlsx', 'Les meg.txt', 'Falsk.pdf'],
    );
  }
});

test('ZIP som er for stor utpakket, farlige navn, kryptert og tom', async () => {
  // For stor til sammen (det filene påstår), og en fil som er for stor alene.
  const big = await zipOf({ 'a.txt': 'a'.repeat(3000), 'b.txt': 'b'.repeat(3000) });
  const total = await unpack(big, { maxFiles: 10, maxFileBytes: MB, maxTotalBytes: 5000 });
  assert.deepEqual(total, { ok: false, error: 'ZIP-filen er for stor når den pakkes ut (over 0 MB til sammen).' });
  const perFile = await unpack(await zipOf({ 'stor.txt': 'x'.repeat(2 * MB), 'liten.txt': 'Krav.' }), { maxFiles: 10, maxFileBytes: MB });
  assert.ok(perFile.ok && perFile.files.length === 1 && perFile.skipped[0]!.reason === 'for stor utpakket (over 1 MB)');
  // Lyver om størrelsen (oppgir 10 byte, er 2 MB): taket gjelder det som faktisk pakkes ut, så filen stoppes og
  // hoppes over – og ingenting av den sendes videre.
  const liar = await unpack(lieAboutSize(await zipOf({ 'bombe.txt': 'z'.repeat(2 * MB), 'liten.txt': 'Krav.' }), 10), { maxFiles: 10, maxFileBytes: 4 * MB, maxTotalBytes: MB });
  assert.deepEqual(liar, {
    ok: true,
    files: [{ name: 'liten.txt', type: 'txt', bytes: 5 }],
    skipped: [{ name: 'bombe.txt', reason: 'ikke plass – pakken er for stor utpakket (over 1 MB til sammen)' }],
  });
  // Farlige navn (JSZip normaliserer «../» i navnet den viser, men ZIP-filen har det opprinnelige navnet).
  const evil = await unpack(await zipOf({ '../ond.txt': 'ond', '/abs.txt': 'abs', 'ok.txt': 'Krav.' }), { maxFiles: 10, maxFileBytes: MB });
  assert.ok(evil.ok);
  if (evil.ok) {
    assert.deepEqual(evil.files.map((f) => f.name), ['ok.txt']);
    assert.deepEqual(evil.skipped.map((s) => s.reason), ['farlig filnavn (peker ut av mappen)', 'farlig filnavn (peker ut av mappen)']);
  }
  // Kryptert og tom.
  const enc = await unpack(markEncrypted(await zipOf({ 'hemmelig.pdf': PDF })), { maxFiles: 10, maxFileBytes: 25 * MB });
  assert.equal(enc.ok, false);
  assert.match((enc as { error: string }).error, /^ZIP-filen er kryptert \(passordbeskyttet\)\./);
  assert.deepEqual(await unpack(await emptyZip(), { maxFiles: 10, maxFileBytes: MB }), { ok: false, error: 'ZIP-filen er tom.' });
  // En tom ZIP begynner med slutten av innholdsfortegnelsen – den er fortsatt en ZIP-fil. Navnet må slutte på .zip.
  assert.equal(isZipUpload(await emptyZip(), 'tom.zip'), true);
  assert.equal(isZipUpload(await zipOf({ 'a.txt': 'a' }), 'Pakke.ZIP'), true);
  assert.equal(isZipUpload(await zipOf({ 'a.txt': 'a' }), 'dokument.docx'), false);
  assert.equal(isZipUpload(Buffer.from('ikke en zip'), 'falsk.zip'), false);
  assert.deepEqual(await unpack(await zipOf({ 'a.txt': 'a', 'b.txt': 'b', 'c.txt': 'c' }), { maxFiles: 10, maxFileBytes: MB, maxEntries: 2 }), {
    ok: false,
    error: 'ZIP-filen har for mange filer (over 2).',
  });
});

test('Excel som tekst: arkene med navn, rader med celler, delte og innebygde tekster, tall', async () => {
  const buf = await xlsx([
    { name: 'Kravspesifikasjon', rows: [['Nr', 'Krav', 'Type'], [1, 'Leverandøren skal ha ISO 9001', 'Minstekrav'], [2, 'Dagbot 0,1 % per dag', 'Vilkår']] },
    { name: 'Tomt ark', rows: [] },
    { name: 'Pris', rows: [['Timepris', 950]] },
  ]);
  assert.equal(detectFileType(buf, 'Prisskjema.xlsx'), 'xlsx');
  assert.equal(detectFileType(buf, 'Prisskjema.zip'), null, 'en ZIP er ikke et dokument');
  assert.equal(
    xlsxToText(buf, MB),
    'Ark «Kravspesifikasjon»\nNr | Krav | Type\n1 | Leverandøren skal ha ISO 9001 | Minstekrav\n2 | Dagbot 0,1 % per dag | Vilkår\n\nArk «Pris»\nTimepris | 950',
  );
  const { pages } = extractXlsxSections(buf);
  assert.match(pages[0]!.text, /Leverandøren skal ha ISO 9001/);
  // Innebygd tekst, formatert tekst i flere deler, uttale-hint og tegn som må kodes.
  assert.deepEqual(parseSharedStrings('<sst><si><r><t>Del </t></r><r><t xml:space="preserve">to</t></r><rPh><t>x</t></rPh></si><si><t>A &amp; B</t></si></sst>'), ['Del to', 'A & B']);
  assert.deepEqual(sheetRows('<row><c t="inlineStr"><is><t>Innebygd</t></is></c><c t="b"><v>1</v></c><c t="e"><v>#N/A</v></c><c/></row>', []), ['Innebygd | 1']);
  // Lyver om størrelsen: taket stopper utpakkingen.
  const liar = lieAboutSize(await xlsx([{ name: 'A', rows: [['x'.repeat(5000)]] }]), 10);
  assert.throws(() => xlsxToText(liar, 1000), (e: unknown) => e instanceof ZipError && e.code === 'too_large');
});

test('Word leses med den nye ZIP-leseren som før', async () => {
  const { pages } = await extractDocxSections(await docx(['Kvalifikasjonskrav', 'Leverandøren skal ha &amp; dokumentere ISO 14001.']));
  assert.equal(pages[0]!.text, 'Kvalifikasjonskrav\nLeverandøren skal ha & dokumentere ISO 14001.');
  await assert.rejects(extractDocxSections(await zipOf({ 'annet.xml': '<x/>' })), /Fant ikke dokumentinnhold i Word-filen\./);
});

test('meldingen etter opplasting: hva som ble lest, og hva som ble hoppet over – kort nok til å vises', () => {
  const ok = zipUploadSummary({
    added: [
      { name: 'a.pdf', pages: 3 },
      { name: 'b.docx', pages: 2 },
    ],
    failed: [{ name: 'skannet.pdf' }],
    skipped: [{ name: 'bilde.png', reason: 'bilde – skannede dokumenter og bilder støttes ikke ennå' }],
  }, { ai: true });
  assert.deepEqual(ok, {
    type: 'success',
    message:
      '2 dokumenter lest fra ZIP-filen (5 sider). Fant ikke tekst i: skannet.pdf. Hoppet over: bilde.png (bilde – skannede dokumenter og bilder støttes ikke ennå). Kjør AI-analysen på nytt for å ta dem med.',
  });
  // Uten AI: meldingen lover ikke en AI-analyse.
  const noAi = zipUploadSummary({ added: [{ name: 'a.pdf', pages: 1 }], failed: [], skipped: [] }, { ai: false });
  assert.equal(noAi.message, '1 dokument lest fra ZIP-filen (1 side). Sjekken av krav og vilkår har tatt dem med.');
  const many = zipUploadSummary({ added: [], failed: [], skipped: Array.from({ length: 40 }, (_, i) => ({ name: `tegning-${i}.png`, reason: 'bilde – skannede dokumenter og bilder støttes ikke ennå' })) }, { ai: false });
  assert.equal(many.type, 'error');
  assert.ok(many.message.length <= 480, String(many.message.length));
  assert.match(many.message, /^Ingen filer i ZIP-filen kunne leses\. Hoppet over: tegning-0\.png .* og \d+ til\.$/);
});
