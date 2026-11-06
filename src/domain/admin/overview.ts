/**
 * Admin-oversikten: det som trenger oppmerksomhet, en lanseringssjekk beregnet fra det faktiske
 * oppsettet, datakildene, trender for de siste 30 dagene og siste hendelser.
 *
 * Bare tall og handlinger – ingen navn eller e-postadresser til brukere (de står på Brukere-siden).
 * Bruker systemrollen (på tvers av organisasjoner); tilgangen kontrolleres i ruteren.
 */
import { systemSql } from '@/lib/db';
import { env, integrationStatus } from '@/lib/env';
import { BLOCKED_BY_ALLOWLIST, BLOCKED_TEST_DOMAIN } from '@/lib/email';
import { CONNECTORS } from '@/connectors';
import { companyConfigured, companyInfo, contactIsGmail, isPlaceholder } from '@/domain/legal/legal';
import { platformMetrics } from './admin';

export type AttentionTone = 'feil' | 'advarsel' | 'info';
export interface AttentionItem {
  tone: AttentionTone;
  title: string;
  detail?: string;
  href?: string;
}

/** klar = ferdig · delvis = virker, men ikke ferdig · mangler = ikke satt opp · venter = bevisst av til lansering */
export type LaunchState = 'klar' | 'delvis' | 'mangler' | 'venter';
export interface LaunchItem {
  id: string;
  label: string;
  state: LaunchState;
  detail: string;
  href?: string;
}

export type SourceState = 'ok' | 'feil' | 'gammel' | 'mangler-nokkel' | 'av';
export interface SourceStatus {
  id: string;
  name: string;
  state: SourceState;
  notices: number;
  new24h: number;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  lastRun: { status: string; startedAt: Date; finishedAt: Date | null; createdCount: number; errorCount: number } | null;
}

export interface DayCounts {
  /** YYYY-MM-DD, norsk tid */
  day: string;
  users: number;
  tenders: number;
}

export interface ActivityItem {
  label: string;
  at: Date;
  href?: string;
}

/** Hendelser fra revisjonsloggen som vises i oversikten. Andre (innlogging, autolagring …) er støy her. */
export const ACTIVITY_LABELS: Record<string, string> = {
  'auth.register': 'Ny bruker registrert',
  'auth.email_verified': 'E-postadresse bekreftet',
  'org.created': 'Ny organisasjon opprettet',
  'org.member_joined': 'Kollega ble med i en organisasjon',
  'org.member_invited': 'Kollega invitert',
  'org.deleted': 'Organisasjon slettet',
  'account.deleted': 'Konto slettet',
  'billing.checkout_started': 'Startet betaling',
  'billing.subscription_changed': 'Abonnement endret',
  'billing.payment_failed': 'Betaling feilet',
  'billing.manual_override': 'Plan endret manuelt',
  'billing.dispute_opened': 'Betaling bestridt',
  'admin.import_triggered': 'Henting startet manuelt',
  'admin.role_changed': 'Admin-tilgang endret',
  'admin.source_updated': 'Datakilde endret',
  'partner.request_sent': 'Partnerforespørsel sendt',
  'bid.status_changed': 'Tilbud fikk ny status',
  'notifications.unsubscribed': 'Avmeldt e-postvarsler',
  'data.exported': 'Data eksportert',
};

const HOUR = 3_600_000;
/** En kilde regnes som «gammel» når siste vellykkede henting er eldre enn dette. */
export function staleAfterMs(): number {
  return Math.max(3 * env.INGEST_INTERVAL_MINUTES * 60_000, 6 * HOUR);
}

export function sourceState(
  s: { id: string; enabled: boolean; lastSuccessAt: Date | null; lastErrorAt: Date | null },
  now: Date,
): SourceState {
  if (!s.enabled) return 'av';
  const connector = CONNECTORS[s.id as keyof typeof CONNECTORS];
  if (connector && !connector.status().configured) return 'mangler-nokkel';
  if (s.lastErrorAt && (!s.lastSuccessAt || s.lastErrorAt > s.lastSuccessAt)) return 'feil';
  if (connector && (!s.lastSuccessAt || now.getTime() - s.lastSuccessAt.getTime() > staleAfterMs())) return 'gammel';
  return 'ok';
}

