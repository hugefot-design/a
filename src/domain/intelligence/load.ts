/**
 * Henter alt Intelligence trenger for ett anbud – med de eksisterende funksjonene og innenfor organisasjonens
 * tilgang (kjøres i ctx.tenant, så radnivåsikkerheten i databasen gjelder). Planreglene er de samme som ellers i
 * appen: hver del bruker bare det planen gir tilgang til, og resten merkes som låst.
 */
import { getLatestFitAssessment, getLatestTenderAnalysis, loadDocumentSources, noticeSource } from '@/domain/ai/analysis';
import { aiModeFor } from '@/domain/ai/provider';
import type { AnalysisSource } from '@/domain/ai/sources';
import { FEATURE_LABELS, PLANS, type Entitlements } from '@/domain/billing/plans';
import { tenderCompetition } from '@/domain/competitors/competitors';
import { tenderRequirementScan } from '@/domain/documents/requirements-service';
import type { MatchBreakdown } from '@/domain/matching/engine';
import { noticeSignals, screenTender } from '@/domain/matching/screening';
import { getProfile } from '@/domain/profile/profile';
import { marketPrice } from '@/domain/profit/market';
import { assessQualifications, loadCapacityData, loadProfitWorkspace } from '@/domain/profit/service';
import { scanContractTerms } from '@/domain/profit/terms-scan';
import { getTender, getTenderExtras } from '@/domain/tenders/queries';
import { distinctAwards, learningSummary, loadResults, tenderResultInfo } from '@/domain/tenders/results';
import type { Tx } from '@/lib/db';
import type { OrgContext } from '@/server/http';
import { buildReport } from './build';
import { learningFor, type TenderMeta } from './learning';
import type { IntelligenceReport } from './types';

const DEFAULT_MIN_DAYS = 5;

/** Hva planen ikke gir (vises som låst med navnet på planen som har det). */
export function lockedPlans(e: Entitlements): IntelligenceReport['lockedPlans'] {
  const plan = (f: keyof typeof FEATURE_LABELS) => PLANS[FEATURE_LABELS[f].minPlan].name;
  return {
    ...(e.matching ? {} : { fit: plan('matching') }),
    ...(e.profitCalculator ? {} : { profit: plan('profitCalculator') }),
    ...(e.competitorIntel ? {} : { competition: plan('competitorIntel') }),
    ...(e.documentUpload ? {} : { documents: plan('documentUpload') }),
  };
}

