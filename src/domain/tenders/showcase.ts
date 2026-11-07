/**
 * Kundereisen på forsiden, vist med ekte offentlige data – ikke oppdiktede eksempler:
 *
 * 1. Treff for en eksempelprofil (bransje og fylke fra et ekte anbud), regnet ut med samme matching som i appen.
 * 2. Krav, avvisningsgrunner og kostbare vilkår i et åpent anbud – samme ordsøk som anbudssiden i appen.
 * 3. Tidligere tildelinger for samme type kontrakt (markedspris), som i lønnsomhetskalkylen.
 * 4. Kravene som sjekkliste (samme setninger).
 * 5. En nylig tildeling i samme bransje.
 * 6. Kontrakter som snart utløper (samme anslag som kontraktsutløp-radaren).
 *
 * Leverandørnavn vises ikke på nettsiden. Mangler noe (f.eks. ingen tildelinger), utelates det steget –
 * ingenting fylles inn. Mellomlagres i 30 minutter.
 */
import { systemSql, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import { INDUSTRIES, REGIONS } from '@/domain/reference';
import { scanRequirements, type RequirementKind } from '@/domain/documents/requirements';
import { scanContractTerms, type TermCategory } from '@/domain/profit/terms-scan';
import { marketPrice, MIN_COMPARABLES } from '@/domain/profit/market';
import { expiringContracts, type ExpiryBasis } from '@/domain/competitors/expiry';
import { scoreTender, type MatchProfile, type MatchTender } from '@/domain/matching/engine';
import type { AnalysisSource } from '@/domain/ai/sources';
import { guessLanguage } from '@/connectors/doffin';
import { displayBuyer } from './market';

/** Norsk tekst foretrekkes (de fleste besøkende er norske); TED publiserer norske kunngjøringer på engelsk. */
const norwegianFirst = (title: string, text?: string | null) => (guessLanguage(`${title} ${text ?? ''}`) === 'nb' ? 1 : 0);

export interface ShowcaseQuote {
  kind: string;
  /** Utdrag rundt treffet (ordrett fra kunngjøringen). */
  text: string;
  /** Ordet som ga treffet (uthevet), tomt når det ikke står i utdraget. */
  match: string;
}

export interface Showcase {
  at: Date;
  industry: { id: string; name: string };
  region: { code: string; name: string } | null;
  /** Treff for eksempelprofilen (bransje + fylke), beste først. */
  matches: { id: string; title: string; buyerName: string | null; place: string | null; deadlineAt: Date | null; score: number; reason: string | null }[];
  /** Det åpne anbudet kravene er hentet fra. */
  notice: {
    id: string;
    title: string;
    buyerName: string | null;
    deadlineAt: Date;
    source: string;
    noticeId: string;
    sourceUrl: string | null;
  };
  requirements: (ShowcaseQuote & { kind: RequirementKind })[];
  terms: (ShowcaseQuote & { kind: TermCategory })[];
  /** Tidligere tildelinger for samme type kontrakt (bare når minst MIN_COMPARABLES finnes). */
  market: { label: string; n: number; values: number[]; median: number; p25: number; p75: number; currency: string } | null;
  award: { title: string; buyerName: string | null; value: number; currency: string; awardDate: Date } | null;
  expiring: { title: string; buyerName: string | null; expectedEnd: Date; basis: ExpiryBasis }[];
}

const KEY_KINDS: RequirementKind[] = ['avvisning', 'minstekrav', 'kvalifikasjon', 'befaring'];
const TTL_MS = 30 * 60_000;
let cache: { at: number; value: Showcase | null } | null = null;

export function resetShowcaseCache(): void {
  cache = null;
}

/** Kort utdrag rundt treffordet, kuttet ved hele ord. */
export function clipAround(text: string, match: string, max = 180): ShowcaseQuote['text'] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const i = match ? clean.indexOf(match) : -1;
  const center = i >= 0 ? i + match.length / 2 : 0;
  let from = Math.max(0, Math.round(center - max / 2));
  let to = Math.min(clean.length, from + max);
  from = Math.max(0, to - max);
  if (from > 0) from = clean.indexOf(' ', from) + 1 || from;
  if (to < clean.length) {
    const cut = clean.lastIndexOf(' ', to);
    if (cut > from + 40) to = cut;
  }
  return `${from > 0 ? '… ' : ''}${clean.slice(from, to)}${to < clean.length ? ' …' : ''}`;
}

