/**
 * Ukesbrevet «Ukens anbud» – for de som vil følge med uten å lage konto.
 *
 * - Påmelding med e-post, bransje og (valgfritt) fylke. Dobbel bekreftelse: ingen ukesbrev før
 *   lenken i bekreftelses-e-posten er trykket (samtykke etter markedsføringsloven § 15).
 * - Lenkene (bekreft og avmeld) er signert med SESSION_SECRET; ingen tokens lagres.
 * - Avmelding sletter raden. Ubekreftede påmeldinger slettes etter 7 dager (applyRetention).
 * - Sendes mandag fra kl. 07 (norsk tid) med nye åpne anbud fra siste uke. Ingen e-post om det
 *   ikke er noe nytt.
 */
import { emailSchema } from '@/domain/auth/auth';
import { isoWeek } from '@/domain/dashboard';
import { absoluteUrl, newsletterConfirmTemplate, weeklyNewsletterTemplate, type NewsletterItem } from '@/domain/email/templates';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { industryRegionPath, industrySlugNb } from '@/domain/slugs';
import { displayBuyer } from '@/domain/tenders/market';
import { hmacHex, safeEqual, sha256Hex } from '@/lib/crypto';
import { systemSql } from '@/lib/db';
import { queueEmail, sendEmailSoon } from '@/lib/email';
import { log } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';

const MAX_ITEMS = 10;

export interface Subscription {
  id: string;
  email: string;
  industry: string;
  region: string | null;
  confirmedAt: Date | null;
}

/** «Vakt og sikkerhet i Trøndelag» / «Vakt og sikkerhet (hele landet)». */
export function topicName(industry: string, region: string | null): string {
  const name = INDUSTRY_BY_ID.get(industry)?.name ?? industry;
  const county = region ? REGION_BY_CODE.get(region)?.name : null;
  return county ? `${name} i ${county}` : `${name} (hele landet)`;
}

/** Den offentlige siden med alle åpne anbud for temaet. */
export function topicPath(industry: string, region: string | null): string {
  return region ? industryRegionPath(industry, region) : `/bransjer/${industrySlugNb(industry)}`;
}

// ---------------------------------------------------------------------------
// Signerte lenker
// ---------------------------------------------------------------------------
type Purpose = 'confirm' | 'unsubscribe';
const sign = (purpose: Purpose, id: string) => hmacHex(`newsletter:${purpose}:${id}`).slice(0, 40);

export function linkFor(purpose: Purpose, id: string): string {
  const path = purpose === 'confirm' ? '/ukesbrev/bekreft' : '/ukesbrev/avmeld';
  return absoluteUrl(`${path}?id=${encodeURIComponent(id)}&t=${sign(purpose, id)}`);
}

export function verifyLink(purpose: Purpose, id: string | null, token: string | null): string | null {
  if (!id || !token || !/^[0-9a-f-]{36}$/.test(id) || token.length !== 40) return null;
  return safeEqual(token, sign(purpose, id)) ? id : null;
}

// ---------------------------------------------------------------------------
// Påmelding, bekreftelse, avmelding
// ---------------------------------------------------------------------------
export type SubscribeResult = { ok: true; email: string; topic: string } | { ok: false; error: string; status: number };

export async function subscribe(input: { email: string; industry: string; region: string | null; sourcePath?: string | null; ipHash: string }): Promise<SubscribeResult> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return { ok: false, error: 'Skriv inn en gyldig e-postadresse.', status: 422 };
  if (!INDUSTRY_BY_ID.has(input.industry)) return { ok: false, error: 'Velg en bransje.', status: 422 };
  const region = input.region && REGION_BY_CODE.has(input.region) ? input.region : null;
  const email = parsed.data;
  // Hindrer at skjemaet brukes til å sende mange e-poster til noen andre.
  if (!(await rateLimit(`newsletter:ip:${input.ipHash}`, 10, 3600)) || !(await rateLimit(`newsletter:email:${sha256Hex(email)}`, 3, 86_400))) {
    return { ok: false, error: 'For mange påmeldinger på kort tid. Prøv igjen senere.', status: 429 };
  }
  const sql = systemSql();
  const [row] = (await sql`
    insert into newsletter_subscribers (email, industry, region, source_path)
    values (${email}, ${input.industry}, ${region}, ${input.sourcePath?.slice(0, 200) ?? null})
    on conflict (email, industry, (coalesce(region, ''))) do update set
      created_at = case when newsletter_subscribers.confirmed_at is null then now() else newsletter_subscribers.created_at end
    returning id, confirmed_at
  `) as unknown as { id: string; confirmedAt: Date | null }[];
  const topic = topicName(input.industry, region);
  // Allerede bekreftet: samme svar, men ingen ny e-post (avslører ikke hvem som er påmeldt).
  if (row && !row.confirmedAt) {
    const tpl = newsletterConfirmTemplate(topic, linkFor('confirm', row.id));
    await sendEmailSoon({ to: email, ...tpl, kind: 'newsletter_confirm' });
  }
  return { ok: true, email, topic };
}

export async function confirmSubscription(id: string): Promise<Subscription | null> {
  const [row] = (await systemSql()`
    update newsletter_subscribers set confirmed_at = coalesce(confirmed_at, now())
    where id = ${id}
    returning id, email, industry, region, confirmed_at
  `) as unknown as Subscription[];
  return row ?? null;
}

