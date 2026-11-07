/**
 * Markedspris fra tidligere tildelinger.
 *
 * Finner tildelte kontrakter med samme CPV – så spesifikt som datagrunnlaget tillater – og viser hva de ble
 * tildelt for, totalt og per år når varigheten er kjent. Bare ekte verdier fra tildelingskunngjøringer:
 * ingen anslag og ingen utfylling. Holdes utenfor (og telles, så brukeren ser det):
 *   - rammeavtaler: verdien er ofte et tak eller anslag, ikke en pris,
 *   - tildelinger uten verdi eller i en annen valuta (vi regner ikke om valuta),
 *   - tildelinger eldre enn fem år og eksempeldata.
 * Samme vinner fra TED og Doffin telles én gang.
 *
 * Verdien er vinnerens tilbudsverdi i eForms (BT-720) og samlet tildelt verdi i TED. Det er en pekepinn på
 * prisnivået, ikke en fasit: omfang, kvalitetskrav og opsjoner varierer mellom kontrakter.
 */
import type { Tx } from '@/lib/db';
import { cpvLabels } from '@/domain/tenders/queries';
import { CPV_DIVISIONS } from '@/domain/reference';

/** Færre sammenlignbare tildelinger enn dette gir ingen statistikk. */
export const MIN_COMPARABLES = 3;
/** Fra så mange regnes grunnlaget som brukbart (færre vises med advarsel). */
export const SOLID_COMPARABLES = 8;
const MAX_AGE_YEARS = 5;

export interface MarketAward {
  tenderId: string;
  title: string;
  buyerName: string | null;
  supplierName: string;
  value: number;
  awardDate: Date | null;
  durationMonths: number | null;
  /** Verdi per år når varigheten er kjent. */
  perYear: number | null;
}

export interface MarketStats {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export interface MarketPrice {
  /** CPV-prefikset som ble brukt, med navn når koden finnes i CPV-listen (ellers hovedgruppen). Null uten brukbar CPV. */
  match: { prefix: string; code: string; label: string } | null;
  currency: string;
  /** Alle sammenlignbare tildelinger, nyeste først. Grensesnittet viser et utvalg; statistikken bruker alle. */
  awards: MarketAward[];
  total: MarketStats | null;
  perYear: MarketStats | null;
  excluded: { frameworks: number; otherCurrency: number };
}

/** Kvartiler med lineær interpolasjon (samme metode som regneark). */
export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function marketStats(values: number[]): MarketStats | null {
  if (values.length < MIN_COMPARABLES) return null;
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, min: s[0]!, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75), max: s[s.length - 1]! };
}

/** Andel av tildelingene som var dyrere enn prisen (0–100). «Lavere enn X % av tildelingene.» */
export function shareAbove(values: number[], price: number): number {
  if (!values.length) return 0;
  return Math.round((values.filter((v) => v > price).length / values.length) * 100);
}

const significant = (code: string) => code.slice(0, 8).replace(/0+$/, '');

/**
 * CPV-prefiksene som prøves, mest spesifikk først: kategori (5), klasse (4), gruppe (3). Koder med færre enn
 * tre gjeldende siffer (f.eks. 45000000, «bygg og anlegg») er for brede til å sammenligne priser, og prefiksene
 * lagres bare så langt koden er spesifikk (se cpvPrefixes) – de gir derfor ingen nivåer.
 */
export function cpvLevels(code: string | null | undefined): string[] {
  if (!code || !/^\d{8}/.test(code)) return [];
  const sig = significant(code);
  if (sig.length < 3) return [];
  const out: string[] = [];
  for (let len = Math.min(5, sig.length); len >= 3; len--) out.push(code.slice(0, len));
  return out;
}

/** Hovedkoden når den er spesifikk nok, ellers den mest spesifikke av anbudets øvrige koder. */
export function pickCpv(mainCpv: string | null, cpvCodes: string[]): string | null {
  const valid = [mainCpv, ...cpvCodes].filter((c): c is string => Boolean(c && /^\d{8}/.test(c)));
  if (mainCpv && valid.includes(mainCpv) && significant(mainCpv).length >= 3) return mainCpv;
  return [...valid].sort((x, y) => significant(y).length - significant(x).length)[0] ?? null;
}

interface Row {
  tenderId: string;
  title: string;
  buyerName: string | null;
  supplierName: string;
  value: number;
  currency: string | null;
  awardDate: Date | null;
  durationMonths: number | null;
  isFramework: boolean | null;
}

async function rowsFor(tx: Tx, prefix: string, excludeTenderId: string): Promise<Row[]> {
  // Samme vinner og delkontrakt fra flere kilder telles én gang; de nyeste 2000 holder for statistikken.
  return (await tx`
    select * from (
      select distinct on (a.tender_id, coalesce(s.org_number, lower(a.supplier_name)), coalesce(lower(a.lot_title), ''))
        a.tender_id, t.title, t.buyer_name, a.supplier_name, a.awarded_value::float8 as value,
        coalesce(a.currency, t.currency) as currency, coalesce(a.award_date, t.published_at::date) as award_date,
        t.duration_months::float8 as duration_months, t.is_framework
      from contract_awards a
      join tenders t on t.id = a.tender_id
      left join suppliers s on s.id = a.supplier_id
      where t.cpv_prefixes && ${[prefix]}::text[]
        and t.id <> ${excludeTenderId}
        and not t.is_sample
        and a.awarded_value > 0
        and coalesce(a.award_date, a.created_at::date) >= current_date - make_interval(years => ${MAX_AGE_YEARS})
      order by a.tender_id, coalesce(s.org_number, lower(a.supplier_name)), coalesce(lower(a.lot_title), ''), a.awarded_value desc
    ) x
    order by x.award_date desc nulls last
    limit 2000
  `) as unknown as Row[];
}

