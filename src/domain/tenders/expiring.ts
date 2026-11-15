/**
 * «Kontrakter som snart utløper» på bransjesidene og oppdragsgiversidene (offentlig): de nærmeste tildelte kontraktene i bransjen (og
 * fylket) som trolig utløper de neste 12 månedene – samme anslag og samme grunnlag som radaren i appen.
 *
 * - Bare tittel, oppdragsgiver, ventet slutt og hva anslaget bygger på. Hvem som har kontrakten i dag, og hva den
 *   ble tildelt for, vises bare i appen.
 * - Kontrakter uten sluttdato eller varighet tas ikke med – de gjettes ikke.
 * - Mellomlagres i 30 minutter per bransje og fylke (og per oppdragsgiver). En feil skjuler bare listen; siden virker som før.
 */
import { EXPIRY_ROW_LIMIT, expiringContracts, type ExpiryFilter } from '@/domain/competitors/expiry';
import { systemSql, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import { pickExpiring, type ExpiringTeaser } from './showcase';

export const EXPIRING_SHOWN = 5;
const TTL_MS = 30 * 60_000;
const MAX_CACHED = 500;

export interface IndustryExpiring {
  /** Kontrakter som trolig utløper de neste 12 månedene. */
  upcoming: number;
  /** Antallet er en nedre grense (spørringen nådde taket). */
  atLeast: boolean;
  rows: ExpiringTeaser[];
}

const EMPTY: IndustryExpiring = { upcoming: 0, atLeast: false, rows: [] };
const cache = new Map<string, { at: number; value: IndustryExpiring }>();

export function resetExpiringCache(): void {
  cache.clear();
}

export function industryExpiring(industryId: string, region: string | null, now = new Date()): Promise<IndustryExpiring> {
  return load(`b|${industryId}|${region ?? ''}`, { industries: [industryId], regions: region ? [region] : null, monthsAhead: 12 }, now);
}

/** Det samme for én oppdragsgiver (oppdragsgiversidene). Mellomlagres sammen med resten av oppdragsgiversiden. */
export function buyerExpiring(authorityId: string, now = new Date()): Promise<IndustryExpiring> {
  return load(null, { industries: null, regions: null, monthsAhead: 12, authorityId }, now);
}

/** `key` null = ikke mellomlagre her (den som kaller, mellomlagrer selv). */
async function load(key: string | null, filter: ExpiryFilter, now: Date): Promise<IndustryExpiring> {
  const hit = key ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value = EMPTY;
  try {
    value = await systemSql().begin(async (tx) => {
      const r = await expiringContracts(tx as unknown as Tx, filter, now);
      return {
        upcoming: r.rows.filter((x) => x.expectedEnd >= now).length,
        atLeast: r.rows.length >= EXPIRY_ROW_LIMIT,
        rows: pickExpiring(r.rows, now, EXPIRING_SHOWN),
      };
    });
  } catch (err) {
    log.warn('industry_expiring_failed', { message: err instanceof Error ? err.message : String(err) });
    return EMPTY;
  }
  if (!key) return value;
  // Fullt: den eldste ut – ikke tøm alt (da må alle bransjesidene regnes ut på nytt samtidig).
  cache.delete(key);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}
