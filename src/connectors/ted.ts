/**
 * TED (Tenders Electronic Daily) – EUs offisielle kunngjøringsdatabase.
 *
 * API: POST {TED_API_BASE_URL}/v3/notices/search  (ingen nøkkel nødvendig)
 * Dokumentasjon: https://docs.ted.europa.eu/api/latest/search.html
 * Gjenbruk: TED-data kan gjenbrukes fritt med kildehenvisning (© Den europeiske union).
 *
 * MERK: Feltnavnene under er hentet fra TEDs dokumentasjon og verifiserte eksempler,
 * men er IKKE testet mot live API fra utviklingsmiljøet. Kjør
 *   npm run ingest -- --source ted --dry-run
 * først, og sjekk import-loggen i admin.
 */
import { env } from '@/lib/env';
import {
  cleanCpv,
  cleanOrgNumber,
  combineDateTime,
  stripHtml,
  type Lifecycle,
  type NormalizedNotice,
  type NoticeAward,
} from '@/domain/tenders/normalize';
import { ConnectorError, fetchWithRetry, sleep, type FetchWindow, type SourceConnector } from './types';

export const TED_FIELDS = [
  'publication-number',
  'notice-identifier',
  'procedure-identifier',
  'notice-type',
  'notice-title',
  'title-proc',
  'description-proc',
  'internal-identifier-proc',
  'buyer-name',
  'buyer-city',
  'buyer-country',
  'organisation-identifier-buyer',
  'publication-date',
  'procedure-type',
  'contract-nature',
  'classification-cpv',
  'place-of-performance',
  'deadline-date-lot',
  'deadline-receipt-tender-time-lot',
  'estimated-value-proc',
  'estimated-value-lot',
  'estimated-value-cur-lot',
  'total-value',
  'total-value-cur',
  'winner-name',
  'winner-decision-date',
] as const;

const ISO3_TO_ISO2: Record<string, string> = { NOR: 'NO', SWE: 'SE', DNK: 'DK', FIN: 'FI', DEU: 'DE', ISL: 'IS' };
const LANG_PREFERENCE = ['nor', 'nob', 'nno', 'NOR', 'NOB', 'NNO', 'eng', 'ENG', 'swe', 'dan', 'fin', 'deu', 'MUL', 'mul'];

/** TED returnerer ofte språknøklede objekter ({ nor: [...], eng: [...] }) eller lister. */
export function tedScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = tedScalar(v);
      if (s) return s;
    }
    return null;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const lang of LANG_PREFERENCE) {
      if (lang in obj) {
        const s = tedScalar(obj[lang]);
        if (s) return s;
      }
    }
    for (const v of Object.values(obj)) {
      const s = tedScalar(v);
      if (s) return s;
    }
  }
  return null;
}

export function tedList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((v) => tedList(v));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const lang of LANG_PREFERENCE) if (lang in obj) return tedList(obj[lang]);
    return Object.values(obj).flatMap((v) => tedList(v));
  }
  return [];
}

function tedNumber(value: unknown): number | null {
  const s = tedScalar(value);
  if (s === null) return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function tedLifecycle(noticeType: string | null): Lifecycle {
  if (!noticeType) return 'other';
  const t = noticeType.toLowerCase();
  if (t.startsWith('pin')) return 'planned';
  if (t.startsWith('cn')) return 'competition';
  if (t.startsWith('can')) return 'awarded';
  if (t === 'veat') return 'direct_award';
  return 'other';
}

function contractNature(value: string | null): NormalizedNotice['contractNature'] {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v.includes('work')) return 'works';
  if (v.includes('suppl')) return 'supplies';
  if (v.includes('serv')) return 'services';
  return null;
}

function earliestDate(values: string[]): string | null {
  const valid = values.filter((v) => /^\d{4}-\d{2}-\d{2}/.test(v)).sort();
  return valid[0] ?? null;
}

