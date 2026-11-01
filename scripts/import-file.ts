/**
 * Manuell import fra fil (JSON/CSV i AnbudRadar-format, eller lagret TED/Doffin-API-svar).
 *   npm run import:file -- sti/til/fil.json
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { closeDb } from '../src/lib/db';
import { parseImportFile } from '../src/connectors/manual';
import { finishImportRun, ingestNotices, recordImportError, startImportRun } from '../src/domain/tenders/ingest';
import { recomputeMatchesForTenders } from '../src/domain/matching/service';

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Bruk: npm run import:file -- <fil.json|fil.csv>');
    process.exit(2);
  }
  const parsed = parseImportFile(basename(path), readFileSync(path, 'utf8'));
  const source = parsed.format === 'ted-api' ? 'ted' : parsed.format === 'doffin-api' ? 'doffin' : 'manual';
  const run = await startImportRun(source, 'cli', { file: basename(path), format: parsed.format });
  for (const e of parsed.errors) await recordImportError(run, 'parse', e.error, e.id);
  const stats = await ingestNotices(parsed.notices, run);
  stats.errors += parsed.errors.length;
  await finishImportRun(run, stats);
  console.log(`Format: ${parsed.format}. Nye: ${stats.created}, oppdatert: ${stats.updated}, uendret: ${stats.unchanged}, duplikater: ${stats.duplicates}, feil: ${stats.errors}`);
  for (const e of parsed.errors.slice(0, 20)) console.log(`  Rad ${e.index}${e.id ? ` (${e.id})` : ''}: ${e.error}`);
  if (stats.tenderIds.length) console.log(`Treff beregnet: ${await recomputeMatchesForTenders(stats.tenderIds)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
