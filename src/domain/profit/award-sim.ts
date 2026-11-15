/**
 * Tildelingssimulator (/tildeling): poeng for to tilbud ut fra vekten på pris, prisene og kvalitetspoengene – og
 * prisen der de to står likt. Svarer på «hvor mye dyrere kan vi være hvis vi er bedre på kvalitet?».
 *
 * Prismodellene er de to i DFØs veileder (anskaffelser.no, «Regne om pris til poeng»), på en skala fra 0 til 10,
 * der Pb er laveste pris og Pe prisen som evalueres:
 * - Forholdsmessig: 10 × Pb ÷ Pe. Ingen får 0 eller minuspoeng.
 * - Lineær: 10 − 10 × (Pe − Pb) ÷ Pb. 0 poeng ved dobbel pris av laveste, minuspoeng over det.
 * Summen er poengene ganget med vekten for hvert kriterium. Står det noe annet i konkurransegrunnlaget, gjelder det.
 *
 * - Bare to tilbud. Konkurrentens pris og poeng er brukerens egne antakelser – simulatoren vet ikke hva andre byr.
 * - Kvalitet og alle andre kriterier enn pris regnes som ett kriterium med resten av vekten.
 * - Ingenting lagres, og ingenting anslås: vektene fra kunngjøringen fylles bare inn når de kan leses sikkert.
 */
import { isEnvironmentNonCriterion } from '@/domain/tenders/eforms-facts';
import { fmtKr, fmtNumber } from './calculator';
import { parseNumber } from './service';

export const MAX_POINTS = 10;
/** DFØs veileder om å regne pris om til poeng – kilden til begge modellene. */
export const DFO_PRICE_SOURCE = 'https://www.anskaffelser.no/veileder-i-evaluering-av-tilbud/regne-om-pris-til-poeng';

export type PriceModel = 'forholdsmessig' | 'lineaer';
export const PRICE_MODELS: { id: PriceModel; label: string; formula: string; note: string }[] = [
  { id: 'forholdsmessig', label: 'Forholdsmessig', formula: '10 × laveste pris ÷ tilbudets pris', note: 'Ingen får 0 eller minuspoeng.' },
  { id: 'lineaer', label: 'Lineær', formula: '10 − 10 × (tilbudets pris − laveste pris) ÷ laveste pris', note: '0 poeng ved dobbel pris av laveste, minuspoeng over det.' },
];

export interface AwardSimForm {
  model: string;
  pricePct: string;
  ourPrice: string;
  ourQuality: string;
  theirPrice: string;
  theirQuality: string;
}

export const EMPTY_AWARD_SIM: AwardSimForm = { model: 'forholdsmessig', pricePct: '', ourPrice: '', ourQuality: '', theirPrice: '', theirQuality: '' };

export interface AwardSimInput {
  model: PriceModel;
  /** Vekten på pris i prosent (over 0, høyst 100). Resten er kvalitet og andre kriterier. */
  pricePct: number;
  ourPrice: number;
  ourQuality: number;
  theirPrice: number;
  theirQuality: number;
}

type Errors = Partial<Record<keyof AwardSimForm, string>>;
const MAX_PRICE = 1_000_000_000_000;

