/**
 * Tekstuttrekk fra opplastede dokumenter med sidetall (PDF), slik at AI-svar kan
 * henvise til riktig side. Kjører med sikre innstillinger (ingen eval, ingen nettverk).
 */
export type DetectedType = 'pdf' | 'docx' | 'txt' | null;

/** Avgjør filtype fra innholdet (ikke fra filnavnet alene). */
export function detectFileType(buf: Buffer, filename: string): DetectedType {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const lower = filename.toLowerCase();
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04 && lower.endsWith('.docx')) return 'docx';
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
    stopAtErrors: false,
    verbosity: 0,
  });
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

/** DOCX: henter tekst fra word/document.xml. Word-filer har ikke faste sider, så teksten deles i avsnitt. */
export async function extractDocxSections(data: Buffer): Promise<{ pages: ExtractedPage[]; totalPages: number }> {
  const { default: JSZip } = (await import('jszip')) as unknown as { default: { loadAsync(d: Buffer): Promise<{ file(n: string): { async(t: 'string'): Promise<string> } | null }> } };
  const zip = await JSZip.loadAsync(data);
  const xml = await zip.file('word/document.xml')?.async('string');
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
  return chunkText(data.toString('utf8'));
}
