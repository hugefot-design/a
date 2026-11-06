/**
 * Tilbudsarbeid: sjekkliste, tekstseksjoner, dokumenter og godkjenningsflyt.
 * AnbudRadar sender ALDRI inn tilbud. Godkjenning av et menneske kreves før tilbudet
 * kan merkes som levert i oppdragsgivers konkurransegjennomføringsverktøy.
 */
import { randomUUID } from 'node:crypto';
import { first, withTenant, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { audit } from '@/lib/audit';
import { storage } from '@/lib/storage';
import type { OrgContext, OrgRole } from '@/server/http';
import { cleanFilename } from '@/domain/documents/documents';

export const BID_STATUSES: Record<string, string> = {
  draft: 'Utkast',
  in_review: 'Til gjennomgang',
  approved: 'Godkjent',
  submitted: 'Levert',
  archived: 'Arkivert',
};

export const STANDARD_CHECKLIST: { label: string; category: string }[] = [
  { label: 'Les konkurransegrunnlaget og alle vedlegg', category: 'frist' },
  { label: 'Noter spørsmålsfristen og send eventuelle spørsmål til oppdragsgiver', category: 'frist' },
  { label: 'Fyll ut egenerklæringsskjema (ESPD) hvis det kreves', category: 'dokumentasjon' },
  { label: 'Skaff skatteattest (kreves ofte – sjekk alderskravet i konkurransegrunnlaget)', category: 'dokumentasjon' },
  { label: 'Skaff firmaattest', category: 'dokumentasjon' },
  { label: 'Dokumenter alle kvalifikasjonskrav (sertifikater, godkjenninger, referanser)', category: 'kvalifikasjon' },
  { label: 'Besvar alle krav i kravspesifikasjonen', category: 'løsning' },
  { label: 'Fyll ut prisskjemaet', category: 'pris' },
  { label: 'Signer tilbudsbrevet', category: 'dokumentasjon' },
  { label: 'Last opp tilbudet i oppdragsgivers system før fristen', category: 'frist' },
];

export const STANDARD_SECTIONS: string[] = [
  'Om leverandøren',
  'Forståelse av oppdraget',
  'Løsning og gjennomføring',
  'Bemanning og kompetanse',
  'Kvalitetssikring og HMS',
  'Miljø og samfunnsansvar',
  'Referanser',
];

export interface Workspace {
  id: string;
  tenderId: string;
  title: string;
  status: string;
  ownerUserId: string | null;
  reviewRequestedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  tenderTitle: string;
  buyerName: string | null;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  sourceUrl: string | null;
  isSample: boolean;
}

export interface ChecklistItem {
  id: string;
  label: string;
  category: string;
  source: string;
  sourceRef: string | null;
  isDone: boolean;
  doneAt: Date | null;
}

export interface Section {
  id: string;
  title: string;
  requirement: string | null;
  content: string;
  aiAssisted: boolean;
  updatedAt: Date;
  updatedByName: string | null;
}

export interface BidDocument {
  id: string;
  name: string;
  category: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: Date;
  uploadedByName: string | null;
}

export async function createWorkspace(org: OrgContext, userId: string, tenderId: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!org.entitlements.bidAssistant) return { ok: false, error: 'Tilbudsarbeid er med i Bedrift-planen.' };
  return withTenant({ userId, orgId: org.id }, async (tx) => {
    const existing = first((await tx`select id from bid_workspaces where org_id = ${org.id} and tender_id = ${tenderId}`) as unknown as { id: string }[]);
    if (existing) return { ok: true as const, id: existing.id };
    const tender = first((await tx`select title from tenders where id = ${tenderId}`) as unknown as { title: string }[]);
    if (!tender) return { ok: false as const, error: 'Fant ikke kunngjøringen.' };
    const [ws] = (await tx`
      insert into bid_workspaces (org_id, tender_id, title, owner_user_id) values (${org.id}, ${tenderId}, ${tender.title.slice(0, 300)}, ${userId})
      returning id
    `) as unknown as { id: string }[];
    for (const [i, item] of STANDARD_CHECKLIST.entries()) {
      await tx`
        insert into bid_checklist_items (workspace_id, org_id, label, category, source, sort_order)
        values (${ws!.id}, ${org.id}, ${item.label}, ${item.category}, 'standard', ${i})
      `;
    }
    for (const [i, title] of STANDARD_SECTIONS.entries()) {
      await tx`insert into bid_sections (workspace_id, org_id, title, sort_order) values (${ws!.id}, ${org.id}, ${title}, ${i})`;
    }
    await tx`
      insert into bookmarks (org_id, tender_id, created_by, status) values (${org.id}, ${tenderId}, ${userId}, 'preparing')
      on conflict (org_id, tender_id) do update set status = 'preparing'
    `;
    return { ok: true as const, id: ws!.id };
  });
}

