/**
 * Setter sammen Intelligence-rapporten fra data som allerede er lastet (se load.ts). Ren funksjon – ingen
 * databasekall – så hele vurderingen kan testes med faste data.
 */
import type { StoredFitAssessment, StoredTenderAnalysis } from '@/domain/ai/analysis';
import type { RefCheck } from '@/domain/ai/sources';
import type { Entitlements } from '@/domain/billing/plans';
import type { TenderCompetition } from '@/domain/competitors/competitors';
import { REQUIREMENT_LABELS, type RequirementHit, type RequirementScan } from '@/domain/documents/requirements';
import type { MatchBreakdown } from '@/domain/matching/engine';
import type { Screening } from '@/domain/matching/screening';
import type { CalcResult } from '@/domain/profit/calculator';
import type { CapacityResult } from '@/domain/profit/capacity';
import { MIN_COMPARABLES, pricePositions, SOLID_COMPARABLES, type MarketPrice } from '@/domain/profit/market';
import type { RecommendationResult } from '@/domain/profit/recommendation';
import type { QualificationView, RiskView } from '@/domain/profit/service';
import { TERM_LABELS, type TermScan } from '@/domain/profit/terms-scan';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import type { TenderDetail } from '@/domain/tenders/queries';
import type { DistinctAward } from '@/domain/tenders/results';
import { decide } from './decision';
import type { LearningResult } from './learning';
import { buildPlan } from './plan';
import { COSTLY_TERMS, hitSource, scoreRisk, termSource } from './risk';
import type { FitLevel, FitSection, IntelligenceReport, Point, ProfitSection, RiskSection } from './types';

/** Samme grenser som resten av appen: 60+ er et godt treff (neste steg «Start tilbudsarbeid»), under 40 svakt. */
export const GOOD_FIT = 60;
export const WEAK_FIT = 40;

const COMPONENTS: { key: keyof MatchBreakdown['components']; label: string; max: number }[] = [
  { key: 'cpv', label: 'Fag og CPV', max: 40 },
  { key: 'keywords', label: 'Søkeord', max: 15 },
  { key: 'geography', label: 'Geografi', max: 15 },
  { key: 'value', label: 'Verdi og størrelse', max: 10 },
  { key: 'type', label: 'Kontraktstype', max: 5 },
  { key: 'deadline', label: 'Frist', max: 5 },
  { key: 'requirements', label: 'Krav i kunngjøringen', max: 10 },
];

export interface BuildInputs {
  now: Date;
  tender: TenderDetail;
  sources: { source: string; sourceNoticeId: string; sourceUrl: string | null }[];
  entitlements: Entitlements;
  lockedPlans: IntelligenceReport['lockedPlans'];
  aiMode: 'off' | 'mock' | 'real';
  profile: { regions: string[] } | null;
  match: { score: number; excluded: boolean; breakdown: MatchBreakdown } | null;
  screening: Screening;
  requirements: RequirementScan;
  terms: TermScan;
  documents: { readable: number; notReadable: string[] };
  qualifications: QualificationView;
  /** Fra Lønnsomhet (loadProfitWorkspace) – null uten kalkulatoren i planen. */
  profit: {
    calc: CalcResult;
    targetMarginPct: number | null;
    durationMonths: number | null;
    recommendation: RecommendationResult;
    risk: RiskView;
    capacity: CapacityResult;
  } | null;
  market: MarketPrice | null;
  calcAccuracy: { medianPct: number; n: number } | null;
  /** Null når planen ikke har konkurranseinnsikt. */
  competition: TenderCompetition | null;
  awards: DistinctAward[];
  learning: LearningResult;
  analysis: StoredTenderAnalysis | null;
  fitAssessment: StoredFitAssessment | null;
  bid: { id: string; status: string; checklistTotal: number; checklistDone: number } | null;
  bookmarkStatus: string | null;
}

function fitLevel(score: number | null, excluded: boolean): FitLevel {
  if (score === null) return 'ukjent';
  if (excluded || score < WEAK_FIT) return 'svak';
  return score >= GOOD_FIT ? 'god' : 'middels';
}