/** Leser skjemaet (norsk tallformat). Feil per felt – ingenting gjettes. */
export function parseAwardSim(form: AwardSimForm): { ok: true; input: AwardSimInput } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  const model = PRICE_MODELS.some((p) => p.id === form.model) ? (form.model as PriceModel) : null;
  if (!model) errors.model = 'Velg prismodell.';

  const read = (key: keyof AwardSimForm, label: string, missing: string, ok: (n: number) => boolean, range: string): number | null => {
    const n = parseNumber(form[key]);
    if (n === null) {
      errors[key] = missing;
      return null;
    }
    if (n === 'invalid') {
      errors[key] = `${label}: skriv et tall.`;
      return null;
    }
    if (!ok(n)) {
      errors[key] = `${label}: ${range}`;
      return null;
    }
    return n;
  };
  const pricePct = read('pricePct', 'Vekt på pris', 'Skriv vekten på pris, f.eks. 30.', (n) => n > 0 && n <= 100, 'må være over 0 og høyst 100.');
  const price = (n: number) => n > 0 && n <= MAX_PRICE;
  const ourPrice = read('ourPrice', 'Deres pris', 'Skriv prisen dere vurderer å by.', price, 'må være over 0.');
  const theirPrice = read('theirPrice', 'Konkurrentens pris', 'Skriv prisen dere tror konkurrenten byr.', price, 'må være over 0.');
  // Teller bare pris, brukes ikke kvalitetspoengene (og kan stå tomme).
  const priceOnly = pricePct === 100;
  const quality = (key: 'ourQuality' | 'theirQuality', label: string) => {
    if (priceOnly && parseNumber(form[key]) === null) return 0;
    return read(key, label, `Skriv ${label.toLowerCase()} fra 0 til 10.`, (n) => n >= 0 && n <= MAX_POINTS, 'må være mellom 0 og 10.');
  };
  const ourQuality = quality('ourQuality', 'Deres kvalitetspoeng');
  const theirQuality = quality('theirQuality', 'Konkurrentens kvalitetspoeng');

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, input: { model: model!, pricePct: pricePct!, ourPrice: ourPrice!, ourQuality: ourQuality!, theirPrice: theirPrice!, theirQuality: theirQuality! } };
}

/** Prispoeng etter DFØs formler. `lowest` er laveste pris blant tilbudene. */
export function pricePoints(model: PriceModel, price: number, lowest: number): number {
  return model === 'forholdsmessig' ? (MAX_POINTS * lowest) / price : MAX_POINTS - (MAX_POINTS * (price - lowest)) / lowest;
}

/**
 * Prisen der deres sum blir lik konkurrentens (alt annet likt).
 * - `pris`: den prisen, og hvor mye den ligger over (+) eller under (−) konkurrentens pris i prosent.
 * - `alltid`: med forholdsmessig modell er kvalitetsforspranget større enn prisen kan ta igjen – dere står foran uansett pris.
 * - `aldri`: med forholdsmessig modell er konkurrentens forsprang for stort til å tas igjen på pris.
 */
export type BreakEven = { kind: 'pris'; price: number; vsTheirsPct: number } | { kind: 'alltid' } | { kind: 'aldri' };

/** Kvalitetsforspranget (deres minus konkurrentens) regnet om til prispoeng. */
export function qualityLeadInPricePoints(input: Pick<AwardSimInput, 'pricePct' | 'ourQuality' | 'theirQuality'>): number {
  const w = input.pricePct / 100;
  return ((1 - w) * (input.ourQuality - input.theirQuality)) / w;
}

export function breakEven(input: AwardSimInput): BreakEven {
  const d = qualityLeadInPricePoints(input);
  const pt = input.theirPrice;
  const at = (price: number): BreakEven => ({ kind: 'pris', price, vsTheirsPct: (price / pt - 1) * 100 });
  if (d === 0) return at(pt);
  if (d > 0) {
    // Dere er dyrest: konkurrenten får 10 prispoeng, og deres prispoeng kan falle til 10 − d.
    if (input.model === 'forholdsmessig') return d >= MAX_POINTS ? { kind: 'alltid' } : at((pt * MAX_POINTS) / (MAX_POINTS - d));
    return at(pt * (1 + d / MAX_POINTS));
  }
  // Dere er billigst: dere får 10 prispoeng, og konkurrentens prispoeng må ned til 10 − |d|.
  const a = -d;
  if (input.model === 'forholdsmessig') return a >= MAX_POINTS ? { kind: 'aldri' } : at(pt * (1 - a / MAX_POINTS));
  return at(pt / (1 + a / MAX_POINTS));
}

export interface BidScore {
  price: number;
  pricePoints: number;
  quality: number;
  total: number;
}

