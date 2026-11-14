/**
 * Offentlig side per anbud (/anbud/<id>, bare norsk) – til deling, ukesbrevet og søk.
 *
 * - Viser det som står i den offentlige kunngjøringen, og det AnbudRadar finner med ordsøket i appen (krav,
 *   avvisningsgrunner, befaring og kostbare vilkår) – ordrett, uten AI og uten å fylle inn noe.
 * - Hva lignende kontrakter ble tildelt for (samme markedspris som i appen), bare når det finnes nok tildelinger.
 * - E-postadresser og telefonnumre i teksten skjules (kontaktpersoner er personopplysninger, selv om de er publisert).
 * - Bare åpne anbud med nok tekst indekseres av søkemotorer. Resten får noindex – ingen tynne sider.
 *
 * Mellomlagres i 30 minutter per anbud.
 */
import type { AnalysisSource } from '@/domain/ai/sources';
import { scanRequirements, type RequirementKind } from '@/domain/documents/requirements';
import { marketPrice } from '@/domain/profit/market';
import { scanContractTerms, type TermCategory } from '@/domain/profit/terms-scan';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { systemSql, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import { displayBuyer } from './market';
import { getTender } from './queries';
import { marketSummary, scanCandidate, type Showcase, type ShowcaseQuote } from './showcase';

/** Minst så mange tegn kunngjøringstekst for at siden skal indekseres. */
export const MIN_TEXT_FOR_INDEXING = 300;
const MAX_TEXT = 1600;
const TTL_MS = 30 * 60_000;
const MAX_CACHED = 300;
const COSTLY: TermCategory[] = ['dagbot', 'garanti', 'erstatningsansvar', 'forsikring', 'betalingsvilkar', 'prisregulering'];

export interface PublicTender {
  id: string;
  title: string;
  buyerName: string | null;
  place: string | null;
  regions: { code: string; name: string }[];
  industries: { id: string; name: string }[];
  status: string;
  deadlineAt: Date | null;
  deadlineTimeKnown: boolean;
  deadlineKind: string | null;
  publishedAt: Date | null;
  estimatedValue: number | null;
  currency: string;
  /** Kunngjøringsteksten med kontaktopplysninger skjult, forkortet til MAX_TEXT tegn. */
  text: string | null;
  textClipped: boolean;
  sources: { source: string; noticeId: string; url: string | null }[];
  requirements: (ShowcaseQuote & { kind: RequirementKind })[];
  terms: (ShowcaseQuote & { kind: TermCategory })[];
  /** Antall treff i ordsøket (før utvalget over). */
  counts: { rejection: number; qualification: number; siteVisit: number; costlyTerms: number };
  market: Showcase['market'];
  indexable: boolean;
}

// ---------------------------------------------------------------------------
// Kontaktopplysninger skjules
// ---------------------------------------------------------------------------
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
/** Norske telefonnumre slik de skrives i kunngjøringer. Ikke beløp («2 000 000») eller årstall («2026–2027»). */
const PHONES = [
  /(?:\+|00)\s?47[\s-]?\d(?:[\s-]?\d){7}(?!\d)/g,
  /(?<!\d)\d{2} \d{2} \d{2} \d{2}(?!\d)/g,
  /(?<!\d)\d{3} \d{2} \d{3}(?!\d)/g,
];
const PHONE_AFTER_WORD = /\b(tlf|telefon|tel|mobil|mob)(\.?:?\s*)\d{8}(?!\d)/gi;

export function maskContacts(text: string): string {
  let out = text.replace(EMAIL, '[e-post skjult]').replace(PHONE_AFTER_WORD, (_m, word: string, sep: string) => `${word}${sep}[telefon skjult]`);
  for (const re of PHONES) out = out.replace(re, '[telefon skjult]');
  return out;
}

/**
 * Forkorter ved slutten av en setning (eller et ord) før grensen. Mange kunngjøringer mangler mellomrom etter
 * punktum («flystasjon.Tiltaket») – det settes inn for lesbarhet (bare foran stor bokstav, ikke i tall og forkortelser).
 */
export function clipText(text: string, max = MAX_TEXT): { text: string; clipped: boolean } {
  const clean = text
    .replace(/(\p{Ll}|\))\.(\p{Lu}\p{Ll})/gu, '$1. $2')
    .replace(/\s+\n/g, '\n')
    .trim();
  if (clean.length <= max) return { text: clean, clipped: false };
  const cut = clean.slice(0, max);
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  const end = sentence > max * 0.6 ? sentence + 1 : cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max;
  return { text: `${cut.slice(0, end).trim()} …`, clipped: true };
}

