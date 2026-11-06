/**
 * Tilbudsresultat og læring.
 *
 * Bygger på lagrede anbud: status «Tilbud levert», «Vunnet» eller «Ikke vunnet», og det bedriften selv
 * registrerer fra tildelingsbrevet (egen pris, vinner, vinnerpris og hva som avgjorde). Tildelinger fra
 * kunngjøringene brukes når de finnes og vises alltid med kilde. Ingenting gjettes: mangler et tall, holdes
 * det utenfor snitt og sammenligninger, og «Ikke vunnet» settes aldri automatisk.
 *
 * Verdien i en tildelingskunngjøring er vinnerens tilbudsverdi i eForms (BT-720) og samlet tildelt verdi i TED.
 * For rammeavtaler er den ofte et anslag, så den brukes bare automatisk når det er én vinner og ikke rammeavtale.
 */
import { first, type Tx } from '@/lib/db';
import { parseNumber } from '@/domain/profit/service';

export const OUTCOME_REASONS = {
  pris: 'Pris',
  kvalitet: 'Kvalitet eller løsning',
  kvalifikasjon: 'Ikke kvalifisert',
  avvist: 'Tilbudet ble avvist',
  annet: 'Annet',
} as const;
export type OutcomeReason = keyof typeof OUTCOME_REASONS;

/** Statuser som betyr at tilbudet er levert. */
export const DELIVERED_STATUSES = ['submitted', 'won', 'lost'] as const;

export interface ResultFields {
  ourPrice: number | null;
  winningPrice: number | null;
  winnerName: string | null;
  reason: OutcomeReason | null;
}

const MAX_PRICE = 1e13;

/** Leser resultatfeltene fra skjemaet (norsk tallformat: «1 250 000», «1.250.000,50»). */
export function parseResultForm(form: FormData): { ok: true; data: ResultFields } | { ok: false; error: string } {
  const str = (k: string, max: number) => {
    const v = form.get(k);
    return typeof v === 'string' ? v.slice(0, max).trim() : '';
  };
  const price = (k: string, label: string): number | null | string => {
    const n = parseNumber(str(k, 40));
    if (n === 'invalid') return `${label}: «${str(k, 40)}» er ikke et tall.`;
    if (n !== null && (n < 0 || n > MAX_PRICE)) return `${label} må være et positivt beløp.`;
    return n === null ? null : Math.round(n * 100) / 100;
  };
  const ourPrice = price('ourPrice', 'Deres pris');
  if (typeof ourPrice === 'string') return { ok: false, error: ourPrice };
  const winningPrice = price('winningPrice', 'Vinnerens pris');
  if (typeof winningPrice === 'string') return { ok: false, error: winningPrice };
  const reasonRaw = str('reason', 20);
  if (reasonRaw && !(reasonRaw in OUTCOME_REASONS)) return { ok: false, error: 'Velg hva som avgjorde fra listen.' };
  return {
    ok: true,
    data: { ourPrice, winningPrice, winnerName: str('winnerName', 200) || null, reason: (reasonRaw || null) as OutcomeReason | null },
  };
}

