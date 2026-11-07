/**
 * Henter kunngjøringer fra en kilde.
 *
 *   npm run ingest -- --source ted --dry-run                 (hent og vis datakvalitet, LAGRER INGENTING – gjør dette først)
 *   npm run ingest -- --source ted                           (hent siden forrige vellykkede kjøring og lagre)
 *   npm run ingest -- --source ted --since 2026-10-01
 *   npm run ingest -- --source doffin --dry-run --limit 50
 *   npm run ingest -- --source ted --dry-run --sample 5      (vis flere eksempler)
 *
 * Mål et annet land i TED før det eventuelt slås på (bare dry-run – appen viser bare norske anbud):
 *   npm run ingest -- --source ted --country SWE --dry-run --since 2026-10-08 --until 2026-11-07 --sample 0
 *
 * Enkeltkunngjøringer fra Doffin per ID (eForms-XML, maks 10 nedlastinger per minutt):
 *   npm run ingest -- --source doffin --id 2026-123456 --dry-run                     (vis, LAGRER INGENTING)
 *   npm run ingest -- --source doffin --id 2026-123456 --dry-run --save-raw ./storage/doffin-xml
 *   npm run ingest -- --source doffin --id 2026-123456,2026-123457                   (hent og lagre)
 *
 * Berik Doffin-søketreff med full eForms-XML (det samme som arbeideren gjør når DOFFIN_ENRICH_XML er på):
 *   npm run ingest -- --source doffin --enrich --plan                 (vis kandidatene, INGEN kall mot Doffin)
 *   npm run ingest -- --source doffin --enrich --dry-run --limit 3    (last ned og vis, LAGRER INGENTING)
 *   npm run ingest -- --source doffin --enrich --limit 10             (last ned og lagre)
 */
import { closeDb } from '../src/lib/db';
import { runConnector } from '../src/connectors';
import { enrichDoffinXml } from '../src/connectors/doffin-enrich';
import { recomputeMatchesForTenders } from '../src/domain/matching/service';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Alle verdier for et flagg som kan gjentas eller kommasepareres (--id a,b --id c). */
function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((v, i) => {
    if (v === `--${name}` && process.argv[i + 1]) out.push(...process.argv[i + 1]!.split(','));
  });
  return out.map((v) => v.trim()).filter(Boolean);
}

async function main() {
  const source = arg('source');
  if (source !== 'ted' && source !== 'doffin') {
    console.error('Bruk: npm run ingest -- --source ted|doffin [--since ÅÅÅÅ-MM-DD] [--until ÅÅÅÅ-MM-DD] [--limit N] [--dry-run] [--sample N] [--country SWE] [--id DOFFIN-ID[,…]] [--save-raw MAPPE] [--enrich [--plan]]');
    process.exit(2);
  }
  const sinceArg = arg('since');
  const untilArg = arg('until');
  if ((sinceArg && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg)) || (untilArg && !/^\d{4}-\d{2}-\d{2}$/.test(untilArg))) {
    console.error('Datoer må ha formatet ÅÅÅÅ-MM-DD.');
    process.exit(2);
  }
  const dryRun = process.argv.includes('--dry-run');
  const ids = args('id');
  if (ids.length && source !== 'doffin') {
    console.error('--id støttes bare for Doffin (--source doffin).');
    process.exit(2);
  }
  if (process.argv.includes('--enrich')) {
    if (source !== 'doffin' || ids.length) {
      console.error('--enrich gjelder bare Doffin og kan ikke kombineres med --id.');
      process.exit(2);
    }
    const plan = process.argv.includes('--plan');
    const limitArg = arg('limit');
    if (limitArg && !/^\d+$/.test(limitArg)) {
      console.error('--limit må være et heltall.');
      process.exit(2);
    }
    const result = await enrichDoffinXml({ trigger: 'cli', force: true, plan, dryRun, limit: limitArg ? Number(limitArg) : undefined });
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          skipped: result.skipped,
          error: result.error,
          dryRun,
          plan: result.plan?.map((c) => ({ id: c.doffinId, lifecycle: c.lifecycle, deadlineAt: c.deadlineAt, publishedAt: c.publishedAt, onTed: c.onTed, previousAttempts: c.previousAttempts })),
          candidates: result.candidates,
          recorded: result.recorded,
          downloads: result.downloads,
          stats: result.stats ? { ...result.stats, tenderIds: result.stats.tenderIds.length } : undefined,
          errorSample: result.errorSample,
          sample: result.sample?.slice(0, Number(arg('sample') ?? 1)),
        },
        null,
        2,
      ),
    );
    if (plan) console.error('\nPlan: ingen kall mot Doffin, ingenting lagret.');
    else if (dryRun && !result.skipped) console.error('\nDry-run: ingen kunngjøringsdata eller forsøk er lagret (bare tempo-luken mot Doffin er oppdatert).');
    if (result.ok && result.stats && !dryRun && result.stats.tenderIds.length) {
      console.log(`Treff beregnet: ${await recomputeMatchesForTenders(result.stats.tenderIds)}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (ids.length) {
    const result = await runConnector('doffin', { trigger: 'cli', ids, dryRun, saveRawDir: arg('save-raw'), force: true });
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          error: result.error,
          dryRun,
          downloads: result.downloads,
          stats: result.stats ? { ...result.stats, tenderIds: result.stats.tenderIds.length } : undefined,
          errorSample: result.errorSample,
          sample: result.sample?.slice(0, Number(arg('sample') ?? 1)),
        },
        null,
        2,
      ),
    );
    if (dryRun) console.error('\nDry-run: ingen kunngjøringsdata er lagret (bare tempo-luken mot Doffin er oppdatert).');
    if (result.ok && result.stats && !dryRun && result.stats.tenderIds.length) {
      console.log(`Treff beregnet: ${await recomputeMatchesForTenders(result.stats.tenderIds)}`);
    }
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const result = await runConnector(source, {
    trigger: 'cli',
    since: sinceArg ? new Date(`${sinceArg}T00:00:00Z`) : undefined,
    until: untilArg ? new Date(`${untilArg}T00:00:00Z`) : undefined,
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    dryRun,
    force: true,
    country: arg('country'),
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