export interface AwardSimResult {
  input: AwardSimInput;
  lowest: number;
  ours: BidScore;
  theirs: BidScore;
  /** Deres sum minus konkurrentens. */
  diff: number;
  /** «likt» når forskjellen er under 0,01 poeng. */
  outcome: 'vinner' | 'taper' | 'likt';
  breakEven: BreakEven;
  /** Ett kvalitetspoeng mer: hvor likt-prisen flytter seg. Null når det ikke kan regnes (full pott, bare pris, eller ingen likt-pris). */
  qualityPoint: { quality: number; from: number; to: number; kr: number } | null;
  /** Utregningen steg for steg («Slik er det regnet»). */
  steps: { label: string; formula: string; value: string }[];
}

const pointsFmt = new Intl.NumberFormat('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Poeng med to desimaler: «8,30». */
export const fmtPoints = (n: number) => pointsFmt.format(Math.round(n * 100) / 100 || 0);
const pct = (n: number) => `${fmtNumber(n)} %`;

function score(input: AwardSimInput, price: number, quality: number, lowest: number): BidScore {
  const w = input.pricePct / 100;
  const pp = pricePoints(input.model, price, lowest);
  return { price, pricePoints: pp, quality, total: pp * w + quality * (1 - w) };
}

export function simulateAward(input: AwardSimInput): AwardSimResult {
  const lowest = Math.min(input.ourPrice, input.theirPrice);
  const ours = score(input, input.ourPrice, input.ourQuality, lowest);
  const theirs = score(input, input.theirPrice, input.theirQuality, lowest);
  const diff = ours.total - theirs.total;
  const be = breakEven(input);
  const priceOnly = input.pricePct === 100;

  let qualityPoint: AwardSimResult['qualityPoint'] = null;
  if (!priceOnly && be.kind === 'pris' && input.ourQuality + 1 <= MAX_POINTS) {
    const next = breakEven({ ...input, ourQuality: input.ourQuality + 1 });
    if (next.kind === 'pris') qualityPoint = { quality: input.ourQuality + 1, from: be.price, to: next.price, kr: next.price - be.price };
  }

  // Slik er det regnet – med tallene som er brukt.
  const ppFormula = (price: number) =>
    input.model === 'forholdsmessig' ? `10 × ${fmtKr(lowest)} ÷ ${fmtKr(price)}` : `10 − 10 × (${fmtKr(price)} − ${fmtKr(lowest)}) ÷ ${fmtKr(lowest)}`;
  const sumFormula = (s: BidScore) =>
    priceOnly ? `${fmtPoints(s.pricePoints)} × 100 %` : `${fmtPoints(s.pricePoints)} × ${pct(input.pricePct)} + ${fmtPoints(s.quality)} × ${pct(100 - input.pricePct)}`;
  const steps: AwardSimResult['steps'] = [
    { label: 'Laveste pris', formula: `den laveste av ${fmtKr(input.ourPrice)} og ${fmtKr(input.theirPrice)}`, value: fmtKr(lowest) },
    { label: 'Prispoeng, dere', formula: ppFormula(input.ourPrice), value: fmtPoints(ours.pricePoints) },
    { label: 'Prispoeng, konkurrenten', formula: ppFormula(input.theirPrice), value: fmtPoints(theirs.pricePoints) },
    { label: 'Sum, dere', formula: sumFormula(ours), value: fmtPoints(ours.total) },
    { label: 'Sum, konkurrenten', formula: sumFormula(theirs), value: fmtPoints(theirs.total) },
  ];
  const d = qualityLeadInPricePoints(input);
  if (!priceOnly) {
    steps.push({
      label: 'Kvalitetsforsprang i prispoeng',
      formula: `(${fmtPoints(input.ourQuality)} − ${fmtPoints(input.theirQuality)}) × ${pct(100 - input.pricePct)} ÷ ${pct(input.pricePct)}`,
      value: fmtPoints(d),
    });
  }
  const pt = fmtKr(input.theirPrice);
  const a = fmtPoints(Math.abs(d));
  if (be.kind === 'pris') {
    const formula =
      d === 0
        ? priceOnly
          ? 'bare pris teller: lik pris gir lik sum'
          : 'samme kvalitetspoeng: lik pris gir lik sum'
        : d > 0
          ? input.model === 'forholdsmessig'
            ? `deres prispoeng kan falle til 10 − ${a}: 10 × ${pt} ÷ pris = 10 − ${a}`
            : `deres prispoeng kan falle til 10 − ${a}: 10 − 10 × (pris − ${pt}) ÷ ${pt} = 10 − ${a}`
          : input.model === 'forholdsmessig'
            ? `konkurrentens prispoeng må ned til 10 − ${a}: 10 × pris ÷ ${pt} = 10 − ${a}`
            : `konkurrentens prispoeng må ned til 10 − ${a}: 10 − 10 × (${pt} − pris) ÷ pris = 10 − ${a}`;
    steps.push({ label: 'Likt ved', formula, value: fmtKr(be.price) });
    // Kontroll: summene ved likt-prisen (regnet med den uavrundede prisen).
    const low = Math.min(be.price, input.theirPrice);
    const us = score(input, be.price, input.ourQuality, low);
    const them = score(input, input.theirPrice, input.theirQuality, low);
    steps.push({ label: 'Kontroll', formula: `ved ${fmtKr(be.price)} blir summen ${fmtPoints(us.total)} for dere og ${fmtPoints(them.total)} for konkurrenten`, value: 'likt' });
  } else {
    steps.push({
      label: 'Likt ved',
      formula:
        be.kind === 'alltid'
          ? `forspranget (${a}) er minst 10 – med forholdsmessig modell kan dere ikke tape så mange prispoeng`
          : `konkurrentens forsprang (${a}) er minst 10 – med forholdsmessig modell kan prisen ikke ta det igjen`,
      value: 'ingen pris',
    });
  }

  return { input, lowest, ours, theirs, diff, outcome: Math.abs(diff) < 0.005 ? 'likt' : diff > 0 ? 'vinner' : 'taper', breakEven: be, qualityPoint, steps };
}

// ---------------------------------------------------------------------------
// Vektene fra kunngjøringen
// ---------------------------------------------------------------------------
export interface NoticeWeights {
  pricePct: number;
  criteria: { name: string; pct: number; price: boolean }[];
}

const PRICE_TYPES = new Set(['price', 'cost']);
const WEIGHT = /^(\d+(?:[.,]\d+)?)\s*(%|poeng)$/u;

/**
 * Vekten på pris fra tildelingskriteriene i kunngjøringen – bare når den kan leses sikkert: alle kriteriene har vekt
 * i samme enhet (prosent, eller poeng som summerer til 100), summen er 100, og nøyaktig ett kriterium er pris eller
 * kostnad. Ellers null (ingenting fylles inn). Miljø som bare er krav i spesifikasjonen, er ikke kriterier og telles ikke.
 */
export function noticeWeights(criteria: readonly { name: string; type: string | null; weight: string | null }[] | null | undefined): NoticeWeights | null {
  const list = (criteria ?? []).filter((c) => !isEnvironmentNonCriterion(c.type));
  if (!list.length) return null;
  const items: { name: string; pct: number; price: boolean; unit: string }[] = [];
  for (const c of list) {
    const m = WEIGHT.exec((c.weight ?? '').replace(/[\s  ]+/g, ' ').trim());
    if (!m) return null;
    items.push({ name: c.name, pct: Number(m[1]!.replace(',', '.')), price: PRICE_TYPES.has(c.type ?? ''), unit: m[2]! });
  }
  if (new Set(items.map((i) => i.unit)).size !== 1) return null;
  const sum = items.reduce((s, i) => s + i.pct, 0);
  if (Math.abs(sum - 100) > 0.1) return null;
  const prices = items.filter((i) => i.price);
  if (prices.length !== 1 || !(prices[0]!.pct > 0)) return null;
  return { pricePct: prices[0]!.pct, criteria: items.map(({ name, pct: p, price }) => ({ name, pct: p, price })) };
}
