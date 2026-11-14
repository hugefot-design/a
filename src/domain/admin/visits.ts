/**
 * Besøkstelling uten informasjonskapsler og uten personopplysninger.
 *
 * Det som lagres per sidevisning: dato (norsk tid), siden (stien) og hvor besøket kom fra – enten
 * `utm_source` i lenken eller domenet i Referer-headeren, gruppert («google», «linkedin», «direkte»).
 * Ingen IP-adresse, ingen nettleserdata, ingen ID-er. Innloggede brukere og roboter telles ikke.
 * Brukes i Admin → Besøk for å se hva som gir besøk og registreringer.
 */
import { systemSql } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';

const SELF_HOST = new URL(env.APP_URL).hostname.toLowerCase().replace(/^www\./, '');

/** Søkemotorer, sosiale medier, overvåking og skript – ikke mennesker. */
const BOT_RE =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|quora link|pinterest|vkshare|whatsapp|telegram|discord|skypeuripreview|lighthouse|headless|phantomjs|python|curl\/|wget|httpclient|go-http|java\/|okhttp|axios|node-fetch|undici|uptime|pingdom|statuscake|monitor/i;

export function isBot(userAgent: string | undefined): boolean {
  return !userAgent || BOT_RE.test(userAgent);
}

const SOURCE_RULES: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
  [/(^|\.)kvasir\.no$/, 'kvasir'],
  [/(^|\.)yahoo\.[a-z.]+$/, 'yahoo'],
  [/(^|\.)ecosia\.org$/, 'ecosia'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
  [/(^|\.)facebook\.com$|^fb\.me$/, 'facebook'],
  [/^t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'x'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, 'chatgpt'],
  [/(^|\.)perplexity\.ai$/, 'perplexity'],
  [/(^|\.)doffin\.no$/, 'doffin'],
  [/^(mail|webmail|outlook)\.|(^|\.)outlook\.(com|office\.com)$/, 'e-post'],
];

/** Hvor besøket kom fra. `utm_source` i lenken går foran (f.eks. fra LinkedIn-innlegg og e-post). */
export function trafficSource(referer: string | undefined, utmSource: string | null): string {
  const utm = (utmSource ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  if (utm) return utm;
  if (!referer) return 'direkte';
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'direkte';
  }
  if (!host) return 'direkte';
  if (host === SELF_HOST) return 'intern';
  for (const [re, name] of SOURCE_RULES) if (re.test(host)) return name;
  return host.slice(0, 60);
}

/** Teller én sidevisning. Feiler aldri forespørselen. */
export async function recordPageView(path: string, source: string): Promise<void> {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  // Anbudssidene telles samlet («/anbud/*»), så tabellen ikke får én rad per anbud per dag.
  const clean = /^\/anbud\/[^/]+$/.test(trimmed) ? '/anbud/*' : trimmed;
  try {
    await systemSql()`
      insert into page_views_daily (day, path, source, views)
      values ((now() at time zone 'Europe/Oslo')::date, ${clean.slice(0, 200)}, ${source.slice(0, 60)}, 1)
      on conflict (day, path, source) do update set views = page_views_daily.views + 1
    `;
  } catch (err) {
    log.warn('page_view_failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

// ---------------------------------------------------------------------------
// Tall til admin
// ---------------------------------------------------------------------------
export interface VisitStats {
  days: { day: string; views: number; entries: number; signups: number; subscribers: number }[];
  /** Hvor besøkene kom fra (siste 30 dager), uten intern navigering. */
  sources: { label: string; n: number }[];
  /** Mest besøkte sider (siste 30 dager). */
  pages: { label: string; n: number }[];
  totals: {
    views7: number;
    entries7: number;
    google7: number;
    signups7: number;
    subscribers7: number;
    entries30: number;
    signups30: number;
  };
}

export const SOURCE_LABELS: Record<string, string> = {
  direkte: 'Direkte (skrevet inn eller bokmerke)',
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
  kvasir: 'Kvasir',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  x: 'X (Twitter)',
  instagram: 'Instagram',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  doffin: 'Doffin',
  'e-post': 'E-post',
  epost: 'E-post (våre lenker)',
  ukesbrev: 'Ukesbrevet',
};

export async function visitStats(): Promise<VisitStats> {
  const sql = systemSql();
  const days = (await sql`
    with days as (
      select generate_series((now() at time zone 'Europe/Oslo')::date - 29, (now() at time zone 'Europe/Oslo')::date, interval '1 day')::date as d
    ),
    v as (
      select day as d, sum(views)::int as views, sum(views) filter (where source <> 'intern')::int as entries
      from page_views_daily where day > (now() at time zone 'Europe/Oslo')::date - 30 group by day
    ),
    u as (
      select (created_at at time zone 'Europe/Oslo')::date as d, count(*)::int as n
      from users where created_at > now() - interval '31 days' group by 1
    ),
    s as (
      select (confirmed_at at time zone 'Europe/Oslo')::date as d, count(*)::int as n
      from newsletter_subscribers where confirmed_at > now() - interval '31 days' group by 1
    )
    select to_char(days.d, 'YYYY-MM-DD') as day, coalesce(v.views, 0)::int as views, coalesce(v.entries, 0)::int as entries,
           coalesce(u.n, 0)::int as signups, coalesce(s.n, 0)::int as subscribers
    from days left join v on v.d = days.d left join u on u.d = days.d left join s on s.d = days.d
    order by days.d
  `) as unknown as VisitStats['days'];

  const sources = (await sql`
    select source as label, sum(views)::int as n from page_views_daily
    where day > (now() at time zone 'Europe/Oslo')::date - 30 and source <> 'intern'
    group by source order by n desc limit 12
  `) as unknown as { label: string; n: number }[];

  const pages = (await sql`
    select path as label, sum(views)::int as n from page_views_daily
    where day > (now() at time zone 'Europe/Oslo')::date - 30
    group by path order by n desc limit 15
  `) as unknown as { label: string; n: number }[];

  const [g] = (await sql`
    select coalesce(sum(views), 0)::int as n from page_views_daily
    where day > (now() at time zone 'Europe/Oslo')::date - 7 and source = 'google'
  `) as unknown as { n: number }[];

  const last7 = days.slice(-7);
  const sum = (rows: VisitStats['days'], key: keyof VisitStats['days'][number]) => rows.reduce((a, r) => a + Number(r[key]), 0);
  return {
    days,
    sources: sources.map((s) => ({ label: SOURCE_LABELS[s.label] ?? s.label, n: s.n })),
    pages,
    totals: {
      views7: sum(last7, 'views'),
      entries7: sum(last7, 'entries'),
      google7: g?.n ?? 0,
      signups7: sum(last7, 'signups'),
      subscribers7: sum(last7, 'subscribers'),
      entries30: sum(days, 'entries'),
      signups30: sum(days, 'signups'),
    },
  };
}
