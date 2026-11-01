import { first, withTenant, type Tx } from '@/lib/db';
import { CONTRACT_NATURES, procedureLabel } from '@/domain/reference';
import { getTender, type TenderDetail } from '@/domain/tenders/queries';
import type { OrgContext } from '@/server/http';
import { formatDateTime, formatMoney } from '@/ui/format';
import { mockBasicSummary, mockTenderAnalysis } from './mock';
import { BASIC_SUMMARY_SYSTEM, TENDER_ANALYSIS_SYSTEM } from './prompts';
import { runAi, type RunAiResult } from './runner';
import { basicSummaryJsonSchema, basicSummaryZ, tenderAnalysisJsonSchema, tenderAnalysisZ } from './schemas';
import { buildSourceBlock, verifyAllRefs, type AnalysisSource, type RefCheck, type SourceCoverage } from './sources';

export function noticeSource(t: TenderDetail): AnalysisSource {
  const lines = [
    `Tittel: ${t.title}`,
    t.buyerName ? `Oppdragsgiver: ${t.buyerName}` : null,
    t.placeText ? `Sted: ${t.placeText}` : null,
    t.cpvCodes.length ? `CPV-koder: ${t.cpvCodes.join(', ')}` : null,
    t.contractNature ? `Kontraktstype: ${CONTRACT_NATURES[t.contractNature] ?? t.contractNature}` : null,
    t.procedureType ? `Prosedyre: ${procedureLabel(t.procedureType)}` : null,
    t.estimatedValue !== null ? `Estimert verdi: ${formatMoney(t.estimatedValue, t.currency, false)}` : 'Estimert verdi: ikke oppgitt',
    t.deadlineAt ? `Tilbudsfrist: ${formatDateTime(t.deadlineAt, t.deadlineTimeKnown)}` : 'Tilbudsfrist: ikke oppgitt',
    t.publishedAt ? `Publisert: ${formatDateTime(t.publishedAt, false)}` : null,
    '',
    'Beskrivelse:',
    t.description ?? '(ingen beskrivelse i kunngjøringen)',
  ].filter((l) => l !== null);
  return { id: 'S0', kind: 'notice', title: 'Kunngjøringen', pages: [{ page: null, text: lines.join('\n') }], totalPages: null, isPrivate: false };
}

export async function loadDocumentSources(tx: Tx, tenderId: string): Promise<AnalysisSource[]> {
  const docs = (await tx`
    select id, title, org_id, page_count from tender_documents
    where tender_id = ${tenderId} and text_status = 'extracted'
    order by created_at asc
    limit 10
  `) as unknown as { id: string; title: string; orgId: string | null; pageCount: number | null }[];
  const sources: AnalysisSource[] = [];
  for (const [i, d] of docs.entries()) {
    const pages = (await tx`
      select page_number, content from tender_document_pages where document_id = ${d.id} order by page_number
    `) as unknown as { pageNumber: number; content: string }[];
    sources.push({
      id: `D${i + 1}`,
      kind: 'document',
      title: d.title,
      pages: pages.map((p) => ({ page: p.pageNumber, text: p.content })),
      totalPages: d.pageCount,
      isPrivate: d.orgId !== null,
      documentId: d.id,
    });
  }
  return sources;
}

export interface StoredTenderAnalysis {
  id: string;
  createdAt: Date;
  orgId: string | null;
  level: 'basic' | 'full';
  data: Record<string, unknown>;
  verification: Record<string, RefCheck>;
  coverage: SourceCoverage[];
  isMock: boolean;
  provider: string;
  model: string;
}

/** Nyeste analyse: foretrekker organisasjonens egen (med dokumenter) foran den delte. */
export async function getLatestTenderAnalysis(tx: Tx, tenderId: string, orgId: string): Promise<StoredTenderAnalysis | null> {
  const row = first(
    (await tx`
      select id, created_at, org_id, result, provider, model from ai_analyses
      where tender_id = ${tenderId} and kind = 'tender_analysis' and status = 'completed'
        and (org_id is null or org_id = ${orgId})
      order by (org_id is not null) desc, (result->>'level' = 'full') desc, created_at desc
      limit 1
    `) as unknown as { id: string; createdAt: Date; orgId: string | null; result: Record<string, unknown>; provider: string; model: string }[],
  );
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    orgId: row.orgId,
    level: (row.result.level as 'basic' | 'full') ?? 'full',
    data: (row.result.data ?? {}) as Record<string, unknown>,
    verification: (row.result.verification ?? {}) as Record<string, RefCheck>,
    coverage: (row.result.coverage ?? []) as SourceCoverage[],
    isMock: Boolean(row.result.isMock),
    provider: row.provider,
    model: row.model,
  };
}

export async function runTenderAnalysis(
  org: OrgContext,
  userId: string,
  tenderId: string,
  opts: { force?: boolean } = {},
): Promise<RunAiResult> {
  const level: 'basic' | 'full' = org.entitlements.aiFullAnalysis ? 'full' : 'basic';
  const prepared = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const tender = await getTender(tx, tenderId);
    if (!tender) return null;
    const docs = level === 'full' ? await loadDocumentSources(tx, tenderId) : [];
    return { tender, sources: [noticeSource(tender), ...docs] };
  });
  if (!prepared) return { ok: false, code: 'invalid_output', error: 'Fant ikke kunngjøringen.' };
  const { block, coverage } = buildSourceBlock(prepared.sources);
  const isPrivate = prepared.sources.some((s) => s.isPrivate);
  const user = `${block}\n\nAnalyser kildene over og svar i henhold til skjemaet.`;

  if (level === 'basic') {
    return runAi({
      kind: 'tender_analysis',
      usageKind: 'ai_tender_analysis',
      org,
      userId,
      tenderId,
      isPrivate: false,
      system: BASIC_SUMMARY_SYSTEM,
      user,
      schemaName: 'tender_summary',
      schemaDescription: 'Kort sammendrag av kunngjøringen',
      schema: basicSummaryJsonSchema,
      validator: basicSummaryZ,
      maxOutputTokens: 1200,
      mockHint: () => mockBasicSummary(prepared.sources),
      hashExtra: 'basic',
      force: opts.force,
      enrich: () => ({ level: 'basic', coverage, verification: {} }),
    });
  }
  return runAi({
    kind: 'tender_analysis',
    usageKind: 'ai_tender_analysis',
    org,
    userId,
    tenderId,
    isPrivate,
    system: TENDER_ANALYSIS_SYSTEM,
    user,
    schemaName: 'tender_analysis',
    schemaDescription: 'Strukturert analyse av en offentlig kunngjøring med kildehenvisninger',
    schema: tenderAnalysisJsonSchema,
    validator: tenderAnalysisZ,
    maxOutputTokens: 4000,
    mockHint: () => mockTenderAnalysis(prepared.sources),
    hashExtra: 'full',
    force: opts.force,
    enrich: (data) => ({ level: 'full', coverage, verification: verifyAllRefs(data, prepared.sources) }),
  });
}
