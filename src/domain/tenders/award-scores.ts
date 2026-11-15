/**
 * Poeng fra tildelingsbrevet (byggeplanen, pakke 4): egne og vinnerens poeng, samlet og per kriterium – og hva det
 * betyr: tapte dere på pris eller på kvalitet og de andre kriteriene?
 *
 * - Bedriften skriver tallene inn selv fra brevet. Ingen AI leser brevet, og ingenting anslås: mangler et tall, er
 *   det utenfor utregningen.
 * - Poeng per kriterium kan stå før vekting (f.eks. 0–10, ganges med vekten) eller etter (f.eks. 28 av 30). Brukeren
 *   sier hvilken. Uten vekt kan et uvektet kriterium ikke regnes inn.
 * - Lagres på det lagrede anbudet (bookmarks), som bare organisasjonen selv ser (radnivåsikkerhet).
 */
import { fmtPoints, noticeWeights } from '@/domain/profit/award-sim';
import { fmtNumber } from '@/domain/profit/calculator';
import { parseNumber } from '@/domain/profit/service';
import { isEnvironmentNonCriterion } from './eforms-facts';

export const MAX_SCORE_CRITERIA = 6;
const MAX_POINTS = 1000;

export interface ScoreCriterion {
  name: string;
  /** Vekten i prosent, når den er kjent. */
  weightPct: number | null;
  ours: number | null;
  winner: number | null;
  /** Pris- eller kostnadskriterium (fra kunngjøringen, eller et kriterium som heter «Pris»). */
  price: boolean;
}

export interface ScoreDetails {
  ourTotal: number | null;
  winnerTotal: number | null;
  /** Poengene per kriterium er allerede vektet (står slik i brevet). */
  weighted: boolean;
  criteria: ScoreCriterion[];
}

/** «Pris», «Totalpris», «Price», «Livsløpskostnad» … – bare når kunngjøringen ikke har sagt det. */
const PRICE_NAME = /^(?:total)?(?:pris|price|kostnad|cost)\b|livsløpskostnad|totalkostnad/i;
export const isPriceName = (name: string) => PRICE_NAME.test(name.trim());

/** Leser poengene fra resultatskjemaet. Tomt skjema → null (feltene tømmes). Feil per tall – ingenting gjettes. */
export function parseScoreForm(form: FormData): { ok: true; data: ScoreDetails | null } | { ok: false; error: string } {
  const one = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.slice(0, 40).trim() : '';
  };
  const all = (k: string) => form.getAll(k).map((v) => (typeof v === 'string' ? v.slice(0, 200).trim() : ''));
  const num = (raw: string, label: string, max: number): number | null | string => {
    const n = parseNumber(raw);
    if (n === 'invalid') return `${label}: «${raw}» er ikke et tall.`;
    if (n !== null && (n < 0 || n > max)) return `${label} må være mellom 0 og ${max.toLocaleString('nb-NO')}.`;
    return n === null ? null : Math.round(n * 100) / 100;
  };
  const ourTotal = num(one('scoreOurTotal'), 'Deres samlede poeng', MAX_POINTS);
  if (typeof ourTotal === 'string') return { ok: false, error: ourTotal };
  const winnerTotal = num(one('scoreWinnerTotal'), 'Vinnerens samlede poeng', MAX_POINTS);
  if (typeof winnerTotal === 'string') return { ok: false, error: winnerTotal };

  const [names, weights, ours, winners, prices] = ['scoreName', 'scoreWeight', 'scoreOurs', 'scoreWinner', 'scorePrice'].map(all) as [string[], string[], string[], string[], string[]];
  const criteria: ScoreCriterion[] = [];
  for (let i = 0; i < Math.min(names.length, MAX_SCORE_CRITERIA); i++) {
    const name = names[i] ?? '';
    const w = num(weights[i] ?? '', `Vekt for ${name || `kriterium ${i + 1}`}`, 100);
    if (typeof w === 'string') return { ok: false, error: w };
    const o = num(ours[i] ?? '', `Deres poeng for ${name || `kriterium ${i + 1}`}`, MAX_POINTS);
    if (typeof o === 'string') return { ok: false, error: o };
    const v = num(winners[i] ?? '', `Vinnerens poeng for ${name || `kriterium ${i + 1}`}`, MAX_POINTS);
    if (typeof v === 'string') return { ok: false, error: v };
    // En rad uten poeng er bare en ledig rad (eller kriteriet fra kunngjøringen som ikke er fylt ut).
    if (o === null && v === null) continue;
    if (!name) return { ok: false, error: `Skriv navnet på kriterium ${i + 1}.` };
    criteria.push({ name: name.slice(0, 120), weightPct: w, ours: o, winner: v, price: prices[i] === '1' || (prices[i] !== '0' && isPriceName(name)) });
  }
  if (ourTotal === null && winnerTotal === null && !criteria.length) return { ok: true, data: null };
  return { ok: true, data: { ourTotal, winnerTotal, weighted: form.get('scoreWeighted') === '1', criteria } };
}

