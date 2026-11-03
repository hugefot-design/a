/**
 * Planlagte oppgaver. Kjøres av arbeideren (npm run worker) eller via /api/cron/:task.
 */
import { systemSql } from '@/lib/db';
import { deliverPendingEmails } from '@/lib/email';
import { log } from '@/lib/logger';
import { withTaskLock } from '@/lib/jobs';
import { runConnector } from '@/connectors';
import { enrichDoffinXml } from '@/connectors/doffin-enrich';
import { ingestEinnsyn } from '@/connectors/einnsyn';
import { recomputeMatchesForTenders } from '@/domain/matching/service';
import { reconcileStripeSubscriptions } from '@/domain/billing/stripe';
import { generateWeeklySummaries, runNotificationCycle } from '@/domain/notifications/engine';

export const SCHEDULED_TASKS = ['ingest-ted', 'ingest-doffin', 'enrich-doffin', 'ingest-einnsyn', 'notifications', 'emails', 'weekly', 'retention', 'refresh-matches', 'reconcile-stripe'] as const;
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
  await run('search_usage', sql`delete from search_usage where day < (now() at time zone 'Europe/Oslo')::date - 8 returning 1`);
  await run('notifications', sql`delete from notifications where (read_at is not null and created_at < now() - interval '180 days') or created_at < now() - interval '365 days' returning 1`);
  await run('email_outbox', sql`delete from email_outbox where created_at < now() - interval '90 days' returning 1`);
  await run('audit_logs', sql`delete from audit_logs where created_at < now() - interval '365 days' returning 1`);
  await run('search_events', sql`delete from search_events where created_at < now() - interval '365 days' returning 1`);
  await run('import_errors', sql`delete from import_errors where created_at < now() - interval '90 days' returning 1`);
  await run('import_runs', sql`delete from import_runs where finished_at is not null and started_at < now() - interval '365 days' returning 1`);
  // Forsøkslogg for Doffin-XML: vellykkede og oppgitte etter 180 dager (da er kunngjøringen uansett ikke kandidat lenger).
  await run('doffin_enrichment', sql`delete from doffin_enrichment where status <> 'retry' and last_attempt_at < now() - interval '180 days' returning 1`);
  await run('jobs', sql`delete from jobs where status in ('done', 'failed') and created_at < now() - interval '30 days' returning 1`);
  await run('invitations', sql`delete from invitations where (accepted_at is not null or revoked_at is not null or expires_at < now()) and created_at < now() - interval '90 days' returning 1`);
  // Partnerforespørsler inneholder kontaktinfo: ubesvarte 180 dager, avslåtte/trukne 12 måneder, godtatte 24 måneder.
  await run('partner_requests', sql`
    delete from partner_requests
    where (status = 'pending' and created_at < now() - interval '180 days')
       or (status in ('declined', 'withdrawn') and coalesce(responded_at, created_at) < now() - interval '365 days')
       or (status = 'accepted' and coalesce(responded_at, created_at) < now() - interval '730 days')
    returning 1
  `);
  log.info('retention_applied', out);
  return out;
}

/** Maks leietid for låsen per oppgave (minutter). Oppgaver som tar lengre tid, frigis ved neste kjøring. */
const LOCK_TTL_MINUTES: Record<ScheduledTask, number> = {
  'ingest-ted': 60,
  'ingest-doffin': 120,
  'enrich-doffin': 30,
  'ingest-einnsyn': 30,
  notifications: 15,
  emails: 10,
  weekly: 30,
  retention: 30,
  'refresh-matches': 60,
  'reconcile-stripe': 30,
};

async function runUnlocked(task: ScheduledTask, trigger: 'schedule' | 'manual' | 'cli', triggeredBy?: string | null): Promise<unknown> {
  switch (task) {
    case 'ingest-ted':
      return runConnector('ted', { trigger, triggeredBy });
    case 'ingest-doffin':
      return runConnector('doffin', { trigger, triggeredBy });
    case 'enrich-doffin':
      // Gjør ingenting før DOFFIN_ENRICH_XML er slått på (gjelder også /api/cron).
      return enrichDoffinXml({ trigger, triggeredBy });
    case 'ingest-einnsyn':
      return ingestEinnsyn();
    case 'notifications':
      return runNotificationCycle();
    case 'emails':
      return { sent: await deliverPendingEmails(200) };
    case 'weekly':
      return { summaries: await generateWeeklySummaries() };
    case 'retention':
      return applyRetention();
    case 'reconcile-stripe':
      return reconcileStripeSubscriptions();
    case 'refresh-matches': {
      // Daglig: frister passerer, så åpne anbud må vurderes på nytt.
      const rows = (await systemSql()`
        select id from tenders where lifecycle in ('competition', 'planned', 'other') and (deadline_at is null or deadline_at > now() - interval '1 day')
      `) as unknown as { id: string }[];
      return { stored: await recomputeMatchesForTenders(rows.map((r) => r.id)) };
    }
  }
}

/**
 * Kjører en planlagt oppgave. Samme oppgave kjøres aldri i to prosesser samtidig (arbeideren og
 * /api/cron kan ellers overlappe og f.eks. sende samme varsel-e-post to ganger).
 */
export async function runScheduledTask(task: ScheduledTask, trigger: 'schedule' | 'manual' | 'cli', triggeredBy?: string | null): Promise<unknown> {
  const locked = await withTaskLock(task, LOCK_TTL_MINUTES[task], () => runUnlocked(task, trigger, triggeredBy));
  if (!locked.ran) log.info('scheduled_task_skipped', { task, reason: locked.reason });
  return locked.ran ? locked.result : { skipped: locked.reason };
}
