/**
 * Hvilken modell prøves først. For enkle oppgaver prøves den billige modellen (Claude Haiku 5.5) først, og svaret
 * kontrolleres; holder det ikke, lages det med kvalitetsmodellen (runner.ts). Det lønner seg bare så lenge den billige
 * modellen som regel holder: kvalitetsmodellen leser kilder den nylig har lest, fra leverandørens buffer til en
 * brøkdel av prisen (5 % hos Sonnet 5.5), mens et eskalert kall starter kaldt og betaler full pris for kildene.
 * Kostnadsmodellen (scripts/cost-model.ts) viste at oppfølgingsspørsmål i «Spør om anbudet» ellers kunne bli dyrere
 * enn før. To regler, begge ut fra data vi allerede har:
 *
 * 1. Varm buffer: ga kvalitetsmodellen det siste godkjente svaret på nøyaktig de samme kildene (samme systemtekst og
 *    kildeblokk) for under 5 minutter siden, går neste forespørsel rett dit. Kildene ligger da i bufferen dens, og den
 *    billige modellen holdt nettopp ikke for disse kildene. Huskes i minnet i denne prosessen: bare et hash av
 *    kildene (per organisasjon for private forespørsler), modellnavnet og tidspunktet – ingen tekst. Kjører flere
 *    prosesser, prøves den billige modellen først der dette ikke er kjent, som før.
 * 2. Vakt: ble mer enn halvparten av svarene fra den billige modellen for en funksjon forkastet de siste 7 dagene
 *    (minst 20 forsøk), prøves den ikke for den funksjonen før andelen faller igjen. Da koster to kall i snitt mer enn
 *    ett, og kunden venter lenger. Tallene er antall rader, ikke innhold, og leses høyst hvert 10. minutt.
 */
import { sha256Hex } from '@/lib/crypto';
import { systemSql } from '@/lib/db';
import { log } from '@/lib/logger';

/** Leverandørens buffer for kildene (cache_control: ephemeral) varer 5 minutter etter siste bruk. */
export const WARM_CACHE_MS = 5 * 60_000;
const MAX_REMEMBERED = 5_000;

export const ESCALATION_GUARD = {
  windowDays: 7,
  minAttempts: 20,
  /** Over denne andelen forkastede svar prøves ikke den billige modellen for funksjonen. */
  maxRejectedShare: 0.5,
  refreshMs: 10 * 60_000,
} as const;

/** Funksjonene der den billige modellen prøves først (tier 'fast' i runner.ts). */
export const CHEAP_FIRST_KINDS = ['tender_analysis', 'tender_chat', 'bid_structure', 'weekly_overview'] as const;

const lastAnswer = new Map<string, { model: string; at: number }>();

/**
 * Nøkkel for kildene. Private forespørsler (egne dokumenter, egne spørsmål) får organisasjonen med i nøkkelen, så
 * én kundes bruk aldri påvirker hvilken modell en annen kunde får.
 */
export function sourcesKey(system: string, cacheablePrefix: string, orgScope: string | null): string {
  return sha256Hex(`${orgScope ?? 'delt'}\u0000${system}\u0000${cacheablePrefix}`);
}

/** Husker hvilken modell som ga det godkjente svaret på disse kildene (og dermed har dem i bufferen nå). */
export function rememberAnswer(key: string, model: string, now = Date.now()): void {
  lastAnswer.delete(key); // eldste først i Map-en, så utløpte kan fjernes forfra
  lastAnswer.set(key, { model, at: now });
  for (const [k, v] of lastAnswer) {
    if (lastAnswer.size <= MAX_REMEMBERED && now - v.at < WARM_CACHE_MS) break;
    lastAnswer.delete(k);
  }
}

/** Ga kvalitetsmodellen det siste svaret på disse kildene for under 5 minutter siden? */
export function qualityIsWarm(key: string, qualityModel: string, now = Date.now()): boolean {
  const last = lastAnswer.get(key);
  return Boolean(last && last.model === qualityModel && now - last.at < WARM_CACHE_MS);
}

export interface CheapFirstStats {
  kind: string;
  /** Svar fra den billige modellen som ble brukt, og som ble forkastet og laget på nytt, siste 7 dager. */
  attempts: number;
  rejected: number;
  rejectedShare: number | null;
  paused: boolean;
}

const statsCache = new Map<string, CheapFirstStats & { at: number }>();

export async function cheapFirstStats(kind: string, fastModel: string, now = Date.now()): Promise<CheapFirstStats> {
  const key = `${kind}\u0000${fastModel}`;
  const cached = statsCache.get(key);
  if (cached && now - cached.at < ESCALATION_GUARD.refreshMs) return cached;
  // Godkjente svar fra den billige modellen, og svar som måtte lages på nytt (escalated_from er satt). Leverandøren kan
  // svare med et utvidet modellnavn (f.eks. med dato), derfor også «modell-…».
  const [row] = (await systemSql()`
    select count(*) filter (where escalated_from is not null)::int as rejected,
           count(*) filter (where escalated_from is null and (model = ${fastModel} or model like ${`${fastModel}-%`}))::int as accepted
    from ai_analyses
    where kind = ${kind} and status = 'completed' and created_at > now() - make_interval(days => ${ESCALATION_GUARD.windowDays})
  `) as unknown as { rejected: number; accepted: number }[];
  const rejected = row?.rejected ?? 0;
  const attempts = rejected + (row?.accepted ?? 0);
  const rejectedShare = attempts ? rejected / attempts : null;
  const stats = {
    kind,
    attempts,
    rejected,
    rejectedShare,
    paused: attempts >= ESCALATION_GUARD.minAttempts && (rejectedShare ?? 0) > ESCALATION_GUARD.maxRejectedShare,
    at: now,
  };
  statsCache.set(key, stats);
  return stats;
}

/** Hvorfor kvalitetsmodellen brukes direkte (uten å prøve den billige først), eller null når den billige skal prøves. */
export async function skipCheapFirst(kind: string, key: string | null, fastModel: string, qualityModel: string): Promise<'warm_cache' | 'guard' | null> {
  if (key && qualityIsWarm(key, qualityModel)) return 'warm_cache';
  try {
    if ((await cheapFirstStats(kind, fastModel)).paused) return 'guard';
  } catch (err) {
    // Tallene er bare et kostnadsvern: feiler de, går forespørselen videre som vanlig (billig modell først).
    log.warn('ai_routing_stats_failed', { kind, error: (err instanceof Error ? err.message : String(err)).slice(0, 200) });
  }
  return null;
}

/** For tester: glem alt i minnet. */
export function resetRoutingMemory(): void {
  lastAnswer.clear();
  statsCache.clear();
}
