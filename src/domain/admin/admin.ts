/**
 * Internt adminpanel og nøkkeltall. Kun for plattform-administratorer.
 * Bruker systemrollen (på tvers av organisasjoner) – tilgang kontrolleres i ruteren.
 */
import { first, systemSql } from '@/lib/db';
import { entitlementsFor, PLANS, resolveBilling, withAdminAccess, type PlanId, type SubscriptionRow } from '@/domain/billing/plans';
import { orgHasAdminAccess } from '@/domain/org/org';

export async function platformMetrics() {
  const sql = systemSql();
  const [users] = (await sql`
    select count(*)::int as total,
      count(*) filter (where created_at > now() - interval '7 days')::int as new_7d,
      count(*) filter (where created_at > now() - interval '30 days')::int as new_30d,
      count(*) filter (where email_verified_at is not null)::int as verified,
      (select count(distinct user_id)::int from sessions where last_seen_at > now() - interval '7 days') as active_7d,
      (select count(distinct user_id)::int from sessions where last_seen_at > now() - interval '30 days') as active_30d
    from users
  `) as unknown as { total: number; new7d: number; new30d: number; verified: number; active7d: number; active30d: number }[];

  const subs = (await sql`
    select o.id, o.created_at, s.plan, s.status, s.source, s.current_period_end, s.trial_ends_at, s.cancel_at_period_end,
           s.stripe_customer_id, s.stripe_subscription_id, s.updated_at as sub_updated_at,
           (select onboarding_completed_at from company_profiles p where p.org_id = o.id) as onboarded_at
    from organizations o left join subscriptions s on s.org_id = o.id
  `) as unknown as (SubscriptionRow & { id: string; createdAt: Date; plan: PlanId | null; subUpdatedAt: Date | null; onboardedAt: Date | null })[];

  let mrr = 0;
  let paying = 0;
  let trials = 0;
  let canceled30d = 0;
  const byPlan: Record<string, number> = {};
  for (const s of subs) {
    const billing = resolveBilling(s.plan ? s : null);
    byPlan[billing.effectivePlan] = (byPlan[billing.effectivePlan] ?? 0) + 1;
    if (s.source === 'stripe' && ['active', 'trialing', 'past_due'].includes(s.status)) {
      paying++;
      mrr += PLANS[s.plan ?? 'free'].priceNok ?? 0;
    }
    if (billing.status === 'trial') trials++;
    if (s.source === 'stripe' && s.status === 'canceled' && s.subUpdatedAt && s.subUpdatedAt > new Date(Date.now() - 30 * 86_400_000)) canceled30d++;
  }
  const orgs = subs.length;
  const onboarded = subs.filter((s) => s.onboardedAt).length;

  const registrations = (await sql`
    select to_char(date_trunc('week', created_at), 'IYYY-"W"IW') as week, count(*)::int as n
    from users where created_at > now() - interval '8 weeks' group by 1 order by 1
  `) as unknown as { week: string; n: number }[];

  const searchedIndustries = (await sql`
    select ind as industry, count(*)::int as n from search_events, unnest(industries) as ind
    where created_at > now() - interval '30 days' group by 1 order by n desc limit 8
  `) as unknown as { industry: string; n: number }[];

  const savedTenders = (await sql`
    select t.id, t.title, count(*)::int as n from bookmarks b join tenders t on t.id = b.tender_id
    group by t.id, t.title order by n desc limit 8
  `) as unknown as { id: string; title: string; n: number }[];

  const [ai] = (await sql`
    select count(*) filter (where status = 'completed')::int as completed,
           count(*) filter (where status = 'failed')::int as failed,
           coalesce(sum(input_tokens), 0)::int as input_tokens, coalesce(sum(output_tokens), 0)::int as output_tokens,
           coalesce(sum(cost_usd), 0)::float8 as cost_usd
    from ai_analyses where created_at >= date_trunc('month', now())
  `) as unknown as { completed: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number }[];

  const freshness = (await sql`
    select d.id, d.name, d.enabled, d.verified_live, d.last_success_at, d.last_error_at, d.last_error,
      (select count(*)::int from tender_sources s where s.source = d.id) as notices,
      (select max(fetched_at) from tender_sources s where s.source = d.id) as last_fetched
    from data_sources d order by d.id
  `) as unknown as {
    id: string;
    name: string;
    enabled: boolean;
    verifiedLive: boolean;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
    notices: number;
    lastFetched: Date | null;
  }[];

  const [imports] = (await sql`
    select count(*) filter (where status = 'failed')::int as failed_runs,
           coalesce(sum(error_count), 0)::int as errors
    from import_runs where started_at > now() - interval '7 days'
  `) as unknown as { failedRuns: number; errors: number }[];

  const [tenders] = (await sql`
    select count(*)::int as total, count(*) filter (where is_sample)::int as sample,
           count(*) filter (where lifecycle in ('competition', 'other') and deadline_at > now())::int as open
    from tenders
  `) as unknown as { total: number; sample: number; open: number }[];

  return {
    users: users!,
    orgs,
    onboarded,
    paying,
    trials,
    canceled30d,
    mrr,
    byPlan,
    conversion: orgs ? paying / orgs : 0,
    churn: paying + canceled30d ? canceled30d / (paying + canceled30d) : 0,
    registrations,
    searchedIndustries,
    savedTenders,
    ai: ai!,
    freshness,
    imports: imports!,
    tenders: tenders!,
  };
}

