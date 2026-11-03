/**
 * eInnsyn (Digdir): politiske møtesaker fra kommuner, fylker og staten – et signal om fremtidige
 * prosjekter før de blir anbud (Future Opportunities). Åpent API uten nøkkel: https://api.einnsyn.no
 *
 * Presisjon foran mengde:
 * - Bare møtesaker av typen «politisk» (ikke referatsaker). Saksmapper er utelatt – de er
 *   for det meste personal-, tilskudds- og klagesaker (verifisert mot ekte data 3.11.2026).
 * - Tittelen må tyde på et prosjekt eller en anskaffelse (se classifyTitle). Vi viser hvilke ord
 *   som traff, så brukeren ser hvorfor saken er tatt med. Ingen AI, ingen gjetning om verdi eller dato.
 * - Samme sak behandles ofte i flere utvalg; den lagres én gang per organ og tittel.
 * - Fylke kommer fra organets kommunenummer (de to første sifrene er fylkesnummeret).
 * - Høflig mot API-et: én forespørsel om gangen, pause mellom kallene og et tak per kjøring.
 */
import { createHash } from 'node:crypto';
import { systemSql } from '@/lib/db';
import { log } from '@/lib/logger';
import { INDUSTRIES, REGIONS } from '@/domain/reference';

export const EINNSYN_API = 'https://api.einnsyn.no';
/** Enhetsregisteret (Brønnøysundregistrene), åpent API uten nøkkel – brukes bare til kommunenummer. */
export const BRREG_API = 'https://data.brreg.no/enhetsregisteret/api/enheter';
const USER_AGENT = 'AnbudRadar/1.0 (+https://anbudradar.com)';
const REGION_CODES = new Set(REGIONS.map((r) => r.code));

/** Søkeord vi henter møtesaker for. Tittelen filtreres lokalt etterpå. */
export const EINNSYN_QUERIES = [
  'konkurranseutsetting',
  'anskaffelse',
  'byggeprosjekt',
  'investeringsprosjekt',
  'forprosjekt',
  'skisseprosjekt',
  'ny skole',
  'barnehage',
  'sykehjem',
  'omsorgsboliger',
  'idrettshall',
  'svømmehall',
  'rehabilitering',
  'vann og avløp',
  'brannstasjon',
  'ferje',
];

const L = '\\p{L}';
/** Ord som alene tyder på en kommende anskaffelse eller et prosjekt. */
const STRONG = new RegExp(
  `(?<!${L})(konkurranseutsett${L}*|anskaffels${L}*|utlysning${L}*|totalentrepris${L}*|byggeprosjekt${L}*|investeringsprosjekt${L}*|forprosjekt${L}*|skisseprosjekt${L}*|prosjekteringskonkurrans${L}*|rammeavtal${L}*)`,
  'giu',
);
/** Handling + objekt: «bygging av ny skole», «rehabilitering av svømmehall» … */
const ACTION = new RegExp(
  `(?<!${L})(nye?|nytt|bygging|nybygg${L}*|utbygging|tilbygg${L}*|påbygg${L}*|ombygging|rehabilitering|oppgradering|utvidelse|riving|investering${L}*|finansiering|realisering|etablering)(?!${L})`,
  'giu',
);
const OBJECT = new RegExp(
  `(${L}*skole|${L}*skule|barnehage${L}*|sykehjem${L}*|omsorgsbolig${L}*|helsehus${L}*|legevakt${L}*|${L}*hall(?!${L})|svømme${L}*|basseng${L}*|kulturhus${L}*|bibliotek${L}*|brannstasjon${L}*|rådhus${L}*|administrasjonsbygg${L}*|(?<!${L})veg(?!${L})|(?<!${L})vei(?!${L})|${L}+veg(?!${L})|${L}+vei(?!${L})|gang- og sykkel${L}*|fortau${L}*|(?<!${L})bru(?!${L})|tunnel${L}*|kaianlegg${L}*|havn${L}*|vannverk${L}*|vannforsyning${L}*|avløp${L}*|renseanlegg${L}*|overvann${L}*|fjernvarme${L}*|ladestasjon${L}*|parkeringshus${L}*|idrettsanlegg${L}*|kunstgress${L}*|ferje${L}*|ferge${L}*|båtrute${L}*|kollektiv${L}*|renovasjon${L}*|avfall${L}*|gjenvinning${L}*|sykehus${L}*|helsebygg${L}*|(?<!${L})boliger(?!${L}))`,
  'giu',
);
/** Saker som omtaler noe, men ikke er et vedtak om å gjøre noe. */
const EXCLUDE = new RegExp(
  `(?<!${L})(høring${L}*|spørsmål|interpellasjon|referat${L}*|orientering${L}*|presentasjon${L}*|regnskap${L}*|årsmelding${L}*|tertial${L}*|budsjettkontroll|klage${L}*|dispensasjon${L}*|salg|søknad${L}*|oversendelse${L}*|uttalelse${L}*|innspill|navnsetting|navnevalg|sluttrapport|prosjektavslutning|avslutning|forskrift|instruks|reglement|retningslinje${L}*|tilskudd|private barnehager|festeavtale|leieavtale)(?!${L})`,
  'iu',
);

