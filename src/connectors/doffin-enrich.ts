/**
 * Automatisk berikelse av Doffin-søketreff med full eForms-XML (download-endepunktet).
 *
 * Søket gir bare et sammendrag. Den fulle kunngjøringen har bl.a. rettsgrunnlag, frister og
 * tildelingskriterier per delkontrakt, varighet, innleveringslenke og nasjonale miljøkriterier.
 * Nedlastingen har strengere grense (10 kall per minutt per abonnement) og deler tempo-luke med alle
 * andre nedlastinger (api_slots), også `npm run ingest -- --id`.
 *
 * - Av som standard (DOFFIN_ENRICH_XML) til formatet er verifisert mot et ekte API-svar.
 * - Rekkefølge: åpne konkurranser med frist fram i tid → konkurranser uten frist → planlagte →
 *   nylig publisert (30 dager, f.eks. tildelinger). Kunngjøringer som ikke også finnes i TED, først.
 * - Mislykkede forsøk prøves igjen med økende pause. 404 tre ganger eller andre feil fire ganger
 *   → gir opp. 429 og ugyldig nøkkel stopper kjøringen og teller ikke som forsøk.
 * - Bruker samme import som alt annet (ingestNotices). Første berikelse gir ingen falske
 *   endringsvarsler, og senere søketreff overskriver ikke XML-dataene (se ingest.ts).
 */
import { systemSql } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';
import { DOFFIN_MAX_IDS_PER_RUN, type DoffinByIdOutcome } from './doffin';
import { runConnector, type RunResult } from './index';

/** Nylig publiserte kunngjøringer (alle typer) berikes innen så mange dager. */
export const ENRICH_RECENT_DAYS = 30;
const NOT_FOUND_RETRY_HOURS = 24;
const NOT_FOUND_MAX_ATTEMPTS = 3;
const ERROR_BACKOFF_HOURS = [1, 6, 24] as const;
const ERROR_MAX_ATTEMPTS = 4;

export type EnrichStatus = 'ok' | 'retry' | 'gave_up';

export interface EnrichCandidate {
  doffinId: string;
  tenderId: string;
  lifecycle: string;
  deadlineAt: Date | null;
  publishedAt: Date | null;
  onTed: boolean;
  previousAttempts: number;
}

/** Felles utvalg for kandidater (brukes både til henting og til telling i admin). */
function candidateFrom(sql: ReturnType<typeof systemSql>) {
  return sql`
    from tender_sources s
    join tenders t on t.id = s.tender_id
    left join doffin_enrichment e on e.doffin_id = s.source_notice_id
    where s.source = 'doffin'
      and s.removed_at is null
      and coalesce(s.raw->>'format', '') <> 'eforms-xml'
      and s.source_notice_id ~ '^[0-9]{4}-[0-9]{1,12}$'
      and (e.doffin_id is null or (e.status = 'retry' and e.next_attempt_at <= now()))
      and (
        (t.lifecycle in ('competition', 'planned') and (t.deadline_at is null or t.deadline_at > now())
          and coalesce(s.published_at, s.fetched_at) > now() - interval '365 days')
        or coalesce(s.published_at, s.fetched_at) > now() - make_interval(days => ${ENRICH_RECENT_DAYS})
      )
  `;
}

/** Hvilke Doffin-ID-er som bør berikes nå, viktigst først. Bare lesing. */
export async function selectEnrichmentCandidates(limit: number): Promise<EnrichCandidate[]> {
  const sql = systemSql();
  return (await sql`
    select s.source_notice_id as doffin_id, s.tender_id, t.lifecycle, t.deadline_at, s.published_at,
           exists (select 1 from tender_sources x where x.tender_id = s.tender_id and x.source = 'ted') as on_ted,
           coalesce(e.attempts, 0) as previous_attempts,
           case
             when t.lifecycle = 'competition' and t.deadline_at > now() then 0
             when t.lifecycle = 'competition' then 1
             when t.lifecycle = 'planned' then 2
             else 3
           end as priority
    ${candidateFrom(sql)}
    order by priority, on_ted, s.published_at desc nulls last, s.source_notice_id
    limit ${limit}
  `) as unknown as EnrichCandidate[];
}

