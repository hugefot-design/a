/**
 * TED (Tenders Electronic Daily) – EUs offisielle kunngjøringsdatabase.
 *
 * API: POST {TED_API_BASE_URL}/v3/notices/search  (ingen nøkkel nødvendig)
 * Dokumentasjon: https://docs.ted.europa.eu/api/latest/search.html
 * Gjenbruk: TED-data kan gjenbrukes fritt med kildehenvisning (© Den europeiske union).
 *
 * Feltnavnene er VERIFISERT mot live API 1.11.2026 (se tests/fixtures/ted-live-*.json, som er
 * ekte svar). Viktig: `deadline-date-lot` er SPØRSMÅLSFRISTEN (eForms BT-13), ikke tilbudsfristen.
 * Tilbudsfristen er `deadline-receipt-tender-date-lot` + `-time-lot` (BT-131).
 *
 * Norske kunngjøringer ligger i TED på engelsk (titler og beskrivelser). Den norske teksten
 * finnes i Doffin – se ingest.ts, som foretrekker norsk tekst når samme anskaffelse finnes i begge.
 */
import { env } from '@/lib/env';
import {
  cleanCpv,
  cleanNutsCodes,
  cleanOrgNumber,
  combineDateTime,
  durationFrom,
  mostSpecificCpv,
  stripHtml,
  type Lifecycle,
  type NormalizedNotice,
  type NoticeAward,
  type NoticeAwardCriterion,
  type NoticeDetails,
  type NoticeLot,
} from '@/domain/tenders/normalize';
import { ConnectorError, fetchWithRetry, sleep, type FetchWindow, type SourceConnector } from './types';

export const TED_FIELDS = [
  'publication-number',
  'notice-identifier',
  'notice-version',
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
  // Frister: BT-131 tilbud, BT-1311 forespørsel om å delta, BT-13 spørsmål
  'deadline-receipt-tender-date-lot',
  'deadline-receipt-tender-time-lot',
  'deadline-receipt-request-date-lot',
  'deadline-receipt-request-time-lot',
  'deadline-date-lot',
  'deadline-time-lot',
  'estimated-value-proc',
  'estimated-value-cur-proc',
  'estimated-value-lot',
  'estimated-value-cur-lot',
  'total-value',
  'total-value-cur',
  'winner-name',
  'winner-identifier',
  'winner-decision-date',
  'document-url-lot',
  'submission-url-lot',
  'duration-period-value-lot',
  'duration-period-unit-lot',
  'contract-duration-start-date-lot',
  'contract-duration-end-date-lot',
  'identifier-lot',
  'title-lot',
  'selection-criterion-description-lot',
  'award-criterion-name-lot',
  'award-criterion-type-lot',
  'award-criterion-number-lot',
  'award-criterion-number-weight-lot',
  'framework-agreement-lot',
  'change-description',
] as const;

const ISO3_TO_ISO2: Record<string, string> = { NOR: 'NO', SWE: 'SE', DNK: 'DK', FIN: 'FI', DEU: 'DE', ISL: 'IS' };
/** Land tolkningen kjenner (kan måles med dry-run). */
export const TED_KNOWN_COUNTRIES = Object.keys(ISO3_TO_ISO2);
const LANG_PREFERENCE = ['nor', 'nob', 'nno', 'eng', 'swe', 'dan', 'fin', 'deu', 'mul'];
const LANG_CODE: Record<string, string> = { nor: 'nb', nob: 'nb', nno: 'nn', eng: 'en', swe: 'sv', dan: 'da', fin: 'fi', deu: 'de' };