export async function listWorkspaces(tx: Tx, orgId: string) {
  return (await tx`
    select w.id, w.title, w.status, w.updated_at, t.deadline_at, t.deadline_time_known, t.buyer_name, t.is_sample,
      (select count(*)::int from bid_checklist_items c where c.workspace_id = w.id) as items_total,
      (select count(*)::int from bid_checklist_items c where c.workspace_id = w.id and c.is_done) as items_done
    from bid_workspaces w join tenders t on t.id = w.tender_id
    where w.org_id = ${orgId}
    order by (w.status in ('submitted', 'archived')), t.deadline_at asc nulls last
  `) as unknown as {
    id: string;
    title: string;
    status: string;
    updatedAt: Date;
    deadlineAt: Date | null;
    deadlineTimeKnown: boolean;
    buyerName: string | null;
    isSample: boolean;
    itemsTotal: number;
    itemsDone: number;
  }[];
}

export async function loadWorkspace(tx: Tx, orgId: string, id: string) {
  const ws = first(
    (await tx`
      select w.*, t.title as tender_title, t.buyer_name, t.deadline_at, t.deadline_time_known, t.source_url, t.is_sample,
             u.name as approved_by_name
      from bid_workspaces w join tenders t on t.id = w.tender_id left join users u on u.id = w.approved_by
      where w.id = ${id} and w.org_id = ${orgId}
    `) as unknown as Workspace[],
  );
  if (!ws) return null;
  const checklist = (await tx`
    select id, label, category, source, source_ref, is_done, done_at from bid_checklist_items
    where workspace_id = ${id} order by sort_order, created_at
  `) as unknown as ChecklistItem[];
  const sections = (await tx`
    select s.id, s.title, s.requirement, s.content, s.ai_assisted, s.updated_at, u.name as updated_by_name
    from bid_sections s left join users u on u.id = s.updated_by
    where s.workspace_id = ${id} order by s.sort_order, s.created_at
  `) as unknown as Section[];
  const documents = (await tx`
    select d.id, d.name, d.category, d.mime_type, d.size_bytes, d.created_at, u.name as uploaded_by_name
    from bid_documents d left join users u on u.id = d.uploaded_by where d.workspace_id = ${id} order by d.created_at desc
  `) as unknown as BidDocument[];
  const review = first(
    (await tx`
      select result, created_at from ai_analyses where workspace_id = ${id} and kind = 'bid_review' and status = 'completed'
      order by created_at desc limit 1
    `) as unknown as { result: Record<string, unknown>; createdAt: Date }[],
  );
  return { ws, checklist, sections, documents, review };
}

/** Deterministisk sjekk av hva som mangler (ingen AI). */
export function missingInfo(sections: Section[], checklist: ChecklistItem[]) {
  const placeholders = sections.flatMap((s) => [...s.content.matchAll(/\[FYLL INN:[^\]]*\]/g)].map((m) => ({ section: s.title, text: m[0] })));
  const emptySections = sections.filter((s) => s.content.trim().length < 20).map((s) => s.title);
  const openItems = checklist.filter((c) => !c.isDone).map((c) => c.label);
  return { placeholders, emptySections, openItems, ready: placeholders.length === 0 && emptySections.length === 0 && openItems.length === 0 };
}

// ---------------------------------------------------------------------------
// Status og godkjenning
// ---------------------------------------------------------------------------
export type BidAction = 'request_review' | 'approve' | 'reopen' | 'mark_submitted' | 'archive';

export function allowedActions(status: string, role: OrgRole): BidAction[] {
  const manager = role === 'owner' || role === 'admin';
  switch (status) {
    case 'draft':
      return ['request_review', 'archive'];
    case 'in_review':
      return [...(manager ? (['approve'] as BidAction[]) : []), 'reopen'];
    case 'approved':
      return ['mark_submitted', 'reopen'];
    case 'submitted':
      return ['archive'];
    case 'archived':
      return ['reopen'];
    default:
      return [];
  }
}