/** Oversetter ett TED-søketreff til felles format. Ren funksjon – testes med fiksturer. */
export function mapTedNotice(hit: Record<string, unknown>): NormalizedNotice {
  const pubNo = tedScalar(hit['publication-number']);
  if (!pubNo) throw new ConnectorError('Mangler publication-number');
  const noticeType = tedScalar(hit['notice-type']);
  const lifecycle = tedLifecycle(noticeType);
  const country = ISO3_TO_ISO2[(tedScalar(hit['buyer-country']) ?? '').toUpperCase()] ?? 'NO';

  const orgIds = tedList(hit['organisation-identifier-buyer']);
  const orgNumber = orgIds.map((id) => cleanOrgNumber(id, country)).find((v) => v !== null) ?? null;

  const nuts = tedList(hit['place-of-performance'])
    .map((c) => c.toUpperCase())
    // TED blander inn landkoder (ISO3, f.eks. "NOR" = hele landet) – de er ikke NUTS-koder.
    .filter((c) => /^[A-Z]{2}[0-9A-Z]{1,3}$/.test(c) && !/^[A-Z]{3}$/.test(c));

  const cpv = [...new Set(tedList(hit['classification-cpv']).map(cleanCpv).filter((c): c is string => c !== null))];
  const deadline = combineDateTime(earliestDate(tedList(hit['deadline-date-lot'])), tedScalar(hit['deadline-receipt-tender-time-lot']));
  const published = tedScalar(hit['publication-date']);

  const isAward = lifecycle === 'awarded';
  const estimated = isAward ? null : (tedNumber(hit['estimated-value-proc']) ?? tedNumber(hit['estimated-value-lot']));
  const currency = (tedScalar(hit['estimated-value-cur-lot']) ?? tedScalar(hit['total-value-cur']))?.toUpperCase() ?? null;

  const awards: NoticeAward[] = [];
  if (isAward) {
    const winners = [...new Set(tedList(hit['winner-name']).map((w) => w.trim()).filter(Boolean))];
    const total = tedNumber(hit['total-value']);
    const decision = earliestDate(tedList(hit['winner-decision-date']));
    for (const name of winners) {
      awards.push({
        lotTitle: null,
        supplierName: name,
        supplierOrgNumber: null,
        // Verdien knyttes kun til leverandøren når det er én vinner; ellers er fordelingen ukjent.
        value: winners.length === 1 ? total : null,
        currency: (tedScalar(hit['total-value-cur']) ?? currency)?.toUpperCase() ?? null,
        awardDate: decision ? decision.slice(0, 10) : null,
      });
    }
  }

  const links = (hit.links ?? {}) as Record<string, Record<string, string> | undefined>;
  const htmlLink =
    links.htmlDirect?.NOR ?? links.html?.NOR ?? links.htmlDirect?.ENG ?? links.html?.ENG ?? `https://ted.europa.eu/en/notice/-/detail/${pubNo}`;

  const title = stripHtml(tedScalar(hit['title-proc']) ?? tedScalar(hit['notice-title'])) ?? `TED ${pubNo}`;

  return {
    source: 'ted',
    sourceNoticeId: pubNo,
    sourceUrl: htmlLink,
    noticeType,
    lifecycle,
    procedureId: tedScalar(hit['procedure-identifier']),
    buyerReference: tedScalar(hit['internal-identifier-proc']),
    title: title.slice(0, 1000),
    description: stripHtml(tedScalar(hit['description-proc'])),
    buyerName: tedScalar(hit['buyer-name']),
    buyerOrgNumber: orgNumber,
    buyerCity: tedScalar(hit['buyer-city']),
    countryCode: country,
    nutsCodes: nuts,
    placeText: tedScalar(hit['buyer-city']),
    cpvCodes: cpv,
    mainCpv: cpv[0] ?? null,
    contractNature: contractNature(tedScalar(hit['contract-nature'])),
    procedureType: tedScalar(hit['procedure-type']),
    estimatedValue: estimated,
    currency: estimated !== null || awards.length ? currency : null,
    publishedAt: published ? `${published.slice(0, 10)}T00:00:00Z` : null,
    deadlineAt: deadline.iso,
    deadlineTimeKnown: deadline.timeKnown,
    documentsUrl: null,
    receivedTenders: null,
    awards,
    raw: hit,
  };
}

function tedDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function buildTedQuery(window: FetchWindow, countryIso3 = 'NOR'): string {
  const parts = [`buyer-country=${countryIso3}`, `publication-date>=${tedDate(window.since)}`];
  if (window.until) parts.push(`publication-date<=${tedDate(window.until)}`);
  return parts.join(' AND ');
}

export const tedConnector: SourceConnector = {
  id: 'ted',
  name: 'TED (EU)',
  status() {
    return { configured: true, message: 'Bruker TEDs åpne søke-API (ingen nøkkel).' };
  },
  async fetch(window, onError) {
    const out: NormalizedNotice[] = [];
    const limit = window.limit ?? 5000;
    let token: string | null = null;
    const endpoint = `${env.TED_API_BASE_URL.replace(/\/$/, '')}/v3/notices/search`;
    for (let page = 0; page < 200 && out.length < limit; page++) {
      const body: Record<string, unknown> = {
        query: buildTedQuery(window),
        fields: TED_FIELDS,
        limit: 100,
        scope: 'ALL',
        paginationMode: 'ITERATION',
        checkQuerySyntax: false,
      };
      if (token) body.iterationNextToken = token;
      const res = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'AnbudRadar/0.1 (+kontakt i README)' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ConnectorError(`TED svarte ${res.status}: ${text.slice(0, 300)}`, res.status);
      }
      const data = (await res.json()) as { notices?: Record<string, unknown>[]; iterationNextToken?: string | null };
      const notices = data.notices ?? [];
      for (const hit of notices) {
        try {
          out.push(mapTedNotice(hit));
        } catch (err) {
          await onError(tedScalar(hit['publication-number']), err instanceof Error ? err.message : String(err), hit);
        }
      }
      token = data.iterationNextToken ?? null;
      if (!token || notices.length === 0) break;
      await sleep(500); // Skånsom mot API-et.
    }
    return out.slice(0, limit);
  },
};
