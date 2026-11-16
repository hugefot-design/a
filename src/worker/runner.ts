/**
 * Arbeiderens løkke: jobbkø, planlagte oppgaver (henting, varsler, e-post, opprydding).
 * Brukes av `npm run worker` (egen tjeneste) og – med RUN_WORKER_IN_WEB=true – inne i
 * nettsideprosessen, så gratisoppsett uten egen arbeider også henter anbud.
 */
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { deliverPendingEmails } from '@/lib/email';
import { claimJob, claimScheduledTask, completeJob, enqueueJob, failJob, heartbeat, releaseStaleJobs, restWorker, scheduledTaskRuns, wakeWorker, withTaskLock, type Job } from '@/lib/jobs';
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

/** Planlagte oppgaver: navn i scheduled_task_runs, intervall i minutter, og hva som skal skje. */
const SCHEDULE: { task: string; minutes: () => number; enabled?: () => boolean; run: () => Promise<unknown> }[] = [
  { task: 'ingest-ted', minutes: () => env.INGEST_INTERVAL_MINUTES, run: () => enqueueJob('ingest', { source: 'ted' }, { dedupeKey: 'ingest:ted' }) },
  { task: 'ingest-doffin', minutes: () => env.INGEST_INTERVAL_MINUTES, run: () => enqueueJob('ingest', { source: 'doffin' }, { dedupeKey: 'ingest:doffin' }) },
  {
    task: 'enrich-doffin',
    minutes: () => env.DOFFIN_ENRICH_INTERVAL_MINUTES,
    enabled: () => Boolean(env.DOFFIN_ENRICH_XML && env.DOFFIN_API_KEY),
    run: () => enqueueJob('enrich_doffin', {}, { dedupeKey: 'enrich:doffin', maxAttempts: 1 }),
  },
  // Future Opportunities: politiske saker fra eInnsyn to ganger i døgnet (få, høflige kall).
  { task: 'ingest-einnsyn', minutes: () => 12 * 60, run: () => runScheduledTask('ingest-einnsyn', 'schedule') },
  { task: 'notifications', minutes: () => 15, run: () => enqueueJob('generate_notifications', {}, { dedupeKey: 'generate_notifications' }) },
  { task: 'weekly-check', minutes: () => 60, run: () => runScheduledTask('weekly', 'schedule') },
  { task: 'refresh-matches', minutes: () => 24 * 60, run: () => runScheduledTask('refresh-matches', 'schedule') },
  { task: 'retention', minutes: () => 24 * 60, run: () => enqueueJob('retention', {}, { dedupeKey: 'retention' }) },
  { task: 'reconcile-stripe', minutes: () => 6 * 60, run: () => runScheduledTask('reconcile-stripe', 'schedule') },
  // Feilovervåking: én oppsummering i timen til administratoren når det har kommet nye feil.
  { task: 'error-digest', minutes: () => 60, run: () => runScheduledTask('error-digest', 'schedule') },
];

/**
 * Kjører oppgavene som er forfalt. Først én lesing av når de sist kjørte; bare forfalte oppgaver forsøkes tatt –
 * selve «ta» er fortsatt atomisk i databasen (claimScheduledTask), så to prosesser kan ikke kjøre samme oppgave.
 */
async function scheduleTick(): Promise<void> {
  const lastRuns = await scheduledTaskRuns();
  const now = Date.now();
  for (const s of SCHEDULE) {
    if (s.enabled && !s.enabled()) continue;
    const last = lastRuns.get(s.task);
    // Litt slingringsmonn for klokkeforskjell mellom appen og databasen.
    if (last && now - last.getTime() < s.minutes() * 60_000 - 5_000) continue;
    if (await claimScheduledTask(s.task, s.minutes())) await s.run();
  }
}

/** Hvile mellom rundene: 5 s når det er arbeid, opptil 30 s når det er stille (færre spørringer mot databasen). */
const REST_MIN_MS = 5_000;
const REST_MAX_MS = 30_000;
/** Hjerteslag og opprydding av hengende jobber trenger ikke skje oftere enn hvert minutt. */
const HOUSEKEEPING_MS = 60_000;

async function loop(state: { running: boolean }, mode: 'worker' | 'web'): Promise<void> {
  log.info('worker_started', {
    mode,
    ingestEveryMinutes: env.INGEST_INTERVAL_MINUTES,
    doffinXmlEnrichment: env.DOFFIN_ENRICH_XML ? `hvert ${env.DOFFIN_ENRICH_INTERVAL_MINUTES}. min, maks ${env.DOFFIN_ENRICH_MAX_PER_RUN}` : 'av',
  });
  let lastSchedule = 0;
  let lastHousekeeping = 0;
  let rest = REST_MIN_MS;
  while (state.running) {
    let busy = false;
    try {
      if (Date.now() - lastHousekeeping >= HOUSEKEEPING_MS) {
        await heartbeat({ pid: process.pid });
        await releaseStaleJobs();
        lastHousekeeping = Date.now();
      }
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
      const sent = await deliverPendingEmails(50);
      busy = processed > 0 || sent > 0;
    } catch (err) {
      log.error('worker_tick_failed', { err });
    }
    rest = busy ? REST_MIN_MS : Math.min(REST_MAX_MS, rest * 2);
    if (state.running) await restWorker(rest);
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
      // Hviler den, skal den ikke vente ut hvilen før den stopper.
      wakeWorker();
      await done;
    },
  };
}
