/**
 * Varselmotor. Kjøres av arbeideren (worker) med systemrollen fordi den går på tvers
 * av organisasjoner. Duplikater hindres av unik nøkkel (user_id, dedupe_key).
 */
import { systemSql, type Tx } from '@/lib/db';
import { log } from '@/lib/logger';
import { sha256Hex } from '@/lib/crypto';
import { queueEmail } from '@/lib/email';
import { listUnsubscribeHeaders, unsubscribeUrl } from '@/domain/email/unsubscribe';
import { entitlementsFor, resolveBilling, type Entitlements, type SubscriptionRow } from '@/domain/billing/plans';
import { buildConditions } from '@/domain/tenders/queries';
import { sanitizeQuery, type TenderQuery } from '@/domain/search/filters';
import { absoluteUrl, digestTemplate, trialEndingTemplate, type DigestItem } from '@/domain/email/templates';
import { isoWeek } from '@/domain/dashboard';

type NotificationType =
  | 'new_match'
  | 'saved_search'
  | 'deadline'
  | 'tender_update'
  | 'cancellation'
  | 'weekly_summary'
  | 'payment_failed'
  | 'competitor_award'
  | 'system'
  | 'partner_request'
  | 'partner_response';

export interface NewNotification {
  orgId: string;
  userId: string;
  type: NotificationType;
  tenderId: string | null;
  title: string;
  body: string | null;
  url: string | null;
  dedupeKey: string;
}

/** Setter inn varsler; eksisterende (samme bruker + nøkkel) hoppes over. Returnerer antall nye. */
export async function insertNotifications(items: NewNotification[]): Promise<number> {
  if (!items.length) return 0;
  const sql = systemSql();
  let inserted = 0;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const rows = await sql`
      insert into notifications (org_id, user_id, type, tender_id, title, body, url, dedupe_key)
      select x.org_id, x.user_id, x.type, x.tender_id, x.title, x.body, x.url, x.dedupe_key
      from unnest(
        ${chunk.map((n) => n.orgId)}::uuid[], ${chunk.map((n) => n.userId)}::uuid[], ${chunk.map((n) => n.type)}::text[],
        ${chunk.map((n) => n.tenderId)}::uuid[], ${chunk.map((n) => n.title)}::text[], ${chunk.map((n) => n.body)}::text[],
        ${chunk.map((n) => n.url)}::text[], ${chunk.map((n) => n.dedupeKey)}::text[]
      ) as x(org_id, user_id, type, tender_id, title, body, url, dedupe_key)
      on conflict (user_id, dedupe_key) do nothing
      returning id
    `;
    inserted += rows.length;
  }
  return inserted;
}

/** Rettigheter per organisasjon, beregnet fra abonnementsradene. */
export async function entitlementsByOrg(): Promise<Map<string, Entitlements>> {
  const rows = (await systemSql()`
    select o.id as org_id, s.plan, s.status, s.source, s.current_period_end, s.trial_ends_at, s.cancel_at_period_end,
           s.stripe_customer_id, s.stripe_subscription_id
    from organizations o left join subscriptions s on s.org_id = o.id
  `) as unknown as (SubscriptionRow & { orgId: string; plan: SubscriptionRow['plan'] | null })[];
  const map = new Map<string, Entitlements>();
  for (const r of rows) {
    const billing = resolveBilling(r.plan ? r : null);
    map.set(r.orgId, entitlementsFor(billing.effectivePlan));
  }
  return map;
}

interface MemberPref {
  orgId: string;
  userId: string;
  newMatches: boolean;
  matchThreshold: number;
  savedSearchAlerts: boolean;
  deadlineReminders: boolean;
  tenderChanges: boolean;
  weeklySummary: boolean;
  emailFrequency: string;
}

function prefsByOrg(prefs: MemberPref[]): Map<string, MemberPref[]> {
  const map = new Map<string, MemberPref[]>();
  for (const p of prefs) map.set(p.orgId, [...(map.get(p.orgId) ?? []), p]);
  return map;
}

