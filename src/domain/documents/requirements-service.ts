/**
 * Kobler kravsjekken (requirements.ts) til databasen: hvilke kilder som leses for et anbud, og hvordan
 * funnene legges i sjekklisten i tilbudsarbeidet. Ingen AI.
 */
import { first, type Tx } from '@/lib/db';
import { loadDocumentSources, noticeSource } from '@/domain/ai/analysis';
import { isEnvironmentNonCriterion } from '@/domain/tenders/eforms-facts';
import { getTender, type TenderDetail } from '@/domain/tenders/queries';
import type { OrgContext } from '@/server/http';
import { CHECKLIST_KINDS, scanRequirements, sourceLabel, type RequirementScan } from './requirements';

/** Høyst så mange punkter legges i sjekklisten om gangen (resten vises på anbudssiden). */
export const MAX_CHECKLIST_IMPORT = 100;

/**
 * Kravsjekk for ett anbud. Fra kunngjøringen søkes det bare i beskrivelsen (oppdragsgivers fritekst) –
 * kvalifikasjons- og tildelingskriteriene hentes fra egne felt, og øvrige felt (frister, verdi) vises andre
 * steder på siden. Dokumentene leses bare når planen har dokumentopplasting.
 */
export async function tenderRequirementScan(tx: Tx, tender: TenderDetail, withDocuments: boolean): Promise<RequirementScan> {
  const notice = { ...noticeSource(tender), pages: [{ page: null, text: tender.description ?? '' }] };
  const docs = withDocuments ? await loadDocumentSources(tx, tender.id) : [];
  return scanRequirements([notice, ...docs], {
    selectionCriteria: tender.selectionCriteria,
    // Klimakrav i spesifikasjonen og unntak (norske eForms-koder) er ikke tildelingskriterier.
    awardCriteria: (tender.awardCriteria ?? []).filter((c) => !isEnvironmentNonCriterion(c.type)),
  });
}

const sameLabel = (s: string) => s.toLowerCase().replace(/[^a-zæøå0-9]+/g, ' ').trim();

export type AddRequirementsResult =
  | { ok: true; added: number; alreadyThere: number; found: number; capped: boolean }
  | { ok: false; error: string; notFound?: boolean };

/**
 * Legger kravene (unntatt tildelingskriterier) i sjekklisten, i prioritert rekkefølge. Punkter som allerede
 * står i listen (samme tekst) legges ikke inn på nytt, så knappen kan trykkes flere ganger – for eksempel
 * etter at et nytt dokument er lastet opp. Kjøres i organisasjonens transaksjon (RLS).
 */
export async function addRequirementsToChecklist(tx: Tx, org: OrgContext, workspaceId: string): Promise<AddRequirementsResult> {
  const ws = first(
    (await tx`select tender_id, status from bid_workspaces where id = ${workspaceId} and org_id = ${org.id}`) as unknown as { tenderId: string; status: string }[],
  );
  if (!ws) return { ok: false, error: 'Fant ikke tilbudsarbeidet.', notFound: true };
  if (ws.status === 'submitted' || ws.status === 'archived') return { ok: false, error: 'Tilbudet er låst.' };
  const tender = await getTender(tx, ws.tenderId);
  if (!tender) return { ok: false, error: 'Fant ikke kunngjøringen.' };
  const scan = await tenderRequirementScan(tx, tender, org.entitlements.documentUpload);

  const existing = new Set(
    ((await tx`select label from bid_checklist_items where workspace_id = ${workspaceId}`) as unknown as { label: string }[]).map((r) => sameLabel(r.label)),
  );
  const [max] = (await tx`select coalesce(max(sort_order), 0)::int as m from bid_checklist_items where workspace_id = ${workspaceId}`) as unknown as { m: number }[];
  let order = (max?.m ?? 0) + 1;
  let added = 0;
  let alreadyThere = 0;
  let found = 0;
  for (const kind of CHECKLIST_KINDS) {
    for (const hit of scan.byKind[kind]) {
      found++;
      const label = hit.text.slice(0, 500);
      const key = sameLabel(label);
      if (existing.has(key)) {
        alreadyThere++;
        continue;
      }
      if (added >= MAX_CHECKLIST_IMPORT) continue;
      existing.add(key);
      await tx`
        insert into bid_checklist_items (workspace_id, org_id, label, category, source, source_ref, sort_order)
        values (${workspaceId}, ${org.id}, ${label}, ${kind}, 'krav', ${sourceLabel(hit).slice(0, 300)}, ${order++})
      `;
      added++;
    }
  }
  return { ok: true, added, alreadyThere, found, capped: found - alreadyThere > added };
}
