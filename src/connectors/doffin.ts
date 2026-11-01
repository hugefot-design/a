/**
 * Doffin – den norske nasjonale kunngjøringsdatabasen (driftes av DFØ).
 *
 * Bruker Doffins OFFENTLIGE API (krever gratis abonnementsnøkkel fra Doffins
 * API-portal). Vi bruker IKKE nettsidens interne API-er.
 *   GET {DOFFIN_API_BASE_URL}/search?...   header: Ocp-Apim-Subscription-Key
 *
 * Felt og verdier er basert på API-ets dokumenterte modell (PagedPublicNoticeDto /
 * PublicNoticeHit) og typeverdier observert i offentlig kode. IKKE verifisert mot live
 * API fra utviklingsmiljøet – kjør `npm run ingest -- --source doffin --dry-run` først.
 */
import { env } from '@/lib/env';
import { cleanCpv, cleanOrgNumber, parseSourceDateTime, stripHtml, type Lifecycle, type NormalizedNotice, type NoticeAward } from '@/domain/tenders/normalize';
import { ConnectorError, fetchWithRetry, sleep, type SourceConnector } from './types';

interface DoffinOrg {
  id?: string;
  organizationId?: string;
  name?: string;
}

export interface DoffinHit {
  id: string;
  buyer?: DoffinOrg[];
  heading?: string;
  description?: string;
  locationId?: string[];
  estimatedValue?: { currencyCode?: string; amount?: number } | null;
  type?: string;
  allTypes?: string[];
  status?: string;
  issueDate?: string;
  deadline?: string | null;
  publicationDate?: string;
  receivedTenders?: number | null;
  cpvCodes?: string[];
  lots?: { heading?: string; description?: string; winner?: DoffinOrg[] }[];
}

const TYPE_LIFECYCLE: Record<string, Lifecycle> = {
  ADVISORY_NOTICE: 'planned',
  PLANNING: 'planned',
  ANNOUNCEMENT_OF_COMPETITION: 'competition',
  COMPETITION: 'competition',
  RESULT: 'awarded',
  CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT: 'cancelled',
  INTENTION_ANNOUNCEMENT: 'direct_award',
};

export function doffinLifecycle(hit: Pick<DoffinHit, 'type' | 'allTypes' | 'status'>): Lifecycle {
  const status = (hit.status ?? '').toUpperCase();
  if (status.includes('CANCEL')) return 'cancelled';
  const types = [hit.type, ...(hit.allTypes ?? [])].filter(Boolean).map((t) => t!.toUpperCase());
  let best: Lifecycle = 'other';
  const rank: Record<Lifecycle, number> = { other: 0, planned: 1, competition: 2, direct_award: 2, awarded: 3, cancelled: 4, withdrawn: 5 };
  for (const t of types) {
    const lc = TYPE_LIFECYCLE[t];
    if (lc && rank[lc] > rank[best]) best = lc;
  }
  if (best === 'other' && status === 'AWARDED') return 'awarded';
  return best;
}

function isoOrNull(value: string | null | undefined): string | null {
  return parseSourceDateTime(value);
}