// ---------------------------------------------------------------------------
// Siden
// ---------------------------------------------------------------------------
const cache = new Map<string, { at: number; value: PublicTender | null }>();

export function resetPublicTenderCache(): void {
  cache.clear();
}

async function load(sql: Tx, id: string): Promise<PublicTender | null> {
  const t = await getTender(sql, id);
  if (!t || t.isSample) return null;
  const sources = (await sql`
    select source, source_notice_id, source_url from tender_sources
    where tender_id = ${id} and removed_at is null and source in ('doffin', 'ted')
    order by (source = 'doffin') desc, fetched_at desc
  `) as unknown as { source: string; sourceNoticeId: string; sourceUrl: string | null }[];

  const description = t.description ?? '';
  const notice: AnalysisSource = { id: 'S0', kind: 'notice', title: 'Kunngjøringen', pages: [{ page: null, text: description }], totalPages: null, isPrivate: false };
  const scan = scanRequirements([notice], { selectionCriteria: t.selectionCriteria ?? [] });
  const costly = new Set(scanContractTerms([notice]).hits.filter((h) => !h.negated && COSTLY.includes(h.category)).map((h) => h.category));
  const picked = scanCandidate({ description, selectionCriteria: t.selectionCriteria ?? [] });
  const mask = (q: ShowcaseQuote) => ({ ...q, text: maskContacts(q.text) });

  const masked = description ? clipText(maskContacts(description)) : null;
  const market = marketSummary(await marketPrice(sql, t));
  return {
    id: t.id,
    title: t.title,
    buyerName: t.buyerName ? displayBuyer(t.buyerName) : null,
    place: t.placeText,
    regions: t.regionCodes.flatMap((code) => {
      const r = REGION_BY_CODE.get(code);
      return r ? [{ code, name: r.name }] : [];
    }),
    industries: t.industryIds.flatMap((i) => {
      const ind = INDUSTRY_BY_ID.get(i);
      return ind ? [{ id: i, name: ind.name }] : [];
    }),
    status: t.status,
    deadlineAt: t.deadlineAt,
    deadlineTimeKnown: t.deadlineTimeKnown,
    deadlineKind: t.deadlineKind,
    publishedAt: t.publishedAt,
    estimatedValue: t.estimatedValue,
    currency: t.currency ?? 'NOK',
    text: masked?.text ?? null,
    textClipped: masked?.clipped ?? false,
    sources: sources.map((s) => ({ source: s.source, noticeId: s.sourceNoticeId, url: s.sourceUrl })),
    requirements: picked.requirements.map((r) => ({ ...mask(r), kind: r.kind })),
    terms: picked.terms.map((r) => ({ ...mask(r), kind: r.kind })),
    counts: {
      rejection: scan.counts.avvisning + scan.counts.minstekrav,
      qualification: scan.counts.kvalifikasjon,
      siteVisit: scan.counts.befaring,
      costlyTerms: costly.size,
    },
    market,
    indexable: t.status === 'open' && description.trim().length >= MIN_TEXT_FOR_INDEXING,
  };
}

/** Den offentlige siden for ett anbud. Null for ukjente anbud og eksempeldata. */
export async function publicTender(id: string): Promise<PublicTender | null> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: PublicTender | null = null;
  try {
    value = await systemSql().begin((tx) => load(tx as unknown as Tx, id));
  } catch (err) {
    log.warn('public_tender_failed', { message: err instanceof Error ? err.message : String(err) });
    return null;
  }
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(id, { at: Date.now(), value });
  return value;
}

/** Åpne anbud med nok tekst – de som tas med i nettstedskartet. Nyeste først. */
export async function indexableTenderIds(limit = 2000): Promise<string[]> {
  const rows = (await systemSql()`
    select t.id from tenders t
    where not t.is_sample and tender_status(t.lifecycle, t.deadline_at, t.published_at) = 'open'
      and char_length(btrim(coalesce(t.description, ''))) >= ${MIN_TEXT_FOR_INDEXING}
    order by t.first_seen_at desc
    limit ${limit}
  `) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}