export async function listUsers(q: string, page: number) {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return (await systemSql()`
    select u.id, u.email, u.name, u.email_verified_at, u.is_platform_admin, u.created_at, u.last_login_at, u.locked_until,
           (select count(*)::int from organization_members m where m.user_id = u.id) as orgs
    from users u
    where ${q ? systemSql()`(u.email ilike ${pattern} or u.name ilike ${pattern})` : systemSql()`true`}
    order by u.created_at desc limit 50 offset ${(page - 1) * 50}
  `) as unknown as {
    id: string;
    email: string;
    name: string;
    emailVerifiedAt: Date | null;
    isPlatformAdmin: boolean;
    createdAt: Date;
    lastLoginAt: Date | null;
    lockedUntil: Date | null;
    orgs: number;
  }[];
}

export async function listOrganizations(q: string) {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = (await systemSql()`
    select o.id, o.name, o.org_number, o.created_at, s.plan, s.status, s.source, s.current_period_end, s.trial_ends_at, s.cancel_at_period_end,
           s.stripe_customer_id, s.stripe_subscription_id,
           (select count(*)::int from organization_members m where m.org_id = o.id) as members,
           (select onboarding_completed_at from company_profiles p where p.org_id = o.id) as onboarded_at,
           exists (
             select 1 from organization_members m join users u on u.id = m.user_id
             where m.org_id = o.id and m.role = 'owner' and u.is_platform_admin
           ) as admin_access
    from organizations o left join subscriptions s on s.org_id = o.id
    where ${q ? systemSql()`o.name ilike ${pattern}` : systemSql()`true`}
    order by o.created_at desc limit 100
  `) as unknown as (SubscriptionRow & { id: string; name: string; orgNumber: string | null; createdAt: Date; plan: PlanId | null; members: number; onboardedAt: Date | null; adminAccess: boolean })[];
  return rows.map((r) => ({ ...r, billing: withAdminAccess(resolveBilling(r.plan ? r : null), r.adminAccess) }));
}

export async function organizationDetail(orgId: string) {
  const sql = systemSql();
  const org = first((await sql`select id, name, org_number, created_at from organizations where id = ${orgId}`) as unknown as {
    id: string;
    name: string;
    orgNumber: string | null;
    createdAt: Date;
  }[]);
  if (!org) return null;
  const sub = first(
    (await sql`select plan, status, source, current_period_end, trial_ends_at, cancel_at_period_end, stripe_customer_id, stripe_subscription_id, manual_note from subscriptions where org_id = ${orgId}`) as unknown as (SubscriptionRow & {
      manualNote: string | null;
    })[],
  );
  const members = (await sql`
    select u.id, u.name, u.email, m.role from organization_members m join users u on u.id = m.user_id where m.org_id = ${orgId}
  `) as unknown as { id: string; name: string; email: string; role: string }[];
  const usage = (await sql`
    select kind, sum(quantity)::int as n, sum(cost_usd)::float8 as cost from usage_records
    where org_id = ${orgId} and period = to_char(now(), 'YYYY-MM') group by kind
  `) as unknown as { kind: string; n: number; cost: number }[];
  const billing = withAdminAccess(resolveBilling(sub), await orgHasAdminAccess(orgId));
  return { org, sub, billing, entitlements: entitlementsFor(billing.effectivePlan), members, usage };
}

export async function systemHealth() {
  const sql = systemSql();
  const started = Date.now();
  await sql`select 1`;
  const dbMs = Date.now() - started;
  const migrations = (await sql`select version, applied_at from schema_migrations order by version`) as unknown as { version: string; appliedAt: Date }[];
  const workers = (await sql`select worker_id, last_seen_at, info from worker_heartbeats order by last_seen_at desc limit 5`) as unknown as {
    workerId: string;
    lastSeenAt: Date;
    info: Record<string, unknown>;
  }[];
  const jobs = (await sql`select status, count(*)::int as n from jobs group by status`) as unknown as { status: string; n: number }[];
  const failedJobs = (await sql`select id, kind, last_error, finished_at from jobs where status = 'failed' order by finished_at desc nulls last limit 10`) as unknown as {
    id: string;
    kind: string;
    lastError: string | null;
    finishedAt: Date | null;
  }[];
  const emails = (await sql`select status, count(*)::int as n from email_outbox where created_at > now() - interval '7 days' group by status`) as unknown as {
    status: string;
    n: number;
  }[];
  const [dbSize] = (await sql`select pg_size_pretty(pg_database_size(current_database())) as size`) as unknown as { size: string }[];
  // Grunnlag for å vurdere OCR: opplastede dokumenter som ikke kunne leses (typisk skannede PDF-er).
  const [documents] = (await sql`
    select count(*)::int as uploaded, (count(*) filter (where text_status <> 'extracted'))::int as unreadable
    from tender_documents where storage_key is not null and created_at > now() - interval '90 days'
  `) as unknown as { uploaded: number; unreadable: number }[];
  return {
    dbMs,
    migrations,
    workers,
    jobs,
    failedJobs,
    emails,
    documents: documents ?? { uploaded: 0, unreadable: 0 },
    dbSize: dbSize?.size ?? '?',
    node: process.version,
    uptimeSec: Math.round(process.uptime()),
  };
}
