import { randomUUID } from 'node:crypto';
import { first, withTenant } from '@/lib/db';
import { env } from '@/lib/env';
import { sha256Hex } from '@/lib/crypto';
import { log } from '@/lib/logger';
import { storage } from '@/lib/storage';
import type { OrgContext } from '@/server/http';
import { detectFileType, extractText, type DetectedType } from './extract';
import { isZipUpload, unpackZip, type SkippedFile } from './zip';
import { mergeOcrPages, type OcrPayload } from './ocr';

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain; charset=utf-8',
};
/** Høyst så mange dokumenter per anbud og organisasjon. */
export const MAX_DOCUMENTS_PER_TENDER = 10;

export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'dokument';
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150) || 'dokument';
}

export type UploadResult = { ok: true; documentId: string; pages: number; ocrPages: number } | { ok: false; error: string };

/** Antall dokumenter organisasjonen har på anbudet – og om anbudet finnes. */
async function documentSlots(org: OrgContext, userId: string, tenderId: string): Promise<{ tender: boolean; count: number }> {
  return withTenant({ userId, orgId: org.id }, async (tx) => {
    const t = await tx`select 1 from tenders where id = ${tenderId}`;
    const [count] = (await tx`select count(*)::int as n from tender_documents where tender_id = ${tenderId} and org_id = ${org.id}`) as unknown as { n: number }[];
    return { tender: t.length > 0, count: count?.n ?? 0 };
  });
}

/** Leser teksten, lagrer filen privat for organisasjonen og registrerer dokumentet (også når teksten ikke kunne leses). */
async function storeDocument(
  org: OrgContext,
  userId: string,
  tenderId: string,
  name: string,
  buf: Buffer,
  type: Exclude<DetectedType, null>,
  ocr: OcrPayload | null = null,
): Promise<UploadResult> {
  const title = cleanFilename(name);
  const key = `orgs/${org.id}/tenders/${tenderId}/${randomUUID()}.${type}`;
  let extracted: { pages: { page: number; text: string }[]; totalPages: number } | null = null;
  let error: string | null = null;
  let ocrPages = 0;
  try {
    extracted = await extractText(type, buf);
    // Skannede sider i en PDF: teksten fra OCR i kundens nettleser brukes for sidene vi ikke fant tekst på.
    if (type === 'pdf' && ocr) {
      const merged = mergeOcrPages(extracted, ocr);
      extracted = { pages: merged.pages, totalPages: extracted.totalPages };
      ocrPages = merged.ocrPages;
    }
    if (!extracted.pages.some((p) => p.text.trim().length > 0)) {
      error =
        type === 'pdf'
          ? 'Fant ingen tekst i dokumentet – det ser skannet ut. Last opp PDF-en alene (ikke i ZIP), så leser nettleseren teksten med OCR.'
          : 'Fant ingen tekst i dokumentet.';
      extracted = null;
    }
  } catch (err) {
    log.warn('document_extract_failed', { err });
    error = 'Kunne ikke lese teksten i dokumentet. Filen kan være skadet eller passordbeskyttet.';
  }
  await storage().put(key, buf, MIME[type]!);

  const documentId = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const [doc] = (await tx`
      insert into tender_documents (tender_id, org_id, title, storage_key, mime_type, size_bytes, page_count, sha256, text_status, text_error, uploaded_by, ocr_pages)
      values (${tenderId}, ${org.id}, ${title}, ${key}, ${MIME[type]!}, ${buf.length}, ${extracted?.totalPages ?? null}, ${sha256Hex(buf)},
              ${extracted ? 'extracted' : 'failed'}, ${error}, ${userId}, ${extracted ? ocrPages : 0})
      returning id
    `) as unknown as { id: string }[];
    if (extracted) {
      const pages = extracted.pages.filter((p) => p.text.trim());
      for (let i = 0; i < pages.length; i += 200) {
        const chunk = pages.slice(i, i + 200);
        await tx`
          insert into tender_document_pages (document_id, org_id, page_number, content)
          select ${doc!.id}, ${org.id}, x.page, x.content
          from unnest(${chunk.map((p) => p.page)}::int[], ${chunk.map((p) => p.text.slice(0, 50_000))}::text[]) as x(page, content)
        `;
      }
    }
    return doc!.id;
  });
  if (error) return { ok: false, error };
  return { ok: true, documentId, pages: extracted?.totalPages ?? 0, ocrPages };
}

