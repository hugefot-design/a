/**
 * Doffin – den norske nasjonale kunngjøringsdatabasen (driftes av DFØ).
 *
 * Bruker Doffins OFFENTLIGE API v2 (gratis abonnementsnøkkel fra Doffins API-portal).
 * Vi bruker IKKE nettsidens interne API-er eller skraping.
 *   GET {DOFFIN_API_BASE_URL}/search?...   header: Ocp-Apim-Subscription-Key
 *
 * Kilder for oppførselen under:
 *  - Doffins API-portal (dof-notices-prod-api.developer.azure-api.net, lest 1.11.2026):
 *    feltene i PublicNoticeHitDto, typeverdiene (EFormType), statusverdiene (EFormStatusEnum),
 *    maks 100 treff per side og maks 30 søk per minutt per abonnement (HTTP 429 + Retry-After).
 *  - Uavhengige prosjekter som har testet API-et live (okt. 2026): `page` er 1-basert
 *    (page=0 gir HTTP 400), maks 10 sider (1 000 treff) per søk, `status` er bare satt på
 *    konkurransekunngjøringer, og `deadline` på resultatkunngjøringer er IKKE en tilbudsfrist.
 *
 * Dette er IKKE verifisert av oss mot live API (krever nøkkel). Kjør
 *   npm run ingest -- --source doffin --dry-run --limit 20
 * med nøkkel før første ekte henting (se docs/INTEGRASJONER.md).
 *
 * Nedlasting av én kunngjøring (eForms-XML) per Doffin-ID:
 *   GET {DOFFIN_API_BASE_URL}/download/{doffinId}     header: Ocp-Apim-Subscription-Key
 * API-portalen (lest 2.11.2026): maks 10 kall per minutt per abonnement, HTTP 429 med Retry-After,
 * 200 = «The downloaded notice» (application/octet-stream), 404 = ikke funnet. Formatet på svaret er
 * IKKE verifisert mot live API – vi gjenkjenner XML, ZIP med XML og JSON og sier fra om noe annet.
 *   npm run ingest -- --source doffin --id 2026-123456 --dry-run
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { env } from '@/lib/env';
import { dbSlots, type SlotProvider } from '@/lib/api-slots';
import {
  cleanCpv,
  cleanNutsCodes,
  cleanOrgNumber,
  mostSpecificCpv,
  parseSourceDateTime,
  stripHtml,
  type Lifecycle,
  type NormalizedNotice,
  type NoticeAward,
  type NoticeLot,
} from '@/domain/tenders/normalize';
import { backoffMs, ConnectorError, fetchWithRetry, retryAfterMs, sleep, type FetchWindow, type SourceConnector } from './types';
import { EformsError, eformsToNotice, parseEformsXml } from './eforms';

interface DoffinOrg {
  id?: string;
  organizationId?: string;
  name?: string;
}

export interface DoffinHit {
  id: string;
  buyer?: DoffinOrg[] | null;
  heading?: string | null;
  description?: string | null;
  locationId?: string[] | null;
  estimatedValue?: { currencyCode?: string; amount?: number } | null;
  type?: string | null;
  allTypes?: string[] | null;
  status?: string | null;
  issueDate?: string | null;
  deadline?: string | null;
  publicationDate?: string | null;
  receivedTenders?: number | null;
  cpvCodes?: string[] | null;
  lots?: { heading?: string | null; description?: string | null; winner?: DoffinOrg[] | null }[] | null;
}

export interface DoffinSearchResponse {
  numHitsTotal?: number;
  numHitsAccessible?: number;
  hits?: DoffinHit[] | DoffinHit | null;
}

/** Alle typeverdier fra Doffins EFormType-liste (API-portalen, 1.11.2026). */
const TYPE_LIFECYCLE: Record<string, Lifecycle> = {
  PLANNING: 'planned',
  NOTICE_ON_BUYER_PROFILE: 'planned',
  ADVISORY_NOTICE: 'planned',
  PRE_ANNOUNCEMENT: 'planned',
  COMPETITION: 'competition',
  ANNOUNCEMENT_OF_COMPETITION: 'competition',
  DYNAMIC_PURCHASING_SCHEME: 'competition',
  QUALIFICATION_SCHEME: 'competition',
  RESULT: 'awarded',
  ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT: 'awarded',
  CHANGE_OF_CONCLUSION_OF_CONTRACT: 'awarded',
  ANNOUNCEMENT_OF_INTENT: 'direct_award',
  CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT: 'cancelled',
};