interface Candidate {
  id: string;
  title: string;
  buyerName: string | null;
  deadlineAt: Date;
  description: string;
  regionCodes: string[];
  industryIds: string[];
  cpvCodes: string[];
  mainCpv: string | null;
  currency: string | null;
  selectionCriteria: string[] | null;
  source: string;
  sourceNoticeId: string;
  sourceUrl: string | null;
}

/** Kravene og vilkårene i ett anbud, slik appen finner dem i kunngjøringsteksten. */
export function scanCandidate(c: Pick<Candidate, 'description' | 'selectionCriteria'>): { requirements: Showcase['requirements']; terms: Showcase['terms'] } {
  const source: AnalysisSource = { id: 'S0', kind: 'notice', title: 'Kunngjøringen', pages: [{ page: null, text: c.description }], totalPages: null, isPrivate: false };
  const scan = scanRequirements([source], { selectionCriteria: [] });
  const requirements: Showcase['requirements'] = [];
  for (const kind of KEY_KINDS) {
    const hit = scan.byKind[kind].find((h) => h.match && !h.structured);
    if (hit) requirements.push({ kind, text: clipAround(hit.text, hit.match), match: hit.match });
  }
  const seen = new Set<TermCategory>();
  const terms: Showcase['terms'] = [];
  for (const h of scanContractTerms([source]).hits) {
    if (h.negated || seen.has(h.category)) continue;
    seen.add(h.category);
    terms.push({ kind: h.category, text: clipAround(h.snippet, h.match), match: h.match });
  }
  return { requirements, terms: terms.slice(0, 2) };
}

async function pickNotice(tx: Tx): Promise<(Candidate & ReturnType<typeof scanCandidate>) | null> {
  const known = new Set(INDUSTRIES.map((i) => i.id));
  const rows = (await tx`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.description, t.region_codes, t.industry_ids, t.cpv_codes, t.main_cpv, t.currency,
           coalesce((select array_agg(x) from jsonb_array_elements_text(t.selection_criteria) x), '{}') as selection_criteria,
           s.source, s.source_notice_id, s.source_url
    from tenders t
    join lateral (
      select source, source_notice_id, source_url from tender_sources s
      where s.tender_id = t.id and s.removed_at is null
      order by (s.source = 'doffin') desc, s.fetched_at desc limit 1
    ) s on true
    where not t.is_sample and t.lifecycle = 'competition' and t.deadline_at > now() + interval '5 days'
      and char_length(coalesce(t.description, '')) > 300 and cardinality(t.industry_ids) > 0
    order by t.first_seen_at desc
    limit 120
  `) as unknown as Candidate[];
  let best: (Candidate & ReturnType<typeof scanCandidate>) | null = null;
  let bestScore = -1;
  for (const r of rows) {
    if (!r.industryIds.some((i) => known.has(i))) continue;
    const found = scanCandidate(r);
    // Norsk tekst teller bare når eksempelet også har nok innhold (minst to krav).
    const score = Math.min(found.requirements.length, 3) * 2 + Math.min(found.terms.length, 2) + (found.requirements.length >= 2 ? norwegianFirst(r.title, r.description) * 4 : 0);
    if (score > bestScore) {
      best = { ...r, ...found };
      bestScore = score;
    }
    if (score >= 12) break;
  }
  return best && best.requirements.length ? best : null;
}

/** Eksempelprofil: bransjen og fylket til anbudet – ikke en ekte kunde. */
export function exampleProfile(industry: string, region: string | null): MatchProfile {
  return {
    industries: [industry],
    cpvCodes: [],
    keywords: [],
    services: null,
    regions: region ? [region] : [],
    countries: ['NO'],
    certifications: [],
    minContractValue: null,
    maxContractValue: null,
    contractTypes: [],
    excludedCpv: [],
    excludedKeywords: [],
    minDaysToDeadline: 5,
  };
}

