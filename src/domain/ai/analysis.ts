import { first, withTenant, type Tx } from '@/lib/db';
import { CONTRACT_NATURES, procedureLabel } from '@/domain/reference';
import { getTender, type TenderDetail } from '@/domain/tenders/queries';
import type { OrgContext } from '@/server/http';
import { formatDateTime, formatMoney } from '@/ui/format';
import { getProfile, profileFactsForAi } from '@/domain/profile/profile';
import { mockBasicSummary, mockFitAssessment, mockTenderAnalysis } from './mock';
import { BASIC_SUMMARY_SYSTEM, FIT_ASSESSMENT_SYSTEM, TENDER_ANALYSIS_SYSTEM } from './prompts';
import { runAi, type RunAiResult } from './runner';
import {
  basicSummaryJsonSchema,
  basicSummaryZ,
  fitAssessmentJsonSchema,
  fitAssessmentZ,
  tenderAnalysisJsonSchema,
  tenderAnalysisZ,
  type FitAssessment,
} from './schemas';
import { buildSourceBlock, sanitizeSourceText, verifyAllRefs, type AnalysisSource, type RefCheck, type SourceCoverage } from './sources';

export function noticeSource(t: TenderDetail): AnalysisSource {
  const lines: (string | null)[] = [
    `Tittel: ${t.title}`,
    t.buyerName ? `Oppdragsgiver: ${t.buyerName}` : null,
    t.placeText ? `Sted: ${t.placeText}` : null,
    t.cpvCodes.length ? `CPV-koder: ${t.cpvCodes.join(', ')}` : null,
    t.contractNature ? `Kontraktstype: ${CONTRACT_NATURES[t.contractNature] ?? t.contractNature}` : null,
    t.procedureType ? `Prosedyre: ${procedureLabel(t.procedureType)}` : null,
    t.isFramework === true ? 'Rammeavtale: ja' : null,
    t.estimatedValue !== null ? `Estimert verdi: ${formatMoney(t.estimatedValue, t.currency, false)}` : 'Estimert verdi: ikke oppgitt',
    t.deadlineAt
      ? `${t.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist'}: ${formatDateTime(t.deadlineAt, t.deadlineTimeKnown)}${t.lotDeadlinesDiffer ? ' (tidligste – delkontraktene har ulike frister)' : ''}`
      : 'Tilbudsfrist: ikke oppgitt',
    t.questionsDeadlineAt ? `Frist for spørsmål: ${formatDateTime(t.questionsDeadlineAt, true)}` : null,
    t.durationText ? `Kontraktens varighet: ${t.durationText}` : null,
    t.contractStart ? `Kontraktsstart: ${formatDateTime(t.contractStart, false)}` : null,
    t.contractEnd ? `Kontraktsslutt: ${formatDateTime(t.contractEnd, false)}` : null,
    t.publishedAt ? `Publisert: ${formatDateTime(t.publishedAt, false)}` : null,
    t.documentsUrl ? `Konkurransedokumenter (ikke lest av AI): ${t.documentsUrl}` : null,
    '',
    'Beskrivelse:',
    t.description ?? '(ingen beskrivelse i kunngjøringen)',
  ];
  if (t.lots?.length) {
    lines.push('', 'Delkontrakter:');
    t.lots.slice(0, 40).forEach((l, i) => {
      const value = l.estimatedValue !== null ? `, estimert ${formatMoney(l.estimatedValue, t.currency, false)}` : '';
      lines.push(`${i + 1}. ${l.title ?? l.id ?? 'uten tittel'}${value}${l.durationText ? `, varighet ${l.durationText}` : ''}`);
    });
  }
  if (t.selectionCriteria?.length) {
    lines.push('', 'Kvalifikasjonskrav (slik de står i kunngjøringen):');
    t.selectionCriteria.forEach((c) => lines.push(`- ${c}`));
  }
  if (t.awardCriteria?.length) {
    lines.push('', 'Tildelingskriterier (fra kunngjøringen):');
    t.awardCriteria.forEach((c) => lines.push(`- ${c.name}${c.weight ? ` – vekt ${c.weight}` : ''}`));
  }
  if (t.textLanguage === 'en') lines.push('', '(Kunngjøringen er publisert på engelsk.)');
  return {
    id: 'S0',
    kind: 'notice',
    title: 'Kunngjøringen',
    pages: [{ page: null, text: lines.filter((l): l is string => l !== null).join('\n') }],
    totalPages: null,
    isPrivate: false,
  };
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
  const user = 'Analyser kildene over og svar i henhold til skjemaet.';

  if (level === 'basic') {
    return runAi({
      kind: 'tender_analysis',
      usageKind: 'ai_tender_analysis',
      org,
      userId,
      tenderId,
      isPrivate: false,
      system: BASIC_SUMMARY_SYSTEM,
      cacheablePrefix: block,
      user,
      tier: 'fast',
      effort: 'low',
      schemaName: 'tender_summary',
      schemaDescription: 'Kort sammendrag av kunngjøringen',
      schema: basicSummaryJsonSchema,
      validator: basicSummaryZ,
      maxOutputTokens: 4000,
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
    cacheablePrefix: block,
    user,
    tier: 'quality',
    effort: 'medium',
    schemaName: 'tender_analysis',
    schemaDescription: 'Strukturert analyse av en offentlig kunngjøring med kildehenvisninger',
    schema: tenderAnalysisJsonSchema,
    validator: tenderAnalysisZ,
    maxOutputTokens: 16000,
    mockHint: () => mockTenderAnalysis(prepared.sources),
    hashExtra: 'full',
    force: opts.force,
    enrich: (data) => ({ level: 'full', coverage, verification: verifyAllRefs(data, prepared.sources) }),
  });
}

// ---------------------------------------------------------------------------
// Egnethetsvurdering: bedriftsprofil mot kravene (AI, med kildehenvisninger)
// ---------------------------------------------------------------------------
export interface StoredFitAssessment {
  id: string;
  createdAt: Date;
  data: FitAssessment;
  verification: Record<string, RefCheck>;
  coverage: SourceCoverage[];
  profileVersion: number | null;
  isMock: boolean;
  model: string;
}

export async function getLatestFitAssessment(tx: Tx, tenderId: string, orgId: string): Promise<StoredFitAssessment | null> {
  const row = first(
    (await tx`
      select id, created_at, result, model from ai_analyses
      where tender_id = ${tenderId} and kind = 'match_explanation' and status = 'completed' and org_id = ${orgId}
      order by created_at desc limit 1
    `) as unknown as { id: string; createdAt: Date; result: Record<string, unknown>; model: string }[],
  );
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    data: row.result.data as FitAssessment,
    verification: (row.result.verification ?? {}) as Record<string, RefCheck>,
    coverage: (row.result.coverage ?? []) as SourceCoverage[],
    profileVersion: typeof row.result.profileVersion === 'number' ? row.result.profileVersion : null,
    isMock: Boolean(row.result.isMock),
    model: row.model,
  };
}

