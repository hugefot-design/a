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
}

const STEPS: Omit<JourneyStep, 'n'>[] = [
  { key: 'registered', label: 'Registrerte seg', hint: 'Laget konto' },
  { key: 'verified', label: 'Bekreftet e-posten', hint: 'Trykket på lenken i e-posten' },
  { key: 'profiled', label: 'Fylte ut bedriftsprofilen', hint: 'Bransjer og fylker – grunnlaget for treff' },
  { key: 'matched', label: 'Fikk gode treff', hint: 'Minst ett anbud med treffscore 60 eller mer' },
  { key: 'saved', label: 'Lagret et anbud', hint: 'Fulgte med på minst ett anbud' },
  { key: 'bidding', label: 'Startet tilbudsarbeid', hint: 'Åpnet en arbeidsflate for et tilbud' },
  { key: 'paying', label: 'Betaler', hint: 'Aktivt abonnement i Stripe' },
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
  const [row] = (await sql`
    with cohort as (
      select u.id, u.email_verified_at
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
    select
      (select count(*) from cohort)::int as registered,
      (select count(*) from cohort where email_verified_at is not null)::int as verified,
      (select count(distinct mo.user_id) from member_orgs mo
         join company_profiles p on p.org_id = mo.org_id where p.onboarding_completed_at is not null)::int as profiled,
      (select count(distinct mo.user_id) from member_orgs mo
         where exists (select 1 from match_results r where r.org_id = mo.org_id and not r.excluded and r.score >= 60))::int as matched,
      (select count(distinct mo.user_id) from member_orgs mo
         where exists (select 1 from bookmarks b where b.org_id = mo.org_id))::int as saved,
      (select count(distinct mo.user_id) from member_orgs mo
         where exists (select 1 from bid_workspaces w where w.org_id = mo.org_id))::int as bidding,
      (select count(distinct mo.user_id) from member_orgs mo
         join subscriptions s on s.org_id = mo.org_id
         where s.source = 'stripe' and s.status in ('active', 'trialing', 'past_due'))::int as paying
  `) as unknown as Record<string, number>[];
  const steps = STEPS.map((s) => ({ ...s, n: row?.[s.key] ?? 0 }));
  return { days, steps, biggestDrop: biggestDrop(steps.map((s) => s.n)) };
}