export const DOFFIN_COMPETITION_TYPES = new Set(['COMPETITION', 'ANNOUNCEMENT_OF_COMPETITION', 'DYNAMIC_PURCHASING_SCHEME', 'QUALIFICATION_SCHEME']);

/** Brukes bare hvis ett døgn har flere kunngjøringer enn API-et gir tilgang til (1 000). */
export const DOFFIN_TYPE_GROUPS: string[][] = [
  ['COMPETITION', 'ANNOUNCEMENT_OF_COMPETITION', 'DYNAMIC_PURCHASING_SCHEME', 'QUALIFICATION_SCHEME'],
  ['RESULT', 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT', 'CHANGE_OF_CONCLUSION_OF_CONTRACT', 'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT', 'ANNOUNCEMENT_OF_INTENT'],
  ['PLANNING', 'NOTICE_ON_BUYER_PROFILE', 'ADVISORY_NOTICE', 'PRE_ANNOUNCEMENT'],
];

const RANK: Record<Lifecycle, number> = { other: 0, planned: 1, competition: 2, direct_award: 2, awarded: 3, cancelled: 4, withdrawn: 5 };

function types(hit: Pick<DoffinHit, 'type' | 'allTypes'>): string[] {
  return [hit.type, ...(hit.allTypes ?? [])].filter((t): t is string => typeof t === 'string' && t.length > 0).map((t) => t.toUpperCase());
}

export function doffinLifecycle(hit: Pick<DoffinHit, 'type' | 'allTypes' | 'status'>): Lifecycle {
  const status = (hit.status ?? '').toUpperCase();
  if (status === 'CANCELLED') return 'cancelled';
  let best: Lifecycle = 'other';
  for (const t of types(hit)) {
    const lc = TYPE_LIFECYCLE[t];
    if (lc && RANK[lc] > RANK[best]) best = lc;
  }
  if (best === 'other' && status === 'AWARDED') return 'awarded';
  return best;
}

export function isCompetitionNotice(hit: Pick<DoffinHit, 'type' | 'allTypes'>): boolean {
  return types(hit).some((t) => DOFFIN_COMPETITION_TYPES.has(t));
}

/** Enkel språkgjenkjenning for å foretrekke norsk tekst ved sammenslåing med TED. Ingen gjetning ved tvil. */
export function guessLanguage(text: string | null | undefined): 'nb' | 'en' | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase()} `;
  const nb = (t.match(/[æøå]| og | av | for | til | med | som | skal | anskaffelse| levering| rammeavtale| kjøp /g) ?? []).length;
  const en = (t.match(/ the | and | of | for the | shall | procurement | supply | framework agreement | services /g) ?? []).length;
  if (nb >= 2 && nb > en) return 'nb';
  if (en >= 2 && en > nb) return 'en';
  return null;
}

export function mapDoffinHit(hit: DoffinHit): NormalizedNotice {
  if (!hit?.id) throw new ConnectorError('Mangler id');
  const buyer = hit.buyer?.find((b) => b?.name) ?? hit.buyer?.[0];
  const lifecycle = doffinLifecycle(hit);
  const cpv = [...new Set((hit.cpvCodes ?? []).map(cleanCpv).filter((c): c is string => c !== null))];
  const nuts = cleanNutsCodes(hit.locationId ?? []);
  const awards: NoticeAward[] = [];
  for (const lot of hit.lots ?? []) {
    for (const w of lot?.winner ?? []) {
      if (!w?.name?.trim()) continue;
      awards.push({
        lotTitle: stripHtml(lot.heading)?.slice(0, 1000) ?? null,
        supplierName: w.name.trim().slice(0, 500),
        supplierOrgNumber: w.organizationId ?? null,
        value: null,
        currency: null,
        awardDate: null,
      });
    }
  }
  const lots: NoticeLot[] =
    (hit.lots?.length ?? 0) > 1
      ? (hit.lots ?? []).slice(0, 300).map((l) => ({ id: null, title: stripHtml(l?.heading)?.slice(0, 1000) ?? null, estimatedValue: null, durationText: null }))
      : [];
  // Fristen er bare en tilbudsfrist på konkurransekunngjøringer (på resultatkunngjøringer betyr
  // feltet noe annet). Vi lagrer den derfor aldri for andre typer.
  const competition = isCompetitionNotice(hit);
  const deadline = competition ? parseSourceDateTime(hit.deadline) : null;
  const title = stripHtml(hit.heading);
  const description = stripHtml(hit.description);
  const amount = typeof hit.estimatedValue?.amount === 'number' && Number.isFinite(hit.estimatedValue.amount) ? hit.estimatedValue.amount : null;
  const estimated = lifecycle === 'awarded' ? null : amount;
  const published = parseSourceDateTime(hit.publicationDate) ?? parseSourceDateTime(hit.issueDate);
  return {
    source: 'doffin',
    sourceNoticeId: hit.id,
    sourceUrl: `https://doffin.no/notices/${encodeURIComponent(hit.id)}`,
    noticeType: hit.type ?? null,
    lifecycle,
    procedureId: null,
    buyerReference: null,
    title: (title ?? `Doffin ${hit.id}`).slice(0, 1000),
    description,
    buyerName: buyer?.name?.trim() || null,
    buyerOrgNumber: buyer?.organizationId ? cleanOrgNumber(buyer.organizationId, 'NO') : null,
    buyerCity: null,
    countryCode: 'NO',
    nutsCodes: nuts,
    placeText: null,
    cpvCodes: cpv,
    mainCpv: mostSpecificCpv(cpv),
    contractNature: null,
    procedureType: null,
    estimatedValue: estimated,
    currency: estimated !== null ? (hit.estimatedValue?.currencyCode?.toUpperCase() ?? 'NOK') : null,
    publishedAt: published,
    deadlineAt: deadline,
    deadlineTimeKnown: Boolean(deadline && /T\d{2}:\d{2}/.test(hit.deadline ?? '') && !/T00:00(:00)?(\.0+)?(Z|[+-]00:00)?$/.test(hit.deadline ?? '')),
    documentsUrl: null,
    receivedTenders: typeof hit.receivedTenders === 'number' ? hit.receivedTenders : null,
    awards,
    details: {
      deadlineKind: deadline ? 'tender' : null,
      lots,
      language: guessLanguage(`${title ?? ''} ${description ?? ''}`) ?? 'nb',
    },
    raw: hit,
  };
}

