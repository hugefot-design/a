import { hostname } from 'node:os';
import { systemSql, toJson } from './db';
import { log } from './logger';

/**
 * Enkel jobbkø i Postgres (FOR UPDATE SKIP LOCKED). Ingen Redis eller ekstern kø i MVP.
 */
export type JobKind =
  | 'ingest'
  | 'recompute_matches'
  | 'generate_notifications'
  | 'send_emails'
  | 'weekly_summary'
  | 'retention';

export interface Job {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function enqueueJob(
  kind: JobKind,
  payload: Record<string, unknown> = {},
  opts: { dedupeKey?: string; runAt?: Date; maxAttempts?: number } = {},
): Promise<string | null> {
  const rows = (await systemSql()`
    insert into jobs (kind, payload, dedupe_key, run_at, max_attempts)
    values (${kind}, ${toJson(payload)}::text::jsonb, ${opts.dedupeKey ?? null}, ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 3})
    on conflict (dedupe_key) where dedupe_key is not null and status in ('queued', 'running') do nothing
    returning id
  `) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

const WORKER_ID = `${hostname()}:${process.pid}`;

export async function claimJob(): Promise<Job | null> {
  const rows = (await systemSql()`
    update jobs set status = 'running', locked_at = now(), locked_by = ${WORKER_ID}, attempts = attempts + 1
    where id = (
      select id from jobs where status = 'queued' and run_at <= now()
      order by run_at limit 1 for update skip locked
    )
    returning id, kind, payload, attempts, max_attempts
  `) as unknown as Job[];
  return rows[0] ?? null;
}

export async function completeJob(id: string): Promise<void> {
  await systemSql()`update jobs set status = 'done', finished_at = now(), last_error = null where id = ${id}`;
}

export async function failJob(job: Job, error: string): Promise<void> {
  const retry = job.attempts < job.maxAttempts;
  await systemSql()`
    update jobs set status = ${retry ? 'queued' : 'failed'}, last_error = ${error.slice(0, 2000)},
      run_at = now() + make_interval(mins => ${Math.min(60, 2 ** job.attempts)}),
      finished_at = ${retry ? null : new Date()}
    where id = ${job.id}
  `;
  log.warn('job_failed', { id: job.id, kind: job.kind, attempts: job.attempts, retry, error });
}

/** Jobber som har hengt (krasjet arbeider) settes tilbake i køen. */
export async function releaseStaleJobs(): Promise<void> {
  await systemSql()`
    update jobs set status = 'queued', locked_at = null, locked_by = null
    where status = 'running' and locked_at < now() - interval '30 minutes'
  `;
}

export async function heartbeat(info: Record<string, unknown> = {}): Promise<void> {
  await systemSql()`
    insert into worker_heartbeats (worker_id, last_seen_at, info) values (${WORKER_ID}, now(), ${toJson(info)}::text::jsonb)
    on conflict (worker_id) do update set last_seen_at = now(), info = excluded.info
  `;
}

/** Returnerer true hvis en planlagt oppgave skal kjøres nå (og registrerer kjøringen). */
export async function claimScheduledTask(task: string, intervalMinutes: number): Promise<boolean> {
  const rows = await systemSql()`
    insert into scheduled_task_runs (task, last_run_at) values (${task}, now())
    on conflict (task) do update set last_run_at = now()
      where scheduled_task_runs.last_run_at < now() - make_interval(mins => ${intervalMinutes})
    returning task
  `;
  return rows.length > 0;
}