/** Ren funksjon: fra rader til markedspris (testes uten database). */
export function summarizeMarket(rows: Row[], currency: string): Omit<MarketPrice, 'match'> {
  let frameworks = 0;
  let otherCurrency = 0;
  const awards: MarketAward[] = [];
  for (const r of rows) {
    if (r.isFramework) {
      frameworks++;
      continue;
    }
    if ((r.currency ?? currency) !== currency) {
      otherCurrency++;
      continue;
    }
    const perYear = r.durationMonths && r.durationMonths >= 1 ? Math.round((r.value / r.durationMonths) * 12) : null;
    awards.push({
      tenderId: r.tenderId,
      title: r.title,
      buyerName: r.buyerName,
      supplierName: r.supplierName,
      value: r.value,
      awardDate: r.awardDate,
      durationMonths: r.durationMonths,
      perYear,
    });
  }
  awards.sort((a, b) => (b.awardDate?.getTime() ?? 0) - (a.awardDate?.getTime() ?? 0));
  return {
    currency,
    awards,
    total: marketStats(awards.map((a) => a.value)),
    perYear: marketStats(awards.filter((a) => a.perYear !== null).map((a) => a.perYear!)),
    excluded: { frameworks, otherCurrency },
  };
}

/**
 * Markedspris for et anbud. Prøver det mest spesifikke CPV-nivået først og går ett nivå opp når det er for
 * få sammenlignbare tildelinger (under {@link SOLID_COMPARABLES}). Velger det nivået som gir et brukbart grunnlag,
 * ellers det som gir flest.
 */
export async function marketPrice(
  tx: Tx,
  tender: { id: string; mainCpv: string | null; cpvCodes: string[]; currency: string | null },
): Promise<MarketPrice> {
  const currency = tender.currency ?? 'NOK';
  const levels = cpvLevels(pickCpv(tender.mainCpv, tender.cpvCodes));
  let best: { prefix: string; summary: Omit<MarketPrice, 'match'> } | null = null;
  for (const prefix of levels) {
    const summary = summarizeMarket(await rowsFor(tx, prefix, tender.id), currency);
    const n = summary.awards.length;
    if (!best || n > best.summary.awards.length) best = { prefix, summary };
    if (n >= SOLID_COMPARABLES) {
      best = { prefix, summary };
      break;
    }
  }
  if (!best) return { match: null, currency, awards: [], total: null, perYear: null, excluded: { frameworks: 0, otherCurrency: 0 } };
  const code = best.prefix.padEnd(8, '0');
  return { match: { prefix: best.prefix, code, label: await cpvPrefixLabel(tx, best.prefix) }, ...best.summary };
}

/** Navnet på et CPV-prefiks: koden i CPV-listen, ellers hovedgruppen («innen bygge- og anleggsarbeid»). */
export async function cpvPrefixLabel(tx: Tx, prefix: string): Promise<string> {
  const code = prefix.padEnd(8, '0');
  const labels = await cpvLabels(tx, [code]);
  const division = CPV_DIVISIONS[code.slice(0, 2)];
  return labels.get(code) ?? (division ? `innen ${division.charAt(0).toLowerCase()}${division.slice(1)}` : '');
}

export interface PricePosition {
  key: string;
  label: string;
  /** Prisen i samme enhet som markedsstatistikken (per år eller totalt). */
  value: number;
  /** Andel av tildelingene som var dyrere (0–100). */
  cheaperThanPct: number;
}

/**
 * Hvor bedriftens priser (minstepris, målpris, testpris) ligger i markedet. Per år når både anbudet og
 * tildelingene har kjent varighet, ellers totalt. Null når grunnlaget er for lite.
 */
export function pricePositions(
  market: MarketPrice,
  durationMonths: number | null,
  prices: { key: string; label: string; total: number | null }[],
): { unit: 'per_year' | 'total'; stats: MarketStats; values: number[]; positions: PricePosition[] } | null {
  const usePerYear = Boolean(durationMonths && durationMonths >= 1 && market.perYear);
  const stats = usePerYear ? market.perYear : market.total;
  if (!stats) return null;
  const values = usePerYear ? market.awards.filter((a) => a.perYear !== null).map((a) => a.perYear!) : market.awards.map((a) => a.value);
  const positions = prices
    .filter((p): p is { key: string; label: string; total: number } => p.total !== null && p.total > 0)
    .map((p) => {
      const value = usePerYear ? Math.round((p.total / durationMonths!) * 12) : p.total;
      return { key: p.key, label: p.label, value, cheaperThanPct: shareAbove(values, value) };
    });
  return { unit: usePerYear ? 'per_year' : 'total', stats, values, positions };
}
