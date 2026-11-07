/**
 * AnbudRadar Intelligence: én samlet vurdering per anbud, satt sammen av modulene som finnes fra før
 * (treff, kravsjekk, vilkårssøk, forhåndsvurdering, kalkyle, anbefaling, markedspris, konkurrenter, resultater,
 * tilbudsarbeid, AI). Typene her deles av siden, PDF-en og testene.
 *
 * Hvert punkt sier hva det bygger på:
 *   fact        – står i kunngjøringen, et dokument, en publisert tildeling eller i deres egne data
 *   calculation – regnet ut av AnbudRadar fra fakta (formelen/grunnlaget vises)
 *   ai          – en AI-vurdering (med om sitatet ble funnet ordrett i kilden)
 * Manglende data vises som manglende – aldri som null eller et anslag.
 */
import type { MarketStats, PricePosition } from '@/domain/profit/market';
import type { CalcResult } from '@/domain/profit/calculator';
import type { RecommendationResult } from '@/domain/profit/recommendation';
import type { RequirementKind } from '@/domain/documents/requirements';

export type Basis = 'fact' | 'calculation' | 'ai';
export type Severity = 'høy' | 'middels' | 'lav';
export type Level = 'lav' | 'middels' | 'høy';

export interface SourceRef {
  kind: 'notice' | 'document' | 'award' | 'own' | 'ai';
  /** «Kunngjøringen (Doffin 2026-117314)», «Konkurransegrunnlag.pdf», «Kalkylen deres» … */
  label: string;
  page?: number | null;
  /** Utdrag fra kilden (ordrett). */
  quote?: string | null;
  href?: string | null;
  /** AI: sitatet ble funnet ordrett i kilden. */
  verified?: boolean;
}

export interface Point {
  text: string;
  basis: Basis;
  source?: SourceRef | null;
}

// ---------------------------------------------------------------------------------------------- 1. Passer det
export type FitLevel = 'god' | 'middels' | 'svak' | 'ukjent';

export interface FitSection {
  /** locked: planen har ikke treff mot profil. no_profile: bedriftsprofilen mangler. */
  availability: 'ok' | 'locked' | 'no_profile';
  score: number | null;
  excluded: boolean;
  level: FitLevel;
  components: { key: string; label: string; value: number; max: number }[];
  strengths: Point[];
  gaps: Point[];
  uncertainty: { level: Level; reasons: string[] } | null;
  qualifications: { label: string; have: boolean; legal: boolean; via: 'profil' | 'bemanning' | null }[];
  turnover: { required: number; have: number | null; ok: boolean | null } | null;
  regions: { names: string[]; inProfile: boolean | null };
  capacity: { status: string; gapHoursPerYear: number | null; gapPct: number | null; notes: string[] } | null;
  ai: { fit: 'god' | 'middels' | 'svak' | 'uklar'; overall: string; unfulfilled: Point[]; isMock: boolean; at: Date } | null;
}

// ---------------------------------------------------------------------------------------------- 2. Risiko
export interface RiskFactor {
  key: string;
  label: string;
  /** Bidrag til risikoscoren. */
  points: number;
  severity: Severity;
  explanation: string;
  basis: Basis;
  sources: SourceRef[];
  /** Gjør at anbudet ikke bør prioriteres uansett resten (frist ute, lovpålagt godkjenning mangler, tap …). */
  blocker: boolean;
}

export interface RiskSection {
  /** 0–100, summen av faktorene (tak 100). En beregning – ikke en sannsynlighet. */
  score: number;
  level: Level;
  factors: RiskFactor[];
  read: { documents: number; pages: number; noticeOnly: boolean; notReadable: string[] };
  deadlines: { key: 'submission' | 'participation' | 'questions'; label: string; at: Date; timeKnown: boolean }[];
  rejection: Point[];
  documentation: Point[];
  siteVisit: Point[];
  terms: { category: string; label: string; points: Point[] }[];
  /** Kontraktsrisiko fra AI-analysen i Lønnsomhet (med kontrollerte sitater og utregnet konsekvens). */
  contractFindings: (Point & { severity: Severity; consequence: string | null })[];
  counts: Record<RequirementKind, number>;
  ai: { isMock: boolean; at: Date; points: Point[] } | null;
}