export interface ScoreAnalysis {
  /** Samlede poeng: fra brevet, eller regnet ut av kriteriene når alle har poeng og vekt. */
  totals: { ours: number; winner: number; source: 'brev' | 'regnet' } | null;
  /** Deres samlede poeng minus vinnerens. Negativ = bak. */
  gap: number | null;
  /** Per kriterium: forskjell i poeng og vektet forskjell (bidraget til summen). */
  criteria: { name: string; price: boolean; gap: number | null; weighted: number | null }[];
  /** Vektet forskjell på pris og på de andre kriteriene – når alle kriteriene kan regnes og pris er med. */
  split: { price: number; other: number } | null;
  /** Kriteriet dere tapte mest på (mest negative vektede forskjell). */
  biggestLoss: { name: string; weighted: number } | null;
  /** Hvor dere tapte: på pris, på kvalitet og de andre kriteriene, eller begge. */
  verdict: 'pris' | 'kvalitet' | 'begge' | null;
}

const EPS = 0.005;

export function analyzeScores(d: ScoreDetails): ScoreAnalysis {
  const criteria = d.criteria.map((c) => {
    const gap = c.ours !== null && c.winner !== null ? c.ours - c.winner : null;
    const weighted = gap === null ? null : d.weighted ? gap : c.weightPct !== null ? (gap * c.weightPct) / 100 : null;
    return { name: c.name, price: c.price, gap, weighted };
  });
  const complete = criteria.length > 0 && criteria.every((c) => c.weighted !== null);
  const contribution = (c: ScoreCriterion, side: 'ours' | 'winner') => (d.weighted ? c[side]! : (c[side]! * c.weightPct!) / 100);
  const fromCriteria = complete
    ? { ours: d.criteria.reduce((s, c) => s + contribution(c, 'ours'), 0), winner: d.criteria.reduce((s, c) => s + contribution(c, 'winner'), 0) }
    : null;
  const totals =
    d.ourTotal !== null && d.winnerTotal !== null
      ? { ours: d.ourTotal, winner: d.winnerTotal, source: 'brev' as const }
      : fromCriteria
        ? { ...fromCriteria, source: 'regnet' as const }
        : null;
  const hasPrice = criteria.some((c) => c.price);
  const hasOther = criteria.some((c) => !c.price);
  const split =
    complete && hasPrice && hasOther
      ? { price: criteria.filter((c) => c.price).reduce((s, c) => s + c.weighted!, 0), other: criteria.filter((c) => !c.price).reduce((s, c) => s + c.weighted!, 0) }
      : null;
  const losses = criteria.filter((c) => c.weighted !== null && c.weighted < -EPS).sort((a, b) => a.weighted! - b.weighted!);
  const verdict = split
    ? split.price < -EPS && split.other < -EPS
      ? 'begge'
      : split.price < -EPS
        ? 'pris'
        : split.other < -EPS
          ? 'kvalitet'
          : null
    : null;
  return {
    totals,
    gap: totals ? totals.ours - totals.winner : null,
    criteria,
    split,
    biggestLoss: losses[0] ? { name: losses[0].name, weighted: losses[0].weighted! } : null,
    verdict,
  };
}

/** «+0,60», «−1,60», «0,00». */
export const signedPoints = (n: number) => (n > EPS ? `+${fmtPoints(n)}` : n < -EPS ? `−${fmtPoints(-n)}` : fmtPoints(0));
const signed = signedPoints;

