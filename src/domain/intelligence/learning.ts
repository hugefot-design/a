/**
 * Læring for ett anbud: deres egne resultater i lignende anbud, regnet med samme funksjon som Resultater-siden
 * (learningSummary). To grupper:
 *   samme oppdragsgiver – samme organisasjon (eller samme navn når organisasjonen mangler)
 *   lignende arbeid     – felles bransje og samme CPV-hovedgruppe (to første sifre)
 * Innsikt vises først når minst MIN_DECIDED tilbud er avgjort (vunnet eller ikke vunnet) i gruppen – færre
 * gir tilfeldige tall. Ingen vinnersannsynlighet: bare hva som faktisk skjedde, med antall.
 */
import { OUTCOME_REASONS, learningSummary, type Learning, type ResultRow } from '@/domain/tenders/results';
import { fmtNumber } from '@/domain/profit/calculator';
import type { LearningGroup, LearningSection, Point } from './types';

export const MIN_DECIDED = 3;

export interface TenderKey {
  id: string;
  authorityId: string | null;
  buyerName: string | null;
  industryIds: string[];
  cpvCodes: string[];
  mainCpv: string | null;
}

/** Bransje og CPV for tidligere anbud (lastes sammen med resultatene). */
export type TenderMeta = Map<string, { industryIds: string[]; cpvCodes: string[]; mainCpv: string | null }>;

const division = (t: { mainCpv: string | null; cpvCodes: string[] }) => (t.mainCpv ?? t.cpvCodes[0] ?? '').slice(0, 2) || null;

export function sameBuyer(row: Pick<ResultRow, 'authorityId' | 'buyerName'>, t: Pick<TenderKey, 'authorityId' | 'buyerName'>): boolean {
  if (t.authorityId && row.authorityId) return row.authorityId === t.authorityId;
  return Boolean(t.buyerName && row.buyerName && t.buyerName.trim().toLowerCase() === row.buyerName.trim().toLowerCase());
}

export function similarWork(meta: { industryIds: string[]; cpvCodes: string[]; mainCpv: string | null } | undefined, t: TenderKey): boolean {
  if (!meta) return false;
  const sharedIndustry = meta.industryIds.some((i) => t.industryIds.includes(i));
  const d = division(t);
  return sharedIndustry && (d === null || division(meta) === d);
}

function group(l: Learning): LearningGroup {
  return { delivered: l.delivered, won: l.won, lost: l.lost, pending: l.pending, winRatePct: l.winRatePct };
}

function insightsFor(l: Learning, scope: string): Point[] {
  const out: Point[] = [];
  const decided = l.won + l.lost;
  if (decided < MIN_DECIDED) return out;
  const own = { kind: 'own' as const, label: 'Resultatene deres' };
  out.push({ text: `${scope}: ${l.won} av ${decided} avgjorte tilbud vunnet (${fmtNumber(l.winRatePct ?? 0)} %).`, basis: 'fact', source: own });
  const lossReasons = l.reasons.filter((r) => r.lost > 0 && r.reason !== null).sort((a, b) => b.lost - a.lost);
  const top = lossReasons[0];
  if (top && l.lost >= 2 && top.lost / l.lost >= 0.5) {
    out.push({ text: `${scope}: «${OUTCOME_REASONS[top.reason!]}» avgjorde ${top.lost} av ${l.lost} tap.`, basis: 'fact', source: own });
  }
  if (l.medianPriceDiffPct !== null && l.priceVsWinner.length >= 2) {
    const d = l.medianPriceDiffPct;
    out.push({
      text: `${scope}: prisen deres lå i median ${fmtNumber(Math.abs(d))} % ${d >= 0 ? 'over' : 'under'} vinneren (${l.priceVsWinner.length} sammenligninger).`,
      basis: 'calculation',
      source: own,
    });
  }
  if (l.medianCalcDiffPct !== null && l.calcVsResult.length >= 2) {
    const d = l.medianCalcDiffPct;
    out.push({
      text: `${scope}: målprisen i kalkylene lå i median ${fmtNumber(Math.abs(d))} % ${d >= 0 ? 'over' : 'under'} prisen som vant (${l.calcVsResult.length} anbud).`,
      basis: 'calculation',
      source: own,
    });
  }
  return out;
}

export interface LearningResult extends LearningSection {
  buyerRecord: { decided: number; won: number };
  /** Median pris mot vinneren (positiv = over), bare med nok data. */
  pricing: { medianDiffPct: number; n: number } | null;
}

export function learningFor(rows: ResultRow[], meta: TenderMeta, t: TenderKey): LearningResult {
  const others = rows.filter((r) => r.tenderId !== t.id);
  const buyerRows = others.filter((r) => sameBuyer(r, t));
  const similarRows = others.filter((r) => similarWork(meta.get(r.tenderId), t));
  const buyer = learningSummary(buyerRows);
  const similar = learningSummary(similarRows);

  const insights = [...insightsFor(buyer, 'Hos denne oppdragsgiveren'), ...insightsFor(similar, 'I lignende anbud')];
  const applied: string[] = [];
  const buyerDecided = buyer.won + buyer.lost;
  if (buyerDecided >= MIN_DECIDED && buyer.won === 0) applied.push(`Ingen av ${buyerDecided} avgjorte tilbud hos oppdragsgiveren er vunnet – lagt til som risiko.`);
  const similarDecided = similar.won + similar.lost;
  if (similarDecided >= MIN_DECIDED && (similar.winRatePct ?? 0) >= 50) applied.push(`Dere vinner ofte lignende anbud (${fmtNumber(similar.winRatePct ?? 0)} %) – tatt med som grunn for.`);
  // Pris mot vinneren: samme krav som ellers (nok avgjorte i gruppen) og minst to sammenligninger.
  const priceFrom = (l: Learning, decided: number) => (decided >= MIN_DECIDED && l.priceVsWinner.length >= 2 && l.medianPriceDiffPct !== null ? l : null);
  const priced = priceFrom(similar, similarDecided) ?? priceFrom(buyer, buyerDecided);
  const pricing = priced ? { medianDiffPct: priced.medianPriceDiffPct!, n: priced.priceVsWinner.length } : null;
  if (pricing && pricing.medianDiffPct > 5) {
    applied.push('Prisen har ligget over vinneren tidligere – handlingsplanen ber dere sjekke målprisen mot markedet.');
  }

  // Hvem som har slått dere (begge grupper, samme selskap telles én gang per anbud av learningSummary).
  const beat = new Map<string, number>();
  for (const w of [...buyer.winnersAgainstUs, ...similar.winnersAgainstUs]) beat.set(w.name, Math.max(beat.get(w.name) ?? 0, w.count));
  return {
    sameBuyer: group(buyer),
    similar: group(similar),
    insights,
    applied,
    minDecided: MIN_DECIDED,
    beatUs: [...beat].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    buyerRecord: { decided: buyerDecided, won: buyer.won },
    pricing,
  };
}
