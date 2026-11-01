/**
 * Henter kunngjøringer fra en kilde.
 *
 *   npm run ingest -- --source ted --dry-run                 (hent og vis datakvalitet, LAGRER INGENTING – gjør dette først)
 *   npm run ingest -- --source ted                           (hent siden forrige vellykkede kjøring og lagre)
 *   npm run ingest -- --source ted --since 2026-10-01
 *   npm run ingest -- --source doffin --dry-run --limit 50
 *   npm run ingest -- --source ted --dry-run --sample 5      (vis flere eksempler)
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
    console.error('Bruk: npm run ingest -- --source ted|doffin [--since ÅÅÅÅ-MM-DD] [--until ÅÅÅÅ-MM-DD] [--limit N] [--dry-run] [--sample N]');
    process.exit(2);
  }
  const sinceArg = arg('since');
  const untilArg = arg('until');
  if ((sinceArg && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) || (untilArg && !/^\d{4}-\d{2}-\d{2}$/.test(untilArg))) {
    console.error('Datoer må ha formatet ÅÅÅÅ-MM-DD.');
    process.exit(2);
  }
  const dryRun = process.argv.includes('--dry-run');
  const result = await runConnector(source, {
    trigger: 'cli',
    since: sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : undefined,
    until: untilArg ? new Date(`${untilArg}T00:00:00Z`) : undefined,
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    dryRun,
    force: true,
  });
  const sampleCount = Number(arg('sample') ?? 3);
  console.log(
    JSON.stringify(
      {
        ...result,
        dryRun,
        sample: result.sample?.slice(0, sampleCount),
        stats: result.stats ? { ...result.stats, tenderIds: result.stats.tenderIds.length } : undefined,
      },
      null,
      2,
    ),
  );
  if (dryRun) console.error('\nDry-run: ingenting er lagret eller endret i databasen.');
  if (result.ok && result.stats && !dryRun && result.stats.tenderIds.length) {
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
