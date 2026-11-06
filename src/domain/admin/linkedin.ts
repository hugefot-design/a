/**
 * «Ukens anbud» til LinkedIn: en ferdig tekst med ukens største nye anbud for en bransje og/eller
 * et fylke, laget fra databasen (offentlige kunngjøringer). Ingen AI og ingen påstander utover tallene.
 * Lenken har utm_source=linkedin, så besøkene vises under Admin → Besøk.
 */
import { absoluteUrl } from '@/domain/email/templates';
import { isoWeek } from '@/domain/dashboard';
import { INDUSTRIES, INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { industryRegionPath, industrySlugNb, regionPath, regionSlug } from '@/domain/slugs';
import { displayBuyer } from '@/domain/tenders/market';
import { systemSql } from '@/lib/db';

export interface LinkedinPost {
  text: string;
  count: number;
  topic: string;
}

const deadlineFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });
const dec = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1 });

function value(v: number | null, currency: string | null): string | null {
  if (!v || v <= 0) return null;
  const suffix = !currency || currency === 'NOK' ? 'kr' : currency;
  return v >= 1_000_000 ? `ca. ${dec.format(v / 1_000_000)} mill. ${suffix}` : `ca. ${Math.round(v).toLocaleString('nb-NO')} ${suffix}`;
}

const lowerFirst = (n: string) => (/^[A-ZÆØÅ]{2,}\b/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1));
const hashtag = (s: string) => `#${s.toLowerCase().replace(/[^a-zæøå0-9]/g, '')}`;

export async function linkedinPost(industry: string | null, region: string | null, now = new Date()): Promise<LinkedinPost> {
  const sql = systemSql();
  const ind = industry && INDUSTRY_BY_ID.has(industry) ? industry : null;
  const reg = region && REGION_BY_CODE.has(region) ? region : null;
  const industryCond = ind ? sql`and ${ind}::text = any(t.industry_ids)` : sql``;
  const regionCond = reg ? sql`and ${reg}::text = any(t.region_codes)` : sql``;
  const rows = (await sql`
    select t.title, t.buyer_name, t.deadline_at, t.estimated_value, t.currency, count(*) over () as total
    from tenders t
    where not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now() + interval '2 days'
      and t.first_seen_at > now() - interval '7 days' ${industryCond} ${regionCond}
    order by t.estimated_value desc nulls last, t.deadline_at asc, t.id
    limit 5
  `) as unknown as { title: string; buyerName: string | null; deadlineAt: Date; estimatedValue: string | number | null; currency: string | null; total: string | number }[];

  const industryName = ind ? INDUSTRY_BY_ID.get(ind)!.name : null;
  const county = reg ? REGION_BY_CODE.get(reg)!.name : null;
  const topic = [industryName ? `innen ${lowerFirst(industryName)}` : null, county ? `i ${county}` : null].filter(Boolean).join(' ') || 'i hele landet';
  const count = rows.length ? Number(rows[0]!.total) : 0;
  const path = ind && reg ? industryRegionPath(ind, reg) : ind ? `/bransjer/${industrySlugNb(ind)}` : reg ? regionPath(reg) : '/fylker';
  const link = absoluteUrl(`${path}?utm_source=linkedin`);
  const week = Number(isoWeek(now).split('-W')[1]);

  if (!count) return { text: '', count: 0, topic };

  const lines = rows.map((r, i) => {
    const meta = [r.buyerName ? displayBuyer(r.buyerName) : null, `frist ${deadlineFmt.format(r.deadlineAt)}`, value(r.estimatedValue === null ? null : Number(r.estimatedValue), r.currency)]
      .filter(Boolean)
      .join(' · ');
    return `${i + 1}. ${r.title}\n   ${meta}`;
  });
  const tags = ['#anbud', '#offentligeanbud', ind ? hashtag(industrySlugNb(ind)) : null, reg ? hashtag(regionSlug(reg)) : null].filter(Boolean);
  const text = [
    `Ukens offentlige anbud ${topic} (uke ${week})`,
    '',
    `${count === 1 ? '1 nytt anbud' : `${count} nye anbud`} siste 7 dager.${count > rows.length ? ` Her er de ${rows.length} med høyest oppgitt verdi:` : ''}`,
    '',
    ...lines,
    '',
    `Se alle åpne anbud: ${link}`,
    '',
    'Kilde: offentlige kunngjøringer fra Doffin og TED.',
    tags.join(' '),
  ].join('\n');
  return { text, count, topic };
}

/** Bransjer med flest nye anbud siste 7 dager – gode emner for ukens innlegg. */
export async function weeklyTopics(): Promise<{ id: string; name: string; n: number }[]> {
  const rows = (await systemSql()`
    select i as id, count(*)::int as n
    from tenders t, unnest(t.industry_ids) as i
    where not t.is_sample and t.lifecycle in ('competition', 'other') and t.deadline_at > now() + interval '2 days'
      and t.first_seen_at > now() - interval '7 days'
    group by i order by n desc
  `) as unknown as { id: string; n: number }[];
  const names = new Map(INDUSTRIES.map((i) => [i.id, i.name]));
  return rows.filter((r) => names.has(r.id)).map((r) => ({ id: r.id, name: names.get(r.id)!, n: r.n }));
}
