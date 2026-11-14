/**
 * Offentlig eksempel på en samlet vurdering (/eksempel): et ekte, åpent anbud vurdert med nøyaktig de samme
 * reglene som i appen (buildReport). Ingenting er oppdiktet:
 *
 * - Anbudet er det samme ekte anbudet som forsiden viser krav fra (siteShowcase).
 * - Bedriften er en eksempelprofil: bare bransjen og fylket til anbudet – ingen godkjenninger, sertifiseringer,
 *   omsetning eller kostnader. Det står på siden.
 * - Krav, avvisningsgrunner og kostbare vilkår er ordsøk i kunngjøringen. Markedsprisen er ekte tidligere tildelinger.
 * - Ingen AI brukes, og ingen leverandørnavn vises (konkurranse er med i Bedrift og vises som låst).
 *
 * Mellomlagres i 30 minutter, som forsiden.
 */
import { noticeSource } from '@/domain/ai/analysis';
import { PLANS } from '@/domain/billing/plans';
import { tenderRequirementScan } from '@/domain/documents/requirements-service';
import { scoreTender } from '@/domain/matching/engine';
import { noticeSignals, screenTender } from '@/domain/matching/screening';
import { marketPrice } from '@/domain/profit/market';
import { assessQualifications } from '@/domain/profit/service';
import { scanContractTerms } from '@/domain/profit/terms-scan';
import { getTender } from '@/domain/tenders/queries';
import { exampleProfile, siteShowcase } from '@/domain/tenders/showcase';
import { systemSql, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import { buildReport } from './build';
import { learningFor } from './learning';
import { lockedPlans } from './load';
import type { IntelligenceReport } from './types';

export interface DemoReport {
  report: IntelligenceReport;
  /** Eksempelbedriften – vises på siden, så ingen tror det er en ekte kunde. */
  company: { industry: string; region: string | null; minDaysToDeadline: number };
  /** Planen eksempelet viser (prøveperioden gir den samme). */
  plan: string;
}

const TTL_MS = 30 * 60_000;
let cache: { at: number; value: DemoReport | null } | null = null;

export function resetDemoCache(): void {
  cache = null;
}

async function build(tx: Tx, now: Date): Promise<DemoReport | null> {
  const showcase = await siteShowcase(now);
  if (!showcase) return null;
  const tender = await getTender(tx, showcase.notice.id);
  if (!tender || tender.isSample || tender.status !== 'open') return null;

  const profile = exampleProfile(showcase.industry.id, showcase.region?.code ?? null);
  const scored = scoreTender(profile, tender, now);
  const match = { score: scored.score, excluded: scored.excluded, breakdown: scored.breakdown };
  const notice = noticeSource(tender);
  const requirements = await tenderRequirementScan(tx, tender, false);
  const sources = (await tx`
    select source, source_notice_id, source_url from tender_sources where tender_id = ${tender.id} and removed_at is null and source <> 'sample'
  `) as unknown as { source: string; sourceNoticeId: string; sourceUrl: string | null }[];
  const entitlements = PLANS.professional.entitlements;

  const report = buildReport({
    now,
    tender,
    sources,
    entitlements,
    lockedPlans: lockedPlans(entitlements),
    aiMode: 'off',
    profile: { regions: profile.regions },
    match,
    screening: screenTender({ match, deadlineAt: tender.deadlineAt, minDaysToDeadline: profile.minDaysToDeadline, signals: noticeSignals(tender.description), now }),
    requirements,
    terms: scanContractTerms([notice]),
    documents: { readable: 0, notReadable: [] },
    // Eksempelbedriften har ingen godkjenninger eller bemanning registrert.
    qualifications: assessQualifications([notice], null, { staffCertificationText: '' }, []),
    profit: null,
    market: await marketPrice(tx, tender),
    calcAccuracy: null,
    competition: null,
    awards: [],
    learning: learningFor([], new Map(), tender),
    analysis: null,
    fitAssessment: null,
    bid: null,
    bookmarkStatus: null,
  });
  return {
    report,
    company: { industry: showcase.industry.name, region: showcase.region?.name ?? null, minDaysToDeadline: profile.minDaysToDeadline },
    plan: PLANS.professional.name,
  };
}

/** Eksempelet til /eksempel. Null når det ikke finnes et passende åpent anbud (da vises en enkel side uten rapport). */
export async function demoReport(now = new Date()): Promise<DemoReport | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value: DemoReport | null = null;
  try {
    value = await systemSql().begin((tx) => build(tx as unknown as Tx, now));
  } catch (err) {
    log.warn('demo_report_failed', { message: err instanceof Error ? err.message : String(err) });
  }
  cache = { at: Date.now(), value };
  return value;
}
