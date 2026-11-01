/**
 * Henter kunngjøringer fra en kilde.
 *
 *   npm run ingest -- --source ted                 (hent siden forrige vellykkede kjøring)
 *   npm run ingest -- --source ted --since 2026-10-01
 *   npm run ingest -- --source doffin --dry-run    (hent og vis, men ikke lagre – bruk dette først!)
 *   npm run ingest -- --source ted --limit 200
 */
import { closeDb } from '../src/lib/db';
import { runConnector } from '../src/connectors';
import { recomputeMatchesForTenders } from '../src/domain/matching/service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const source = arg('source');
  if (source !== 'ted' && source !== 'doffin') {
    console.error('Bruk: npm run ingest -- --source ted|doffin [--since YYYY-MM-DD] [--limit N] [--dry-run]');
    process.exit(2);
  }
  const since = arg('since') ? new Date(`${arg('since')}T00:00:00Z`) : undefined;
  const result = await runConnector(source, {
    trigger: 'cli',
    since,
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    dryRun: process.argv.includes('--dry-run'),
    force: true,
  });
  console.log(JSON.stringify({ ...result, stats: result.stats ? { ...result.stats, tenderIds: result.stats.tenderIds.length } : undefined }, null, 2));
  if (result.ok && result.stats && !process.argv.includes('--dry-run') && result.stats.tenderIds.length) {
    const n = await recomputeMatchesForTenders(result.stats.tenderIds);
    console.log(`Treff beregnet: ${n}`);
  }
  if (!result.ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