export async function changeStatus(
  org: OrgContext,
  userId: string,
  workspaceId: string,
  action: BidAction,
  confirmed: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return withTenant({ userId, orgId: org.id }, async (tx) => {
    const ws = first((await tx`select status from bid_workspaces where id = ${workspaceId} and org_id = ${org.id} for update`) as unknown as { status: string }[]);
    if (!ws) return { ok: false as const, error: 'Fant ikke tilbudsarbeidet.' };
    if (!allowedActions(ws.status, org.role).includes(action)) return { ok: false as const, error: 'Handlingen er ikke tillatt nå.' };
    switch (action) {
      case 'request_review':
        await tx`update bid_workspaces set status = 'in_review', review_requested_by = ${userId}, review_requested_at = now() where id = ${workspaceId}`;
        break;
      case 'approve':
        await tx`update bid_workspaces set status = 'approved', approved_by = ${userId}, approved_at = now() where id = ${workspaceId}`;
        break;
      case 'reopen':
        await tx`update bid_workspaces set status = 'draft', approved_by = null, approved_at = null where id = ${workspaceId}`;
        break;
      case 'mark_submitted':
        if (!confirmed) return { ok: false as const, error: 'Bekreft at tilbudet er lastet opp hos oppdragsgiver.' };
        await tx`update bid_workspaces set status = 'submitted', submitted_by = ${userId}, submitted_at = now() where id = ${workspaceId}`;
        await tx`update bookmarks set status = 'submitted', submitted_at = coalesce(submitted_at, now()) where org_id = ${org.id} and tender_id = (select tender_id from bid_workspaces where id = ${workspaceId}) and status not in ('won', 'lost')`;
        break;
      case 'archive':
        await tx`update bid_workspaces set status = 'archived' where id = ${workspaceId}`;
        break;
    }
    await audit({ action: 'bid.status_changed', orgId: org.id, actorUserId: userId, targetType: 'bid_workspace', targetId: workspaceId, metadata: { action } });
    return { ok: true as const };
  });
}

/** Endringer i innhold setter et godkjent tilbud tilbake til utkast (godkjenningen gjaldt en annen versjon). */
export async function invalidateApproval(tx: Tx, workspaceId: string): Promise<void> {
  await tx`update bid_workspaces set status = 'draft', approved_by = null, approved_at = null where id = ${workspaceId} and status = 'approved'`;
}

// ---------------------------------------------------------------------------
// Dokumenter
// ---------------------------------------------------------------------------
const ALLOWED = /\.(pdf|docx|xlsx|doc|xls|txt|png|jpg|jpeg|zip)$/i;

/** Filtypen bestemmes av filendelsen på serveren – aldri av det nettleseren oppgir (kan forfalskes). */
export const BID_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  txt: 'text/plain; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  zip: 'application/zip',
};

export async function uploadBidDocument(org: OrgContext, userId: string, workspaceId: string, file: File, category: string) {
  if (file.size === 0) return { ok: false as const, error: 'Filen er tom.' };
  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) return { ok: false as const, error: `Filen er større enn ${env.MAX_UPLOAD_MB} MB.` };
  const name = cleanFilename(file.name);
  if (!ALLOWED.test(name)) return { ok: false as const, error: 'Filtypen støttes ikke.' };
  const ext = name.split('.').pop()!.toLowerCase();
  const key = `orgs/${org.id}/bids/${workspaceId}/${randomUUID()}.${ext}`;
  const exists = await withTenant({ userId, orgId: org.id }, (tx) => tx`select 1 from bid_workspaces where id = ${workspaceId} and org_id = ${org.id}`);
  if (!exists.length) return { ok: false as const, error: 'Fant ikke tilbudsarbeidet.' };
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = BID_MIME[ext] ?? 'application/octet-stream';
  await storage().put(key, buf, mime);
  await withTenant({ userId, orgId: org.id }, async (tx) => {
    await tx`
      insert into bid_documents (workspace_id, org_id, name, category, storage_key, mime_type, size_bytes, uploaded_by)
      values (${workspaceId}, ${org.id}, ${name}, ${category.slice(0, 40) || 'vedlegg'}, ${key}, ${mime}, ${buf.length}, ${userId})
    `;
    await invalidateApproval(tx, workspaceId);
  });
  return { ok: true as const };
}

export async function getBidDocument(org: OrgContext, userId: string, documentId: string) {
  const row = await withTenant({ userId, orgId: org.id }, async (tx) =>
    first(
      (await tx`select name, storage_key, mime_type from bid_documents where id = ${documentId} and org_id = ${org.id}`) as unknown as {
        name: string;
        storageKey: string;
        mimeType: string | null;
      }[],
    ),
  );
  if (!row) return null;
  // Eldre rader kan ha typen nettleseren oppga; bruk filendelsen.
  const ext = row.name.split('.').pop()?.toLowerCase() ?? '';
  return { name: row.name, mimeType: BID_MIME[ext] ?? 'application/octet-stream', data: await storage().get(row.storageKey) };
}

export async function deleteBidDocument(org: OrgContext, userId: string, documentId: string): Promise<boolean> {
  const key = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const row = first((await tx`delete from bid_documents where id = ${documentId} and org_id = ${org.id} returning storage_key, workspace_id`) as unknown as {
      storageKey: string;
      workspaceId: string;
    }[]);
    if (row) await invalidateApproval(tx, row.workspaceId);
    return row?.storageKey ?? null;
  });
  if (!key) return false;
  await storage().remove([key]).catch(() => undefined);
  return true;
}