/** TED returnerer ofte språknøklede objekter ({ eng: [...] }) eller lister. Gir tekst og språk. */
export function tedText(value: unknown): { text: string | null; lang: string | null } {
  if (value === null || value === undefined) return { text: null, lang: null };
  if (typeof value === 'string') return { text: value.trim() || null, lang: null };
  if (typeof value === 'number') return { text: String(value), lang: null };
  if (Array.isArray(value)) {
    for (const v of value) {
      const t = tedText(v);
      if (t.text) return t;
    }
    return { text: null, lang: null };
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const ordered = [
      ...LANG_PREFERENCE.flatMap((l) => keys.filter((k) => k.toLowerCase() === l)),
      ...keys.filter((k) => !LANG_PREFERENCE.includes(k.toLowerCase())),
    ];
    for (const k of ordered) {
      const t = tedText(obj[k]);
      if (t.text) return { text: t.text, lang: t.lang ?? LANG_CODE[k.toLowerCase()] ?? null };
    }
  }
  return { text: null, lang: null };
}

export function tedScalar(value: unknown): string | null {
  return tedText(value).text;
}

/** Alle verdier som liste. Språknøklede objekter gir verdiene på det foretrukne språket. */
export function tedList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string' || typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((v) => tedList(v));
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const lang of LANG_PREFERENCE) {
      const key = Object.keys(obj).find((k) => k.toLowerCase() === lang);
      if (key) return tedList(obj[key]);
    }
    return Object.values(obj).flatMap((v) => tedList(v));
  }
  return [];
}