async function memberPrefs(): Promise<MemberPref[]> {
  return (await systemSql()`
    select m.org_id, m.user_id,
      coalesce(p.new_matches, true) as new_matches, coalesce(p.match_threshold, 60) as match_threshold,
      coalesce(p.saved_search_alerts, true) as saved_search_alerts, coalesce(p.deadline_reminders, true) as deadline_reminders,
      coalesce(p.tender_changes, true) as tender_changes, coalesce(p.weekly_summary, true) as weekly_summary,
      coalesce(p.email_frequency, 'daily') as email_frequency
    from organization_members m
    left join notification_preferences p on p.user_id = m.user_id and p.org_id = m.org_id
  `) as unknown as MemberPref[];
}

export async function generateSavedSearchAlerts(ents: Map<string, Entitlements>, prefs: MemberPref[]): Promise<number> {
  const sql = systemSql();
  const searches = (await sql`
    select s.id, s.org_id, s.user_id, s.name, s.filters, s.alert_frequency, s.last_alerted_at, s.created_at
    from saved_searches s
    where s.alert_enabled and (
      s.last_alerted_at is null
      or (s.alert_frequency = 'instant')
      or (s.alert_frequency = 'daily' and s.last_alerted_at < now() - interval '23 hours')
      or (s.alert_frequency = 'weekly' and s.last_alerted_at < now() - interval '6 days 12 hours')
    )
  `) as unknown as { id: string; orgId: string; userId: string; name: string; filters: TenderQuery; lastAlertedAt: Date | null; createdAt: Date }[];
  const prefByKey = new Map(prefs.map((p) => [`${p.orgId}:${p.userId}`, p]));
  // Etter nedgradering kan en organisasjon ha flere lagrede søk enn planen tillater. Da varsles
  // bare de eldste innenfor grensen – planen styrer faktisk hva kunden får.
  const rank = new Map<string, number>();
  for (const r of (await sql`
    select id, row_number() over (partition by org_id order by created_at, id)::int as n from saved_searches
  `) as unknown as { id: string; n: number }[]) rank.set(r.id, r.n);
  const items: NewNotification[] = [];
  for (const s of searches) {
    const ent = ents.get(s.orgId);
    const pref = prefByKey.get(`${s.orgId}:${s.userId}`);
    if (!ent || ent.alerts === 'none' || !pref || !pref.savedSearchAlerts) continue;
    if ((rank.get(s.id) ?? Infinity) > ent.maxSavedSearches) continue;
    const since = s.lastAlertedAt ?? s.createdAt;
    const filters = sanitizeQuery({ ...s.filters, page: 1, sort: null });
    const tenders = (await sql`
      select t.id, t.title, t.buyer_name from tenders t
      where ${buildConditions(sql, filters, { firstSeenAfter: since })}
      order by t.first_seen_at desc limit 25
    `) as unknown as { id: string; title: string; buyerName: string | null }[];
    for (const t of tenders) {
      items.push({
        orgId: s.orgId,
        userId: s.userId,
        type: 'saved_search',
        tenderId: t.id,
        title: t.title,
        body: `Nytt treff for det lagrede søket «${s.name}»${t.buyerName ? ` – ${t.buyerName}` : ''}`,
        url: `/app/anbud/${t.id}`,
        dedupeKey: `ss:${s.id}:${t.id}`,
      });
    }
    await sql`update saved_searches set last_alerted_at = now() where id = ${s.id}`;
  }
  return insertNotifications(items);
}