export async function findSubscription(id: string): Promise<Subscription | null> {
  const [row] = (await systemSql()`select id, email, industry, region, confirmed_at from newsletter_subscribers where id = ${id}`) as unknown as Subscription[];
  return row ?? null;
}

/** Sletter påmeldingen. Returnerer temaet, eller null om den allerede er borte. */
export async function unsubscribe(id: string): Promise<string | null> {
  const [row] = (await systemSql()`delete from newsletter_subscribers where id = ${id} returning industry, region`) as unknown as { industry: string; region: string | null }[];
  return row ? topicName(row.industry, row.region) : null;
}

// ---------------------------------------------------------------------------
// Ukentlig utsending
// ---------------------------------------------------------------------------
function osloParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', weekday: 'short', hour12: false }).formatToParts(now);
  return { hour: Number(parts.find((p) => p.type === 'hour')?.value ?? '0'), weekday: parts.find((p) => p.type === 'weekday')?.value ?? '' };
}

const deadlineFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });
const moneyFmt = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });

function valueText(v: number | null, currency: string | null): string | null {
  if (!v || v <= 0) return null;
  const suffix = !currency || currency === 'NOK' ? 'kr' : currency;
  if (v >= 1_000_000) return `ca. ${moneyFmt.format(v / 1_000_000)} mill. ${suffix}`;
  return `ca. ${Math.round(v).toLocaleString('nb-NO')} ${suffix}`;
}

interface TenderRow {
  id: string;
  title: string;
  buyerName: string | null;
  deadlineAt: Date;
  estimatedValue: string | number | null;
  currency: string | null;
  sourceUrl: string | null;
}

/** Nye, åpne anbud siste 7 dager for ett tema, nærmeste frist først. */
async function tendersFor(industry: string, region: string | null): Promise<{ rows: TenderRow[]; total: number }> {
  const sql = systemSql();
  const regionCond = region ? sql`and ${region}::text = any(t.region_codes)` : sql``;
  const rows = (await sql`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.estimated_value, t.currency,
      (select s.source_url from tender_sources s where s.tender_id = t.id and s.removed_at is null and s.source_url is not null
        order by (s.source = 'doffin') desc, s.fetched_at desc limit 1) as source_url,
      count(*) over () as total
    from tenders t
    where not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now() + interval '2 days'
      and t.first_seen_at > now() - interval '7 days'
      and ${industry}::text = any(t.industry_ids) ${regionCond}
    order by t.deadline_at asc, t.id
    limit ${MAX_ITEMS}
  `) as unknown as (TenderRow & { total: string | number })[];
  return { rows, total: rows.length ? Number(rows[0]!.total) : 0 };
}

/**
 * Sender ukesbrevet til alle bekreftede som ikke har fått det denne uken. Kjøres hver time av
 * arbeideren; gjør bare noe mandag fra kl. 07. Samme tema hentes én gang, uansett antall mottakere.
 */
export async function sendWeeklyNewsletters(now = new Date(), force = false): Promise<number> {
  const { hour, weekday } = osloParts(now);
  if (!force && (weekday !== 'Mon' || hour < 7)) return 0;
  const sql = systemSql();
  const due = (await sql`
    select id, email, industry, region from newsletter_subscribers
    where confirmed_at is not null and (last_sent_at is null or last_sent_at < now() - interval '6 days')
    order by industry, region nulls first, id
  `) as unknown as { id: string; email: string; industry: string; region: string | null }[];
  const week = isoWeek(now);
  const weekNo = Number(week.split('-W')[1]);
  const cache = new Map<string, Awaited<ReturnType<typeof tendersFor>>>();
  let sent = 0;
  for (const s of due) {
    const key = `${s.industry}|${s.region ?? ''}`;
    if (!cache.has(key)) cache.set(key, await tendersFor(s.industry, s.region));
    const { rows, total } = cache.get(key)!;
    if (!rows.length) continue;
    const listUrl = absoluteUrl(`${topicPath(s.industry, s.region)}?utm_source=ukesbrev`);
    // Hver sak lenker til vår side for anbudet (krav, risiko og «se om det passer dere»), med kilden derfra.
    const items: NewsletterItem[] = rows.map((r) => ({
      title: r.title,
      url: env.PUBLIC_TENDER_PAGES ? absoluteUrl(`/anbud/${r.id}?utm_source=ukesbrev`) : (r.sourceUrl ?? listUrl),
      meta: [r.buyerName ? displayBuyer(r.buyerName) : null, `Frist ${deadlineFmt.format(r.deadlineAt)}`, valueText(r.estimatedValue === null ? null : Number(r.estimatedValue), r.currency)]
        .filter(Boolean)
        .join(' · '),
    }));
    const unsubscribeUrl = linkFor('unsubscribe', s.id);
    const tpl = weeklyNewsletterTemplate({
      topic: topicName(s.industry, s.region),
      week: weekNo,
      items,
      moreCount: Math.max(0, total - rows.length),
      listUrl,
      signupUrl: absoluteUrl('/registrer?utm_source=ukesbrev'),
      unsubscribeUrl,
    });
    try {
      const id = await queueEmail({
        to: s.email,
        ...tpl,
        kind: 'newsletter_weekly',
        dedupeKey: `newsletter:${s.id}:${week}`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      await sql`update newsletter_subscribers set last_sent_at = now() where id = ${s.id}`;
      if (id) sent++;
    } catch (err) {
      log.error('newsletter_queue_failed', { err });
    }
  }
  if (sent) log.info('newsletter_sent', { sent, week });
  return sent;
}
