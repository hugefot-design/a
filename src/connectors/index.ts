import { systemSql } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { audit } from '@/lib/audit';
import { enqueueJob } from '@/lib/jobs';
import { finishImportRun, ingestNotices, recordImportError, startImportRun, type IngestStats } from '@/domain/tenders/ingest';
import { regionCodesFor, type NormalizedNotice, type SourceId } from '@/domain/tenders/normalize';
import { doffinConnector, fetchDoffinByIds, type DoffinByIdOutcome } from './doffin';
import { tedConnector } from './ted';
import type { SourceConnector } from './types';

export const CONNECTORS: Record<'ted' | 'doffin', SourceConnector> = {
  ted: tedConnector,
  doffin: doffinConnector,
};

export interface RunOptions {
  trigger: 'schedule' | 'manual' | 'cli';
  since?: Date;
  until?: Date;
  limit?: number;
  dryRun?: boolean;
  triggeredBy?: string | null;
  force?: boolean;
  /** Bare Doffin: hent disse kunngjøringene direkte (eForms-XML) i stedet for å sveipe et tidsvindu. */
  ids?: string[];
  /** Bare sammen med `ids`: lagre originalfilene i denne mappen (lokal kontroll, ikke database). */
  saveRawDir?: string;
}

export interface RunResult {
  ok: boolean;
  skipped?: string;
  stats?: IngestStats;
  error?: string;
  runId?: string;
  sample?: unknown[];
  errorSample?: string[];
  quality?: DataQuality;
  /** Resultat per Doffin-ID når kjøringen gjaldt enkeltkunngjøringer. */
  downloads?: DoffinByIdOutcome[];
}

export interface DataQuality {
  notices: number;
  byLifecycle: Record<string, number>;
  /** Andel (0–100 %) av kunngjøringene som har feltet. */
  coverage: Record<string, number>;
  languages: Record<string, number>;
  /** Konkurranser med frist som allerede er passert ved publisering (tegn på feil frist). */
  deadlineBeforePublication: number;
}

/** Oppsummerer datakvaliteten i en henting – brukes i dry-run for å se at feltene faktisk fylles. */
export function dataQuality(notices: NormalizedNotice[]): DataQuality {
  const n = notices.length || 1;
  const pct = (count: number) => Math.round((count / n) * 1000) / 10;
  const count = (fn: (x: NormalizedNotice) => boolean) => pct(notices.filter(fn).length);
  const competitions = notices.filter((x) => x.lifecycle === 'competition');
  const byLifecycle: Record<string, number> = {};
  const languages: Record<string, number> = {};
  for (const x of notices) {
    byLifecycle[x.lifecycle] = (byLifecycle[x.lifecycle] ?? 0) + 1;
    const lang = x.details?.language ?? 'ukjent';
    languages[lang] = (languages[lang] ?? 0) + 1;
  }
  const compPct = (fn: (x: NormalizedNotice) => boolean) =>
    competitions.length ? Math.round((competitions.filter(fn).length / competitions.length) * 1000) / 10 : 0;
  return {
    notices: notices.length,
    byLifecycle,
    coverage: {
      title: count((x) => x.title.length > 3),
      description: count((x) => Boolean(x.description)),
      buyerName: count((x) => Boolean(x.buyerName)),
      buyerOrgNumber: count((x) => Boolean(x.buyerOrgNumber)),
      cpv: count((x) => x.cpvCodes.length > 0),
      region: count((x) => regionCodesFor(x).length > 0),
      estimatedValue: count((x) => x.estimatedValue !== null),
      publishedAt: count((x) => Boolean(x.publishedAt)),
      deadlineOfCompetitions: compPct((x) => Boolean(x.deadlineAt)),
      documentsUrlOfCompetitions: compPct((x) => Boolean(x.documentsUrl)),
      durationOfCompetitions: compPct((x) => Boolean(x.details?.durationText)),
      selectionCriteriaOfCompetitions: compPct((x) => (x.details?.selectionCriteria?.length ?? 0) > 0),
    },
    languages,
    deadlineBeforePublication: competitions.filter(
      (x) => x.deadlineAt && x.publishedAt && new Date(x.deadlineAt).getTime() < new Date(x.publishedAt).getTime() - 86_400_000,
    ).length,
  };
}