async function buildShowcase(tx: Tx, now: Date): Promise<Showcase | null> {
  const notice = await pickNotice(tx);
  if (!notice) return null;
  const industryId = notice.industryIds.find((i) => INDUSTRIES.some((x) => x.id === i))!;
  const industry = { id: industryId, name: INDUSTRIES.find((x) => x.id === industryId)!.name };
  const regionCode = notice.regionCodes.find((c) => REGIONS.some((r) => r.code === c)) ?? null;
  const region = regionCode ? { code: regionCode, name: REGIONS.find((r) => r.code === regionCode)!.name } : null;

  // 1. Treff for eksempelprofilen – samme matching som i appen.
  const pool = (await tx`
    select id, title, left(description, 8000) as description, cpv_codes, industry_ids, region_codes, country_code,
           estimated_value::float8 as estimated_value, currency, contract_nature, deadline_at, lifecycle, buyer_name, place_text,
           coalesce((select array_agg(left(x, 2000)) from jsonb_array_elements_text(t.selection_criteria) x), '{}') as selection_criteria
    from tenders t
    where not t.is_sample and t.lifecycle = 'competition' and t.deadline_at > now() + interval '5 days'
      and t.industry_ids @> array[${industryId}]::text[]
    order by t.first_seen_at desc
    limit 300
  `) as unknown as (MatchTender & { buyerName: string | null; placeText: string | null })[];
  const profile = exampleProfile(industryId, regionCode);
  const regionName = new Map(REGIONS.map((r) => [r.code, r.name]));
  const matches = pool
    .map((t) => ({ t, r: scoreTender(profile, t, now) }))
    .filter((x) => !x.r.excluded)
    .sort((a, b) => b.r.score - a.r.score || norwegianFirst(b.t.title, b.t.description) - norwegianFirst(a.t.title, a.t.description))
    .slice(0, 3)
    .map(({ t, r }) => ({
      id: t.id,
      title: t.title,
      buyerName: t.buyerName ? displayBuyer(t.buyerName) : null,
      place: (t.regionCodes[0] && regionName.get(t.regionCodes[0])) || t.placeText || null,
      deadlineAt: t.deadlineAt,
      score: r.score,
      reason: r.breakdown.reasons[0] ?? null,
    }));

  // 3. Markedspris fra tidligere tildelinger (samme som i kalkylen).
  const mp = await marketPrice(tx, { id: notice.id, mainCpv: notice.mainCpv, cpvCodes: notice.cpvCodes, currency: notice.currency });
  const market =
    mp.total && mp.awards.length >= MIN_COMPARABLES && mp.match
      ? {
          label: mp.match.label,
          n: mp.total.n,
          values: mp.awards.map((a) => a.value),
          median: mp.total.median,
          p25: mp.total.p25,
          p75: mp.total.p75,
          currency: mp.currency,
        }
      : null;

  // 5. En nylig tildeling i samme bransje (uten leverandørnavn).
  const awards = (await tx`
    select t.title, t.buyer_name, a.awarded_value::float8 as value, coalesce(a.currency, 'NOK') as currency, a.award_date
    from contract_awards a join tenders t on t.id = a.tender_id
    where not t.is_sample and t.industry_ids @> array[${industryId}]::text[]
      and a.awarded_value is not null and a.awarded_value > 0 and a.award_date is not null and a.award_date <= now()::date
    order by a.award_date desc, a.awarded_value desc
    limit 20
  `) as unknown as { title: string; buyerName: string | null; value: number; currency: string; awardDate: Date }[];
  const award = [...awards].sort((a, b) => norwegianFirst(b.title) - norwegianFirst(a.title))[0];

  // 6. Kontrakter som snart utløper (samme anslag som radaren i appen).
  const expiry = await expiringContracts(tx, { industries: [industryId], regions: null, monthsAhead: 12 }, now);
  const expiring = expiry.rows
    .filter((r) => r.expectedEnd >= now)
    .sort((a, b) => norwegianFirst(b.title) - norwegianFirst(a.title) || a.expectedEnd.getTime() - b.expectedEnd.getTime())
    .slice(0, 3)
    .sort((a, b) => a.expectedEnd.getTime() - b.expectedEnd.getTime())
    .map((r) => ({ title: r.title, buyerName: r.buyerName ? displayBuyer(r.buyerName) : null, expectedEnd: r.expectedEnd, basis: r.basis }));

  return {
    at: now,
    industry,
    region,
    matches,
    notice: {
      id: notice.id,
      title: notice.title,
      buyerName: notice.buyerName ? displayBuyer(notice.buyerName) : null,
      deadlineAt: notice.deadlineAt,
      source: notice.source,
      noticeId: notice.sourceNoticeId,
      sourceUrl: notice.sourceUrl,
    },
    requirements: notice.requirements,
    terms: notice.terms,
    market,
    award: award ? { ...award, buyerName: award.buyerName ? displayBuyer(award.buyerName) : null } : null,
    expiring,
  };
}

/** Ekte eksempler til forsiden. Null når det ikke finnes et åpent anbud med krav i teksten. */
export async function siteShowcase(now = new Date()): Promise<Showcase | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let value: Showcase | null = null;
  try {
    value = await systemSql().begin((tx) => buildShowcase(tx as unknown as Tx, now));
  } catch (err) {
    log.warn('showcase_failed', { message: err instanceof Error ? err.message : String(err) });
  }
  cache = { at: Date.now(), value };
  return value;
}
