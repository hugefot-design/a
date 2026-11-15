/**
 * «Kontrakter som snart utløper» på bransjesidene (offentlig): de nærmeste tildelte kontraktene i bransjen (og
 * fylket) som trolig utløper de neste 12 månedene – samme anslag og samme grunnlag som radaren i appen.
 *
 * - Bare tittel, oppdragsgiver, ventet slutt og hva anslaget bygger på. Hvem som har kontrakten i dag, og hva den
 *   ble tildelt for, vises bare i appen.
 * - Kontrakter uten sluttdato eller varighet tas ikke med – de gjettes ikke.
 * - Mellomlagres i 30 minutter per bransje og fylke. En feil skjuler bare listen; siden virker som før.
 */
import { expiringContracts } from '@/domain/competitors/expiry';
import { systemSql, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import { pickExpiring, type ExpiringTeaser } from './showcase';

export const EXPIRING_SHOWN = 5;
/** Øvre grense i spørringen (inkludert de siste tre månedene). Treffes den, vises antallet som «minst». */
const QUERY_LIMIT = 300;
const TTL_MS = 30 * 60_000;

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

export async function industryExpiring(industryId: string, region: string | null, now = new Date()): Promise<IndustryExpiring> {
  const key = `${industryId}|${region ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value = EMPTY;
  try {
    value = await systemSql().begin(async (tx) => {
      const r = await expiringContracts(tx as unknown as Tx, { industries: [industryId], regions: region ? [region] : null, monthsAhead: 12 }, now);
      return {
        upcoming: r.rows.filter((x) => x.expectedEnd >= now).length,
        atLeast: r.rows.length >= QUERY_LIMIT,
        rows: pickExpiring(r.rows, now, EXPIRING_SHOWN),
      };
    });
  } catch (err) {
    log.warn('industry_expiring_failed', { message: err instanceof Error ? err.message : String(err) });
    return EMPTY;
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), value });
  return value;
}
