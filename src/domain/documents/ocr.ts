/**
 * Tekst fra OCR i kundens nettleser (Tesseract.js) for skannede PDF-er – ingen betalt OCR i skyen, og dokumentet
 * sendes ikke til noen andre. Nettleseren leser sidene som ikke har tekst, og sender teksten sammen med filen.
 *
 * Serveren stoler ikke blindt på det som kommer: teksten brukes bare for sider der vår egen PDF-lesing ikke fant
 * tekst (skannede sider), sidetallene må finnes i PDF-en, og det er grenser for antall sider og lengde. Teksten er
 * kundens eget, private dokument – samme tillit som filen selv – og merkes som lest med OCR.
 */
import { z } from 'zod';

/** Så mange sider leser nettleseren med OCR (resten står det om i meldingen). */
export const MAX_OCR_PAGES = 60;
/** Grense for hele OCR-svaret (JSON) i skjemaet. */
export const MAX_OCR_PAYLOAD_CHARS = 1_500_000;
/** En side med færre tegn enn dette regnes som uten tekst (skannet) – både i nettleseren og her. */
export const MIN_TEXT_CHARS_PER_PAGE = 25;

const ocrPayloadZ = z.object({
  engine: z.string().min(1).max(80),
  languages: z.string().min(1).max(40),
  pages: z
    .array(
      z.object({
        page: z.number().int().min(1).max(5000),
        text: z.string().max(20_000),
        confidence: z.number().min(0).max(100).nullable().optional(),
      }),
    )
    .max(MAX_OCR_PAGES),
});
export type OcrPayload = z.infer<typeof ocrPayloadZ>;

/** Leser OCR-feltet fra skjemaet. Null når det mangler eller ikke er gyldig (da behandles filen som før). */
export function parseOcrPayload(raw: unknown): OcrPayload | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > MAX_OCR_PAYLOAD_CHARS) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = ocrPayloadZ.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const hasText = (text: string) => text.replace(/\s+/g, '').length >= MIN_TEXT_CHARS_PER_PAGE;

/**
 * Slår sammen vår egen PDF-tekst med OCR-teksten: OCR brukes bare for sider uten tekst som finnes i PDF-en.
 * Returnerer sidene og hvor mange som kom fra OCR.
 */
export function mergeOcrPages(
  extracted: { pages: { page: number; text: string }[]; totalPages: number },
  ocr: OcrPayload | null,
): { pages: { page: number; text: string }[]; ocrPages: number } {
  const own = new Map(extracted.pages.map((p) => [p.page, p.text]));
  if (!ocr) return { pages: extracted.pages, ocrPages: 0 };
  let ocrPages = 0;
  const merged = new Map(own);
  for (const p of ocr.pages) {
    if (p.page > extracted.totalPages) continue;
    if (hasText(own.get(p.page) ?? '')) continue;
    // Kontrolltegn bort; resten er kundens egen tekst (renses som annen dokumenttekst før AI leser den).
    const clean = p.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim();
    if (!clean) continue;
    merged.set(p.page, clean);
    ocrPages++;
  }
  const pages = [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([page, text]) => ({ page, text }));
  return { pages, ocrPages };
}
