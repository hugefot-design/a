import { systemSql } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { audit } from '@/lib/audit';
import { enqueueJob } from '@/lib/jobs';
import { finishImportRun, ingestNotices, recordImportError, startImportRun, type IngestStats } from '@/domain/tenders/ingest';
import type { SourceId } from '@/domain/tenders/normalize';
import { doffinConnector } from './doffin';
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
}

export interface RunResult {
  ok: boolean;
  skipped?: string;
  stats?: IngestStats;
  error?: string;
  runId?: string;
  sample?: unknown[];
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
      fetchErrors.push(error);
      await recordImportError(run, 'mapping', error, id, raw);
    });
    if (opts.dryRun) {
      return {
        ok: true,
        stats: { fetched: notices.length, created: 0, updated: 0, unchanged: 0, duplicates: 0, errors: fetchErrors.length, tenderIds: [] },
        sample: notices.slice(0, 3).map(({ raw: _raw, ...rest }) => rest),
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