export async function generateMatchAlerts(ents: Map<string, Entitlements>, prefs: MemberPref[]): Promise<number> {
  const rows = (await systemSql()`
    select m.org_id, m.tender_id, m.score, t.title, t.buyer_name
    from match_results m
    join tenders t on t.id = m.tender_id
    join company_profiles p on p.org_id = m.org_id
    where not m.excluded and m.score >= 40
      and t.first_seen_at > greatest(p.onboarding_completed_at, now() - interval '3 days')
      and t.lifecycle in ('competition', 'planned', 'other')
      and (t.deadline_at is null or t.deadline_at > now())
  `) as unknown as { orgId: string; tenderId: string; score: number; title: string; buyerName: string | null }[];
  const items: NewNotification[] = [];
  const byOrg = prefsByOrg(prefs);
  for (const r of rows) {
    const ent = ents.get(r.orgId);
    if (!ent?.matching || ent.alerts !== 'full') continue;
    for (const p of byOrg.get(r.orgId) ?? []) {
      if (!p.newMatches || r.score < p.matchThreshold) continue;
      items.push({
        orgId: r.orgId,
        userId: p.userId,
        type: 'new_match',
        tenderId: r.tenderId,
        title: r.title,
        body: `Nytt anbud som passer profilen (relevans ${r.score} %)${r.buyerName ? ` – ${r.buyerName}` : ''}`,
        url: `/app/anbud/${r.tenderId}`,
        dedupeKey: `match:${r.tenderId}`,
      });
    }
  }
  return insertNotifications(items);
}

export async function generateDeadlineReminders(ents: Map<string, Entitlements>, prefs: MemberPref[]): Promise<number> {
  const rows = (await systemSql()`
    select b.org_id, t.id as tender_id, t.title, t.deadline_at,
      case when t.deadline_at <= now() + interval '1 day' then '1d'
           when t.deadline_at <= now() + interval '3 days' then '3d'
           else '7d' end as window
    from bookmarks b join tenders t on t.id = b.tender_id
    where t.deadline_at > now() and t.deadline_at <= now() + interval '7 days'
      and b.status in ('watching', 'preparing')
  `) as unknown as { orgId: string; tenderId: string; title: string; deadlineAt: Date; window: '1d' | '3d' | '7d' }[];
  const label = { '1d': 'mindre enn 1 døgn', '3d': '3 dager eller mindre', '7d': '7 dager eller mindre' };
  const items: NewNotification[] = [];
  const byOrg = prefsByOrg(prefs);
  for (const r of rows) {
    // Fristpåminnelser for lagrede anbud er med i alle betalte planer (også Start).
    const alerts = ents.get(r.orgId)?.alerts;
    if (alerts !== 'full' && alerts !== 'basic') continue;
    for (const p of byOrg.get(r.orgId) ?? []) {
      if (!p.deadlineReminders) continue;
      items.push({
        orgId: r.orgId,
        userId: p.userId,
        type: 'deadline',
        tenderId: r.tenderId,
        title: r.title,
        body: `Fristen er om ${label[r.window]}.`,
        url: `/app/anbud/${r.tenderId}`,
        dedupeKey: `deadline:${r.tenderId}:${r.window}`,
      });
    }
  }
  return insertNotifications(items);
}

export async function generateUpdateAlerts(ents: Map<string, Entitlements>, prefs: MemberPref[]): Promise<number> {
  const sql = systemSql();
  const updates = (await sql`
    select u.id, u.tender_id, u.change_type, u.summary, t.title
    from tender_updates u join tenders t on t.id = u.tender_id
    where u.notified_at is null order by u.detected_at limit 1000
  `) as unknown as { id: string; tenderId: string; changeType: string; summary: string; title: string }[];
  if (!updates.length) return 0;
  const bookmarks = (await sql`select org_id, tender_id from bookmarks where tender_id = any(${updates.map((u) => u.tenderId)}::uuid[])`) as unknown as {
    orgId: string;
    tenderId: string;
  }[];
  const items: NewNotification[] = [];
  const byOrg = prefsByOrg(prefs);
  for (const u of updates) {
    for (const b of bookmarks.filter((x) => x.tenderId === u.tenderId)) {
      if (ents.get(b.orgId)?.alerts !== 'full') continue;
      for (const p of byOrg.get(b.orgId) ?? []) {
        if (!p.tenderChanges) continue;
        items.push({
          orgId: b.orgId,
          userId: p.userId,
          type: u.changeType === 'cancelled' ? 'cancellation' : 'tender_update',
          tenderId: u.tenderId,
          title: u.title,
          body: u.summary,
          url: `/app/anbud/${u.tenderId}`,
          dedupeKey: `upd:${u.id}`,
        });
      }
    }
  }
  const n = await insertNotifications(items);
  await sql`update tender_updates set notified_at = now() where id = any(${updates.map((u) => u.id)}::uuid[])`;
  return n;
}