function toNumber(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const n = Number(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function tedNumber(value: unknown): number | null {
  return toNumber(tedScalar(value));
}

export function tedLifecycle(noticeType: string | null): Lifecycle {
  if (!noticeType) return 'other';
  const t = noticeType.toLowerCase();
  // Forhåndskunngjøring brukt som kunngjøring av konkurranse, og kvalifikasjonsordninger.
  if (t.startsWith('pin-cfc') || t === 'qu-sy') return 'competition';
  if (t.startsWith('pin') || t === 'pmc') return 'planned';
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

/** Datoer og klokkeslett per delkontrakt → ISO-tidspunkter (null der datoen mangler). */
export function lotDateTimes(dates: string[], times: string[]): string[] {
  const out: string[] = [];
  dates.forEach((d, i) => {
    const time = times.length === dates.length ? times[i] : times[0];
    const { iso } = combineDateTime(d, time ?? null);
    if (iso) out.push(iso);
  });
  return out;
}

function earliestIso(values: string[]): string | null {
  return [...values].sort()[0] ?? null;
}

function httpUrls(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    try {
      const u = new URL(v.trim());
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !out.includes(u.toString())) out.push(u.toString());
    } catch {
      /* ugyldig – hoppes over */
    }
  }
  return out;
}

function dedupeTexts(values: string[], max: number, maxLen: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const text = stripHtml(v)?.slice(0, maxLen);
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

const WEIGHT_TYPE_SUFFIX: Record<string, string> = { 'per-exa': ' %', 'per-ran': ' %', 'poi-exa': ' poeng', 'poi-ran': ' poeng' };

export function tedAwardCriteria(hit: Record<string, unknown>): NoticeAwardCriterion[] {
  const names = tedList(hit['award-criterion-name-lot']);
  const types = tedList(hit['award-criterion-type-lot']);
  const numbers = tedList(hit['award-criterion-number-lot']);
  const weightTypes = tedList(hit['award-criterion-number-weight-lot']);
  // Listene er flatet ut over delkontrakter og har ikke alltid samme lengde. Vi kobler bare
  // vekt og type til navnet når lengdene stemmer – ellers vises bare navnene (aldri gjetning).
  const aligned = names.length > 0 && names.length === types.length && names.length === numbers.length;
  const out: NoticeAwardCriterion[] = [];
  const seen = new Set<string>();
  names.forEach((rawName, i) => {
    const name = stripHtml(rawName)?.slice(0, 500);
    if (!name) return;
    const type = aligned ? (types[i] ?? null) : null;
    const suffix = aligned && weightTypes.length === names.length ? (WEIGHT_TYPE_SUFFIX[weightTypes[i] ?? ''] ?? '') : '';
    const weight = aligned && numbers[i] ? `${numbers[i]}${suffix}`.slice(0, 50) : null;
    const key = `${name.toLowerCase()}|${type}|${weight}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name, type, weight });
  });
  return out.slice(0, 40);
}

const MEANINGFUL = /[\p{L}\p{N}].*[\p{L}\p{N}].*[\p{L}\p{N}]/u;

/** Verdier som bare er tegnsetting («.», «-») behandles som manglende. */
function meaningful(value: string | null): string | null {
  return value && MEANINGFUL.test(value) ? value : null;
}

/**
 * Tittel: anskaffelsens tittel, ellers første delkontrakt, ellers TEDs generiske tittel uten
 * landprefikset («Norway – Kategori – …»). Titler som bare er tegnsetting («.») hoppes over.
 */
export function tedTitle(hit: Record<string, unknown>): { text: string | null; lang: string | null } {
  const proc = tedText(hit['title-proc']);
  if (proc.text && MEANINGFUL.test(proc.text)) return proc;
  const lot = tedText(hit['title-lot']);
  if (lot.text && MEANINGFUL.test(lot.text)) return lot;
  const notice = tedText(hit['notice-title']);
  if (notice.text) {
    const parts = notice.text.split(/\s+[–-]\s+/).map((p) => p.trim()).filter((p) => MEANINGFUL.test(p));
    const text = parts.length > 1 ? parts.slice(1).join(' – ') : (parts[0] ?? null);
    if (text) return { text, lang: notice.lang };
  }
  return proc.text ? proc : notice;
}

/** Oversetter ett TED-søketreff til felles format. Ren funksjon – testes med ekte svar fra TED. */
export function mapTedNotice(hit: Record<string, unknown>): NormalizedNotice {
  const pubNo = tedScalar(hit['publication-number']);
  if (!pubNo) throw new ConnectorError('Mangler publication-number');
  const noticeType = tedScalar(hit['notice-type']);
  const lifecycle = tedLifecycle(noticeType);
  const country = ISO3_TO_ISO2[(tedScalar(hit['buyer-country']) ?? '').toUpperCase()] ?? 'NO';

  const orgIds = tedList(hit['organisation-identifier-buyer']);
  const orgNumber = orgIds.map((id) => cleanOrgNumber(id, country)).find((v) => v !== null) ?? null;
  const nuts = cleanNutsCodes(tedList(hit['place-of-performance']));
  const cpv = [...new Set(tedList(hit['classification-cpv']).map(cleanCpv).filter((c): c is string => c !== null))];

  // Frister. Har delkontraktene ulike frister, brukes den tidligste (den som haster mest).
  const tenderDeadlines = lotDateTimes(tedList(hit['deadline-receipt-tender-date-lot']), tedList(hit['deadline-receipt-tender-time-lot']));
  const requestDeadlines = lotDateTimes(tedList(hit['deadline-receipt-request-date-lot']), tedList(hit['deadline-receipt-request-time-lot']));
  const questionDeadlines = lotDateTimes(tedList(hit['deadline-date-lot']), tedList(hit['deadline-time-lot']));
  const tenderTimeKnown = tedList(hit['deadline-receipt-tender-time-lot']).length > 0;
  const requestTimeKnown = tedList(hit['deadline-receipt-request-time-lot']).length > 0;
  const tenderDeadline = earliestIso(tenderDeadlines);
  const requestDeadline = earliestIso(requestDeadlines);
  // Begrenset konkurranse: tilbudsfristen settes først i invitasjonen. Da er fristen for å be om
  // å delta den fristen leverandøren må handle på.
  const deadlineAt = tenderDeadline ?? requestDeadline;
  const deadlineKind = tenderDeadline ? 'tender' : requestDeadline ? 'participation' : null;
  const deadlineTimeKnown = tenderDeadline ? tenderTimeKnown : requestDeadline ? requestTimeKnown : false;

  const published = tedScalar(hit['publication-date']);
  const isAward = lifecycle === 'awarded';

  // Delkontrakter
  const lotIds = tedList(hit['identifier-lot']);
  const lotTitles = tedList(hit['title-lot']);
  const lotValues = tedList(hit['estimated-value-lot']);
  const durValues = tedList(hit['duration-period-value-lot']);
  const durUnits = tedList(hit['duration-period-unit-lot']);
  const durations = durValues.map((v, i) => durationFrom(v, durUnits.length === durValues.length ? durUnits[i] : durUnits[0]));
  const lotCount = Math.max(lotIds.length, lotTitles.length);
  const lots: NoticeLot[] =
    lotCount > 1
      ? Array.from({ length: lotCount }, (_, i) => ({
          id: lotIds.length === lotCount ? (lotIds[i] ?? null) : null,
          title: lotTitles.length === lotCount ? (stripHtml(lotTitles[i])?.slice(0, 1000) ?? null) : null,
          estimatedValue: lotValues.length === lotCount ? toNumber(lotValues[i]) : null,
          durationText: durations.length === lotCount ? (durations[i]?.text ?? null) : null,
        }))
      : [];

  // Verdi: hele anskaffelsen, ellers summen av delkontraktene når alle har verdi.
  const procValue = tedNumber(hit['estimated-value-proc']);
  const lotNumbers = lotValues.map(toNumber);
  const lotSum = lotNumbers.length > 0 && lotNumbers.every((v) => v !== null) ? lotNumbers.reduce<number>((a, b) => a + (b ?? 0), 0) : null;
  const estimated = isAward ? null : (procValue ?? lotSum);
  const currency =
    (tedScalar(hit['estimated-value-cur-proc']) ?? tedScalar(hit['estimated-value-cur-lot']) ?? tedScalar(hit['total-value-cur']))?.toUpperCase() ?? null;

  // Varighet
  const validDurations = durations.filter((d): d is { months: number; text: string } => d !== null);
  const distinctDurations = [...new Set(validDurations.map((d) => d.text))];
  const durationText = distinctDurations.length === 0 ? null : distinctDurations.length === 1 ? distinctDurations[0]! : `${distinctDurations.join(' / ')} (ulikt per delkontrakt)`;
  const durationMonths = validDurations.length ? Math.max(...validDurations.map((d) => d.months)) : null;
  const starts = tedList(hit['contract-duration-start-date-lot']).map((d) => combineDateTime(d, null).iso).filter((d): d is string => d !== null);
  const ends = tedList(hit['contract-duration-end-date-lot']).map((d) => combineDateTime(d, null).iso).filter((d): d is string => d !== null);

  // Tildeling
  const awards: NoticeAward[] = [];
  if (isAward) {
    const winnerNames = tedList(hit['winner-name']).map((w) => w.trim()).filter(Boolean);
    const winnerIds = tedList(hit['winner-identifier']);
    const unique = [...new Set(winnerNames)];
    const total = tedNumber(hit['total-value']);
    const decision = earliestIso(tedList(hit['winner-decision-date']).map((d) => combineDateTime(d, null).iso).filter((d): d is string => d !== null));
    const pairedIds = winnerIds.length === winnerNames.length;
    const lotPaired = lotTitles.length === winnerNames.length && winnerNames.length > 1;
    winnerNames.forEach((name, i) => {
      const orgNo = pairedIds ? (winnerIds[i] ?? null) : unique.length === 1 && winnerIds.length === 1 ? winnerIds[0]! : null;
      awards.push({
        lotTitle: lotPaired ? (stripHtml(lotTitles[i])?.slice(0, 1000) ?? null) : null,
        supplierName: name.slice(0, 500),
        supplierOrgNumber: orgNo,
        // Verdien knyttes kun til leverandøren når det er én vinner; ellers er fordelingen ukjent.
        value: unique.length === 1 ? total : null,
        currency: (tedScalar(hit['total-value-cur']) ?? currency)?.toUpperCase() ?? null,
        awardDate: decision ? decision.slice(0, 10) : null,
      });
    });
  }

  const title = tedTitle(hit);
  const description = tedText(hit['description-proc']);
  const frameworkValues = tedList(hit['framework-agreement-lot']).map((v) => v.toLowerCase());
  const documentsUrl = httpUrls(tedList(hit['document-url-lot']))[0] ?? null;
  const submissionUrl = httpUrls(tedList(hit['submission-url-lot']))[0] ?? null;

  const details: NoticeDetails = {
    noticeIdentifier: tedScalar(hit['notice-identifier']),
    noticeVersion: toNumber(tedScalar(hit['notice-version'])),
    questionsDeadlineAt: earliestIso(questionDeadlines),
    participationDeadlineAt: requestDeadline,
    deadlineKind,
    lotDeadlinesDiffer: new Set(deadlineKind === 'participation' ? requestDeadlines : tenderDeadlines).size > 1,
    durationMonths,
    durationText,
    contractStart: earliestIso(starts),
    contractEnd: [...ends].sort().at(-1) ?? null,
    submissionUrl,
    lots,
    selectionCriteria: dedupeTexts(tedList(hit['selection-criterion-description-lot']), 30, 4000),
    awardCriteria: tedAwardCriteria(hit),
    isFramework: frameworkValues.length ? frameworkValues.some((v) => v !== 'none') : null,
    changeDescription: dedupeTexts(tedList(hit['change-description']), 10, 1000).join('\n') || null,
    language: title.lang ?? description.lang,
  };

  return {
    source: 'ted',
    sourceNoticeId: pubNo,
    sourceUrl: `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(pubNo)}`,
    noticeType,
    lifecycle,
    procedureId: tedScalar(hit['procedure-identifier']),
    buyerReference: tedScalar(hit['internal-identifier-proc']),
    title: (stripHtml(title.text) ?? `TED ${pubNo}`).slice(0, 1000),
    description: meaningful(stripHtml(description.text)),
    buyerName: meaningful(tedScalar(hit['buyer-name'])),
    buyerOrgNumber: orgNumber,
    buyerCity: tedScalar(hit['buyer-city']),
    countryCode: country,
    nutsCodes: nuts,
    placeText: tedScalar(hit['buyer-city']),
    cpvCodes: cpv,
    mainCpv: mostSpecificCpv(cpv),
    contractNature: contractNature(tedScalar(hit['contract-nature'])),
    procedureType: tedScalar(hit['procedure-type']),
    estimatedValue: estimated,
    currency: estimated !== null || awards.length ? currency : null,
    publishedAt: published ? `${published.slice(0, 10)}T00:00:00Z` : null,
    deadlineAt,
    deadlineTimeKnown,
    documentsUrl,
    receivedTenders: null,
    awards,
    details,
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

export interface TedPage {
  notices?: Record<string, unknown>[];
  iterationNextToken?: string | null;
  totalNoticeCount?: number;
  timedOut?: boolean;
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
        query: buildTedQuery(window, window.countryIso3 ?? 'NOR'),
        fields: TED_FIELDS,
        limit: 100,
        scope: 'ALL',
        paginationMode: 'ITERATION',
        checkQuerySyntax: false,
      };
      if (token) body.iterationNextToken = token;
      let data: TedPage | null = null;
      // TED kan svare «timedOut: true» med ufullstendige treff. Da prøver vi siden én gang til.
      for (let attempt = 0; attempt < 2 && !data; attempt++) {
        const res = await fetchWithRetry(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': `AnbudRadar/1.0 (+${env.APP_URL})` },
          body: JSON.stringify(body),
        }, { timeoutMs: 60_000 });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new ConnectorError(`TED svarte ${res.status}: ${text.slice(0, 300)}`, res.status);
        }
        const parsed = (await res.json()) as TedPage;
        if (parsed.timedOut && attempt === 0) {
          await sleep(2000);
          continue;
        }
        if (parsed.timedOut) {
          await onError(null, 'TED svarte «timedOut» to ganger – hentingen stoppet før alle sider var lest. Neste kjøring henter resten.', null);
          return out.slice(0, limit);
        }
        data = parsed;
      }
      const notices = data?.notices ?? [];
      for (const hit of notices) {
        try {
          out.push(mapTedNotice(hit));
        } catch (err) {
          await onError(tedScalar(hit['publication-number']), err instanceof Error ? err.message : String(err), hit);
        }
      }
      token = data?.iterationNextToken ?? null;
      if (!token || notices.length === 0) break;
      await sleep(500); // Skånsom mot API-et.
    }
    return out.slice(0, limit);
  },
};