export function mapDoffinHit(hit: DoffinHit): NormalizedNotice {
  if (!hit.id) throw new ConnectorError('Mangler id');
  const buyer = hit.buyer?.[0];
  const lifecycle = doffinLifecycle(hit);
  const cpv = [...new Set((hit.cpvCodes ?? []).map(cleanCpv).filter((c): c is string => c !== null))];
  const nuts = (hit.locationId ?? []).map((l) => l.toUpperCase()).filter((l) => /^NO[0-9A-Z]{1,3}$/.test(l));
  const awards: NoticeAward[] = [];
  for (const lot of hit.lots ?? []) {
    for (const w of lot.winner ?? []) {
      if (!w.name) continue;
      awards.push({
        lotTitle: lot.heading ?? null,
        supplierName: w.name,
        supplierOrgNumber: w.organizationId ?? null,
        value: null,
        currency: null,
        awardDate: null,
      });
    }
  }
  const deadline = isoOrNull(hit.deadline);
  return {
    source: 'doffin',
    sourceNoticeId: hit.id,
    sourceUrl: `https://doffin.no/notices/${encodeURIComponent(hit.id)}`,
    noticeType: hit.type ?? null,
    lifecycle,
    procedureId: null,
    buyerReference: null,
    title: (stripHtml(hit.heading) ?? `Doffin ${hit.id}`).slice(0, 1000),
    description: stripHtml(hit.description),
    buyerName: buyer?.name ?? null,
    buyerOrgNumber: buyer?.organizationId ? cleanOrgNumber(buyer.organizationId, 'NO') : null,
    buyerCity: null,
    countryCode: 'NO',
    nutsCodes: nuts,
    placeText: null,
    cpvCodes: cpv,
    mainCpv: cpv[0] ?? null,
    contractNature: null,
    procedureType: null,
    estimatedValue: lifecycle === 'awarded' ? null : (hit.estimatedValue?.amount ?? null),
    currency: hit.estimatedValue?.currencyCode?.toUpperCase() ?? null,
    publishedAt: isoOrNull(hit.publicationDate ?? hit.issueDate),
    deadlineAt: deadline,
    deadlineTimeKnown: Boolean(deadline && /T\d{2}:\d{2}/.test(hit.deadline ?? '') && !/T00:00(:00)?/.test(hit.deadline ?? '')),
    documentsUrl: null,
    receivedTenders: typeof hit.receivedTenders === 'number' ? hit.receivedTenders : null,
    awards,
    raw: hit,
  };
}

export const doffinConnector: SourceConnector = {
  id: 'doffin',
  name: 'Doffin (Norge)',
  status() {
    return env.DOFFIN_API_KEY
      ? { configured: true, message: 'Abonnementsnøkkel er satt.' }
      : { configured: false, message: 'Mangler DOFFIN_API_KEY. Registrer deg i Doffins API-portal for å få en nøkkel.' };
  },
  async fetch(window, onError) {
    if (!env.DOFFIN_API_KEY) throw new ConnectorError('DOFFIN_API_KEY er ikke satt.');
    const out: NormalizedNotice[] = [];
    const limit = window.limit ?? 5000;
    const perPage = 100;
    const base = env.DOFFIN_API_BASE_URL.replace(/\/$/, '');
    for (let page = 0; page < 100 && out.length < limit; page++) {
      const params = new URLSearchParams({
        numHitsPerPage: String(perPage),
        page: String(page),
        sortBy: 'PUBLICATION_DATE_DESC',
        issueDateFrom: window.since.toISOString().slice(0, 10),
      });
      if (window.until) params.set('issueDateTo', window.until.toISOString().slice(0, 10));
      const res = await fetchWithRetry(`${base}/search?${params}`, {
        headers: { 'Ocp-Apim-Subscription-Key': env.DOFFIN_API_KEY, Accept: 'application/json' },
      });
      if (res.status === 401 || res.status === 403) throw new ConnectorError('Doffin avviste nøkkelen (401/403). Sjekk DOFFIN_API_KEY.', res.status);
      if (!res.ok) throw new ConnectorError(`Doffin svarte ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`, res.status);
      const data = (await res.json()) as { numHitsTotal?: number; numHitsAccessible?: number; hits?: DoffinHit[] };
      const hits = data.hits ?? [];
      for (const hit of hits) {
        try {
          out.push(mapDoffinHit(hit));
        } catch (err) {
          await onError(hit?.id ?? null, err instanceof Error ? err.message : String(err), hit);
        }
      }
      const accessible = data.numHitsAccessible ?? data.numHitsTotal ?? 0;
      if (hits.length < perPage || (page + 1) * perPage >= accessible) break;
      await sleep(400);
    }
    return out.slice(0, limit);
  },
};
