/**
 * Arbeiderens løkke: jobbkø, planlagte oppgaver (henting, varsler, e-post, opprydding).
 * Brukes av `npm run worker` (egen tjeneste) og – med RUN_WORKER_IN_WEB=true – inne i
 * nettsideprosessen, så gratisoppsett uten egen arbeider også henter anbud.
 */
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { deliverPendingEmails } from '@/lib/email';
import { claimJob, claimScheduledTask, completeJob, enqueueJob, failJob, heartbeat, releaseStaleJobs, withTaskLock, type Job } from '@/lib/jobs';
import { runConnector } from '@/connectors';
import { recomputeMatchesForTenders } from '@/domain/matching/service';
import { generateWeeklySummaries } from '@/domain/notifications/engine';
import { runScheduledTask } from '@/domain/ops/tasks';


async function handleJob(job: Job): Promise<void> {
  switch (job.kind) {
    case 'ingest': {
      const source = job.payload.source === 'doffin' ? 'doffin' : 'ted';
      const locked = await withTaskLock(`ingest-${source}`, source === 'doffin' ? 120 : 60, () =>
        runConnector(source, {
          trigger: job.payload.trigger === 'manual' ? 'manual' : 'schedule',
          triggeredBy: typeof job.payload.triggeredBy === 'string' ? job.payload.triggeredBy : null,
          force: job.payload.trigger === 'manual',
        }),
      );
      if (!locked.ran) {
        log.info('ingest_skipped', { source, reason: locked.reason });
        return;
      }
      if (!locked.result.ok) throw new Error(locked.result.error ?? 'Henting feilet');
      return;
    }
    case 'enrich_doffin': {
      const result = (await runScheduledTask('enrich-doffin', 'schedule')) as { ok?: boolean; error?: string } | undefined;
      if (result && result.ok === false) throw new Error(result.error ?? 'XML-berikelse feilet');
      return;
    }
    case 'recompute_matches':
      await recomputeMatchesForTenders(Array.isArray(job.payload.tenderIds) ? (job.payload.tenderIds as string[]) : []);
      return;
    case 'generate_notifications':
      await runScheduledTask('notifications', 'schedule');
      return;
    case 'send_emails':
      await deliverPendingEmails(200);
      return;
    case 'weekly_summary':
      await withTaskLock('weekly', 30, () => generateWeeklySummaries(new Date(), true));
      return;
    case 'retention':
      await runScheduledTask('retention', 'schedule');
      return;
  }
}

async function scheduleTick(): Promise<void> {
  if (await claimScheduledTask('ingest-ted', env.INGEST_INTERVAL_MINUTES)) await enqueueJob('ingest', { source: 'ted' }, { dedupeKey: 'ingest:ted' });
  if (await claimScheduledTask('ingest-doffin', env.INGEST_INTERVAL_MINUTES)) await enqueueJob('ingest', { source: 'doffin' }, { dedupeKey: 'ingest:doffin' });
  if (env.DOFFIN_ENRICH_XML && env.DOFFIN_API_KEY && (await claimScheduledTask('enrich-doffin', env.DOFFIN_ENRICH_INTERVAL_MINUTES))) {
    await enqueueJob('enrich_doffin', {}, { dedupeKey: 'enrich:doffin', maxAttempts: 1 });
  }
  if (await claimScheduledTask('notifications', 15)) await enqueueJob('generate_notifications', {}, { dedupeKey: 'generate_notifications' });
  if (await claimScheduledTask('weekly-check', 60)) await runScheduledTask('weekly', 'schedule');
  if (await claimScheduledTask('refresh-matches', 24 * 60)) await runScheduledTask('refresh-matches', 'schedule');
  if (await claimScheduledTask('retention', 24 * 60)) await enqueueJob('retention', {}, { dedupeKey: 'retention' });
  if (await claimScheduledTask('reconcile-stripe', 6 * 60)) await runScheduledTask('reconcile-stripe', 'schedule');
}

async function loop(state: { running: boolean }, mode: 'worker' | 'web'): Promise<void> {
  log.info('worker_started', {
    mode,
    ingestEveryMinutes: env.INGEST_INTERVAL_MINUTES,
    doffinXmlEnrichment: env.DOFFIN_ENRICH_XML ? `hvert ${env.DOFFIN_ENRICH_INTERVAL_MINUTES}. min, maks ${env.DOFFIN_ENRICH_MAX_PER_RUN}` : 'av',
  });
  let lastSchedule = 0;
  while (state.running) {
    try {
      await heartbeat({ pid: process.pid });
      await releaseStaleJobs();
      if (Date.now() - lastSchedule > 60_000) {
        await scheduleTick();
        lastSchedule = Date.now();
      }
      let processed = 0;
      for (let job = await claimJob(); job && state.running; job = await claimJob()) {
        try {
          await handleJob(job);
          await completeJob(job.id);
        } catch (err) {
          await failJob(job, err instanceof Error ? err.message : String(err));
        }
        if (++processed >= 20) break;
      }
      await deliverPendingEmails(50);
    } catch (err) {
      log.error('worker_tick_failed', { err });
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  log.info('worker_stopped', { mode });
}


/** Starter løkken. `stop()` venter til pågående runde er ferdig (maks ~5 s + pågående jobb). */
export function startWorker(mode: 'worker' | 'web'): { stop: () => Promise<void> } {
  const state = { running: true };
  const done = loop(state, mode);
  return {
    stop: async () => {
      state.running = false;
      await done;
    },
  };
}