/**
 * Ny tilstand etter et forsøk. `null` betyr at forsøket ikke telles (kjøringen ble stoppet av 429
 * eller ugyldig nøkkel, eller ID-en ble ikke forsøkt).
 */
export function nextEnrichmentState(
  outcome: DoffinByIdOutcome['outcome'],
  previousAttempts: number,
): { status: EnrichStatus; attempts: number; retryInHours: number | null } | null {
  const attempts = previousAttempts + 1;
  switch (outcome) {
    case 'not_attempted':
    case 'rate_limited':
    case 'unauthorized':
      return null;
    case 'ok':
      return { status: 'ok', attempts, retryInHours: null };
    case 'invalid_id':
      return { status: 'gave_up', attempts, retryInHours: null };
    case 'not_found':
      return attempts >= NOT_FOUND_MAX_ATTEMPTS
        ? { status: 'gave_up', attempts, retryInHours: null }
        : { status: 'retry', attempts, retryInHours: NOT_FOUND_RETRY_HOURS };
    default:
      return attempts >= ERROR_MAX_ATTEMPTS
        ? { status: 'gave_up', attempts, retryInHours: null }
        : { status: 'retry', attempts, retryInHours: ERROR_BACKOFF_HOURS[Math.min(attempts, ERROR_BACKOFF_HOURS.length) - 1]! };
  }
}

/** Lagrer resultatet per ID. En vellykket nedlasting regnes bare som «ok» hvis XML-en faktisk er lagret. */
async function recordOutcomes(outcomes: DoffinByIdOutcome[]): Promise<Partial<Record<EnrichStatus, number>>> {
  const sql = systemSql();
  const ids = outcomes.map((o) => o.id);
  const previous = new Map(
    ((await sql`select doffin_id, attempts from doffin_enrichment where doffin_id = any(${ids}::text[])`) as unknown as { doffinId: string; attempts: number }[]).map(
      (r) => [r.doffinId, r.attempts],
    ),
  );
  const stored = new Set(
    (
      (await sql`
        select source_notice_id from tender_sources
        where source = 'doffin' and source_notice_id = any(${ids}::text[]) and raw->>'format' = 'eforms-xml'
      `) as unknown as { sourceNoticeId: string }[]
    ).map((r) => r.sourceNoticeId),
  );
  const counts: Partial<Record<EnrichStatus, number>> = {};
  for (const o of outcomes) {
    let outcome: string = o.outcome;
    let message = o.message ?? null;
    if (outcome === 'ok' && !stored.has(o.id)) {
      outcome = 'not_stored';
      message = 'Lastet ned, men ikke lagret – se importfeil for kjøringen.';
    }
    const next = nextEnrichmentState(outcome as DoffinByIdOutcome['outcome'], previous.get(o.id) ?? 0);
    if (!next) continue;
    counts[next.status] = (counts[next.status] ?? 0) + 1;
    await sql`
      insert into doffin_enrichment (doffin_id, status, attempts, last_outcome, last_message, last_attempt_at, next_attempt_at)
      values (
        ${o.id}, ${next.status}, ${next.attempts}, ${outcome.slice(0, 40)}, ${message?.slice(0, 500) ?? null}, now(),
        now() + make_interval(hours => ${next.retryInHours}::int)
      )
      on conflict (doffin_id) do update set
        status = excluded.status,
        attempts = excluded.attempts,
        last_outcome = excluded.last_outcome,
        last_message = excluded.last_message,
        last_attempt_at = excluded.last_attempt_at,
        next_attempt_at = excluded.next_attempt_at
    `;
  }
  return counts;
}

export interface EnrichResult extends RunResult {
  /** Antall Doffin-ID-er som ble valgt ut i denne kjøringen. */
  candidates?: number;
  /** Ny tilstand per ID (lagres ikke i dry-run). */
  recorded?: Partial<Record<EnrichStatus, number>>;
  /** Bare ved `plan`: hva som ville blitt hentet, uten noe kall mot Doffin. */
  plan?: EnrichCandidate[];
}

export interface EnrichOptions {
  trigger: 'schedule' | 'manual' | 'cli';
  limit?: number;
  /** Last ned og vis, men lagre ingenting (heller ikke forsøkene). */
  dryRun?: boolean;
  /** Bare vis kandidatene – ingen kall mot Doffin. */
  plan?: boolean;
  /** Kjør selv om DOFFIN_ENRICH_XML er av eller kilden er slått av i admin (CLI og manuell test). */
  force?: boolean;
  triggeredBy?: string | null;
}