export async function loadIntelligence(tx: Tx, org: OrgContext, tenderId: string, now = new Date()): Promise<IntelligenceReport | null> {
  const tender = await getTender(tx, tenderId);
  if (!tender) return null;
  const e = org.entitlements;
  const [extras, profile, resultInfo, results, analysis, fitAssessment] = await Promise.all([
    getTenderExtras(tx, tenderId, org.id),
    getProfile(tx, org.id),
    tenderResultInfo(tx, org.id, tender),
    loadResults(tx, org.id),
    getLatestTenderAnalysis(tx, tenderId, org.id),
    getLatestFitAssessment(tx, tenderId, org.id),
  ]);

  // Dokumentene leses én gang og brukes av kravsjekken, vilkårssøket, kvalifikasjonene og Lønnsomhet.
  const withDocuments = e.documentUpload && extras.documents.some((d) => d.textStatus === 'extracted');
  const docs: AnalysisSource[] = withDocuments ? await loadDocumentSources(tx, tenderId) : [];
  const sources = [noticeSource(tender), ...docs];
  const requirements = await tenderRequirementScan(tx, tender, withDocuments, docs);

  const match = e.matching && extras.match ? { score: extras.match.score, excluded: extras.match.excluded, breakdown: extras.match.breakdown as MatchBreakdown } : null;
  const screening = screenTender({
    match,
    deadlineAt: tender.deadlineAt,
    minDaysToDeadline: profile?.minDaysToDeadline ?? DEFAULT_MIN_DAYS,
    signals: noticeSignals(tender.description),
    now,
  });

  // Lønnsomhet: samme arbeidsflate som siden Lønnsomhet (kalkyle, risiko, kvalifikasjoner, kapasitet, anbefaling).
  const ws = e.profitCalculator ? await loadProfitWorkspace(tx, org, tenderId, { documents: docs, now }) : null;
  const fitUnfulfilled = (fitAssessment?.data.requirements ?? []).filter((r) => r.status === 'ikke_oppfylt').map((r) => r.requirement.slice(0, 200));
  const qualifications = ws?.qualifications ?? assessQualifications(sources, profile, await loadCapacityData(tx, org.id), fitUnfulfilled);
  const terms = ws?.risk.scan ?? scanContractTerms(sources);
  const market = e.profitCalculator ? await marketPrice(tx, tender) : null;
  const competition = e.competitorIntel ? await tenderCompetition(tx, tender) : null;

  // Læring: bransje og CPV for anbudene dere har levert på.
  const ids = [...new Set(results.rows.map((r) => r.tenderId))];
  const metaRows = ids.length
    ? ((await tx`select id, industry_ids, cpv_codes, main_cpv from tenders where id = any(${ids}::uuid[])`) as unknown as {
        id: string;
        industryIds: string[];
        cpvCodes: string[];
        mainCpv: string | null;
      }[])
    : [];
  const meta: TenderMeta = new Map(metaRows.map((r) => [r.id, { industryIds: r.industryIds, cpvCodes: r.cpvCodes, mainCpv: r.mainCpv }]));
  const learning = learningFor(results.rows, meta, tender);
  const all = learningSummary(results.rows);
  const calcAccuracy = all.medianCalcDiffPct !== null ? { medianPct: all.medianCalcDiffPct, n: all.calcVsResult.length } : null;

  // Tildelingen i dette anbudet (samme sammenslåing som anbudssiden; «deres» fra org.nr. i tildelingen).
  const awards = distinctAwards(
    extras.awards.map((a) => ({
      tenderId,
      supplierId: a.supplierId,
      supplierName: a.supplierName,
      supplierOrgNumber: null,
      lotTitle: a.lotTitle,
      awardedValue: a.awardedValue === null ? null : Number(a.awardedValue),
      currency: a.currency,
      awardDate: a.awardDate,
    })),
    null,
  ).map((a) => ({ ...a, isUs: Boolean(a.supplierId && resultInfo.ourSupplierIds.includes(a.supplierId)) }));

  let bid: { id: string; status: string; checklistTotal: number; checklistDone: number } | null = null;
  if (extras.workspace) {
    const [c] = (await tx`
      select count(*)::int as total, count(*) filter (where is_done)::int as done from bid_checklist_items where workspace_id = ${extras.workspace.id}
    `) as unknown as { total: number; done: number }[];
    bid = { id: extras.workspace.id, status: extras.workspace.status, checklistTotal: c?.total ?? 0, checklistDone: c?.done ?? 0 };
  }

  const ai = aiModeFor(org);
  return buildReport({
    now,
    tender,
    sources: extras.sources.filter((s: { removedAt?: Date | null }) => !s.removedAt).map((s: { source: string; sourceNoticeId: string; sourceUrl: string | null }) => ({ source: s.source, sourceNoticeId: s.sourceNoticeId, sourceUrl: s.sourceUrl })),
    entitlements: e,
    lockedPlans: lockedPlans(e),
    aiMode: !ai.configured ? 'off' : ai.isMock ? 'mock' : 'real',
    profile: profile ? { regions: profile.regions } : null,
    match,
    screening,
    requirements,
    terms,
    documents: { readable: docs.length, notReadable: extras.documents.filter((d) => d.textStatus !== 'extracted').map((d) => d.title) },
    qualifications,
    profit: ws
      ? {
          calc: ws.calc,
          targetMarginPct: ws.inputs.targetMarginPct,
          durationMonths: ws.inputs.durationMonths,
          recommendation: ws.recommendation,
          risk: ws.risk,
          capacity: ws.capacity,
        }
      : null,
    market,
    calcAccuracy,
    competition,
    awards,
    learning,
    analysis,
    fitAssessment,
    bid,
    bookmarkStatus: extras.bookmark?.status ?? null,
  });
}