// ---------------------------------------------------------------------------------------------- 3. Lønnsomhet
export interface ProfitSection {
  /** locked: planen har ikke kalkulatoren. no_costs: ingen kostnader lagt inn ennå. */
  availability: 'ok' | 'locked' | 'no_costs';
  calc: Pick<CalcResult, 'breakEven' | 'minPrice' | 'targetPrice' | 'recommendedRange' | 'atContractValue' | 'sensitivity' | 'completeness' | 'directCost'> | null;
  currency: string;
  targetMarginPct: number | null;
  recommendation: RecommendationResult | null;
  market: {
    label: string | null;
    n: number;
    /** «few»: under 8 sammenlignbare (vises med advarsel), «none»: under 3 (ingen statistikk). */
    strength: 'ok' | 'few' | 'none';
    unit: 'per_year' | 'total';
    stats: MarketStats | null;
    values: number[];
    positions: PricePosition[];
    excluded: { frameworks: number; otherCurrency: number };
  } | null;
  /** Hvor treffsikre kalkylene har vært mot faktiske vinnerpriser (fra Resultater). */
  calcAccuracy: { medianPct: number; n: number } | null;
}

// ---------------------------------------------------------------------------------------------- 4. Konkurranse
export interface CompetitionSection {
  availability: 'ok' | 'locked';
  buyer: { winners: { supplierId: string; name: string; wins: number; lastWin: Date | null; beatUs: number }[]; contracts: number } | null;
  similar: { label: string; winners: { supplierId: string; name: string; wins: number; lastWin: Date | null; beatUs: number }[]; contracts: number } | null;
  bids: { label: string; n: number; median: number; min: number; max: number } | null;
  /** Tildelingen i dette anbudet (når den er publisert). */
  thisTender: { name: string; supplierId: string | null; value: number | null; currency: string | null; isUs: boolean }[];
}

// ---------------------------------------------------------------------------------------------- 7. Læring
export interface LearningGroup {
  delivered: number;
  won: number;
  lost: number;
  pending: number;
  winRatePct: number | null;
}

export interface LearningSection {
  sameBuyer: LearningGroup;
  similar: LearningGroup;
  /** Bare når minst `minDecided` er avgjort i gruppen. */
  insights: Point[];
  /** Hvordan læringen påvirket vurderingen (tom når den ikke ble brukt). */
  applied: string[];
  minDecided: number;
  /** Selskaper som har slått dere i lignende anbud (navn, antall). */
  beatUs: { name: string; count: number }[];
}

// ---------------------------------------------------------------------------------------------- 5. Beslutning
export type Verdict = 'go' | 'clarify' | 'no_go' | 'insufficient';

export interface Decision {
  verdict: Verdict;
  label: string;
  headline: string;
  blockers: Point[];
  reasons: Point[];
  concerns: Point[];
  missing: { text: string; href: string | null }[];
  /** Hvor mye av grunnlaget som finnes (profil, dokumenter, kalkyle, marked, konkurranse, resultater). */
  confidence: { level: Level; score: number; max: number };
  coverage: { key: string; label: string; available: boolean; detail: string }[];
}

// ---------------------------------------------------------------------------------------------- 6. Handlingsplan
export interface PlanStep {
  key: string;
  title: string;
  detail: string | null;
  due: Date | null;
  /** fact: frist fra kunngjøringen. calculation: foreslått dato regnet fra fristen. */
  dueBasis: Basis | null;
  priority: Severity;
  href: string | null;
  hrefLabel: string | null;
  done: boolean;
  basis: Basis;
  source: SourceRef | null;
}

// ---------------------------------------------------------------------------------------------- Rapport
export interface IntelligenceReport {
  generatedAt: Date;
  tender: {
    id: string;
    title: string;
    buyerName: string | null;
    status: string;
    deadlineAt: Date | null;
    deadlineTimeKnown: boolean;
    deadlineKind: 'tender' | 'participation' | null;
    publishedAt: Date | null;
    countryCode: string;
    currency: string;
    estimatedValue: number | null;
    durationText: string | null;
    regionNames: string[];
    industryNames: string[];
    sourceUrl: string | null;
    documentsUrl: string | null;
    submissionUrl: string | null;
    sources: { source: string; noticeId: string; url: string | null }[];
    isSample: boolean;
  };
  decision: Decision;
  fit: FitSection;
  risk: RiskSection;
  profit: ProfitSection;
  competition: CompetitionSection;
  learning: LearningSection;
  plan: PlanStep[];
  ai: { mode: 'off' | 'mock' | 'real'; used: boolean };
  /** Planen som trengs for låste deler (navn), f.eks. { profit: 'Profesjonell' }. */
  lockedPlans: Partial<Record<'fit' | 'profit' | 'competition' | 'documents', string>>;
}
