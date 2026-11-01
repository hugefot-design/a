import { randomUUID } from 'node:crypto';
import { first, withTenant } from '@/lib/db';
import { env } from '@/lib/env';
import { sha256Hex } from '@/lib/crypto';
import { log } from '@/lib/logger';
import { storage } from '@/lib/storage';
import type { OrgContext } from '@/server/http';
import { detectFileType, extractText } from './extract';

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
};

export function cleanFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'dokument';
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150) || 'dokument';
}

export type UploadResult = { ok: true; documentId: string; pages: number } | { ok: false; error: string };

/** Laster opp konkurransedokument for analyse. Lagres privat for organisasjonen. */
export async function uploadTenderDocument(org: OrgContext, userId: string, tenderId: string, file: File): Promise<UploadResult> {
  if (!org.entitlements.documentUpload) return { ok: false, error: 'Opplasting av dokumenter er ikke med i planen din.' };
  if (file.size === 0) return { ok: false, error: 'Filen er tom.' };
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, error: `Filen er større enn ${env.MAX_UPLOAD_MB} MB.` };
  const buf = Buffer.from(await file.arrayBuffer());
  const type = detectFileType(buf, file.name);
  if (!type) return { ok: false, error: 'Filtypen støttes ikke. Last opp PDF, Word (.docx) eller tekstfil (.txt).' };

  const exists = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const t = await tx`select 1 from tenders where id = ${tenderId}`;
    const [count] = (await tx`select count(*)::int as n from tender_documents where tender_id = ${tenderId} and org_id = ${org.id}`) as unknown as { n: number }[];
    return { tender: t.length > 0, count: count?.n ?? 0 };
  });
  if (!exists.tender) return { ok: false, error: 'Fant ikke kunngjøringen.' };
  if (exists.count >= 10) return { ok: false, error: 'Maks 10 dokumenter per kunngjøring. Slett et dokument først.' };

  const title = cleanFilename(file.name);
  const key = `orgs/${org.id}/tenders/${tenderId}/${randomUUID()}.${type}`;
  let extracted: { pages: { page: number; text: string }[]; totalPages: number } | null = null;
  let error: string | null = null;
  try {
    extracted = await extractText(type, buf);
    if (!extracted.pages.some((p) => p.text.trim().length > 0)) {
      error = 'Fant ingen tekst i dokumentet. Skannede dokumenter (bilder) støttes ikke ennå.';
      extracted = null;
    }
  } catch (err) {
    log.warn('document_extract_failed', { err });
    error = 'Kunne ikke lese teksten i dokumentet. Filen kan være skadet eller passordbeskyttet.';
  }
  await storage().put(key, buf, MIME[type]!);

  const documentId = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const [doc] = (await tx`
      insert into tender_documents (tender_id, org_id, title, storage_key, mime_type, size_bytes, page_count, sha256, text_status, text_error, uploaded_by)
      values (${tenderId}, ${org.id}, ${title}, ${key}, ${MIME[type]!}, ${buf.length}, ${extracted?.totalPages ?? null}, ${sha256Hex(buf)},
              ${extracted ? 'extracted' : 'failed'}, ${error}, ${userId})
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
  return { ok: true, documentId, pages: extracted?.totalPages ?? 0 };
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