/** AI-påstand med kontrollert kilde (sitatet funnet ordrett) eller uten. */
function aiPoint(text: string, check: RefCheck | undefined, quote?: string | null): Point {
  return {
    text,
    basis: 'ai',
    source: check
      ? { kind: 'ai', label: check.sourceTitle ?? 'Kilde', page: check.pageValid ? check.page : null, quote: check.quote ?? quote ?? null, verified: check.quoteVerified }
      : quote
        ? { kind: 'ai', label: 'AI-vurdering', quote, verified: false }
        : { kind: 'ai', label: 'AI-vurdering' },
  };
}

const hitPoint = (h: RequirementHit): Point => ({ text: h.text, basis: 'fact', source: hitSource(h) });

export function buildReport(i: BuildInputs): IntelligenceReport {
  const t = i.tender;
  const e = i.entitlements;
  const currency = t.currency ?? 'NOK';

  // --------------------------------------------------------------------------------------- 1. Passer det
  const m = e.matching ? i.match : null;
  const regionNames = t.regionCodes.map((r) => REGION_BY_CODE.get(r)?.name ?? r);
  const fa = i.fitAssessment;
  const fit: FitSection = {
    availability: !e.matching ? 'locked' : !i.profile ? 'no_profile' : 'ok',
    score: m?.score ?? null,
    excluded: m?.excluded ?? false,
    level: fitLevel(m?.score ?? null, m?.excluded ?? false),
    components: m ? COMPONENTS.map((c) => ({ key: c.key, label: c.label, value: m.breakdown.components?.[c.key] ?? 0, max: c.max })) : [],
    strengths: (m?.breakdown.reasons ?? []).map((text) => ({ text, basis: 'calculation' as const })),
    gaps: [...(m?.breakdown.disqualifiers ?? []), ...(m?.breakdown.gaps ?? []), ...(m?.breakdown.missingInfo ?? [])].map((text) => ({ text, basis: 'calculation' as const })),
    uncertainty: m ? { level: m.breakdown.uncertainty ?? 'middels', reasons: m.breakdown.uncertaintyReasons ?? [] } : null,
    qualifications: i.qualifications.required.map((r) => ({ label: r.label, have: r.have, legal: r.legal, via: r.via })),
    turnover: i.qualifications.turnover,
    regions: { names: regionNames, inProfile: i.profile && i.profile.regions.length ? t.regionCodes.some((r) => i.profile!.regions.includes(r)) : null },
    capacity: i.profit
      ? { status: i.profit.capacity.status, gapHoursPerYear: i.profit.capacity.gapHoursPerYear, gapPct: i.profit.capacity.gapPct, notes: i.profit.capacity.notes }
      : null,
    ai: fa
      ? {
          fit: fa.data.fit,
          overall: fa.data.overall,
          unfulfilled: fa.data.requirements
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => r.status === 'ikke_oppfylt')
            .map(({ r, idx }) => aiPoint(`${r.requirement} – ${r.explanation}`, fa.verification[`requirements[${idx}]`], r.source?.quote)),
          isMock: fa.isMock,
          at: fa.createdAt,
        }
      : null,
  };

  // --------------------------------------------------------------------------------------- 2. Risiko
  const scored = scoreRisk({
    screening: i.screening,
    requirements: i.requirements,
    terms: i.terms,
    qualifications: i.qualifications,
    aiFindings: i.profit?.risk.findings ?? [],
    capacity: i.profit?.capacity ?? null,
    calc: i.profit && i.profit.calc.completeness.linesIncluded > 0 ? i.profit.calc : null,
    targetMarginPct: i.profit?.targetMarginPct ?? null,
    documentsRead: i.requirements.documents,
    matchUncertainty: m?.breakdown.uncertainty ?? null,
    buyerRecord: i.learning.buyerRecord,
    minDecided: i.learning.minDecided,
  });
  // Faktorene som står på kunngjøringen får lenke til kilden.
  for (const f of scored.factors) for (const s of f.sources) if (s.kind === 'notice') s.href = t.sourceUrl;
  const deadlines: RiskSection['deadlines'] = [];
  if (t.deadlineAt) deadlines.push({ key: t.deadlineKind === 'participation' ? 'participation' : 'submission', label: t.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist', at: t.deadlineAt, timeKnown: t.deadlineTimeKnown });
  if (t.participationDeadlineAt && t.deadlineKind !== 'participation') deadlines.push({ key: 'participation', label: 'Frist for å be om å delta', at: t.participationDeadlineAt, timeKnown: true });
  if (t.questionsDeadlineAt) deadlines.push({ key: 'questions', label: 'Frist for spørsmål', at: t.questionsDeadlineAt, timeKnown: true });
  deadlines.sort((a, b) => a.at.getTime() - b.at.getTime());

  const analysis = i.analysis;
  const aiRisk = analysis
    ? (() => {
        const d = analysis.data as { rejection_risks?: { text: string; source: { quote: string | null } | null }[]; risks?: { text: string; source: { quote: string | null } | null }[] };
        const pts = [
          ...(d.rejection_risks ?? []).map((r, idx) => aiPoint(r.text, analysis.verification[`rejection_risks[${idx}]`], r.source?.quote)),
          ...(d.risks ?? []).map((r, idx) => aiPoint(r.text, analysis.verification[`risks[${idx}]`], r.source?.quote)),
        ];
        return pts.length ? { isMock: analysis.isMock, at: analysis.createdAt, points: pts.slice(0, 12) } : null;
      })()
    : null;

  const risk: RiskSection = {
    ...scored,
    read: {
      documents: i.requirements.documents,
      pages: i.requirements.pages,
      noticeOnly: i.requirements.documents === 0,
      notReadable: i.documents.notReadable,
    },
    deadlines,
    rejection: [...i.requirements.byKind.avvisning, ...i.requirements.byKind.minstekrav].slice(0, 10).map(hitPoint),
    documentation: [...i.requirements.byKind.kvalifikasjon, ...i.requirements.byKind.innlevering].slice(0, 10).map(hitPoint),
    siteVisit: i.requirements.byKind.befaring.slice(0, 5).map(hitPoint),
    terms: COSTLY_TERMS.concat(['betalingsvilkar', 'prisregulering', 'volum'])
      .map((c) => ({ c, hits: (i.terms.byCategory[c] ?? []).filter((h) => !h.negated) }))
      .filter((x) => x.hits.length)
      .map(({ c, hits }) => ({ category: c, label: TERM_LABELS[c], points: hits.slice(0, 2).map((h) => ({ text: h.snippet, basis: 'fact' as const, source: termSource(h) })) })),
    contractFindings: (i.profit?.risk.findings ?? []).map((f) => ({
      text: `${f.title}: ${f.finding}`,
      basis: 'ai' as const,
      severity: f.severity,
      consequence: f.consequence,
      source: f.source ? { kind: 'ai' as const, label: f.source.title ?? 'Dokument', page: f.source.page, quote: f.source.quote, verified: f.source.verified } : null,
    })),
    counts: i.requirements.counts,
    ai: aiRisk,
  };
  for (const p of [...risk.rejection, ...risk.documentation, ...risk.siteVisit]) if (p.source?.kind === 'notice') p.source.href = t.sourceUrl;

  // --------------------------------------------------------------------------------------- 3. Lønnsomhet
  const hasCosts = Boolean(i.profit && i.profit.calc.completeness.linesIncluded > 0 && i.profit.calc.directCost > 0);
  let market: ProfitSection['market'] = null;
  if (i.market) {
    const n = i.market.awards.length;
    const c = hasCosts ? i.profit!.calc : null;
    const pos = pricePositions(i.market, i.profit?.durationMonths ?? t.durationMonths, [
      { key: 'minstepris', label: 'Minstepris', total: c?.minPrice ?? null },
      { key: 'malpris', label: 'Målpris', total: c?.targetPrice ?? null },
    ]);
    market = {
      label: i.market.match?.label ?? null,
      n,
      strength: n >= SOLID_COMPARABLES ? 'ok' : n >= MIN_COMPARABLES ? 'few' : 'none',
      unit: pos?.unit ?? 'total',
      stats: n >= MIN_COMPARABLES ? (pos?.stats ?? i.market.total) : null,
      values: n >= MIN_COMPARABLES ? (pos?.values ?? i.market.awards.map((a) => a.value)) : [],
      positions: n >= MIN_COMPARABLES ? (pos?.positions ?? []) : [],
      excluded: i.market.excluded,
    };
  }
  const profit: ProfitSection = {
    availability: !e.profitCalculator ? 'locked' : hasCosts ? 'ok' : 'no_costs',
    calc: hasCosts
      ? (({ breakEven, minPrice, targetPrice, recommendedRange, atContractValue, sensitivity, completeness, directCost }) => ({
          breakEven,
          minPrice,
          targetPrice,
          recommendedRange,
          atContractValue,
          sensitivity,
          completeness,
          directCost,
        }))(i.profit!.calc)
      : null,
    currency,
    targetMarginPct: i.profit?.targetMarginPct ?? null,
    recommendation: hasCosts ? i.profit!.recommendation : null,
    market: e.profitCalculator ? market : null,
    calcAccuracy: i.calcAccuracy,
  };

  // --------------------------------------------------------------------------------------- 4. Konkurranse
  const beat = new Map(i.learning.beatUs.map((b) => [b.name.toLowerCase(), b.count]));
  const withBeat = <T extends { name: string }>(rows: T[]) => rows.map((r) => ({ ...r, beatUs: beat.get(r.name.toLowerCase()) ?? 0 }));
  const comp = i.competition;
  const competition: IntelligenceReport['competition'] = {
    availability: comp ? 'ok' : 'locked',
    buyer: comp?.buyer ? { winners: withBeat(comp.buyer.winners), contracts: comp.buyer.contracts } : null,
    similar: comp?.similar ? { label: comp.similar.label || `CPV ${comp.similar.prefix}`, winners: withBeat(comp.similar.winners), contracts: comp.similar.contracts } : null,
    bids: comp?.bids ? { label: comp.bids.label || `CPV ${comp.bids.prefix}`, n: comp.bids.n, median: comp.bids.median, min: comp.bids.min, max: comp.bids.max } : null,
    thisTender: i.awards.map((a) => ({ name: a.supplierName, supplierId: a.supplierId, value: a.awardedValue, currency: a.currency, isUs: a.isUs })),
  };

  // --------------------------------------------------------------------------------------- 5–7
  const aiUsed = Boolean(fa || analysis || (i.profit?.risk.findings.length ?? 0) > 0);
  const decision = decide({
    tenderId: t.id,
    fit,
    risk,
    profit,
    competition,
    learning: i.learning,
    documentsEntitled: e.documentUpload,
    aiMode: i.aiMode,
    aiUsed,
    lockedPlans: i.lockedPlans,
  });
  const plan = buildPlan({
    now: i.now,
    tenderId: t.id,
    tender: {
      deadlineAt: t.deadlineAt,
      questionsDeadlineAt: t.questionsDeadlineAt,
      participationDeadlineAt: t.participationDeadlineAt,
      deadlineKind: t.deadlineKind,
      documentsUrl: t.documentsUrl,
      submissionUrl: t.submissionUrl,
    },
    verdict: decision.verdict,
    risk,
    fit,
    profit,
    pricing: i.learning.pricing,
    bid: i.bid,
    bookmarkStatus: i.bookmarkStatus,
    entitlements: { bidAssistant: e.bidAssistant, documentUpload: e.documentUpload, partnerSearch: e.partnerSearch, profitCalculator: e.profitCalculator },
  });

  return {
    generatedAt: i.now,
    tender: {
      id: t.id,
      title: t.title,
      buyerName: t.buyerName,
      status: t.status,
      deadlineAt: t.deadlineAt,
      deadlineTimeKnown: t.deadlineTimeKnown,
      deadlineKind: t.deadlineKind,
      publishedAt: t.publishedAt,
      countryCode: t.countryCode,
      currency,
      estimatedValue: t.estimatedValue,
      durationText: t.durationText,
      regionNames,
      industryNames: t.industryIds.map((id) => INDUSTRY_BY_ID.get(id)?.name ?? id),
      sourceUrl: t.sourceUrl,
      documentsUrl: t.documentsUrl,
      submissionUrl: t.submissionUrl,
      sources: i.sources.filter((s) => s.source !== 'sample').map((s) => ({ source: s.source, noticeId: s.sourceNoticeId, url: s.sourceUrl })),
      isSample: t.isSample,
    },
    decision,
    fit,
    risk,
    profit,
    competition,
    learning: i.learning,
    plan,
    ai: { mode: i.aiMode, used: aiUsed },
    lockedPlans: i.lockedPlans,
  };
}

/** Navnet på kravtypene (til siden og PDF-en). */
export const REQUIREMENT_KIND_LABEL = Object.fromEntries(Object.entries(REQUIREMENT_LABELS).map(([k, v]) => [k, v.label])) as Record<keyof typeof REQUIREMENT_LABELS, string>;
