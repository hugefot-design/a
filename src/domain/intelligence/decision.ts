/**
 * Go/No-Go: bør bedriften bruke tid på anbudet? Bygger på det de andre delene allerede har funnet – ingen egen
 * motor og ingen vinnersannsynlighet. Reglene (i rekkefølge):
 *   1. En hindring (frist ute eller under to døgn, utelukket av profilen, lovpålagt godkjenning mangler, tap ved
 *      oppdragsgivers verdi)                                                            → Ikke gå videre
 *   2. Vi vet ikke om anbudet passer (ingen profil/treff) og det finnes ingen kalkyle → For lite grunnlag
 *   3. Svakt treff mot profilen (under 40) når kunngjøringen er tydelig nok            → Ikke gå videre
 *   4. Godt treff (60+), risiko ikke høy, Lønnsomhet sier ikke «Høy risiko» og
 *      ingen dårlige resultater hos oppdragsgiveren                                     → Gå videre
 *   5. Ellers                                                                           → Avklar først
 * Datagrunnlaget (hvor mye som finnes) vises ved siden av, så brukeren ser hvor sikker vurderingen er.
 */
import { fmtNumber } from '@/domain/profit/calculator';
import { RECOMMENDATION_LABEL } from '@/domain/profit/recommendation';
import { MIN_COMPARABLES } from '@/domain/profit/market';
import type { CompetitionSection, Decision, FitSection, Level, LearningSection, Point, ProfitSection, RiskSection, Verdict } from './types';

export const VERDICT_LABEL: Record<Verdict, string> = {
  go: 'Gå videre',
  clarify: 'Avklar først',
  no_go: 'Ikke gå videre',
  insufficient: 'For lite grunnlag',
};

export interface DecisionInputs {
  tenderId: string;
  fit: FitSection;
  risk: RiskSection;
  profit: ProfitSection;
  competition: CompetitionSection;
  learning: LearningSection;
  documentsEntitled: boolean;
  aiMode: 'off' | 'mock' | 'real';
  aiUsed: boolean;
  /** Plan som trengs for låste deler (navn). */
  lockedPlans: Partial<Record<'fit' | 'profit' | 'competition' | 'documents', string>>;
}

