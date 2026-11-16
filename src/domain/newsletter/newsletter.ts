/**
 * Ukesbrevet «Ukens anbud» – for de som vil følge med uten å lage konto.
 *
 * - Påmelding med e-post, bransje og (valgfritt) fylke. Dobbel bekreftelse: ingen ukesbrev før
 *   lenken i bekreftelses-e-posten er trykket (samtykke etter markedsføringsloven § 15).
 * - Lenkene (bekreft og avmeld) er signert med SESSION_SECRET; ingen tokens lagres.
 * - Avmelding sletter raden. Ubekreftede påmeldinger slettes etter 7 dager (applyRetention).
 * - Lages mandag fra kl. 07 (norsk tid) med nye åpne anbud fra siste uke. Ingen e-post om det
 *   ikke er noe nytt. Brevene sendes innenfor sin andel av e-postkvoten (lib/email.ts); når det er flere
 *   mottakere enn kvoten rekker, går resten dagen etter.
 * - En påmelding gjelder enten en bransje (og eventuelt et fylke) eller én oppdragsgiver («følg en oppdragsgiver»,
 *   fra oppdragsgiversiden). For en oppdragsgiver tas også kontraktene som trolig utløper med – uten leverandørnavn.
 *   Følgingen finnes bare når de offentlige oppdragsgiversidene er slått på (PUBLIC_BUYER_PAGES).
 */
import { emailSchema } from '@/domain/auth/auth';
import { isoWeek } from '@/domain/dashboard';
import { absoluteUrl, buyerNewsletterTemplate, newsletterConfirmTemplate, weeklyNewsletterTemplate, type NewsletterItem } from '@/domain/email/templates';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { industryRegionPath, industrySlugNb } from '@/domain/slugs';
import { displayBuyer } from '@/domain/tenders/market';
import { buyerPath } from '@/domain/tenders/buyer-page';
import { buyerExpiring } from '@/domain/tenders/expiring';
import { hmacHex, safeEqual, sha256Hex } from '@/lib/crypto';
import { systemSql } from '@/lib/db';
import { queueEmail, sendEmailSoon } from '@/lib/email';
import { log } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { env } from '@/lib/env';

const MAX_ITEMS = 10;

const MAX_EXPIRING = 5;
/** Samtykketeksten for å følge en oppdragsgiver (ukesbrevet har 'ukesbrev-v1', standardverdien i tabellen). */
export const BUYER_CONSENT_VERSION = 'oppdragsgiver-v1';

export interface Subscription {
  id: string;
  email: string;
  /** Bransjen – null når påmeldingen gjelder en oppdragsgiver. */
  industry: string | null;
  region: string | null;
  /** Oppdragsgiveren påmeldingen følger (navnet slik kunngjøringene skriver det, og organisasjonsnummeret). */
  buyer: { name: string; orgNumber: string } | null;
  confirmedAt: Date | null;
}

type SubscriptionRow = Omit<Subscription, 'buyer'> & { buyerName: string | null; buyerOrg: string | null };
const toSubscription = ({ buyerName, buyerOrg, ...r }: SubscriptionRow): Subscription => ({
  ...r,
  buyer: buyerName && buyerOrg ? { name: buyerName, orgNumber: buyerOrg } : null,
});

/** Temaet for en påmelding: «Vakt og sikkerhet i Trøndelag» eller oppdragsgiveren («Statsbygg»). */
export function subscriptionTopic(s: Pick<Subscription, 'industry' | 'region' | 'buyer'>): string {
  return s.buyer ? displayBuyer(s.buyer.name) : topicName(s.industry ?? '', s.region);
}

