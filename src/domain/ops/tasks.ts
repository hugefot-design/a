/**
 * Planlagte oppgaver. Kjøres av arbeideren (npm run worker) eller via /api/cron/:task.
 */
import { systemSql } from '@/lib/db';
import { deliverPendingEmails } from '@/lib/email';
import { log } from '@/lib/logger';
import { runConnector } from '@/connectors';
import { recomputeMatchesForTenders } from '@/domain/matching/service';
import { generateWeeklySummaries, runNotificationCycle } from '@/domain/notifications/engine';

export const SCHEDULED_TASKS = ['ingest-ted', 'ingest-doffin', 'notifications', 'emails', 'weekly', 'retention', 'refresh-matches'] as const;
export type ScheduledTask = (typeof SCHEDULED_TASKS)[number];

/** Oppbevaringsregler (personvern og databasestørrelse). Dokumentert i docs/PERSONVERN.md. */
export async function applyRetention(): Promise<Record<string, number>> {
  const sql = systemSql();
  const out: Record<string, number> = {};
  const run = async (name: string, q: PromiseLike<readonly unknown[]>) => {
    out[name] = (await q).length;
  };
  await run('sessions', sql`delete from sessions where expires_at < now() returning 1`);
  await run('email_tokens', sql`delete from email_tokens where expires_at < now() - interval '7 days' returning 1`);
  await run('rate_limits', sql`delete from rate_limits where window_start < now() - interval '2 days' returning 1`);
  await run('notifications', sql`delete from notifications where (read_at is not null and created_at < now() - interval '180 days') or created_at < now() - interval '365 days' returning 1`);
  await run('email_outbox', sql`delete from email_outbox where created_at < now() - interval '90 days' returning 1`);
  await run('audit_logs', sql`delete from audit_logs where created_at < now() - interval '365 days' returning 1`);
  await run('search_events', sql`delete from search_events where created_at < now() - interval '365 days' returning 1`);
  await run('import_errors', sql`delete from import_errors where created_at < now() - interval '90 days' returning 1`);
  await run('jobs', sql`delete from jobs where status in ('done', 'failed') and created_at < now() - interval '30 days' returning 1`);
  await run('invitations', sql`delete from invitations where (accepted_at is not null or revoked_at is not null or expires_at < now()) and created_at < now() - interval '90 days' returning 1`);
  log.info('retention_applied', out);
  return out;
}

export async function runScheduledTask(task: ScheduledTask, trigger: 'schedule' | 'manual' | 'cli', triggeredBy?: string | null): Promise<unknown> {
  switch (task) {
    case 'ingest-ted':
      return runConnector('ted', { trigger, triggeredBy });
    case 'ingest-doffin':
      return runConnector('doffin', { trigger, triggeredBy });
    case 'notifications':
      return runNotificationCycle();
    case 'emails':
      return { sent: await deliverPendingEmails(200) };
    case 'weekly':
      return { summaries: await generateWeeklySummaries() };
    case 'retention':
      return applyRetention();
    case 'refresh-matches': {
      // Daglig: frister passerer, så åpne anbud må vurderes på nytt.
      const rows = (await systemSql()`
        select id from tenders where lifecycle in ('competition', 'planned', 'other') and (deadline_at is null or deadline_at > now() - interval '1 day')
      `) as unknown as { id: string }[];
      return { stored: await recomputeMatchesForTenders(rows.map((r) => r.id)) };
    }
  }
}
