/**
 * Kundereisen i admin: hvor mange av dem som registrerte seg i en periode, som kom videre til hvert steg –
 * fra bekreftet e-post til betalende kunde. Bare antall, ingen personopplysninger. Administratorer og alle
 * i organisasjoner som eies av en administrator (egne tester) er ikke med.
 *
 * Hvert steg telles for seg (en kunde kan lagre et anbud uten å ha fått treff), og andelene regnes av dem
 * som registrerte seg. Største frafall er overgangen der flest ikke kommer videre.
 */
import { systemSql } from '@/lib/db';

export interface JourneyStep {
  key: string;
  label: string;
  hint: string;
  n: number;
}

export interface Journey {
  days: number | null;
  steps: JourneyStep[];
  /** Indeks til steget etter det største frafallet (null når ingen faller fra eller ingen registrerte seg). */
  biggestDrop: number | null;
  /** Sidevisninger på de offentlige sidene i perioden (ikke unike besøkende – vi bruker ikke informasjonskapsler). */
  pageViews: number;
  /** Kom tilbake minst 7 / 30 dager etter registreringen – av dem som registrerte seg for så lenge siden. */
  retention: { days: 7 | 30; eligible: number; returned: number }[];
  /**
   * Fra prøveperiode til betaling (antall brukere, som stegene): prøveperioden er over og de står på gratisplanen,
   * meldte interesse for en plan, betaler, og sa opp (Stripe).
   */
  money: { trialOverFree: number; interested: number; paying: number; cancelled: number };
  /** Hvor registreringene kom fra: siden som lenket til registreringen og kilden (google, ukesbrev …). */
  origins: { pages: { key: string; n: number }[]; sources: { key: string; n: number }[] };
}

const STEPS: Omit<JourneyStep, 'n'>[] = [
  { key: 'registered', label: 'Registrerte seg', hint: 'Laget konto' },
  { key: 'verified', label: 'Bekreftet e-posten', hint: 'Trykket på lenken i e-posten' },
  { key: 'profiled', label: 'Fylte ut bedriftsprofilen', hint: 'Bransjer og fylker – grunnlaget for treff' },
  { key: 'matched', label: 'Fikk gode treff', hint: 'Minst ett anbud med treffscore 60 eller mer' },
  { key: 'opened', label: 'Åpnet et anbud', hint: 'Så anbudssiden i appen (målt fra 14.11.2026)' },
  { key: 'assessed', label: 'Så en samlet vurdering', hint: 'Åpnet Go/No-Go-vurderingen (målt fra 14.11.2026)' },
  { key: 'saved', label: 'Lagret et anbud', hint: 'Fulgte med på minst ett anbud' },
  { key: 'bidding', label: 'Startet tilbudsarbeid', hint: 'Åpnet en arbeidsflate for et tilbud' },
  { key: 'paying', label: 'Betaler', hint: 'Aktivt abonnement i Stripe eller plan satt manuelt av admin' },
];

/** Overgangen med flest som ikke kommer videre (antall, ikke andel). Ren funksjon – testes isolert. */
export function biggestDrop(counts: number[]): number | null {
  let best: number | null = null;
  let bestLoss = 0;
  for (let i = 1; i < counts.length; i++) {
    const loss = counts[i - 1]! - counts[i]!;
    if (loss > bestLoss) {
      bestLoss = loss;
      best = i;
    }
  }
  return best;
}