/** Kjører én datakilde: henting → validering → dedup → lagring → matching og varsler i kø. */
export async function runConnector(sourceId: 'ted' | 'doffin', opts: RunOptions): Promise<RunResult> {
  const connector = CONNECTORS[sourceId];
  const sql = systemSql();
  const [source] = (await sql`select enabled, last_success_at from data_sources where id = ${sourceId}`) as unknown as {
    enabled: boolean;
    lastSuccessAt: Date | null;
  }[];
  if (!source) return { ok: false, error: 'Ukjent datakilde' };
  if (!source.enabled && !opts.force) return { ok: true, skipped: 'Datakilden er slått av i admin.' };
  const status = connector.status();
  if (!status.configured) return { ok: true, skipped: status.message };

  if (opts.ids?.length) return runDoffinByIds(opts);

  const since =
    opts.since ??
    (source.lastSuccessAt
      ? new Date(source.lastSuccessAt.getTime() - 2 * 86_400_000)
      : new Date(Date.now() - env.INGEST_LOOKBACK_DAYS * 86_400_000));

  const run = opts.dryRun ? null : await startImportRun(sourceId as SourceId, opts.trigger, { since: since.toISOString(), until: opts.until?.toISOString() }, opts.triggeredBy);
  if (run && opts.triggeredBy) {
    await audit({ action: 'admin.import_triggered', actorUserId: opts.triggeredBy, targetType: 'data_source', targetId: sourceId });
  }
  try {
    const fetchErrors: string[] = [];
    const notices = await connector.fetch({ since, until: opts.until, limit: opts.limit }, async (id, error, raw) => {
      fetchErrors.push(id ? `${id}: ${error}` : error);
      // Dry-run skal aldri lagre eller endre noe – feil vises bare i resultatet.
      if (!opts.dryRun) await recordImportError(run, 'mapping', error, id, raw);
    });
    if (opts.dryRun) {
      return {
        ok: true,
        stats: { fetched: notices.length, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: fetchErrors.length, tenderIds: [] },
        sample: notices.slice(0, 3).map(({ raw: _raw, ...rest }) => rest),
        errorSample: fetchErrors.slice(0, 10),
        quality: dataQuality(notices),
      };
    }
    const stats = await ingestNotices(notices, run);
    stats.errors += fetchErrors.length;
    stats.fetched += fetchErrors.length;
    await finishImportRun(run!, stats, undefined, true);
    if (stats.created + stats.updated > 0) {
      await enqueueJob('recompute_matches', { tenderIds: stats.tenderIds.slice(0, 5000) });
      await enqueueJob('generate_notifications', {}, { dedupeKey: 'generate_notifications' });
    }
    log.info('ingest_finished', { source: sourceId, ...stats, tenderIds: undefined });
    return { ok: true, stats, runId: run!.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await finishImportRun(run, { fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 1, tenderIds: [] }, message);
    }
    log.error('ingest_failed', { source: sourceId, error: message });
    return { ok: false, error: message, runId: run?.id };
  }
}

/**
 * Henter enkeltkunngjøringer fra Doffin per ID (eForms-XML) og lagrer dem gjennom samme import som
 * vanlige hentinger. Rører ikke `last_success_at` (styrer neste planlagte sveip) og markerer ikke
 * kilden som verifisert. Dry-run lagrer ingen kunngjøringsdata – den eneste skrivingen er den
 * felles tempo-luken mot Doffin (api_slots), som må deles for å holde grensen på 10 kall per minutt.
 */
async function runDoffinByIds(opts: RunOptions): Promise<RunResult> {
  const ids = opts.ids ?? [];
  const status = CONNECTORS.doffin.status();
  if (!status.configured) return { ok: false, error: status.message };
  const run = opts.dryRun ? null : await startImportRun('doffin', opts.trigger, { ids: ids.slice(0, 50) }, opts.triggeredBy);
  try {
    const fetchErrors: string[] = [];
    const { notices, outcomes } = await fetchDoffinByIds(
      ids,
      async (id, error, raw) => {
        fetchErrors.push(id ? `${id}: ${error}` : error);
        if (!opts.dryRun) await recordImportError(run, 'fetch', error, id, raw);
      },
      { saveRawDir: opts.saveRawDir },
    );
    if (opts.dryRun) {
      return {
        ok: outcomes.every((o) => o.outcome === 'ok'),
        stats: { fetched: notices.length, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: fetchErrors.length, tenderIds: [] },
        sample: notices.slice(0, 3).map(({ raw, ...rest }) => ({ ...rest, eforms: raw })),
        errorSample: fetchErrors.slice(0, 10),
        quality: dataQuality(notices),
        downloads: outcomes,
      };
    }
    const stats = await ingestNotices(notices, run);
    stats.errors += fetchErrors.length;
    stats.fetched += fetchErrors.length;
    await finishImportRun(run!, stats, undefined, false, { updateSource: false });
    if (stats.created + stats.updated > 0) {
      await enqueueJob('recompute_matches', { tenderIds: stats.tenderIds.slice(0, 5000) });
      await enqueueJob('generate_notifications', {}, { dedupeKey: 'generate_notifications' });
    }
    log.info('doffin_by_id_finished', { ids: ids.length, ...stats, tenderIds: undefined });
    return { ok: stats.errors === 0, stats, runId: run!.id, downloads: outcomes, errorSample: fetchErrors.slice(0, 10) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await finishImportRun(run, { fetched: 0, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: 1, tenderIds: [] }, message, false, { updateSource: false });
    }
    log.error('doffin_by_id_failed', { error: message });
    return { ok: false, error: message, runId: run?.id };
  }
}