export async function generateCompetitorAlerts(ents: Map<string, Entitlements>, prefs: MemberPref[]): Promise<number> {
  const rows = (await systemSql()`
    select w.org_id, a.id as award_id, a.tender_id, a.supplier_name, t.title
    from competitor_watch w
    join contract_awards a on a.supplier_id = w.supplier_id
    join tenders t on t.id = a.tender_id
    where a.created_at > greatest(w.created_at, now() - interval '7 days')
  `) as unknown as { orgId: string; awardId: string; tenderId: string; supplierName: string; title: string }[];
  const items: NewNotification[] = [];
  for (const r of rows) {
    if (!ents.get(r.orgId)?.competitorIntel) continue;
    for (const p of prefs.filter((x) => x.orgId === r.orgId && x.tenderChanges)) {
      items.push({
        orgId: r.orgId,
        userId: p.userId,
        type: 'competitor_award',
        tenderId: r.tenderId,
        title: `${r.supplierName} vant en kontrakt`,
        body: r.title,
        url: `/app/anbud/${r.tenderId}`,
        dedupeKey: `comp:${r.awardId}`,
      });
    }
  }
  return insertNotifications(items);
}

// ---------------------------------------------------------------------------
// E-post
// ---------------------------------------------------------------------------
function osloParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', weekday: 'short', hour12: false }).formatToParts(now);
  return {
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? '0'),
    weekday: parts.find((p) => p.type === 'weekday')?.value ?? '',
  };
}

const TYPE_TAG: Record<string, string> = {
  new_match: 'Nytt treff',
  saved_search: 'Lagret søk',
  deadline: 'Frist nærmer seg',
  tender_update: 'Endring',
  cancellation: 'Avlyst',
  competitor_award: 'Konkurrent',
  payment_failed: 'Betaling',
  system: 'Melding',
  partner_request: 'Partnerforespørsel',
  partner_response: 'Partnersvar',
};

/**
 * Sender samlede e-postvarsler etter hver brukers valgte frekvens. E-posten legges i kø i samme
 * transaksjon som varslene merkes som sendt, med en nøkkel avledet av varslene – en krasj eller
 * samtidig kjøring kan derfor aldri gi samme e-post to ganger.
 */