function hoursAgo(d: Date, now: Date): string {
  const h = Math.max(1, Math.round((now.getTime() - d.getTime()) / HOUR));
  return h < 48 ? `${h} ${h === 1 ? 'time' : 'timer'}` : `${Math.round(h / 24)} dager`;
}

export async function adminOverview(now = new Date()) {
  const sql = systemSql();
  const m = await platformMetrics();

  const days = (await sql`
    with days as (
      select generate_series((now() at time zone 'Europe/Oslo')::date - 29, (now() at time zone 'Europe/Oslo')::date, interval '1 day')::date as d
    ),
    u as (
      select (created_at at time zone 'Europe/Oslo')::date as d, count(*)::int as n
      from users where created_at > now() - interval '31 days' group by 1
    ),
    t as (
      select (first_seen_at at time zone 'Europe/Oslo')::date as d, count(*)::int as n
      from tenders where not is_sample and first_seen_at > now() - interval '31 days' group by 1
    )
    select to_char(days.d, 'YYYY-MM-DD') as day, coalesce(u.n, 0)::int as users, coalesce(t.n, 0)::int as tenders
    from days left join u on u.d = days.d left join t on t.d = days.d
    order by days.d
  `) as unknown as DayCounts[];

  const [tenders] = (await sql`
    select count(*) filter (where not is_sample and lifecycle in ('competition', 'other') and deadline_at > now())::int as open,
           count(*) filter (where not is_sample and first_seen_at > now() - interval '24 hours')::int as new24h
    from tenders
  `) as unknown as { open: number; new24h: number }[];

  const sourceRows = (await sql`
    select d.id, d.name, d.enabled, d.last_success_at, d.last_error_at, d.last_error,
      (select count(*)::int from tender_sources s where s.source = d.id and s.removed_at is null) as notices,
      (select coalesce(sum(r.created_count), 0)::int from import_runs r where r.source = d.id and r.started_at > now() - interval '24 hours') as new24h
    from data_sources d
    order by case d.id when 'doffin' then 0 when 'ted' then 1 else 2 end, d.id
  `) as unknown as {
    id: string;
    name: string;
    enabled: boolean;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
    notices: number;
    new24h: number;
  }[];
  const lastRuns = (await sql`
    select distinct on (source) source, status, started_at, finished_at, created_count, error_count
    from import_runs order by source, started_at desc
  `) as unknown as { source: string; status: string; startedAt: Date; finishedAt: Date | null; createdCount: number; errorCount: number }[];
  const sources: SourceStatus[] = sourceRows
    // Henting fra Doffin og TED vises alltid; manuell import og eksempeldata bare når de har data.
    .filter((s) => s.id in CONNECTORS || (s.enabled && s.notices > 0))
    .map((s) => {
      const run = lastRuns.find((r) => r.source === s.id);
      return {
        id: s.id,
        name: s.name,
        state: sourceState(s, now),
        notices: s.notices,
        new24h: s.new24h,
        lastSuccessAt: s.lastSuccessAt,
        lastErrorAt: s.lastErrorAt,
        lastError: s.lastError,
        lastRun: run ? { status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, createdCount: run.createdCount, errorCount: run.errorCount } : null,
      };
    });

  const [ops] = (await sql`
    select
      (select max(last_seen_at) from worker_heartbeats) as worker_seen_at,
      (select count(*)::int from jobs where status = 'failed' and coalesce(finished_at, created_at) > now() - interval '24 hours') as failed_jobs,
      (select count(*)::int from email_outbox where created_at > now() - interval '7 days' and status = 'failed'
         and coalesce(last_error, '') not in (${BLOCKED_BY_ALLOWLIST}, ${BLOCKED_TEST_DOMAIN})) as failed_emails,
      (select count(*)::int from email_outbox where created_at > now() - interval '7 days' and status = 'failed'
         and last_error = ${BLOCKED_BY_ALLOWLIST}) as blocked_emails,
      (select count(*)::int from email_outbox where created_at > now() - interval '7 days' and status = 'sent') as sent_emails,
      (select count(*)::int from import_errors where created_at > now() - interval '7 days') as import_errors,
      (select count(*)::int from reports where status = 'open' and kind = 'contact') as open_contact,
      (select count(*)::int from reports where status = 'open' and kind = 'data_error') as open_data_errors,
      (select count(*)::int from users where locked_until > now()) as locked_users,
      (select count(*)::int from subscriptions where source = 'trial' and trial_ends_at > now() and trial_ends_at < now() + interval '3 days') as trials_ending
  `) as unknown as {
    workerSeenAt: Date | null;
    failedJobs: number;
    failedEmails: number;
    blockedEmails: number;
    sentEmails: number;
    importErrors: number;
    openContact: number;
    openDataErrors: number;
    lockedUsers: number;
    trialsEnding: number;
  }[];
  const o = ops!;

  // ---- Trenger oppmerksomhet ---------------------------------------------------------------
  const attention: AttentionItem[] = [];
  for (const s of sources) {
    if (s.state === 'feil') {
      attention.push({
        tone: 'feil',
        title: `Siste henting fra ${s.name} feilet`,
        detail: (s.lastError ?? 'Ukjent feil').slice(0, 160),
        href: '/admin/importer',
      });
    } else if (s.state === 'gammel') {
      attention.push({
        tone: 'advarsel',
        title: s.lastSuccessAt ? `${s.name}: ingen vellykket henting på ${hoursAgo(s.lastSuccessAt, now)}` : `${s.name}: ikke hentet ennå`,
        detail: env.RUN_WORKER_IN_WEB
          ? 'Hentingen går i nettsiden. På gratisplanen sover den når ingen bruker siden, og starter igjen når noen åpner den.'
          : 'Sjekk at bakgrunnstjenesten kjører.',
        href: '/admin/importer',
      });
    } else if (s.state === 'mangler-nokkel') {
      attention.push({ tone: 'advarsel', title: `${s.name} mangler nøkkel`, detail: 'Kunngjøringer fra denne kilden hentes ikke.', href: '/admin/kilder' });
    }
  }
  if (!o.workerSeenAt || now.getTime() - o.workerSeenAt.getTime() > 10 * 60_000) {
    attention.push({
      tone: 'advarsel',
      title: o.workerSeenAt ? `Bakgrunnsjobbene har ikke meldt seg på ${hoursAgo(o.workerSeenAt, now)}` : 'Bakgrunnsjobbene har aldri meldt seg',
      detail: 'Uten dem hentes ikke anbud, og varsler sendes ikke.',
      href: '/admin/helse',
    });
  }
  if (o.failedJobs > 0) {
    attention.push({ tone: 'feil', title: `${o.failedJobs} bakgrunnsjobb${o.failedJobs === 1 ? '' : 'er'} feilet siste døgn`, href: '/admin/helse' });
  }
  if (o.failedEmails > 0) {
    attention.push({ tone: 'feil', title: `${o.failedEmails} e-post${o.failedEmails === 1 ? '' : 'er'} kunne ikke sendes siste 7 dager`, href: '/admin/epost' });
  }
  if (m.ai.failed > 0) {
    attention.push({ tone: 'advarsel', title: `${m.ai.failed} AI-analyse${m.ai.failed === 1 ? '' : 'r'} feilet denne måneden`, href: '/admin/ai' });
  }
  if (o.importErrors > 0) {
    attention.push({
      tone: 'info',
      title: `${o.importErrors} kunngjøring${o.importErrors === 1 ? '' : 'er'} kunne ikke leses siste 7 dager`,
      detail: 'Resten av hentingen gikk som normalt. Detaljene står under Importer.',
      href: '/admin/importer',
    });
  }
  if (o.openContact > 0) {
    attention.push({ tone: 'info', title: `${o.openContact} ubesvart${o.openContact === 1 ? '' : 'e'} henvendelse${o.openContact === 1 ? '' : 'r'} fra kontaktskjemaet`, href: '/admin/rapporter' });
  }
  if (o.openDataErrors > 0) {
    attention.push({ tone: 'info', title: `${o.openDataErrors} feilmelding${o.openDataErrors === 1 ? '' : 'er'} om anbud fra brukere`, href: '/admin/rapporter' });
  }
  if (o.trialsEnding > 0) {
    attention.push({ tone: 'info', title: `${o.trialsEnding} prøveperiode${o.trialsEnding === 1 ? '' : 'r'} slutter innen 3 dager`, href: '/admin/organisasjoner' });
  }
  if (o.lockedUsers > 0) {
    attention.push({ tone: 'info', title: `${o.lockedUsers} konto${o.lockedUsers === 1 ? '' : 'er'} er midlertidig låst etter feil passord`, href: '/admin/brukere' });
  }
  if (o.blockedEmails > 0) {
    attention.push({
      tone: 'info',
      title: `${o.blockedEmails} e-post${o.blockedEmails === 1 ? '' : 'er'} stoppet av testlisten siste 7 dager`,
      detail: 'Bare adressene på testlisten får e-post før lansering.',
      href: '/admin/epost',
    });
  }
  const order: Record<AttentionTone, number> = { feil: 0, advarsel: 1, info: 2 };
  attention.sort((a, b) => order[a.tone] - order[b.tone]);

  // ---- Klar for lansering ---------------------------------------------------------------------
  const i = integrationStatus();
  const appUrl = new URL(env.APP_URL);
  const ownDomain = appUrl.protocol === 'https:' && !/(^|\.)(onrender\.com|localhost)$|^127\.0\.0\.1$/.test(appUrl.hostname);
  const fromAddress = (/<([^>]+)>/.exec(env.EMAIL_FROM)?.[1] ?? env.EMAIL_FROM).trim();
  const emailOwnDomain = i.email && !/@(resend\.dev|example\.(com|org|net))$/i.test(fromAddress);
  const allowlistOn = Boolean(env.EMAIL_ALLOWED_RECIPIENTS?.trim());
  const company = companyInfo();
  const doffin = sources.find((s) => s.id === 'doffin');
  const ted = sources.find((s) => s.id === 'ted');
  const fetched = (s: SourceStatus | undefined) => (s?.lastSuccessAt ? `Sist hentet for ${hoursAgo(s.lastSuccessAt, now)} siden` : 'Ikke hentet ennå');
  const aiOn = i.ai && !i.aiIsMock;

  const launch: LaunchItem[] = [
    { id: 'domene', label: 'Eget domene', state: ownDomain ? 'klar' : 'mangler', detail: ownDomain ? appUrl.host : `Nettsiden bruker ${appUrl.host}` },
    {
      id: 'doffin',
      label: 'Anbud fra Doffin',
      state: !i.doffin ? 'mangler' : doffin?.state === 'ok' ? 'klar' : 'delvis',
      detail: !i.doffin ? 'Mangler nøkkel (DOFFIN_API_KEY)' : fetched(doffin),
      href: '/admin/kilder',
    },
    { id: 'ted', label: 'Anbud fra TED', state: ted?.state === 'ok' ? 'klar' : 'delvis', detail: fetched(ted), href: '/admin/kilder' },
    {
      id: 'epost',
      label: 'E-post fra eget domene',
      state: emailOwnDomain ? 'klar' : i.email ? 'delvis' : 'mangler',
      detail: i.email ? `Avsender ${fromAddress}` : 'E-post er ikke satt opp',
      href: '/admin/epost',
    },
    {
      id: 'ai',
      label: 'AI-analyse',
      state: aiOn ? 'klar' : 'mangler',
      detail: aiOn ? `På (${i.aiProvider === 'openai' ? 'OpenAI' : 'Anthropic'})` : i.aiIsMock ? 'Testmodus – simulerte svar' : 'Av – mangler nøkkel (ANTHROPIC_API_KEY)',
      href: '/admin/ai',
    },
    {
      id: 'betaling',
      label: 'Betaling',
      state: i.stripe ? (i.stripeTestMode ? 'delvis' : 'klar') : 'mangler',
      detail: i.stripe
        ? i.stripeTestMode
          ? 'Stripe i testmodus'
          : 'Stripe live'
        : env.STRIPE_SECRET_KEY
          ? 'Stripe-nøkkel satt, men priser eller webhook mangler'
          : 'Stripe er ikke satt opp',
      href: '/admin/helse',
    },
    {
      id: 'filer',
      label: 'Lagring av dokumenter',
      state: i.storageDriver === 'supabase' && i.storage ? 'klar' : 'mangler',
      detail: i.storageDriver === 'supabase' ? (i.storage ? 'Supabase Storage' : 'Supabase valgt, men nøkler mangler') : 'På serverdisken – forsvinner ved hver ny versjon',
    },
    {
      id: 'firma',
      label: 'Firmaopplysninger',
      state: companyConfigured(company) ? 'klar' : 'mangler',
      detail: companyConfigured(company) ? company.name : 'Firmanavn, org.nr. og adresse mangler',
      href: '/om',
    },
    {
      id: 'kontakt',
      label: 'Kontaktadresse',
      state: isPlaceholder(company.email) ? 'mangler' : contactIsGmail(company) ? 'delvis' : 'klar',
      detail: isPlaceholder(company.email)
        ? 'Ikke satt'
        : contactIsGmail(company)
          ? `${company.email} – gratis Gmail har ingen databehandleravtale`
          : company.email,
    },
    {
      id: 'juridisk',
      label: 'Juridisk gjennomgang',
      state: env.LEGAL_PAGES_REVIEWED ? 'klar' : 'mangler',
      detail: env.LEGAL_PAGES_REVIEWED ? 'Gjennomgått av advokat' : 'Utkast – venter på advokat',
      href: '/vilkar',
    },
    {
      id: 'kunde-epost',
      label: 'E-post til kunder',
      state: !i.email ? 'mangler' : allowlistOn ? 'venter' : 'klar',
      detail: !i.email ? 'E-post er ikke satt opp' : allowlistOn ? 'Testlisten er på – bare dine adresser får e-post' : 'Alle får e-post',
    },
  ];

  // ---- Siste hendelser ------------------------------------------------------------------------
  const activityRows = (await sql`
    select action, org_id, created_at from audit_logs
    where action in ${sql(Object.keys(ACTIVITY_LABELS))}
    order by created_at desc limit 12
  `) as unknown as { action: string; orgId: string | null; createdAt: Date }[];
  const activity: ActivityItem[] = activityRows.map((r) => ({
    label: ACTIVITY_LABELS[r.action] ?? r.action,
    at: r.createdAt,
    href: r.orgId && r.action !== 'org.deleted' ? `/admin/organisasjoner/${r.orgId}` : undefined,
  }));

  return {
    generatedAt: now,
    kpi: {
      openTenders: tenders!.open,
      newTenders24h: tenders!.new24h,
      users: m.users.total,
      newUsers7d: m.users.new7d,
      active7d: m.users.active7d,
      paying: m.paying,
      mrr: m.mrr,
      trials: m.trials,
      trialsEnding: o.trialsEnding,
      sentEmails7d: o.sentEmails,
    },
    days,
    attention,
    launch,
    sources,
    activity,
    metrics: m,
  };
}

export type AdminOverview = Awaited<ReturnType<typeof adminOverview>>;