export async function runFitAssessment(org: OrgContext, userId: string, tenderId: string, opts: { force?: boolean } = {}): Promise<RunAiResult> {
  if (!org.entitlements.matching) {
    return { ok: false, code: 'quota', error: 'Egnethetsvurdering er med i Profesjonell og Bedrift.' };
  }
  const prepared = await withTenant({ userId, orgId: org.id }, async (tx) => {
    const tender = await getTender(tx, tenderId);
    if (!tender) return null;
    const docs = org.entitlements.documentUpload ? await loadDocumentSources(tx, tenderId) : [];
    return { tender, sources: [noticeSource(tender), ...docs], profile: await getProfile(tx, org.id) };
  });
  if (!prepared) return { ok: false, code: 'invalid_output', error: 'Fant ikke kunngjøringen.' };
  if (!prepared.profile) return { ok: false, code: 'invalid_output', error: 'Fyll ut bedriftsprofilen først.' };
  const facts = profileFactsForAi(prepared.profile).map((f) => sanitizeSourceText(f));
  const { block, coverage } = buildSourceBlock(prepared.sources);
  const profileVersion = prepared.profile.version;
  return runAi({
    kind: 'match_explanation',
    usageKind: 'ai_fit_assessment',
    org,
    userId,
    tenderId,
    isPrivate: true,
    system: FIT_ASSESSMENT_SYSTEM,
    cacheablePrefix: block,
    user: `<bedriftsprofil>\n${facts.join('\n')}\n</bedriftsprofil>\n\nVurder om bedriften kan delta og hvor godt den passer, i henhold til skjemaet.`,
    tier: 'quality',
    effort: 'medium',
    schemaName: 'fit_assessment',
    schemaDescription: 'Vurdering av bedriftens egnethet mot kravene i kunngjøringen',
    schema: fitAssessmentJsonSchema,
    validator: fitAssessmentZ,
    maxOutputTokens: 12000,
    mockHint: () => mockFitAssessment(prepared.sources, facts),
    hashExtra: `fit:${profileVersion}`,
    force: opts.force,
    enrich: (data) => ({ verification: verifyAllRefs(data, prepared.sources), coverage, profileVersion }),
  });
}