export async function dispatchNotificationEmails(now = new Date()): Promise<number> {
  const sql = systemSql();
  const { hour, weekday } = osloParts(now);
  const pending = (await sql`
    select n.id, n.user_id, n.org_id, n.title, n.body, n.url, n.type, u.email, u.email_verified_at, o.name as org_name,
           coalesce(p.email_frequency, 'daily') as frequency, p.last_digest_at
    from notifications n
    join users u on u.id = n.user_id
    join organizations o on o.id = n.org_id
    left join notification_preferences p on p.user_id = n.user_id and p.org_id = n.org_id
    where n.emailed_at is null and n.email_skipped = false and n.type <> 'weekly_summary'
    order by n.created_at
    limit 5000
  `) as unknown as {
    id: string;
    userId: string;
    orgId: string;
    title: string;
    body: string | null;
    url: string | null;
    type: string;
    email: string;
    emailVerifiedAt: Date | null;
    orgName: string;
    frequency: 'instant' | 'daily' | 'weekly' | 'off';
    lastDigestAt: Date | null;
  }[];

  const groups = new Map<string, typeof pending>();
  for (const n of pending) {
    const key = `${n.userId}:${n.orgId}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  let sent = 0;
  for (const items of groups.values()) {
    const first = items[0]!;
    if (first.frequency === 'off' || !first.emailVerifiedAt) {
      await sql`update notifications set email_skipped = true where id = any(${items.map((i) => i.id)}::uuid[])`;
      continue;
    }
    const last = first.lastDigestAt?.getTime() ?? 0;
    const due =
      first.frequency === 'instant' ||
      (first.frequency === 'daily' && hour >= 7 && now.getTime() - last > 20 * 3600_000) ||
      (first.frequency === 'weekly' && weekday === 'Mon' && hour >= 7 && now.getTime() - last > 6 * 86_400_000);
    if (!due) continue;
    const shown = items.slice(0, 20);
    const digestItems: DigestItem[] = shown.map((i) => ({
      title: i.title,
      body: i.body,
      url: i.url ? absoluteUrl(i.url) : null,
      tag: TYPE_TAG[i.type] ?? null,
    }));
    const heading = items.length === 1 ? `Nytt varsel fra AnbudRadar: ${first.title}` : `${items.length} nye varsler fra AnbudRadar`;
    const intro =
      items.length > shown.length
        ? `Her er de ${shown.length} nyeste av ${items.length} varsler for ${first.orgName}. Se resten i appen.`
        : `Her er nye varsler for ${first.orgName}.`;
    const unsubscribe = unsubscribeUrl(first.userId, first.orgId);
    const tpl = digestTemplate(heading.slice(0, 150), intro, digestItems, absoluteUrl('/app/varsler'), unsubscribe);
    const ids = items.map((i) => i.id).sort();
    await sql.begin(async (rawTx) => {
      const tx = rawTx as unknown as Tx;
      await queueEmail(
        {
          to: first.email,
          ...tpl,
          kind: 'notification_digest',
          userId: first.userId,
          orgId: first.orgId,
          dedupeKey: `digest:${sha256Hex(ids.join(','))}`,
          headers: listUnsubscribeHeaders(first.userId, first.orgId),
        },
        tx,
      );
      await tx`update notifications set emailed_at = now() where id = any(${ids}::uuid[]) and emailed_at is null`;
      await tx`
        insert into notification_preferences (user_id, org_id, last_digest_at) values (${first.userId}, ${first.orgId}, now())
        on conflict (user_id, org_id) do update set last_digest_at = now()
      `;
    });
    sent++;
  }
  return sent;
}

/**
 * Påminnelse 3 dager og 1 dag før prøveperioden slutter, til eiere og administratorer.
 * Nøkkelen per organisasjon, bruker og terskel hindrer duplikater.
 */
export async function generateTrialReminders(now = new Date()): Promise<number> {
  const sql = systemSql();
  const rows = (await sql`
    select s.org_id, s.trial_ends_at, o.name as org_name, u.id as user_id, u.email
    from subscriptions s
    join organizations o on o.id = s.org_id
    join organization_members m on m.org_id = s.org_id and m.role in ('owner', 'admin')
    join users u on u.id = m.user_id and u.email_verified_at is not null
    where s.source = 'trial' and s.trial_ends_at > ${now} and s.trial_ends_at <= ${now}::timestamptz + interval '3 days'
  `) as unknown as { orgId: string; trialEndsAt: Date; orgName: string; userId: string; email: string }[];
  let queued = 0;
  for (const r of rows) {
    const daysLeft = Math.max(1, Math.ceil((r.trialEndsAt.getTime() - now.getTime()) / 86_400_000));
    const threshold = daysLeft <= 1 ? '1d' : '3d';
    const tpl = trialEndingTemplate(r.orgName, daysLeft, absoluteUrl('/app/abonnement'));
    const id = await queueEmail({
      to: r.email,
      ...tpl,
      kind: 'trial_ending',
      userId: r.userId,
      orgId: r.orgId,
      dedupeKey: `trial_ending:${r.orgId}:${r.userId}:${threshold}`,
    });
    if (id) queued++;
  }
  return queued;
}

/** Ukentlig sammendrag (mandag morgen). Egen e-post, uavhengig av varselfrekvens (men ikke ved "av"). */
export async function generateWeeklySummaries(now = new Date(), force = false): Promise<number> {
  const { hour, weekday } = osloParts(now);
  if (!force && (weekday !== 'Mon' || hour < 7)) return 0;
  const sql = systemSql();
  const week = isoWeek(now);
  const ents = await entitlementsByOrg();
  const users = (await sql`
    select m.org_id, m.user_id, u.email, u.email_verified_at, o.name as org_name,
           coalesce(p.weekly_summary, true) as weekly_summary, coalesce(p.email_frequency, 'daily') as frequency
    from organization_members m join users u on u.id = m.user_id join organizations o on o.id = m.org_id
    left join notification_preferences p on p.user_id = m.user_id and p.org_id = m.org_id
  `) as unknown as { orgId: string; userId: string; email: string; emailVerifiedAt: Date | null; orgName: string; weeklySummary: boolean; frequency: string }[];
  let count = 0;
  for (const u of users) {
    const ent = ents.get(u.orgId);
    if (!ent || ent.alerts === 'none' || !u.weeklySummary) continue;
    const exists = await sql`select 1 from notifications where user_id = ${u.userId} and dedupe_key = ${`weekly:${week}:${u.orgId}`}`;
    if (exists.length) continue;
    const matches = (await sql`
      select t.id, t.title, m.score from match_results m join tenders t on t.id = m.tender_id
      where m.org_id = ${u.orgId} and not m.excluded and t.first_seen_at > now() - interval '7 days'
        and (t.deadline_at is null or t.deadline_at > now())
      order by m.score desc limit 5
    `) as unknown as { id: string; title: string; score: number }[];
    const deadlines = (await sql`
      select t.id, t.title, t.deadline_at from bookmarks b join tenders t on t.id = b.tender_id
      where b.org_id = ${u.orgId} and t.deadline_at between now() and now() + interval '14 days'
      order by t.deadline_at limit 5
    `) as unknown as { id: string; title: string; deadlineAt: Date }[];
    if (!matches.length && !deadlines.length) continue;
    const items: DigestItem[] = [
      ...matches.map((m) => ({ title: m.title, body: 'Nytt denne uken', tag: `Relevans ${m.score}`, url: absoluteUrl(`/app/anbud/${m.id}`) })),
      ...deadlines.map((d) => ({
        title: d.title,
        body: null,
        tag: `Frist ${new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' }).format(d.deadlineAt)}`,
        url: absoluteUrl(`/app/anbud/${d.id}`),
      })),
    ];
    await insertNotifications([
      {
        orgId: u.orgId,
        userId: u.userId,
        type: 'weekly_summary',
        tenderId: null,
        title: `Ukesoversikt ${week}`,
        body: `${matches.length} nye relevante anbud og ${deadlines.length} kommende frister.`,
        url: '/app',
        dedupeKey: `weekly:${week}:${u.orgId}`,
      },
    ]);
    if (u.emailVerifiedAt && u.frequency !== 'off') {
      const unsubscribe = unsubscribeUrl(u.userId, u.orgId);
      const tpl = digestTemplate(`Ukesoversikt for ${u.orgName}`, 'Dette er ukens viktigste anbud og frister.', items, absoluteUrl('/app/varsler'), unsubscribe);
      await queueEmail({
        to: u.email,
        ...tpl,
        kind: 'weekly_summary',
        userId: u.userId,
        orgId: u.orgId,
        dedupeKey: `weekly:${week}:${u.orgId}:${u.userId}`,
        headers: listUnsubscribeHeaders(u.userId, u.orgId),
      });
    }
    await sql`update notifications set email_skipped = true where user_id = ${u.userId} and dedupe_key = ${`weekly:${week}:${u.orgId}`}`;
    count++;
  }
  return count;
}

/** Én full syklus: lag varsler og send e-post som er klare. */
export async function runNotificationCycle(): Promise<Record<string, number>> {
  const ents = await entitlementsByOrg();
  const prefs = await memberPrefs();
  const result = {
    savedSearch: await generateSavedSearchAlerts(ents, prefs),
    matches: await generateMatchAlerts(ents, prefs),
    deadlines: await generateDeadlineReminders(ents, prefs),
    updates: await generateUpdateAlerts(ents, prefs),
    competitors: await generateCompetitorAlerts(ents, prefs),
    trialReminders: await generateTrialReminders(),
    emails: 0,
  };
  result.emails = await dispatchNotificationEmails();
  log.info('notification_cycle', result);
  return result;
}
