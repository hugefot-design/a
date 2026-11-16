/**
 * Tekstuttrekk fra opplastede dokumenter med sidetall (PDF), slik at AI-svar kan
 * henvise til riktig side. Kjører med sikre innstillinger (ingen eval, ingen nettverk).
 * Word og Excel er ZIP-filer og pakkes ut med den trygge ZIP-leseren (zip-reader.ts).
 */
import { xlsxToText } from './xlsx';
import { zipFileReader, ZipError } from './zip-reader';

export type DetectedType = 'pdf' | 'docx' | 'xlsx' | 'txt' | null;

/** Maks utpakket størrelse på teksten i en Word-fil (60 MB). */
export const MAX_DOCX_XML_BYTES = 60 * 1024 * 1024;

/** Avgjør filtype fra innholdet (ikke fra filnavnet alene). */
export function detectFileType(buf: Buffer, filename: string): DetectedType {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const lower = filename.toLowerCase();
  const zip = buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (zip && lower.endsWith('.docx')) return 'docx';
  if (zip && lower.endsWith('.xlsx')) return 'xlsx';
  if (lower.endsWith('.txt')) {
    const sample = buf.subarray(0, 4000);
    if (!sample.includes(0)) return 'txt';
  }
  return null;
}

export interface ExtractedPage {
  page: number;
  text: string;
}

export async function extractPdfPages(data: Buffer, maxPages = 300): Promise<{ pages: ExtractedPage[]; totalPages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    stopAtErrors: false,
    verbosity: 0,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const doc = await task.promise;
  const pages: ExtractedPage[] = [];
  const total = doc.numPages;
  for (let i = 1; i <= Math.min(total, maxPages); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = '';
    let lastY: number | null = null;
    for (const item of content.items as { str?: string; transform?: number[]; hasEOL?: boolean }[]) {
      if (typeof item.str !== 'string') continue;
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += '\n';
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y;
    }
    pages.push({ page: i, text: text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() });
    page.cleanup();
  }
  await task.destroy();
  return { pages, totalPages: total };
}

/**
 * DOCX: henter tekst fra word/document.xml. Word-filer har ikke faste sider, så teksten deles i avsnitt.
 * Pakkes ut med den trygge ZIP-leseren: høyst MAX_DOCX_XML_BYTES, uansett hva filen påstår («zip-bomber»).
 */
export async function extractDocxSections(data: Buffer): Promise<{ pages: ExtractedPage[]; totalPages: number }> {
  let xml: string | null;
  try {
    xml = zipFileReader(data, { maxEntries: 5000, maxTotalBytes: MAX_DOCX_XML_BYTES })('word/document.xml');
  } catch (err) {
    if (err instanceof ZipError && err.code === 'too_large') throw new Error('Word-filen er for stor når den pakkes ut.');
    throw err;
  }
  if (!xml) throw new Error('Fant ikke dokumentinnhold i Word-filen.');
  const text = xml
    .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => p.replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '') + '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
  return chunkText(text);
}

/** Excel: hvert ark og hver rad som tekst (se xlsx.ts), delt i sider som Word. */
export function extractXlsxSections(data: Buffer): { pages: ExtractedPage[]; totalPages: number } {
  try {
    return chunkText(xlsxToText(data, MAX_DOCX_XML_BYTES));
  } catch (err) {
    if (err instanceof ZipError && err.code === 'too_large') throw new Error('Excel-filen er for stor når den pakkes ut.');
    throw err;
  }
}

export function chunkText(text: string, size = 3500): { pages: ExtractedPage[]; totalPages: number } {
  const paragraphs = text.split(/\n+/);
  const pages: ExtractedPage[] = [];
  let current = '';
  for (const p of paragraphs) {
    if ((current + '\n' + p).length > size && current) {
      pages.push({ page: pages.length + 1, text: current.trim() });
      current = '';
    }
    current += (current ? '\n' : '') + p;
  }
  if (current.trim()) pages.push({ page: pages.length + 1, text: current.trim() });
  return { pages, totalPages: pages.length };
}

export async function extractText(type: Exclude<DetectedType, null>, data: Buffer) {
  if (type === 'pdf') return extractPdfPages(data);
  if (type === 'docx') return extractDocxSections(data);
  if (type === 'xlsx') return extractXlsxSections(data);
  return chunkText(data.toString('utf8'));
}