/** Ord i tittelen som peker mot en bransje (i tillegg til bransjenes egne nøkkelord). */
const OBJECT_INDUSTRIES: [RegExp, string[]][] = [
  [/(skole|skule|barnehage|sykehjem|omsorgsbolig|helsehus|legevakt|svømme|basseng|kulturhus|bibliotek|brannstasjon|rådhus|bygg|boliger|idrettsanlegg|kunstgress|parkeringshus)|hall(?!\p{L})/iu, ['construction']],
  [/(?<!\p{L})(vei|veg|bru)(?!\p{L})|\p{L}(vei|veg)(?!\p{L})|(?<!\p{L})fv\.|fylkesve|riksve|utbetring|gang- og sykkel|fortau|tunnel|kaianlegg|(?<!\p{L})havn/iu, ['construction']],
  [/vannverk|vannforsyning|avløp|renseanlegg|overvann/iu, ['construction', 'environmental']],
  [/ferje|ferge|båtrute|kollektiv|(?<!\p{L})buss|elbil|kjøretøy/iu, ['transport']],
  [/renovasjon|avfall|gjenvinning/iu, ['environmental']],
  [/(?<!\p{L})(helse|omsorg|velferd|habilitering|sykehus)/iu, ['healthcare']],
  [/fjernvarme|ladestasjon|(?<!\p{L})energi|solcelle/iu, ['energy']],
  [/renhold/iu, ['cleaning']],
];

export interface TitleClass {
  include: boolean;
  terms: string[];
  industries: string[];
}

/** Ren funksjon: tyder tittelen på et fremtidig prosjekt/anskaffelse? Og hvilke bransjer? */
export function classifyTitle(rawTitle: string): TitleClass {
  const title = rawTitle.replace(/\s+/g, ' ').trim();
  const strong = [...title.matchAll(STRONG)].map((m) => m[0].toLowerCase());
  const actions = [...title.matchAll(ACTION)].map((m) => m[0].toLowerCase());
  const objects = [...title.matchAll(OBJECT)].map((m) => m[0].toLowerCase());
  const excluded = EXCLUDE.test(title);
  const include = !excluded && (strong.length > 0 || (actions.length > 0 && objects.length > 0));
  const terms = [...new Set([...strong, ...(actions.length && objects.length ? [...actions, ...objects] : [])])].slice(0, 6);
  const lower = title.toLowerCase();
  const industries = new Set<string>();
  for (const [re, ids] of OBJECT_INDUSTRIES) if (re.test(lower)) ids.forEach((i) => industries.add(i));
  for (const ind of INDUSTRIES) if (ind.keywords.some((k) => k.length >= 4 && new RegExp(`(?<!${L})${k}`, 'iu').test(lower))) industries.add(ind.id);
  return { include, terms, industries: [...industries].sort() };
}

