import { first, type Tx } from '@/lib/db';
import type { OrgContext } from '@/server/http';

export const BOOKMARK_STATUSES: Record<string, string> = {
  watching: 'Følger med',
  preparing: 'Forbereder tilbud',
  submitted: 'Tilbud levert',
  won: 'Vunnet',
  lost: 'Ikke vunnet',
  declined: 'Valgt bort',
};

export async function toggleBookmark(
  tx: Tx,
  org: OrgContext,
  userId: string,
  tenderId: string,
): Promise<{ ok: true; bookmarked: boolean } | { ok: false; error: string }> {
  const existing = first((await tx`select id from bookmarks where org_id = ${org.id} and tender_id = ${tenderId}`) as unknown as { id: string }[]);
  if (existing) {
    await tx`delete from bookmarks where id = ${existing.id}`;
    return { ok: true, bookmarked: false };
  }
  const [count] = (await tx`select count(*)::int as n from bookmarks where org_id = ${org.id}`) as unknown as { n: number }[];
  if ((count?.n ?? 0) >= org.entitlements.maxBookmarks) {
    return { ok: false, error: `Planen din har plass til ${org.entitlements.maxBookmarks} lagrede anbud. Fjern noen eller oppgrader.` };
  }
  const tender = await tx`select 1 from tenders where id = ${tenderId}`;
  if (!tender.length) return { ok: false, error: 'Fant ikke kunngjøringen.' };
  await tx`
    insert into bookmarks (org_id, tender_id, created_by) values (${org.id}, ${tenderId}, ${userId})
    on conflict (org_id, tender_id) do nothing
  `;
  return { ok: true, bookmarked: true };
}

export interface BookmarkRow {
  id: string;
  tenderId: string;
  status: string;
  note: string | null;
  createdAt: Date;
  title: string;
  buyerName: string | null;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  estimatedValue: number | null;
  currency: string | null;
  tenderStatus: string;
  isSample: boolean;
  score: number | null;
  createdByName: string | null;
  workspaceId: string | null;
}

export async function listBookmarks(tx: Tx, orgId: string, status?: string): Promise<BookmarkRow[]> {
  return (await tx`
    select b.id, b.tender_id, b.status, b.note, b.created_at, t.title, t.buyer_name, t.deadline_at, t.deadline_time_known,
           t.estimated_value, t.currency, tender_status(t.lifecycle, t.deadline_at, t.published_at) as tender_status, t.is_sample,
           m.score, u.name as created_by_name, w.id as workspace_id
    from bookmarks b
    join tenders t on t.id = b.tender_id
    left join match_results m on m.tender_id = b.tender_id and m.org_id = b.org_id
    left join users u on u.id = b.created_by
    left join bid_workspaces w on w.tender_id = b.tender_id and w.org_id = b.org_id
    where b.org_id = ${orgId} ${status ? tx`and b.status = ${status}` : tx``}
    order by t.deadline_at asc nulls last, b.created_at desc
  `) as unknown as BookmarkRow[];
}

export async function updateBookmark(tx: Tx, orgId: string, bookmarkId: string, data: { status: string; note: string | null }): Promise<boolean> {
  if (!(data.status in BOOKMARK_STATUSES)) return false;
  const rows = await tx`
    update bookmarks set status = ${data.status}, note = ${data.note}
    where id = ${bookmarkId} and org_id = ${orgId} returning id
  `;
  return rows.length > 0;
}
