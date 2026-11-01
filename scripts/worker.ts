/**
 * Bakgrunnsarbeider: jobbkø, planlagt datainnhenting, varsler, e-post og opprydding.
 *   npm run worker        (produksjon, etter npm run build)
 *   npm run worker:dev    (utvikling)
 *
 * Kjør én arbeider per miljø. Flere arbeidere er trygt (jobber låses med SKIP LOCKED),
 * men planlagte oppgaver registreres slik at de bare kjøres én gang per intervall.
 */
import { env } from '../src/lib/env';
import { closeDb } from '../src/lib/db';
import { log } from '../src/lib/logger';
import { deliverPendingEmails } from '../src/lib/email';
import { claimJob, claimScheduledTask, completeJob, enqueueJob, failJob, heartbeat, releaseStaleJobs, type Job } from '../src/lib/jobs';
import { runConnector } from '../src/connectors';
import { recomputeMatchesForTenders } from '../src/domain/matching/service';
import { generateWeeklySummaries, runNotificationCycle } from '../src/domain/notifications/engine';
import { runScheduledTask } from '../src/domain/ops/tasks';

let running = true;

async function handleJob(job: Job): Promise<void> {
  switch (job.kind) {
    case 'ingest': {
      const source = job.payload.source === 'doffin' ? 'doffin' : 'ted';
      const result = await runConnector(source, {
        trigger: job.payload.trigger === 'manual' ? 'manual' : 'schedule',
        triggeredBy: typeof job.payload.triggeredBy === 'string' ? job.payload.triggeredBy : null,
        force: job.payload.trigger === 'manual',
      });
      if (!result.ok) throw new Error(result.error ?? 'Henting feilet');
      return;
    }
    case 'recompute_matches':
      await recomputeMatchesForTenders(Array.isArray(job.payload.tenderIds) ? (job.payload.tenderIds as string[]) : []);
      return;
    case 'generate_notifications':
      await runNotificationCycle();
      return;
    case 'send_emails':
      await deliverPendingEmails(200);
      return;
    case 'weekly_summary':
      await generateWeeklySummaries(new Date(), true);
      return;
    case 'retention':
      await runScheduledTask('retention', 'schedule');
      return;
  }
}

async function scheduleTick(): Promise<void> {
  if (await claimScheduledTask('ingest-ted', env.INGEST_INTERVAL_MINUTES)) await enqueueJob('ingest', { source: 'ted' }, { dedupeKey: 'ingest:ted' });
  if (await claimScheduledTask('ingest-doffin', env.INGEST_INTERVAL_MINUTES)) await enqueueJob('ingest', { source: 'doffin' }, { dedupeKey: 'ingest:doffin' });
  if (await claimScheduledTask('notifications', 15)) await enqueueJob('generate_notifications', {}, { dedupeKey: 'generate_notifications' });
  if (await claimScheduledTask('weekly-check', 60)) await generateWeeklySummaries();
  if (await claimScheduledTask('refresh-matches', 24 * 60)) await runScheduledTask('refresh-matches', 'schedule');
  if (await claimScheduledTask('retention', 24 * 60)) await enqueueJob('retention', {}, { dedupeKey: 'retention' });
}

async function loop(): Promise<void> {
  log.info('worker_started', { ingestEveryMinutes: env.INGEST_INTERVAL_MINUTES });
  let lastSchedule = 0;
  while (running) {
    try {
      await heartbeat({ pid: process.pid });
      await releaseStaleJobs();
      if (Date.now() - lastSchedule > 60_000) {
        await scheduleTick();
        lastSchedule = Date.now();
      }
      let processed = 0;
      for (let job = await claimJob(); job && running; job = await claimJob()) {
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
  await closeDb();
  log.info('worker_stopped');
}

process.on('SIGTERM', () => (running = false));
process.on('SIGINT', () => (running = false));
void loop();
