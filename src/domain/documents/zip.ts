/**
 * Hele konkurransegrunnlaget som én ZIP-fil fra portalen: pakkes ut på serveren, og hver PDF-, Word-, Excel- og
 * tekstfil blir ett dokument. Filer som hoppes over, får en grunn som vises til brukeren.
 *
 * Opplastede filer er ikke til å stole på (zip-reader.ts pakker ut med hardt tak):
 * - grense for antall filer i ZIP-filen, for hver fil utpakket og for alle filene samlet;
 * - filnavn som peker ut av mappen («../», absolutt sti, stasjonsbokstav) hoppes over;
 * - ZIP i ZIP pakkes ikke ut, og krypterte ZIP-filer avvises;
 * - filtypen avgjøres av innholdet, som for vanlige opplastinger.
 */
import { detectFileType, type DetectedType } from './extract';
import { extractZipEntry, readZipEntries, unsafePath, ZipError, type ZipEntry } from './zip-reader';

/** Høyst så mange filer (og mapper) i ZIP-filen. */
export const ZIP_MAX_ENTRIES = 500;
/** Høyst så mye utpakket til sammen. */
export const ZIP_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export interface UnpackedFile {
  /** Navnet uten mapper, slik det skal vises. */
  name: string;
  type: Exclude<DetectedType, null>;
  data: Buffer;
}
export interface SkippedFile {
  name: string;
  reason: string;
}
export type UnpackResult = { ok: true; skipped: SkippedFile[] } | { ok: false; error: string };

const SYSTEM_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
const IMAGE = /\.(png|jpe?g|gif|bmp|tiff?|heic|webp)$/i;

/** ZIP-fil fra portalen: «PK»-signaturen (en vanlig fil, eller slutten av innholdsfortegnelsen i en tom ZIP) og .zip i navnet. */
export function isZipUpload(buf: Buffer, filename: string): boolean {
  if (buf.length < 4 || !filename.toLowerCase().endsWith('.zip')) return false;
  const sig = buf.readUInt32LE(0);
  return sig === 0x04034b50 || sig === 0x06054b50;
}

/** Hvorfor en fil som ikke kan leses, hoppes over – ut fra navnet. */
function unsupportedReason(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xls')) return 'gammelt Excel-format – lagre som .xlsx og last opp';
  if (lower.endsWith('.doc')) return 'gammelt Word-format – lagre som .docx og last opp';
  if (IMAGE.test(lower)) return 'bilde – skannede dokumenter og bilder støttes ikke ennå';
  return 'filtypen støttes ikke (bare PDF, Word, Excel og tekst)';
}

/**
 * Pakker ut ZIP-filen, én fil om gangen: hver fil som kan leses, sendes til `onFile` (som lagrer den) før neste
 * pakkes ut – så minnebruken er én fil, ikke hele pakken. `maxFiles` er hvor mange dokumenter det er plass til;
 * resten hoppes over med grunn. Feil som gjelder hele ZIP-filen (kryptert, tom, skadet, for mange filer, eller for
 * stor utpakket etter det filene selv oppgir) gir ok: false før noe er pakket ut.
 */