/** Laster opp konkurransedokument for analyse. Lagres privat for organisasjonen. */
export async function uploadTenderDocument(org: OrgContext, userId: string, tenderId: string, file: File, ocr: OcrPayload | null = null): Promise<UploadResult> {
  if (!org.entitlements.documentUpload) return { ok: false, error: 'Opplasting av dokumenter er ikke med i planen din.' };
  if (file.size === 0) return { ok: false, error: 'Filen er tom.' };
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: `Filen er større enn ${env.MAX_UPLOAD_MB} MB.` };
  const buf = Buffer.from(await file.arrayBuffer());
  const type = detectFileType(buf, file.name);
  if (!type) return { ok: false, error: 'Filtypen støttes ikke. Last opp PDF, Word (.docx), Excel (.xlsx), tekstfil (.txt) eller hele ZIP-filen fra portalen.' };

  const exists = await documentSlots(org, userId, tenderId);
  if (!exists.tender) return { ok: false, error: 'Fant ikke kunngjøringen.' };
  if (exists.count >= MAX_DOCUMENTS_PER_TENDER) return { ok: false, error: `Maks ${MAX_DOCUMENTS_PER_TENDER} dokumenter per kunngjøring. Slett et dokument først.` };
  return storeDocument(org, userId, tenderId, file.name, buf, type, ocr);
}

export type ZipUploadResult =
  | { ok: true; added: { name: string; pages: number }[]; failed: { name: string; error: string }[]; skipped: SkippedFile[] }
  | { ok: false; error: string };

/**
 * Hele pakken fra portalen som én ZIP-fil: hver PDF-, Word-, Excel- og tekstfil blir ett dokument (så langt det er
 * plass til innenfor grensen per anbud). Det som hoppes over eller ikke kan leses, kommer tilbake med grunn.
 */
export async function uploadTenderZip(org: OrgContext, userId: string, tenderId: string, file: File): Promise<ZipUploadResult> {
  if (!org.entitlements.documentUpload) return { ok: false, error: 'Opplasting av dokumenter er ikke med i planen din.' };
  if (file.size === 0) return { ok: false, error: 'Filen er tom.' };
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: `Filen er større enn ${env.MAX_UPLOAD_MB} MB.` };
  const buf = Buffer.from(await file.arrayBuffer());
  if (!isZipUpload(buf, file.name)) return { ok: false, error: 'Filen er ikke en ZIP-fil.' };
  const exists = await documentSlots(org, userId, tenderId);
  if (!exists.tender) return { ok: false, error: 'Fant ikke kunngjøringen.' };
  const room = MAX_DOCUMENTS_PER_TENDER - exists.count;
  if (room <= 0) return { ok: false, error: `Maks ${MAX_DOCUMENTS_PER_TENDER} dokumenter per kunngjøring. Slett et dokument først.` };

  const added: { name: string; pages: number }[] = [];
  const failed: { name: string; error: string }[] = [];
  // Én fil om gangen: pakkes ut, leses og lagres før neste – så minnebruken er én fil, ikke hele pakken.
  const unpacked = await unpackZip(buf, { maxFiles: room, maxFileBytes: env.MAX_UPLOAD_MB * 1024 * 1024 }, async (f) => {
    const res = await storeDocument(org, userId, tenderId, f.name, f.data, f.type);
    if (res.ok) added.push({ name: f.name, pages: res.pages });
    else failed.push({ name: f.name, error: res.error });
  });
  if (!unpacked.ok) return unpacked;
  return { ok: true, added, failed, skipped: unpacked.skipped };
}

export async function deleteTenderDocument(org: OrgContext, userId: string, documentId: string): Promise<boolean> {
  const key = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const row = first(
      (await tx`delete from tender_documents where id = ${documentId} and org_id = ${org.id} returning storage_key`) as unknown as {
        storageKey: string | null;
      }[],
    );
    return row ? (row.storageKey ?? '') : null;
  });
  if (key === null) return false;
  if (key) await storage().remove([key]).catch((err) => log.warn('storage_remove_failed', { err }));
  return true;
}