export interface EinnsynItem {
  id: string;
  entity?: string;
  offentligTittel?: string;
  moetesakstype?: string;
  publisertDato?: string;
  journalenhet?: string;
}

export interface EinnsynUnit {
  id: string;
  name: string;
  orgNumber: string | null;
  kommunenummer: string | null;
  parentId: string | null;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(fetchImpl: FetchLike, url: string): Promise<Record<string, unknown>> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`eInnsyn svarte ${res.status} for ${new URL(url).pathname}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Organ (journalenhet) med mellomlager i databasen. */
async function unitFor(fetchImpl: FetchLike, id: string, budget: { calls: number; brreg: number }): Promise<EinnsynUnit | null> {
  const sql = systemSql();
  const [cached] = (await sql`
    select id, name, org_number, kommunenummer, parent_id from einnsyn_units where id = ${id} and fetched_at > now() - interval '30 days'
  `) as unknown as EinnsynUnit[];
  if (cached) return cached;
  if (budget.calls <= 0) return null;
  budget.calls--;
  const d = await getJson(fetchImpl, `${EINNSYN_API}/enhet/${encodeURIComponent(id)}`);
  const unit: EinnsynUnit = {
    id,
    name: String(d.navn ?? '').slice(0, 300) || 'Ukjent organ',
    orgNumber: typeof d.orgnummer === 'string' ? d.orgnummer : null,
    kommunenummer: typeof d.kommunenummer === 'string' ? d.kommunenummer : null,
    parentId: typeof d.parent === 'string' ? d.parent : null,
  };
  await sql`
    insert into einnsyn_units (id, name, org_number, kommunenummer, parent_id) values (${unit.id}, ${unit.name}, ${unit.orgNumber}, ${unit.kommunenummer}, ${unit.parentId})
    on conflict (id) do update set name = excluded.name, org_number = excluded.org_number, kommunenummer = excluded.kommunenummer,
      parent_id = excluded.parent_id, fetched_at = now()
  `;
  return unit;
}

/** Fylke, navn og org.nr. for et organ – går opp til overordnet organ (f.eks. bydel → kommune). */
export async function publisherInfo(fetchImpl: FetchLike, unitId: string, budget: { calls: number; brreg: number }) {
  const chain: EinnsynUnit[] = [];
  let id: string | null = unitId;
  for (let i = 0; i < 3 && id; i++) {
    const u = await unitFor(fetchImpl, id, budget);
    if (!u) break;
    chain.push(u);
    id = u.parentId;
  }
  const first = chain[0];
  let knr = chain.find((u) => u.kommunenummer)?.kommunenummer ?? null;
  // eInnsyn oppgir ikke alltid kommunenummer. Brønnøysundregistrene (åpent API) har det for org.nr.
  if (!knr && first?.orgNumber && budget.brreg > 0) {
    budget.brreg--;
    try {
      const d = await getJson(fetchImpl, `${BRREG_API}/${encodeURIComponent(first.orgNumber)}`);
      const fromBrreg = (d.forretningsadresse as { kommunenummer?: string } | undefined)?.kommunenummer ?? null;
      if (fromBrreg && /^\d{4}$/.test(fromBrreg)) {
        knr = fromBrreg;
        await systemSql()`update einnsyn_units set kommunenummer = ${knr} where id = ${first.id}`;
      }
    } catch (err) {
      log.warn('brreg_lookup_failed', { orgNumber: first.orgNumber, message: (err as Error).message });
    }
  }
  let region = knr && REGION_CODES.has(knr.slice(0, 2)) ? knr.slice(0, 2) : null;
  if (!region) {
    // Fylkeskommuner har ikke kommunenummer – bruk fylkesnavnet i organets navn.
    const named = REGIONS.find((r) => chain.some((u) => u.name.toLowerCase().includes(r.name.toLowerCase())));
    region = named?.code ?? null;
  }
  return {
    name: first?.name ?? null,
    orgNumbers: [...new Set(chain.map((u) => u.orgNumber).filter((n): n is string => Boolean(n)))],
    regionCodes: region ? [region] : [],
  };
}

export interface EinnsynRunResult {
  calls: number;
  seen: number;
  stored: number;
  skipped: number;
}

/**
 * Henter nye politiske møtesaker og lagrer dem som signaler. Kjøres av bakgrunnsjobben et par ganger
 * i døgnet. `since` er standard siste vellykkede kjøring minus to dager (første gang: 45 dager).
 */
export async function ingestEinnsyn(opts: { fetchImpl?: FetchLike; maxCalls?: number; delayMs?: number; now?: Date } = {}): Promise<EinnsynRunResult> {
  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? new Date();
  const sql = systemSql();
  const budget = { calls: opts.maxCalls ?? 40, brreg: 30 };
  const delay = opts.delayMs ?? 250;
  const [source] = (await sql`select enabled, last_success_at from opportunity_sources where id = 'einnsyn'`) as unknown as {
    enabled: boolean;
    lastSuccessAt: Date | null;
  }[];
  const result: EinnsynRunResult = { calls: 0, seen: 0, stored: 0, skipped: 0 };
  if (!source?.enabled) return result;
  const since = new Date(Math.min(now.getTime() - 2 * 86_400_000, (source.lastSuccessAt ?? new Date(now.getTime() - 45 * 86_400_000)).getTime() - 2 * 86_400_000));
  const sinceDay = since.toISOString().slice(0, 10);
  await sql`update opportunity_sources set last_run_at = now() where id = 'einnsyn'`;
  try {
    for (const query of EINNSYN_QUERIES) {
      if (budget.calls <= 0) break;
      const params = new URLSearchParams({ query, entity: 'Moetesak', limit: '50', sortBy: 'publisertDato', sortOrder: 'desc', publisertDatoFrom: sinceDay });
      budget.calls--;
      result.calls++;
      const page = await getJson(fetchImpl, `${EINNSYN_API}/search?${params}`);
      const items = (Array.isArray(page.items) ? page.items : []) as EinnsynItem[];
      for (const item of items) {
        result.seen++;
        const title = (item.offentligTittel ?? '').replace(/\s+/g, ' ').trim();
        if (!item.id || !title || (item.moetesakstype && item.moetesakstype !== 'politisk')) {
          result.skipped++;
          continue;
        }
        const c = classifyTitle(title);
        if (!c.include || !item.journalenhet) {
          result.skipped++;
          continue;
        }
        const pub = await publisherInfo(fetchImpl, item.journalenhet, budget);
        const ref = `${item.journalenhet}:${createHash('sha1').update(title.toLowerCase()).digest('hex').slice(0, 20)}`;
        const publishedAt = item.publisertDato ? new Date(item.publisertDato) : null;
        const rows = await sql`
          insert into opportunity_signals (source, source_ref, country_code, kind, title, publisher, publisher_org_numbers, region_codes,
            industry_ids, matched_terms, published_at, url)
          values ('einnsyn', ${ref}, 'NO', 'political_case', ${title.slice(0, 1000)}, ${pub.name}, ${pub.orgNumbers}::text[], ${pub.regionCodes}::text[],
            ${c.industries}::text[], ${c.terms}::text[], ${publishedAt}, ${`https://einnsyn.no/moetesak/${encodeURIComponent(item.id)}`})
          on conflict (source, source_ref) do update set
            published_at = greatest(opportunity_signals.published_at, excluded.published_at),
            url = case when excluded.published_at > coalesce(opportunity_signals.published_at, '-infinity') then excluded.url else opportunity_signals.url end
          returning (xmax = 0) as inserted
        `;
        if ((rows[0] as { inserted?: boolean } | undefined)?.inserted) result.stored++;
      }
      if (delay) await sleep(delay);
    }
    await sql`update opportunity_sources set last_success_at = now(), last_error = null, updated_at = now() where id = 'einnsyn'`;
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await sql`update opportunity_sources set last_error_at = now(), last_error = ${message}, updated_at = now() where id = 'einnsyn'`;
    log.warn('einnsyn_failed', { message });
    throw err;
  }
  log.info('einnsyn_ingested', { ...result });
  return result;
}
