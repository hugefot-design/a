/**
 * Hvilke datakilder som faktisk er verifisert mot ekte API (minst én vellykket henting).
 * Brukes i markedsføringstekster, slik at vi aldri påstår at en kilde er koblet til før den er det.
 * Bufres i minnet i fem minutter (én liten spørring).
 */
import { systemSql } from '@/lib/db';
import { log } from '@/lib/logger';

let cache: { at: number; value: string[] } = { at: 0, value: [] };

export async function refreshLiveSourcesIfStale(maxAgeMs = 5 * 60_000): Promise<void> {
  if (Date.now() - cache.at < maxAgeMs) return;
  cache.at = Date.now();
  try {
    const rows = (await systemSql()`
      select id from data_sources where enabled and verified_live and id in ('ted', 'doffin')
    `) as unknown as { id: string }[];
    cache = { at: Date.now(), value: rows.map((r) => r.id) };
  } catch (err) {
    log.warn('live_sources_lookup_failed', { err });
  }
}

export function liveSources(): string[] {
  return cache.value;
}