export async function unpackZip(
  buf: Buffer,
  opts: { maxFiles: number; maxFileBytes: number; maxTotalBytes?: number; maxEntries?: number },
  onFile: (file: UnpackedFile) => Promise<void> | void,
): Promise<UnpackResult> {
  const maxTotal = opts.maxTotalBytes ?? ZIP_MAX_TOTAL_BYTES;
  const tooLargeTotal = `over ${Math.round(maxTotal / 1024 / 1024)} MB til sammen`;
  let entries: ZipEntry[];
  try {
    entries = readZipEntries(buf, opts.maxEntries ?? ZIP_MAX_ENTRIES);
  } catch (err) {
    if (err instanceof ZipError) return { ok: false, error: err.message };
    throw err;
  }
  const files = entries.filter((e) => !e.isDir);
  if (!files.length) return { ok: false, error: 'ZIP-filen er tom.' };
  if (files.some((e) => e.encrypted)) {
    return { ok: false, error: 'ZIP-filen er kryptert (passordbeskyttet). Pakk den ut og last opp filene hver for seg, eller lag en ny ZIP uten passord.' };
  }
  // Det filene oppgir, til sammen: avvis hele pakken før noe pakkes ut. Taket ved utpakking (under) gjelder uansett.
  if (files.reduce((sum, e) => sum + e.declaredSize, 0) > maxTotal) {
    return { ok: false, error: `ZIP-filen er for stor når den pakkes ut (${tooLargeTotal}).` };
  }

  const skipped: SkippedFile[] = [];
  let accepted = 0;
  let used = 0;
  for (const e of files) {
    const base = e.name.split(/[/\\]/).pop() ?? e.name;
    const skip = (reason: string) => skipped.push({ name: base || e.name, reason });
    if (unsafePath(e.name)) {
      skipped.push({ name: e.name, reason: 'farlig filnavn (peker ut av mappen)' });
      continue;
    }
    if (e.name.startsWith('__MACOSX/') || base.startsWith('._') || SYSTEM_FILES.has(base.toLowerCase())) {
      skip('systemfil fra Mac eller Windows');
      continue;
    }
    if (base.toLowerCase().endsWith('.zip')) {
      skip('ZIP i ZIP pakkes ikke ut – pakk den ut og last opp filene');
      continue;
    }
    if (!/\.(pdf|docx|xlsx|txt)$/.test(base.toLowerCase())) {
      skip(unsupportedReason(base));
      continue;
    }
    if (accepted >= opts.maxFiles) {
      skip('grensen for antall dokumenter per anbud er nådd');
      continue;
    }
    // Taket for denne filen: grensen per fil, eller det som er igjen av grensen for alle til sammen. Taket gjelder
    // det som faktisk pakkes ut – en fil som oppgir feil størrelse, stoppes her.
    const cap = Math.min(opts.maxFileBytes, maxTotal - used);
    let data: Buffer;
    try {
      data = extractZipEntry(buf, e, cap);
    } catch (err) {
      if (err instanceof ZipError && err.code === 'too_large') {
        skip(cap < opts.maxFileBytes ? `ikke plass – pakken er for stor utpakket (${tooLargeTotal})` : `for stor utpakket (over ${Math.round(opts.maxFileBytes / 1024 / 1024)} MB)`);
        continue;
      }
      if (err instanceof ZipError) {
        skip(err.code === 'unsupported' ? 'pakket på en måte som ikke støttes' : 'filen er skadet');
        continue;
      }
      throw err;
    }
    used += data.length;
    const type = detectFileType(data, base);
    if (!type) {
      skip('innholdet stemmer ikke med filtypen');
      continue;
    }
    accepted++;
    await onFile({ name: base, type, data });
  }
  return { ok: true, skipped };
}

/** Meldingen etter opplasting av en ZIP-fil – høyst 480 tegn (meldingen vises på neste side). `ai`: er AI slått på? */
export function zipUploadSummary(
  r: { added: { name: string; pages: number }[]; failed: { name: string }[]; skipped: SkippedFile[] },
  opts: { ai: boolean },
): {
  type: 'success' | 'error';
  message: string;
} {
  const MAX = 480;
  const pages = r.added.reduce((sum, a) => sum + a.pages, 0);
  const head = r.added.length
    ? `${r.added.length} ${r.added.length === 1 ? 'dokument' : 'dokumenter'} lest fra ZIP-filen (${pages} ${pages === 1 ? 'side' : 'sider'}).`
    : 'Ingen filer i ZIP-filen kunne leses.';
  const failed = r.failed.length ? ` Fant ikke tekst i: ${r.failed.map((f) => f.name).join(', ')}.` : '';
  // AI nevnes bare når den er slått på – ellers er det sjekken av krav og vilkår (uten AI) som leser dokumentene.
  const tail = r.added.length ? (opts.ai ? ' Kjør AI-analysen på nytt for å ta dem med.' : ' Sjekken av krav og vilkår har tatt dem med.') : '';
  let skipped = '';
  if (r.skipped.length) {
    const items = r.skipped.map((x) => `${x.name} (${x.reason})`);
    for (let n = items.length; n > 0; n--) {
      const rest = items.length - n;
      const candidate = ` Hoppet over: ${items.slice(0, n).join('; ')}${rest ? ` og ${rest} til` : ''}.`;
      if (head.length + failed.length + candidate.length + tail.length <= MAX || n === 1) {
        skipped = candidate;
        break;
      }
    }
  }
  return { type: r.added.length ? 'success' : 'error', message: `${head}${failed}${skipped}${tail}`.slice(0, MAX) };
}