/** Den offentlige siden for temaet: bransje- eller fylkessiden, eller oppdragsgiversiden. */
export function subscriptionPath(s: Pick<Subscription, 'industry' | 'region' | 'buyer'>): string {
  return s.buyer ? buyerPath(s.buyer.name, s.buyer.orgNumber) : topicPath(s.industry ?? '', s.region);
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

/**
 * Følg en oppdragsgiver uten konto (fra oppdragsgiversiden): samme dobbel bekreftelse og samme grenser som
 * ukesbrevet. Bare norske oppdragsgivere med organisasjonsnummer – de som har en offentlig side.
 */
export async function subscribeBuyer(input: { email: string; orgNumber: string; sourcePath?: string | null; ipHash: string }): Promise<SubscribeResult> {
  if (!env.PUBLIC_BUYER_PAGES) return { ok: false, error: 'Siden finnes ikke.', status: 404 };
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return { ok: false, error: 'Skriv inn en gyldig e-postadresse.', status: 422 };
  const sql = systemSql();
  const [a] = /^\d{9}$/.test(input.orgNumber)
    ? ((await sql`select id, name from authorities where country_code = 'NO' and org_number = ${input.orgNumber}`) as unknown as { id: string; name: string }[])
    : [];
  if (!a) return { ok: false, error: 'Fant ikke oppdragsgiveren. Gå tilbake til siden og prøv igjen.', status: 422 };
  const email = parsed.data;
  if (!(await rateLimit(`newsletter:ip:${input.ipHash}`, 10, 3600)) || !(await rateLimit(`newsletter:email:${sha256Hex(email)}`, 3, 86_400))) {
    return { ok: false, error: 'For mange påmeldinger på kort tid. Prøv igjen senere.', status: 429 };
  }
  const [row] = (await sql`
    insert into newsletter_subscribers (email, authority_id, consent_version, source_path)
    values (${email}, ${a.id}, ${BUYER_CONSENT_VERSION}, ${input.sourcePath?.slice(0, 200) ?? null})
    on conflict (email, authority_id) where authority_id is not null do update set
      created_at = case when newsletter_subscribers.confirmed_at is null then now() else newsletter_subscribers.created_at end
    returning id, confirmed_at
  `) as unknown as { id: string; confirmedAt: Date | null }[];
  const topic = displayBuyer(a.name);
  // Allerede bekreftet: samme svar, men ingen ny e-post (avslører ikke hvem som er påmeldt).
  if (row && !row.confirmedAt) {
    const tpl = newsletterConfirmTemplate(topic, linkFor('confirm', row.id), { buyer: true });
    await sendEmailSoon({ to: email, ...tpl, kind: 'newsletter_confirm' });
  }
  return { ok: true, email, topic };
}

export async function confirmSubscription(id: string): Promise<Subscription | null> {
  const [row] = (await systemSql()`
    with u as (
      update newsletter_subscribers set confirmed_at = coalesce(confirmed_at, now())
      where id = ${id}
      returning id, email, industry, region, authority_id, confirmed_at
    )
    select u.id, u.email, u.industry, u.region, u.confirmed_at, a.name as buyer_name, a.org_number as buyer_org
    from u left join authorities a on a.id = u.authority_id
  `) as unknown as SubscriptionRow[];
  return row ? toSubscription(row) : null;
}

export async function findSubscription(id: string): Promise<Subscription | null> {
  const [row] = (await systemSql()`
    select s.id, s.email, s.industry, s.region, s.confirmed_at, a.name as buyer_name, a.org_number as buyer_org
    from newsletter_subscribers s left join authorities a on a.id = s.authority_id
    where s.id = ${id}
  `) as unknown as SubscriptionRow[];
  return row ? toSubscription(row) : null;
}

/** Sletter påmeldingen. Returnerer temaet, eller null om den allerede er borte. */
export async function unsubscribe(id: string): Promise<string | null> {
  const [row] = (await systemSql()`
    with d as (delete from newsletter_subscribers where id = ${id} returning id, email, industry, region, authority_id, confirmed_at)
    select d.id, d.email, d.industry, d.region, d.confirmed_at, a.name as buyer_name, a.org_number as buyer_org
    from d left join authorities a on a.id = d.authority_id
  `) as unknown as SubscriptionRow[];
  return row ? subscriptionTopic(toSubscription(row)) : null;
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
 * Legger ukesbrevet i utboksen for alle bekreftede som ikke har fått det denne uken. Kjøres hver time av
 * arbeideren; gjør bare noe mandag fra kl. 07. Samme tema hentes én gang, uansett antall mottakere.
 * Utboksen sender brevene innenfor e-postkvoten (deliverPendingEmails) – resten dagen etter.
 */
export async function sendWeeklyNewsletters(now = new Date(), force = false): Promise<number> {
  const { hour, weekday } = osloParts(now);
  if (!force && (weekday !== 'Mon' || hour < 7)) return 0;
  const sql = systemSql();
  const due = (await sql`
    select id, email, industry, region from newsletter_subscribers
    where confirmed_at is not null and industry is not null and (last_sent_at is null or last_sent_at < now() - interval '6 days')
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
  return sent + (await sendBuyerNewsletters(now, week));
}

/** Nye, åpne anbud siste 7 dager fra én oppdragsgiver, nærmeste frist først (samme utvalg som ukesbrevet). */
async function tendersFromBuyer(authorityId: string): Promise<{ rows: TenderRow[]; total: number }> {
  const rows = (await systemSql()`
    select t.id, t.title, t.buyer_name, t.deadline_at, t.estimated_value, t.currency,
      (select s.source_url from tender_sources s where s.tender_id = t.id and s.removed_at is null and s.source_url is not null
        order by (s.source = 'doffin') desc, s.fetched_at desc limit 1) as source_url,
      count(*) over () as total
    from tenders t
    where not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now() + interval '2 days'
      and t.first_seen_at > now() - interval '7 days' and t.authority_id = ${authorityId}
    order by t.deadline_at asc, t.id
    limit ${MAX_ITEMS}
  `) as unknown as (TenderRow & { total: string | number })[];
  return { rows, total: rows.length ? Number(rows[0]!.total) : 0 };
}

const monthYearFmt = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });
const BASIS_TEXT = { oppgitt: 'oppgitt i kunngjøringen', beregnet: 'beregnet fra varigheten' } as const;

/**
 * Ukens anbud for dem som følger en oppdragsgiver: nye anbud derfra siste uke, og kontraktene som trolig utløper
 * (uten leverandørnavn). Ingen e-post de ukene oppdragsgiveren ikke har lagt ut noe nytt – som ukesbrevet.
 * Stoppet når de offentlige oppdragsgiversidene er slått av (lenkene ville ikke virket).
 */
async function sendBuyerNewsletters(now: Date, week: string): Promise<number> {
  if (!env.PUBLIC_BUYER_PAGES) return 0;
  const sql = systemSql();
  const due = (await sql`
    select s.id, s.email, s.authority_id, a.name, a.org_number
    from newsletter_subscribers s join authorities a on a.id = s.authority_id
    where s.confirmed_at is not null and a.org_number is not null and (s.last_sent_at is null or s.last_sent_at < now() - interval '6 days')
    order by s.authority_id, s.id
  `) as unknown as { id: string; email: string; authorityId: string; name: string; orgNumber: string }[];
  const weekNo = Number(week.split('-W')[1]);
  const cache = new Map<string, { tenders: Awaited<ReturnType<typeof tendersFromBuyer>>; expiring: Awaited<ReturnType<typeof buyerExpiring>> }>();
  let sent = 0;
  for (const s of due) {
    if (!cache.has(s.authorityId)) {
      const tenders = await tendersFromBuyer(s.authorityId);
      cache.set(s.authorityId, { tenders, expiring: tenders.rows.length ? await buyerExpiring(s.authorityId, now) : { upcoming: 0, atLeast: false, rows: [] } });
    }
    const { tenders, expiring } = cache.get(s.authorityId)!;
    if (!tenders.rows.length) continue;
    const buyer = displayBuyer(s.name);
    const pageUrl = absoluteUrl(`${buyerPath(s.name, s.orgNumber)}?utm_source=ukesbrev`);
    const tenderUrl = (id: string, fallback: string | null) => (env.PUBLIC_TENDER_PAGES ? absoluteUrl(`/anbud/${id}?utm_source=ukesbrev`) : (fallback ?? pageUrl));
    const items: NewsletterItem[] = tenders.rows.map((r) => ({
      title: r.title,
      url: tenderUrl(r.id, r.sourceUrl),
      meta: [`Frist ${deadlineFmt.format(r.deadlineAt)}`, valueText(r.estimatedValue === null ? null : Number(r.estimatedValue), r.currency)].filter(Boolean).join(' · '),
    }));
    const expiringItems: NewsletterItem[] = expiring.rows.slice(0, MAX_EXPIRING).map((x) => ({
      title: x.title,
      url: tenderUrl(x.id, null),
      meta: `Utløper ca. ${monthYearFmt.format(x.expectedEnd)} · ${BASIS_TEXT[x.basis]}`,
    }));
    const unsubscribeUrl = linkFor('unsubscribe', s.id);
    const tpl = buyerNewsletterTemplate({
      buyer,
      week: weekNo,
      items,
      moreCount: Math.max(0, tenders.total - tenders.rows.length),
      expiring: expiringItems,
      expiringTotal: expiring.upcoming,
      pageUrl,
      signupUrl: absoluteUrl('/registrer?utm_source=ukesbrev'),
      unsubscribeUrl,
    });
    try {
      const id = await queueEmail({
        to: s.email,
        ...tpl,
        kind: 'newsletter_buyer',
        dedupeKey: `newsletter:${s.id}:${week}`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      });
      await sql`update newsletter_subscribers set last_sent_at = now() where id = ${s.id}`;
      if (id) sent++;
    } catch (err) {
      log.error('newsletter_queue_failed', { err });
    }
  }
  if (sent) log.info('newsletter_buyer_sent', { sent, week });
  return sent;
}