export async function customerJourney(days: number | null): Promise<Journey> {
  const sql = systemSql();
  const since = days ? new Date(Date.now() - days * 86_400_000) : new Date(0);
  const cohortCte = sql`
    cohort as (
      select u.id, u.email_verified_at, u.created_at, u.signup_path, u.signup_source
      from users u
      where u.created_at >= ${since} and not u.is_platform_admin
        and not exists (
          select 1 from organization_members m
          join organization_members own on own.org_id = m.org_id and own.role = 'owner'
          join users a on a.id = own.user_id and a.is_platform_admin
          where m.user_id = u.id
        )
    ),
    member_orgs as (
      select c.id as user_id, m.org_id from cohort c join organization_members m on m.user_id = c.id
    )
  `;
  const used = (feature: string) => sql`(select count(distinct mo.user_id) from member_orgs mo
    where exists (select 1 from feature_first_use f where f.org_id = mo.org_id and f.feature = ${feature}))::int`;
  const back = (n: number) => sql`(select count(*) from cohort c where c.created_at <= now() - make_interval(days => ${n})
    and exists (select 1 from user_active_days d where d.user_id = c.id and d.day >= (c.created_at at time zone 'Europe/Oslo')::date + ${n}::int))::int`;
  const [row] = (await sql`
    with ${cohortCte}
    select
      (select count(*) from cohort)::int as registered,
      (select count(*) from cohort where email_verified_at is not null)::int as verified,
      (select count(distinct mo.user_id) from member_orgs mo
         join company_profiles p on p.org_id = mo.org_id where p.onboarding_completed_at is not null)::int as profiled,
      (select count(distinct mo.user_id) from member_orgs mo
         where exists (select 1 from match_results r where r.org_id = mo.org_id and not r.excluded and r.score >= 60))::int as matched,
      ${used('tender_viewed')} as opened,
      ${used('intelligence_viewed')} as assessed,
      (select count(distinct mo.user_id) from member_orgs mo
         where exists (select 1 from bookmarks b where b.org_id = mo.org_id))::int as saved,
      (select count(distinct mo.user_id) from member_orgs mo
         where exists (select 1 from bid_workspaces w where w.org_id = mo.org_id))::int as bidding,
      (select count(distinct mo.user_id) from member_orgs mo
         join subscriptions s on s.org_id = mo.org_id
         where (s.source = 'stripe' and s.status in ('active', 'trialing', 'past_due')) or (s.source = 'manual' and s.status = 'active' and s.plan <> 'free'))::int as paying,
      ${used('plan_interest')} as interested,
      (select count(distinct mo.user_id) from member_orgs mo
         join subscriptions s on s.org_id = mo.org_id
         where s.source = 'stripe' and (s.status = 'canceled' or s.cancel_at_period_end))::int as cancelled,
      (select count(distinct mo.user_id) from member_orgs mo
         join subscriptions s on s.org_id = mo.org_id
         where s.source = 'trial' and s.trial_ends_at < now())::int as trial_over_free,
      (select count(*) from cohort where created_at <= now() - interval '7 days')::int as eligible7,
      ${back(7)} as back7,
      (select count(*) from cohort where created_at <= now() - interval '30 days')::int as eligible30,
      ${back(30)} as back30,
      (select coalesce(sum(views), 0) from page_views_daily where day >= (${since}::timestamptz at time zone 'Europe/Oslo')::date)::int as page_views
  `) as unknown as Record<string, number>[];
  const group = async (col: 'signup_path' | 'signup_source') =>
    (await sql`
      with ${cohortCte}
      select case when ${sql(col)} like '/anbud/%' then '/anbud/*' else coalesce(${sql(col)}, '(ikke registrert)') end as key, count(*)::int as n
      from cohort group by 1 order by n desc, key limit 10
    `) as unknown as { key: string; n: number }[];
  const [pages, sources] = await Promise.all([group('signup_path'), group('signup_source')]);
  const r = row ?? {};
  const steps = STEPS.map((s) => ({ ...s, n: r[s.key] ?? 0 }));
  return {
    days,
    steps,
    biggestDrop: biggestDrop(steps.map((s) => s.n)),
    pageViews: r.pageViews ?? 0,
    retention: [
      { days: 7, eligible: r.eligible7 ?? 0, returned: r.back7 ?? 0 },
      { days: 30, eligible: r.eligible30 ?? 0, returned: r.back30 ?? 0 },
    ],
    money: { trialOverFree: r.trialOverFree ?? 0, interested: r.interested ?? 0, paying: r.paying ?? 0, cancelled: r.cancelled ?? 0 },
    origins: { pages, sources },
  };
}
