/**
 * Trygg lesing av ZIP-filer fra brukere (ZIP-pakker fra portalene, og Excel- og Word-filer, som også er ZIP),
 * bare med det Node har innebygd (zlib).
 *
 * Opplastede filer er ikke til å stole på:
 * - Størrelsen en fil sier den har utpakket, kan være løgn («zip-bombe»). Derfor pakkes hver fil ut med et hardt tak
 *   (`maxOutputLength`) – utpakkingen stopper når taket nås, uansett hva filen påstår.
 * - Krypterte filer, ukjente komprimeringsmetoder og ZIP64 avvises med en tydelig grunn.
 * - Innholdet kontrolleres mot sjekksummen (CRC-32), så skadede filer ikke leses som om de var hele.
 * - Navnene leses som de står (UTF-8 når filen sier det, ellers kodesiden norske Windows-maskiner bruker), og
 *   vurderes av den som kaller (se unsafePath).
 */
import { crc32, inflateRawSync } from 'node:zlib';

export class ZipError extends Error {
  constructor(
    readonly code: 'damaged' | 'encrypted' | 'unsupported' | 'too_large' | 'zip64',
    message: string,
  ) {
    super(message);
  }
}

export interface ZipEntry {
  /** Navnet slik det står i ZIP-filen (med mapper). */
  name: string;
  isDir: boolean;
  encrypted: boolean;
  /** 0 = lagret ukomprimert, 8 = deflate. Andre metoder støttes ikke. */
  method: number;
  compressedSize: number;
  /** Det filen påstår. Brukes bare til å avvise tidlig – taket ved utpakking er det som gjelder. */
  declaredSize: number;
  crc: number;
  dataStart: number;
}

// Kodesiden norske Windows-maskiner skriver ZIP-navn med (cp865 – som cp437, men med ø, Ø og ¤).
const CP865_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø₧ƒáíóúñÑªº¿⌐¬½¼¡«¤░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
export const decodeCp865 = (b: Buffer) => [...b].map((c) => (c < 0x80 ? String.fromCharCode(c) : CP865_HIGH[c - 0x80]!)).join('');

/** «Info-ZIP Unicode Path» (0x7075): UTF-8-navnet mange programmer legger ved i tillegg til det gamle navnet. */
function unicodePath(extra: Buffer): string | null {
  for (let i = 0; i + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(i);
    const size = extra.readUInt16LE(i + 2);
    if (id === 0x7075 && size >= 5 && i + 4 + size <= extra.length) return extra.subarray(i + 9, i + 4 + size).toString('utf8');
    i += 4 + size;
  }
  return null;
}

/** Leser innholdsfortegnelsen (sentralkatalogen). Kaster ZipError når filen ikke er en ZIP vi kan lese trygt. */
export function readZipEntries(buf: Buffer, maxEntries: number): ZipEntry[] {
  const damaged = () => new ZipError('damaged', 'ZIP-filen er skadet eller ikke en ZIP-fil.');
  // Slutten av sentralkatalogen ligger de siste 22 bytene (pluss en eventuell kommentar på inntil 64 kB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw damaged();
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ZipError('zip64', 'ZIP-filen bruker et format for svært store filer (ZIP64), som ikke støttes.');
  if (total > maxEntries) throw new ZipError('too_large', `ZIP-filen har for mange filer (over ${maxEntries}).`);
  if (cdOffset + cdSize > eocd) throw damaged();

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw damaged();
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const declaredSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen > buf.length) throw damaged();
    const rawName = buf.subarray(p + 46, p + 46 + nameLen);
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    const name = flags & 0x800 ? rawName.toString('utf8') : (unicodePath(extra) ?? decodeCp865(rawName));
    if (compressedSize === 0xffffffff || declaredSize === 0xffffffff || local === 0xffffffff) {
      throw new ZipError('zip64', 'ZIP-filen bruker et format for svært store filer (ZIP64), som ikke støttes.');
    }
    // Dataene starter etter den lokale overskriften (som har sin egen lengde på navn og ekstrafelt).
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw damaged();
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + compressedSize > buf.length) throw damaged();
    entries.push({ name, isDir: name.endsWith('/') || name.endsWith('\\'), encrypted: Boolean(flags & 0x1), method, compressedSize, declaredSize, crc, dataStart });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Pakker ut én fil, høyst `maxBytes` – uansett hva filen påstår. */
export function extractZipEntry(buf: Buffer, e: ZipEntry, maxBytes: number): Buffer {
  if (e.encrypted) throw new ZipError('encrypted', 'Filen er kryptert (passordbeskyttet).');
  if (e.declaredSize > maxBytes) throw new ZipError('too_large', 'Filen er for stor når den pakkes ut.');
  const raw = buf.subarray(e.dataStart, e.dataStart + e.compressedSize);
  let out: Buffer;
  if (e.method === 0) {
    if (raw.length > maxBytes) throw new ZipError('too_large', 'Filen er for stor når den pakkes ut.');
    out = Buffer.from(raw);
  } else if (e.method === 8) {
    try {
      out = inflateRawSync(raw, { maxOutputLength: maxBytes });
    } catch (err) {
      if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) throw new ZipError('too_large', 'Filen er for stor når den pakkes ut.');
      throw new ZipError('damaged', 'Filen i ZIP-filen er skadet.');
    }
  } else {
    throw new ZipError('unsupported', 'Filen er pakket på en måte som ikke støttes.');
  }
  if (crc32(out) >>> 0 !== e.crc >>> 0) throw new ZipError('damaged', 'Filen i ZIP-filen er skadet (sjekksummen stemmer ikke).');
  return out;
}

/** Navn som kan peke ut av mappen: absolutt sti, stasjonsbokstav, «..» eller nulltegn. */
export function unsafePath(name: string): boolean {
  return /^[/\\]/.test(name) || /^[a-zA-Z]:/.test(name) || name.includes('\0') || name.split(/[/\\]/).some((part) => part === '..');
}

/** Leser én fil inne i en ZIP (f.eks. «xl/workbook.xml» i en Excel-fil). Null når den ikke finnes. */
export function zipFileReader(buf: Buffer, opts: { maxEntries: number; maxTotalBytes: number }) {
  const entries = readZipEntries(buf, opts.maxEntries);
  const byName = new Map(entries.map((e) => [e.name, e]));
  let used = 0;
  return (name: string): string | null => {
    const e = byName.get(name);
    if (!e || e.isDir) return null;
    const out = extractZipEntry(buf, e, Math.max(0, opts.maxTotalBytes - used));
    used += out.length;
    return out.toString('utf8');
  };
}