/** Én setning om hva poengene viser, eller null når det ikke er nok tall. */
export function scoreSummary(a: ScoreAnalysis): string | null {
  if (a.verdict === 'pris') return `Dere tapte på pris: ${fmtPoints(-a.split!.price)} poeng bak på pris, ${signed(a.split!.other)} på de andre kriteriene.`;
  if (a.verdict === 'kvalitet') return `Dere tapte på kvalitet og de andre kriteriene: ${fmtPoints(-a.split!.other)} poeng bak der, ${signed(a.split!.price)} på pris.`;
  if (a.verdict === 'begge') return `Dere lå bak både på pris (${fmtPoints(-a.split!.price)} poeng) og på de andre kriteriene (${fmtPoints(-a.split!.other)} poeng).`;
  if (a.biggestLoss) return `Dere tapte mest på «${a.biggestLoss.name}»: ${fmtPoints(-a.biggestLoss.weighted)} vektede poeng bak.`;
  if (a.totals && a.gap !== null) {
    const { ours, winner } = a.totals;
    if (a.gap < -EPS) return `Dere fikk ${fmtPoints(ours)} poeng mot vinnerens ${fmtPoints(winner)} – ${fmtPoints(-a.gap)} poeng bak.`;
    return `Dere fikk ${fmtPoints(ours)} poeng mot ${fmtPoints(winner)}.`;
  }
  return null;
}

/** Leser feltet fra databasen (jsonb) – tåler eldre eller tomme verdier. */
export function readScoreDetails(raw: unknown): ScoreDetails | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ScoreDetails>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    ourTotal: n(r.ourTotal),
    winnerTotal: n(r.winnerTotal),
    weighted: r.weighted === true,
    criteria: Array.isArray(r.criteria)
      ? r.criteria.slice(0, MAX_SCORE_CRITERIA).flatMap((c) =>
          c && typeof c === 'object' && typeof (c as ScoreCriterion).name === 'string'
            ? [{ name: (c as ScoreCriterion).name, weightPct: n((c as ScoreCriterion).weightPct), ours: n((c as ScoreCriterion).ours), winner: n((c as ScoreCriterion).winner), price: (c as ScoreCriterion).price === true }]
            : [],
        )
      : [],
  };
}

export interface ScoreFormRow {
  name: string;
  weight: string;
  ours: string;
  winner: string;
  /** '1' pris, '0' ikke pris (fra kunngjøringen eller lagret), '' = avgjøres av navnet. */
  price: '1' | '0' | '';
  fromNotice: boolean;
}

/**
 * Radene i poengskjemaet: det som er lagret – ellers kriteriene (og vektene, når de kan leses sikkert) fra
 * kunngjøringen. Alltid minst tre rader, høyst MAX_SCORE_CRITERIA.
 */
export function scoreFormRows(details: ScoreDetails | null, notice: readonly { name: string; type: string | null; weight: string | null }[] | null | undefined): ScoreFormRow[] {
  const f = (n: number | null) => (n === null ? '' : fmtNumber(n));
  let rows: ScoreFormRow[];
  if (details?.criteria.length) {
    rows = details.criteria.map((c) => ({ name: c.name, weight: f(c.weightPct), ours: f(c.ours), winner: f(c.winner), price: c.price ? '1' : '0', fromNotice: false }));
  } else {
    const weights = noticeWeights(notice);
    rows = weights
      ? weights.criteria.map((c) => ({ name: c.name, weight: f(c.pct), ours: '', winner: '', price: c.price ? '1' : '0', fromNotice: true }))
      : (notice ?? [])
          .filter((c) => !isEnvironmentNonCriterion(c.type))
          .map((c) => ({
            name: c.name,
            weight: '',
            ours: '',
            winner: '',
            price: c.type === 'price' || c.type === 'cost' ? '1' : c.type ? '0' : '',
            fromNotice: true,
          }));
  }
  rows = rows.slice(0, MAX_SCORE_CRITERIA);
  while (rows.length < 3) rows.push({ name: '', weight: '', ours: '', winner: '', price: '', fromNotice: false });
  return rows;
}