/** Liten forbokstav midt i en setning – men ikke i forkortelser («ISO 9001», «NS 8406»). */
const lower = (s: string) => (s.length > 1 && s.charAt(1) === s.charAt(1).toLowerCase() ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function decide(i: DecisionInputs): Decision {
  const { fit, risk, profit, competition, learning } = i;
  const blockers: Point[] = risk.factors.filter((f) => f.blocker).map((f) => ({ text: f.explanation, basis: f.basis, source: f.sources[0] ?? null }));
  const highUncertainty = fit.uncertainty?.level === 'høy';
  const profitHighRisk = profit.recommendation?.recommendation === 'high_risk';
  const buyerLosses = risk.factors.some((f) => f.key === 'buyer_losses');

  let verdict: Verdict;
  if (blockers.length) verdict = 'no_go';
  else if (fit.level === 'ukjent' && profit.availability !== 'ok') verdict = 'insufficient';
  else if (fit.level === 'svak' && !highUncertainty) verdict = 'no_go';
  else verdict = fit.level === 'god' && risk.level !== 'høy' && !profitHighRisk && !buyerLosses ? 'go' : 'clarify';

  // Grunner for
  const reasons: Point[] = [];
  if (fit.score !== null && fit.level === 'god') reasons.push({ text: `Godt treff mot profilen: ${fit.score} av 100.`, basis: 'calculation' });
  reasons.push(...fit.strengths.slice(0, 3));
  const required = fit.qualifications;
  if (required.length && required.every((q) => q.have)) {
    reasons.push({ text: `Kvalifikasjonene som nevnes, finnes i profilen eller bemanningen (${required.length}).`, basis: 'fact', source: { kind: 'own', label: 'Profilen og bemanningen deres' } });
  }
  const at = profit.calc?.atContractValue ?? null;
  if (profit.recommendation?.recommendation === 'bid' || (at && at.profit > 0 && profit.targetMarginPct !== null && at.marginPct >= profit.targetMarginPct)) {
    if (at) reasons.push({ text: `Lønnsom ved kontraktsverdien: margin ${fmtNumber(at.marginPct)} %.`, basis: 'calculation', source: { kind: 'own', label: 'Kalkylen deres' } });
  }
  const similar = learning.similar;
  if (similar.won + similar.lost >= learning.minDecided && (similar.winRatePct ?? 0) >= 50) {
    reasons.push({ text: `Dere har vunnet ${similar.won} av ${similar.won + similar.lost} lignende anbud.`, basis: 'fact', source: { kind: 'own', label: 'Resultatene deres' } });
  }
  if (competition.bids && competition.bids.median <= 3) {
    reasons.push({ text: `Lignende konkurranser får få tilbud: median ${fmtNumber(competition.bids.median)} (${competition.bids.n} konkurranser).`, basis: 'fact', source: { kind: 'award', label: 'Tildelingskunngjøringer' } });
  }
  if (risk.level === 'lav') reasons.push({ text: `Lav risiko: ${risk.score} av 100.`, basis: 'calculation' });

  // Forhold som må avklares (hindringene står for seg)
  const concerns: Point[] = [];
  if (verdict === 'no_go' && !blockers.length && fit.score !== null) concerns.push({ text: `Svakt treff mot profilen: ${fit.score} av 100.`, basis: 'calculation' });
  for (const f of risk.factors.filter((x) => !x.blocker && x.severity !== 'lav').slice(0, 5)) {
    concerns.push({ text: `${f.label}: ${lower(f.explanation)}`, basis: f.basis, source: f.sources[0] ?? null });
  }
  if (fit.level === 'middels') concerns.push({ text: `Middels treff mot profilen: ${fit.score} av 100.`, basis: 'calculation' });
  // Avvik fra treffet – uten dem som allerede står som manglende kvalifikasjon over.
  const missingQuals = fit.qualifications.filter((q) => !q.have).map((q) => q.label.toLowerCase());
  if (fit.level !== 'god') concerns.push(...fit.gaps.filter((g) => !missingQuals.some((q) => g.text.toLowerCase().includes(q))).slice(0, 2));
  if (profit.recommendation && profit.recommendation.recommendation !== 'bid' && profit.recommendation.recommendation !== 'insufficient_data') {
    concerns.push({ text: `Lønnsomhet: «${RECOMMENDATION_LABEL[profit.recommendation.recommendation]}». ${profit.recommendation.reasons[0] ?? ''}`.trim(), basis: 'calculation', source: { kind: 'own', label: 'Kalkylen deres' } });
  }

  // Det som ville gjort vurderingen sikrere
  const missing: Decision['missing'] = [];
  const planNote = (what: string, plan: string | undefined) => ({ text: `${what} er med i ${plan ?? 'en høyere plan'}.`, href: '/app/abonnement' });
  if (fit.availability === 'no_profile') missing.push({ text: 'Fyll ut bedriftsprofilen, så kan vi vurdere om anbudet passer.', href: '/app/profil' });
  if (fit.availability === 'locked') missing.push(planNote('Treff mot bedriftsprofilen', i.lockedPlans.fit));
  if (profit.availability === 'no_costs') missing.push({ text: 'Legg inn kostnadene deres for å se lønnsomheten.', href: `/app/anbud/${i.tenderId}/lonnsomhet` });
  if (profit.availability === 'locked') missing.push(planNote('Lønnsomhetskalkulatoren', i.lockedPlans.profit));
  if (risk.read.noticeOnly) {
    missing.push(
      i.documentsEntitled
        ? { text: 'Last opp konkurransegrunnlaget, så leser vi alle krav og vilkår.', href: `/app/anbud/${i.tenderId}#dokumenter-for-analyse` }
        : planNote('Opplasting av konkurransegrunnlaget', i.lockedPlans.documents),
    );
  }
  if (competition.availability === 'locked') missing.push(planNote('Konkurranseinnsikt', i.lockedPlans.competition));
  const anyLearning = [learning.sameBuyer, learning.similar].some((g) => g.won + g.lost >= learning.minDecided);
  if (!anyLearning) missing.push({ text: 'Registrer vunnet og tapt på leverte tilbud – da lærer vurderingen av resultatene deres.', href: '/app/resultater' });

  // Datagrunnlag
  const market = profit.market;
  const competitionData = Boolean(competition.buyer?.contracts || competition.similar?.contracts || competition.bids);
  const coverage: Decision['coverage'] = [
    { key: 'fit', label: 'Profil og treff', available: fit.score !== null, detail: fit.score !== null ? `${fit.score} av 100` : fit.availability === 'locked' ? 'Ikke i planen' : 'Mangler profil' },
    {
      key: 'documents',
      label: 'Dokumenter',
      available: !risk.read.noticeOnly,
      detail: risk.read.noticeOnly ? 'Bare kunngjøringen' : `${risk.read.documents} lest (${risk.read.pages} sider)`,
    },
    { key: 'profit', label: 'Kalkyle', available: profit.availability === 'ok', detail: profit.availability === 'ok' ? 'Lagt inn' : profit.availability === 'locked' ? 'Ikke i planen' : 'Mangler kostnader' },
    {
      key: 'market',
      label: 'Markedspris',
      available: Boolean(market && market.n >= MIN_COMPARABLES),
      detail: market ? (market.n >= MIN_COMPARABLES ? `${market.n} tildelinger` : `For få (${market.n})`) : profit.availability === 'locked' ? 'Ikke i planen' : 'Ingen',
    },
    {
      key: 'competition',
      label: 'Konkurranse',
      available: competitionData,
      detail: competition.availability === 'locked' ? 'Ikke i planen' : competitionData ? `${(competition.buyer?.contracts ?? 0) + (competition.similar?.contracts ?? 0)} kontrakter` : 'Ingen tildelinger',
    },
    {
      key: 'learning',
      label: 'Egne resultater',
      available: anyLearning,
      detail: `${learning.sameBuyer.won + learning.sameBuyer.lost + learning.similar.won + learning.similar.lost} avgjort`,
    },
    { key: 'ai', label: 'AI-vurdering', available: i.aiUsed, detail: i.aiUsed ? (i.aiMode === 'mock' ? 'Simulert (testmodus)' : 'Brukt') : i.aiMode === 'off' ? 'Ikke slått på' : 'Ikke kjørt' },
  ];
  const points = (fit.score !== null ? 2 : 0) + (!risk.read.noticeOnly ? 2 : 0) + (profit.availability === 'ok' ? 2 : 0) + (market && market.n >= MIN_COMPARABLES ? 1 : 0) + (competitionData ? 1 : 0) + (anyLearning ? 1 : 0);
  const max = 9;
  const level: Level = points >= 7 ? 'høy' : points >= 4 ? 'middels' : 'lav';

  const concernNames = [
    ...risk.factors.filter((f) => !f.blocker && f.severity !== 'lav').map((f) => lower(f.label)),
    ...(fit.level === 'middels' || fit.level === 'ukjent' ? ['treffet mot profilen'] : []),
    ...(profitHighRisk ? ['lønnsomheten'] : []),
  ];
  const headline =
    verdict === 'go'
      ? 'Anbudet passer, og vi fant ingen hindringer. Det er verdt tiden.'
      : verdict === 'clarify'
        ? `Kan være verdt det, men avklar først ${concernNames.slice(0, 2).join(' og ') || 'punktene under'}.`
        : verdict === 'no_go'
          ? `Ikke bruk tid på dette: ${lower(blockers[0]?.text ?? concerns[0]?.text ?? 'se grunnene under.')}`
          : 'For lite grunnlag til å anbefale noe ennå. Se hva som mangler.';

  return { verdict, label: VERDICT_LABEL[verdict], headline, blockers, reasons, concerns, missing, confidence: { level, score: points, max }, coverage };
}