export async function saveResultFields(tx: Tx, orgId: string, bookmarkId: string, data: ResultFields): Promise<boolean> {
  const rows = await tx`
    update bookmarks set our_price = ${data.ourPrice}, winning_price = ${data.winningPrice}, winner_name = ${data.winnerName},
      outcome_reason = ${data.reason}
    where id = ${bookmarkId} and org_id = ${orgId} returning id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Tildelinger
// ---------------------------------------------------------------------------
export interface AwardRow {
  tenderId: string;
  supplierId: string | null;
  supplierName: string;
  supplierOrgNumber: string | null;
  lotTitle: string | null;
  awardedValue: number | null;
  currency: string | null;
  awardDate: Date | null;
}

export interface DistinctAward extends AwardRow {
  /** Leverandørens org.nr. er organisasjonens eget. */
  isUs: boolean;
}

/**
 * Samme vinner kan stå både i TED og Doffin. Slår sammen per leverandør og delkontrakt, og beholder en verdi
 * når én av kildene har den.
 */
export function distinctAwards(awards: AwardRow[], ourOrgNumber: string | null): DistinctAward[] {
  const map = new Map<string, DistinctAward>();
  for (const a of awards) {
    const key = `${a.supplierOrgNumber ?? a.supplierId ?? a.supplierName.trim().toLowerCase()}|${(a.lotTitle ?? '').trim().toLowerCase()}`;
    const prev = map.get(key);
    if (!prev) map.set(key, { ...a, isUs: Boolean(ourOrgNumber && a.supplierOrgNumber === ourOrgNumber) });
    else if (prev.awardedValue === null && a.awardedValue !== null) map.set(key, { ...prev, awardedValue: a.awardedValue, currency: a.currency });
  }
  return [...map.values()];
}

async function orgNumberOf(tx: Tx, orgId: string): Promise<string | null> {
  return first((await tx`select org_number from organizations where id = ${orgId}`) as unknown as { orgNumber: string | null }[])?.orgNumber ?? null;
}

async function awardsFor(tx: Tx, tenderIds: string[]): Promise<AwardRow[]> {
  if (!tenderIds.length) return [];
  return (await tx`
    select a.tender_id, a.supplier_id, a.supplier_name, s.org_number as supplier_org_number, a.lot_title, a.awarded_value::float8 as awarded_value,
           a.currency, a.award_date
    from contract_awards a left join suppliers s on s.id = a.supplier_id
    where a.tender_id = any(${tenderIds}::uuid[])
    order by a.award_date desc nulls last
  `) as unknown as AwardRow[];
}

// ---------------------------------------------------------------------------
// Ett anbud (anbudssiden)
// ---------------------------------------------------------------------------
export interface BuyerHistory {
  delivered: number;
  won: number;
  lost: number;
  pending: number;
  recent: { tenderId: string; title: string; status: string; reason: OutcomeReason | null }[];
}

export interface TenderResultInfo {
  ourOrgNumber: string | null;
  /** Tildelingen nevner organisasjonens org.nr. */
  awardMentionsUs: boolean;
  /** Leverandør-ID-ene i tildelingen som er organisasjonen selv (for merking i tildelingslisten). */
  ourSupplierIds: string[];
  /** Målpris i bedriftens kalkyle for anbudet (Profit Intelligence), hvis den finnes. */
  calcTargetPrice: number | null;
  /** Bedriftens tidligere leverte tilbud til samme oppdragsgiver (dette anbudet er ikke med). */
  buyerHistory: BuyerHistory | null;
}

export async function tenderResultInfo(
  tx: Tx,
  orgId: string,
  tender: { id: string; authorityId: string | null; buyerName: string | null },
): Promise<TenderResultInfo> {
  const ourOrgNumber = await orgNumberOf(tx, orgId);
  const awards = distinctAwards(await awardsFor(tx, [tender.id]), ourOrgNumber);
  const calc = first(
    // Kalkylen lagres som et øyeblikksbilde ({ version, calc: { targetPrice, … } }) – målprisen ligger under «calc».
    (await tx`select (result->'calc'->>'targetPrice')::float8 as target from tender_calculations where org_id = ${orgId} and tender_id = ${tender.id}`) as unknown as {
      target: number | null;
    }[],
  );
  const history = (await tx`
    select b.tender_id, t.title, b.status, b.outcome_reason
    from bookmarks b join tenders t on t.id = b.tender_id
    where b.org_id = ${orgId} and b.tender_id <> ${tender.id} and b.status in ('submitted', 'won', 'lost')
      and ${tender.authorityId ? tx`t.authority_id = ${tender.authorityId}` : tender.buyerName ? tx`lower(t.buyer_name) = lower(${tender.buyerName})` : tx`false`}
    order by coalesce(b.decided_at, b.submitted_at, b.updated_at) desc
    limit 50
  `) as unknown as { tenderId: string; title: string; status: string; outcomeReason: OutcomeReason | null }[];
  const count = (s: string) => history.filter((h) => h.status === s).length;
  return {
    ourOrgNumber,
    awardMentionsUs: awards.some((a) => a.isUs),
    ourSupplierIds: [...new Set(awards.filter((a) => a.isUs && a.supplierId).map((a) => a.supplierId!))],
    calcTargetPrice: calc?.target ?? null,
    buyerHistory: history.length
      ? {
          delivered: history.length,
          won: count('won'),
          lost: count('lost'),
          pending: count('submitted'),
          recent: history.slice(0, 3).map((h) => ({ tenderId: h.tenderId, title: h.title, status: h.status, reason: h.outcomeReason })),
        }
      : null,
  };
}

/**
 * «Vi vant» fra tildelingen: bare når kunngjøringen faktisk nevner organisasjonens org.nr. Settes aldri uten at
 * brukeren trykker (ingen automatiske endringer i kundens data).
 */
export async function confirmAwardWin(tx: Tx, orgId: string, bookmarkId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const bm = first((await tx`select tender_id from bookmarks where id = ${bookmarkId} and org_id = ${orgId}`) as unknown as { tenderId: string }[]);
  if (!bm) return { ok: false, error: 'Fant ikke det lagrede anbudet.' };
  const ourOrgNumber = await orgNumberOf(tx, orgId);
  if (!distinctAwards(await awardsFor(tx, [bm.tenderId]), ourOrgNumber).some((a) => a.isUs)) {
    return { ok: false, error: 'Tildelingen nevner ikke organisasjonsnummeret deres. Registrer resultatet selv.' };
  }
  await tx`
    update bookmarks set status = 'won', decided_at = now(), outcome_source = 'tildeling', submitted_at = coalesce(submitted_at, now())
    where id = ${bookmarkId} and org_id = ${orgId}
  `;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Resultater og læring (egen side)
// ---------------------------------------------------------------------------
export interface ResultRow {
  bookmarkId: string;
  tenderId: string;
  title: string;
  buyerName: string | null;
  authorityId: string | null;
  status: 'submitted' | 'won' | 'lost';
  ourPrice: number | null;
  winningPrice: number | null;
  winnerName: string | null;
  reason: OutcomeReason | null;
  outcomeSource: 'bruker' | 'tildeling' | null;
  decidedAt: Date | null;
  submittedAt: Date | null;
  deadlineAt: Date | null;
  isFramework: boolean | null;
  currency: string | null;
  calcTargetPrice: number | null;
  awards: DistinctAward[];
}

export interface PriceComparison {
  tenderId: string;
  title: string;
  /** Deres pris (tapte anbud) eller målprisen i kalkylen. */
  price: number;
  winningPrice: number;
  /** (pris − vinnerpris) ÷ vinnerpris × 100. Positiv = dere lå over vinneren. */
  diffPct: number;
  source: 'tildelingsbrev' | 'kunngjøring' | 'egen_pris';
}

export interface Learning {
  delivered: number;
  won: number;
  lost: number;
  pending: number;
  /** Andel vunnet av avgjorte (vunnet + ikke vunnet). Null når ingen er avgjort. */
  winRatePct: number | null;
  reasons: { reason: OutcomeReason | null; won: number; lost: number }[];
  priceVsWinner: PriceComparison[];
  medianPriceDiffPct: number | null;
  calcVsResult: PriceComparison[];
  medianCalcDiffPct: number | null;
  winnersAgainstUs: { name: string; supplierId: string | null; count: number }[];
  buyers: { name: string; authorityId: string | null; delivered: number; won: number; lost: number }[];
  /** Leverte tilbud uten resultat – med tildelingen hvis den er publisert. */
  awaiting: ResultRow[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
}

/**
 * Vinnerprisen et tapt anbud kan sammenlignes med: tildelingsbrevet (registrert av bedriften) først, ellers
 * verdien i tildelingskunngjøringen når det er nøyaktig én annen vinner, samme valuta og ikke rammeavtale.
 */
export function comparableWinningPrice(row: Pick<ResultRow, 'status' | 'winningPrice' | 'isFramework' | 'currency' | 'awards'>): {
  price: number;
  source: 'tildelingsbrev' | 'kunngjøring';
} | null {
  if (row.status !== 'lost') return null;
  if (row.winningPrice !== null && row.winningPrice > 0) return { price: row.winningPrice, source: 'tildelingsbrev' };
  if (row.isFramework) return null;
  const others = row.awards.filter((a) => !a.isUs);
  const only = others.length === 1 ? others[0]! : null;
  if (!only || only.awardedValue === null || only.awardedValue <= 0) return null;
  if ((only.currency ?? 'NOK') !== (row.currency ?? 'NOK')) return null;
  return { price: only.awardedValue, source: 'kunngjøring' };
}

const diff = (price: number, winning: number) => round1(((price - winning) / winning) * 100);

/** «Rask Renhold AS» og «RASK RENHOLD A/S» er samme selskap. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/(?<![a-zæøå0-9])(?:asa|as|a\/s|ab|oy|gmbh|ltd|sa|ans|da|sf)(?![a-zæøå0-9])/g, ' ')
    .replace(/[^a-zæøå0-9]+/g, ' ')
    .trim();
}

export function learningSummary(rows: ResultRow[]): Learning {
  const won = rows.filter((r) => r.status === 'won');
  const lost = rows.filter((r) => r.status === 'lost');
  const decided = won.length + lost.length;

  const reasonKeys: (OutcomeReason | null)[] = [...(Object.keys(OUTCOME_REASONS) as OutcomeReason[]), null];
  const reasons = reasonKeys
    .map((reason) => ({ reason, won: won.filter((r) => r.reason === reason).length, lost: lost.filter((r) => r.reason === reason).length }))
    .filter((r) => r.won + r.lost > 0);

  const priceVsWinner: PriceComparison[] = [];
  const calcVsResult: PriceComparison[] = [];
  for (const r of [...won, ...lost]) {
    const winning = comparableWinningPrice(r);
    if (winning && r.ourPrice !== null && r.ourPrice > 0) {
      priceVsWinner.push({ tenderId: r.tenderId, title: r.title, price: r.ourPrice, winningPrice: winning.price, diffPct: diff(r.ourPrice, winning.price), source: winning.source });
    }
    // Kalkylen mot det som faktisk vant: vinnerprisen for tapte, deres egen pris for vunnede.
    const reference = r.status === 'won' ? (r.ourPrice !== null && r.ourPrice > 0 ? { price: r.ourPrice, source: 'egen_pris' as const } : null) : winning;
    if (reference && r.calcTargetPrice !== null && r.calcTargetPrice > 0) {
      calcVsResult.push({
        tenderId: r.tenderId,
        title: r.title,
        price: r.calcTargetPrice,
        winningPrice: reference.price,
        diffPct: diff(r.calcTargetPrice, reference.price),
        source: reference.source,
      });
    }
  }

  // Samme selskap kan komme fra kunngjøringen (med org.nr.) og fra tildelingsbrevet (bare navn) – grupperes på navn.
  const winners = new Map<string, { name: string; supplierId: string | null; count: number }>();
  for (const r of lost) {
    const fromAwards = r.awards.filter((a) => !a.isUs);
    const names = fromAwards.length
      ? fromAwards.map((a) => ({ name: a.supplierName, supplierId: a.supplierId }))
      : r.winnerName
        ? [{ name: r.winnerName, supplierId: null }]
        : [];
    for (const key of new Set(names.map((x) => companyKey(x.name)))) {
      if (!key) continue;
      const n = names.find((x) => companyKey(x.name) === key)!;
      const prev = winners.get(key);
      winners.set(key, prev ? { ...prev, supplierId: prev.supplierId ?? n.supplierId, count: prev.count + 1 } : { name: n.name, supplierId: n.supplierId, count: 1 });
    }
  }

  const buyers = new Map<string, { name: string; authorityId: string | null; delivered: number; won: number; lost: number }>();
  for (const r of rows) {
    const name = r.buyerName ?? 'Ukjent oppdragsgiver';
    const key = r.authorityId ?? name.toLowerCase();
    const b = buyers.get(key) ?? { name, authorityId: r.authorityId, delivered: 0, won: 0, lost: 0 };
    b.delivered++;
    if (r.status === 'won') b.won++;
    if (r.status === 'lost') b.lost++;
    buyers.set(key, b);
  }

  return {
    delivered: rows.length,
    won: won.length,
    lost: lost.length,
    pending: rows.length - decided,
    winRatePct: decided ? round1((won.length / decided) * 100) : null,
    reasons,
    priceVsWinner,
    medianPriceDiffPct: median(priceVsWinner.map((p) => p.diffPct)),
    calcVsResult,
    medianCalcDiffPct: median(calcVsResult.map((p) => p.diffPct)),
    winnersAgainstUs: [...winners.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'nb')).slice(0, 8),
    buyers: [...buyers.values()].sort((a, b) => b.delivered - a.delivered || a.name.localeCompare(b.name, 'nb')).slice(0, 10),
    awaiting: rows.filter((r) => r.status === 'submitted'),
  };
}

export async function loadResults(tx: Tx, orgId: string): Promise<{ rows: ResultRow[]; ourOrgNumber: string | null }> {
  const ourOrgNumber = await orgNumberOf(tx, orgId);
  const raw = (await tx`
    select b.id as bookmark_id, b.tender_id, t.title, t.buyer_name, t.authority_id, b.status,
           b.our_price::float8 as our_price, b.winning_price::float8 as winning_price, b.winner_name, b.outcome_reason as reason,
           b.outcome_source, b.decided_at, b.submitted_at, t.deadline_at, t.is_framework, t.currency,
           (c.result->'calc'->>'targetPrice')::float8 as calc_target_price
    from bookmarks b
    join tenders t on t.id = b.tender_id
    left join tender_calculations c on c.org_id = b.org_id and c.tender_id = b.tender_id
    where b.org_id = ${orgId} and b.status in ('submitted', 'won', 'lost')
    order by coalesce(b.decided_at, b.submitted_at, b.updated_at) desc
    limit 500
  `) as unknown as Omit<ResultRow, 'awards'>[];
  const awards = await awardsFor(
    tx,
    raw.map((r) => r.tenderId),
  );
  const rows = raw.map((r) => ({ ...r, awards: distinctAwards(awards.filter((a) => a.tenderId === r.tenderId), ourOrgNumber) }));
  return { rows, ourOrgNumber };
}