function hitsOf(data: DoffinSearchResponse): DoffinHit[] {
  if (!data.hits) return [];
  return Array.isArray(data.hits) ? data.hits : [data.hits];
}

/** Datoer (ÅÅÅÅ-MM-DD) fra og med `since` til og med `until`, i stigende rekkefølge. */
export function dayRange(since: Date, until: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const end = Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate());
  while (d.getTime() <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const DOFFIN_PAGE_SIZE = 100;
export const DOFFIN_MAX_PAGE = 10;

/** Minst 2,1 s mellom søk = under 30 kall per minutt (Doffins grense). Kan settes lavere i tester. */
let minIntervalMs = 2100;
let lastRequestAt = 0;
export function setDoffinPacing(ms: number): void {
  minIntervalMs = ms;
  lastRequestAt = 0;
}

async function paced(): Promise<void> {
  const wait = lastRequestAt + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function search(params: URLSearchParams): Promise<DoffinSearchResponse> {
  const base = env.DOFFIN_API_BASE_URL.replace(/\/$/, '');
  await paced();
  const res = await fetchWithRetry(
    `${base}/search?${params}`,
    { headers: { 'Ocp-Apim-Subscription-Key': env.DOFFIN_API_KEY ?? '', Accept: 'application/json', 'User-Agent': `AnbudRadar/1.0 (+${env.APP_URL})` } },
    { retries: 4, timeoutMs: 45_000 },
  );
  if (res.status === 401 || res.status === 403) throw new ConnectorError('Doffin avviste nøkkelen (401/403). Sjekk DOFFIN_API_KEY.', res.status);
  if (!res.ok) throw new ConnectorError(`Doffin svarte ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, res.status);
  const text = await res.text();
  try {
    return JSON.parse(text) as DoffinSearchResponse;
  } catch {
    // Kjent problem i Doffin-svar: ubeskyttede kontrolltegn i tekstfelt. Fjern dem og prøv igjen.
    try {
      return JSON.parse(text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')) as DoffinSearchResponse;
    } catch {
      throw new ConnectorError('Doffin svarte med ugyldig JSON.');
    }
  }
}

export interface DaySweep {
  hits: Map<string, DoffinHit>;
  total: number;
  accessible: number;
}

/**
 * Henter alle kunngjøringer for ett døgn (og eventuelt én gruppe typer). Sidegrensene er ikke stabile
 * når mange treff har samme sorteringsnøkkel, så vi gjør inntil tre gjennomganger og samler unike ID-er
 * til vi har like mange som Doffin oppgir.
 */
export async function sweepDay(day: string, typeGroup: string[] | null, onError: (msg: string) => Promise<void>): Promise<DaySweep> {
  const hits = new Map<string, DoffinHit>();
  let total = 0;
  let accessible = 0;
  for (let sweep = 1; sweep <= 3; sweep++) {
    for (let page = 1; page <= DOFFIN_MAX_PAGE; page++) {
      const params = new URLSearchParams({
        numHitsPerPage: String(DOFFIN_PAGE_SIZE),
        page: String(page),
        sortBy: 'PUBLICATION_DATE_ASC',
        issueDateFrom: day,
        issueDateTo: day,
      });
      for (const t of typeGroup ?? []) params.append('type', t);
      const data = await search(params);
      total = data.numHitsTotal ?? 0;
      accessible = Math.min(data.numHitsAccessible ?? total, DOFFIN_PAGE_SIZE * DOFFIN_MAX_PAGE);
      const pageHits = hitsOf(data);
      for (const h of pageHits) if (h?.id) hits.set(h.id, h);
      if (pageHits.length < DOFFIN_PAGE_SIZE || page * DOFFIN_PAGE_SIZE >= accessible) break;
    }
    const expected = Math.min(total, accessible);
    // Ett-sides døgn kan ikke stokkes om mellom sider – én gjennomgang holder.
    if (hits.size >= expected || expected <= DOFFIN_PAGE_SIZE) break;
    if (sweep === 3) {
      await onError(`Doffin ${day}: fant ${hits.size} av ${expected} kunngjøringer etter tre gjennomganger. Neste kjøring prøver igjen.`);
    }
  }
  return { hits, total, accessible };
}

export async function fetchDoffin(
  window: FetchWindow,
  onError: (sourceNoticeId: string | null, error: string, raw: unknown) => Promise<void>,
): Promise<NormalizedNotice[]> {
  if (!env.DOFFIN_API_KEY) throw new ConnectorError('DOFFIN_API_KEY er ikke satt.');
  const out: NormalizedNotice[] = [];
  const limit = window.limit ?? 10_000;
  const seen = new Set<string>();
  const reportDay = (msg: string) => onError(null, msg, null);
  for (const day of dayRange(window.since, window.until ?? new Date())) {
    if (out.length >= limit) break;
    let collected = await sweepDay(day, null, reportDay);
    let all = collected.hits;
    // Over 1 000 kunngjøringer samme døgn: del opp etter type for å komme under taket.
    if (collected.total > collected.accessible) {
      all = new Map(all);
      for (const group of DOFFIN_TYPE_GROUPS) {
        collected = await sweepDay(day, group, reportDay);
        for (const [id, hit] of collected.hits) all.set(id, hit);
        if (collected.total > collected.accessible) {
          await reportDay(`Doffin ${day}: ${collected.total} kunngjøringer av typene ${group.join(', ')}, men API-et gir bare tilgang til ${collected.accessible}.`);
        }
      }
    }
    for (const hit of all.values()) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      try {
        out.push(mapDoffinHit(hit));
      } catch (err) {
        await onError(hit?.id ?? null, err instanceof Error ? err.message : String(err), hit);
      }
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Nedlasting av enkeltkunngjøringer (eForms-XML) via Doffin-ID
// ---------------------------------------------------------------------------
export const DOFFIN_DOWNLOAD_PER_MINUTE = 10;
/** 6,5 s mellom kall gir høyst 10 kall i ethvert 60-sekundersvindu, med margin for klokkeavvik. */
export const DOFFIN_DOWNLOAD_INTERVAL_MS = 6_500;
/** Felles luke i databasen: gjelder alle prosesser som bruker samme abonnement. */
export const DOFFIN_DOWNLOAD_SLOT = 'doffin:download';
export const DOFFIN_MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
/** Doffin-ID har formatet ÅÅÅÅ-NNNNNN (DFØ, eForms SDK NOR: notice-identifiers). */
export const DOFFIN_ID_RE = /^\d{4}-\d{1,12}$/;
/** Ventetid når 429 mangler Retry-After: grensen gjelder per minutt. */
export const DOFFIN_DEFAULT_RETRY_AFTER_MS = 60_000;
/** Lengre Retry-After enn dette venter vi ikke på i samme kjøring – kunngjøringen prøves igjen senere. */
export const DOFFIN_MAX_INLINE_WAIT_MS = 5 * 60_000;
/** Høyst så mange ID-er per kjøring (ca. 20 minutter ved 10 per minutt). */
export const DOFFIN_MAX_IDS_PER_RUN = 200;

interface DownloadDeps {
  slots: SlotProvider;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
}
const defaultDownloadDeps: DownloadDeps = { slots: dbSlots, intervalMs: DOFFIN_DOWNLOAD_INTERVAL_MS, sleep };
let downloadDeps: DownloadDeps = defaultDownloadDeps;
/** Kun for tester: bytt tempo-lager, intervall og ventefunksjon (null = standard). */
export function setDoffinDownloadDeps(next: Partial<DownloadDeps> | null): void {
  downloadDeps = next ? { ...defaultDownloadDeps, ...next } : defaultDownloadDeps;
}

export type DownloadFormat = 'eforms-xml' | 'xml' | 'zip' | 'json' | 'unknown';

export type DoffinDownload =
  | {
      ok: true;
      doffinId: string;
      status: 200;
      contentType: string | null;
      format: DownloadFormat;
      body: Buffer;
      bytes: number;
      sha256: string;
      attempts: number;
    }
  | {
      ok: false;
      doffinId: string;
      reason: 'invalid_id' | 'not_found' | 'rate_limited' | 'unauthorized' | 'too_large' | 'error';
      status: number | null;
      message: string;
      retryAfterMs?: number;
      attempts: number;
    };

/** Gjenkjenner formatet fra innholdet (Content-Type fra Doffin er bare «octet-stream»). */
export function sniffFormat(body: Buffer, contentType: string | null): DownloadFormat {
  if (body.length >= 4 && body[0] === 0x50 && body[1] === 0x4b && body[2] === 0x03 && body[3] === 0x04) return 'zip';
  const head = body.subarray(0, 16_384).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (head.startsWith('<')) {
    return /<(\w+:)?(ContractNotice|ContractAwardNotice|PriorInformationNotice)\b/.test(head) ? 'eforms-xml' : 'xml';
  }
  if (head.startsWith('{') || head.startsWith('[') || (contentType ?? '').toLowerCase().includes('json')) return 'json';
  return 'unknown';
}

/**
 * Laster ned én kunngjøring. Holder seg under 10 kall per minutt (felles luke for alle prosesser),
 * venter så lenge Retry-After sier ved 429, og gir tydelig svar ved 404 og ugyldig nøkkel.
 * Nøkkelen leses bare fra miljøvariabelen DOFFIN_API_KEY og logges aldri.
 */
export async function downloadDoffinNotice(doffinId: string, opts: { maxAttempts?: number } = {}): Promise<DoffinDownload> {
  const id = doffinId.trim();
  if (!DOFFIN_ID_RE.test(id)) {
    return { ok: false, doffinId: id, reason: 'invalid_id', status: null, message: `Ugyldig Doffin-ID «${id.slice(0, 40)}» (forventet ÅÅÅÅ-NNNNNN).`, attempts: 0 };
  }
  if (!env.DOFFIN_API_KEY) throw new ConnectorError('DOFFIN_API_KEY er ikke satt.');
  const url = `${env.DOFFIN_API_BASE_URL.replace(/\/$/, '')}/download/${encodeURIComponent(id)}`;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 4);
  let lastProblem = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Vent på vår luke. Etter en 429 er luken skjøvet til Retry-After, så ventetiden kommer her.
    const wait = await downloadDeps.slots.reserve(DOFFIN_DOWNLOAD_SLOT, downloadDeps.intervalMs);
    if (wait > 0) await downloadDeps.sleep(wait);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': env.DOFFIN_API_KEY,
          Accept: 'application/xml, application/octet-stream;q=0.9, */*;q=0.5',
          'User-Agent': `AnbudRadar/1.0 (+${env.APP_URL})`,
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      const cause = err instanceof Error ? ((err.cause as { code?: string } | undefined)?.code ?? err.message) : String(err);
      lastProblem = `nettverksfeil (${cause})`;
      if (attempt < maxAttempts) await downloadDeps.sleep(backoffMs(attempt - 1, 2000));
      continue;
    }
    if (res.status === 200) {
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > DOFFIN_MAX_DOWNLOAD_BYTES) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, doffinId: id, reason: 'too_large', status: 200, message: `Kunngjøringen er for stor (${declared} byte).`, attempts: attempt };
      }
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > DOFFIN_MAX_DOWNLOAD_BYTES) {
        return { ok: false, doffinId: id, reason: 'too_large', status: 200, message: `Kunngjøringen er for stor (${body.length} byte).`, attempts: attempt };
      }
      const contentType = res.headers.get('content-type');
      return {
        ok: true,
        doffinId: id,
        status: 200,
        contentType,
        format: sniffFormat(body, contentType),
        body,
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        attempts: attempt,
      };
    }
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    if (res.status === 404) {
      return { ok: false, doffinId: id, reason: 'not_found', status: 404, message: `Fant ikke kunngjøringen ${id} i Doffin (404).`, attempts: attempt };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        doffinId: id,
        reason: 'unauthorized',
        status: res.status,
        message: `Doffin avviste nøkkelen (${res.status}). Sjekk DOFFIN_API_KEY og at abonnementet gjelder Public API.`,
        attempts: attempt,
      };
    }
    if (res.status === 429) {
      const retryAfter = retryAfterMs(res.headers.get('retry-after')) ?? DOFFIN_DEFAULT_RETRY_AFTER_MS;
      // Skyv luken for alle prosesser, ikke bare denne.
      await downloadDeps.slots.defer(DOFFIN_DOWNLOAD_SLOT, retryAfter);
      if (attempt < maxAttempts && retryAfter <= DOFFIN_MAX_INLINE_WAIT_MS) continue;
      return {
        ok: false,
        doffinId: id,
        reason: 'rate_limited',
        status: 429,
        retryAfterMs: retryAfter,
        message: `Doffin ber oss vente ${Math.ceil(retryAfter / 1000)} s før neste nedlasting (429).`,
        attempts: attempt,
      };
    }
    if (res.status === 408 || res.status >= 500) {
      lastProblem = `HTTP ${res.status}`;
      if (attempt < maxAttempts) await downloadDeps.sleep(backoffMs(attempt - 1, 2000));
      continue;
    }
    return { ok: false, doffinId: id, reason: 'error', status: res.status, message: `Doffin svarte ${res.status}: ${detail}`, attempts: attempt };
  }
  return { ok: false, doffinId: id, reason: 'error', status: null, message: `Fikk ikke lastet ned ${id} etter ${maxAttempts} forsøk (${lastProblem}).`, attempts: maxAttempts };
}

/** Pakker ut XML hvis Doffin svarer med en ZIP-fil (formatet er ikke dokumentert). */
async function xmlFromZip(body: Buffer): Promise<Buffer | null> {
  const zip = await JSZip.loadAsync(body);
  const entry = Object.values(zip.files).find((f) => !f.dir && /\.xml$/i.test(f.name));
  if (!entry) return null;
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (declared > DOFFIN_MAX_DOWNLOAD_BYTES) return null;
  const xml = await entry.async('nodebuffer');
  return xml.length > DOFFIN_MAX_DOWNLOAD_BYTES ? null : xml;
}

export interface DoffinByIdOutcome {
  id: string;
  outcome: 'ok' | 'invalid_id' | 'not_found' | 'rate_limited' | 'unauthorized' | 'too_large' | 'error' | 'unsupported_format' | 'parse_error' | 'not_attempted';
  message?: string;
  status?: number | null;
  format?: DownloadFormat;
  bytes?: number;
  sha256?: string;
  attempts?: number;
  variant?: string;
  noticeSubtype?: string | null;
  savedTo?: string;
}

/**
 * Henter kunngjøringer etter Doffin-ID og oversetter eForms-XML til felles format.
 * Stopper kjøringen ved ugyldig nøkkel og ved 429 som ikke kan ventes ut, og sier hvilke ID-er som
 * ikke ble forsøkt. `saveRawDir` lagrer originalfilene lokalt (for kontroll ved første live-test).
 */
export async function fetchDoffinByIds(
  ids: string[],
  onError: (sourceNoticeId: string | null, error: string, raw: unknown) => Promise<void>,
  opts: { saveRawDir?: string } = {},
): Promise<{ notices: NormalizedNotice[]; outcomes: DoffinByIdOutcome[] }> {
  if (!env.DOFFIN_API_KEY) throw new ConnectorError('DOFFIN_API_KEY er ikke satt.');
  const unique = [...new Set(ids.map((i) => i.trim()).filter(Boolean))].slice(0, DOFFIN_MAX_IDS_PER_RUN);
  const notices: NormalizedNotice[] = [];
  const outcomes: DoffinByIdOutcome[] = [];
  for (let i = 0; i < unique.length; i++) {
    const id = unique[i]!;
    const dl = await downloadDoffinNotice(id);
    if (!dl.ok) {
      outcomes.push({ id, outcome: dl.reason, message: dl.message, status: dl.status, attempts: dl.attempts });
      await onError(id, dl.message, { status: dl.status, reason: dl.reason });
      if (dl.reason === 'unauthorized' || dl.reason === 'rate_limited') {
        for (const rest of unique.slice(i + 1)) outcomes.push({ id: rest, outcome: 'not_attempted', message: 'Ikke forsøkt fordi kjøringen ble stoppet.' });
        if (dl.reason === 'unauthorized') throw new ConnectorError(dl.message, dl.status ?? undefined);
        break;
      }
      continue;
    }
    const base: DoffinByIdOutcome = { id, outcome: 'ok', status: 200, format: dl.format, bytes: dl.bytes, sha256: dl.sha256, attempts: dl.attempts };
    if (opts.saveRawDir) {
      await mkdir(opts.saveRawDir, { recursive: true });
      const ext = dl.format === 'zip' ? 'zip' : dl.format === 'json' ? 'json' : dl.format === 'unknown' ? 'bin' : 'xml';
      base.savedTo = join(opts.saveRawDir, `${id}.${ext}`);
      await writeFile(base.savedTo, dl.body);
    }
    let xml: Buffer | null = dl.format === 'eforms-xml' || dl.format === 'xml' ? dl.body : null;
    if (dl.format === 'zip') xml = await xmlFromZip(dl.body).catch(() => null);
    if (!xml) {
      const message = `Uventet format fra Doffin (${dl.format}, Content-Type ${dl.contentType ?? 'mangler'}). Lagre filen med --save-raw og send den til utvikler.`;
      outcomes.push({ ...base, outcome: 'unsupported_format', message });
      await onError(id, message, { format: dl.format, contentType: dl.contentType, bytes: dl.bytes });
      continue;
    }
    try {
      const parsed = parseEformsXml(xml.toString('utf8'));
      notices.push(eformsToNotice(parsed, { sourceNoticeId: id, sourceUrl: `https://doffin.no/notices/${encodeURIComponent(id)}`, sha256: dl.sha256, bytes: dl.bytes }));
      outcomes.push({ ...base, variant: parsed.variant, noticeSubtype: parsed.noticeSubtype });
    } catch (err) {
      const message = err instanceof EformsError ? err.message : `Kunne ikke lese kunngjøringen: ${err instanceof Error ? err.message : String(err)}`;
      outcomes.push({ ...base, outcome: 'parse_error', message });
      await onError(id, message, { format: dl.format, bytes: dl.bytes, sha256: dl.sha256 });
    }
  }
  return { notices, outcomes };
}

export const doffinConnector: SourceConnector = {
  id: 'doffin',
  name: 'Doffin (Norge)',
  status() {
    return env.DOFFIN_API_KEY
      ? { configured: true, message: 'Abonnementsnøkkel er satt.' }
      : { configured: false, message: 'Mangler DOFFIN_API_KEY. Registrer deg i Doffins API-portal for å få en nøkkel.' };
  },
  fetch: fetchDoffin,
};