export async function enrichDoffinXml(opts: EnrichOptions): Promise<EnrichResult> {
  if (!env.DOFFIN_ENRICH_XML && !opts.force && !opts.plan) {
    return { ok: true, skipped: 'Automatisk XML-berikelse er av (DOFFIN_ENRICH_XML). Slå på etter live-test av nedlastingen.' };
  }
  if (!env.DOFFIN_API_KEY && !opts.plan) return { ok: true, skipped: 'Mangler DOFFIN_API_KEY.' };
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? env.DOFFIN_ENRICH_MAX_PER_RUN), DOFFIN_MAX_IDS_PER_RUN));
  const candidates = await selectEnrichmentCandidates(limit);
  if (opts.plan) return { ok: true, candidates: candidates.length, plan: candidates };
  if (!candidates.length) return { ok: true, candidates: 0 };

  const result = await runConnector('doffin', {
    trigger: opts.trigger,
    ids: candidates.map((c) => c.doffinId),
    dryRun: opts.dryRun,
    force: opts.force,
    triggeredBy: opts.triggeredBy,
  });
  if (result.skipped || opts.dryRun || !result.downloads) return { ...result, candidates: candidates.length };
  const recorded = await recordOutcomes(result.downloads);
  log.info('doffin_enrich_finished', { candidates: candidates.length, ...recorded, error: result.error });
  return { ...result, candidates: candidates.length, recorded };
}

export interface EnrichmentOverview {
  enabled: boolean;
  configured: boolean;
  intervalMinutes: number;
  maxPerRun: number;
  /** Doffin-kilder som er lagret som full eForms-XML. */
  enriched: number;
  /** Venter nå (kandidater som ville blitt valgt, uten grense). */
  waiting: number;
  retry: number;
  gaveUp: number;
  okLast24h: number;
  /** Siste forsøk uansett hvem som startet det (arbeider, /api/cron eller kommandolinje). */
  lastAttemptAt: Date | null;
  recentProblems: { doffinId: string; status: EnrichStatus; lastOutcome: string; lastMessage: string | null; attempts: number; lastAttemptAt: Date; nextAttemptAt: Date | null }[];
}

/** Oversikt for admin. Bare lesing. */
export async function enrichmentOverview(): Promise<EnrichmentOverview> {
  const sql = systemSql();
  const [counts] = (await sql`
    select
      (select count(*) from tender_sources where source = 'doffin' and raw->>'format' = 'eforms-xml')::int as enriched,
      (select count(*) from doffin_enrichment where status = 'retry')::int as retry,
      (select count(*) from doffin_enrichment where status = 'gave_up')::int as gave_up,
      (select count(*) from doffin_enrichment where status = 'ok' and last_attempt_at > now() - interval '24 hours')::int as ok_last24h,
      (select max(last_attempt_at) from doffin_enrichment) as last_attempt_at
  `) as unknown as { enriched: number; retry: number; gaveUp: number; okLast24h: number; lastAttemptAt: Date | null }[];
  const [{ waiting }] = (await sql`select count(*)::int as waiting ${candidateFrom(sql)}`) as unknown as [{ waiting: number }];
  const recentProblems = (await sql`
    select doffin_id, status, last_outcome, last_message, attempts, last_attempt_at, next_attempt_at
    from doffin_enrichment where status <> 'ok'
    order by last_attempt_at desc limit 10
  `) as unknown as EnrichmentOverview['recentProblems'];
  return {
    enabled: env.DOFFIN_ENRICH_XML,
    configured: Boolean(env.DOFFIN_API_KEY),
    intervalMinutes: env.DOFFIN_ENRICH_INTERVAL_MINUTES,
    maxPerRun: env.DOFFIN_ENRICH_MAX_PER_RUN,
    enriched: counts!.enriched,
    waiting,
    retry: counts!.retry,
    gaveUp: counts!.gaveUp,
    okLast24h: counts!.okLast24h,
    lastAttemptAt: counts!.lastAttemptAt,
    recentProblems,
  };
}
