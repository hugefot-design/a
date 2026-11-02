/**
 * Søk etter kontraktsvilkår med økonomisk betydning i kunngjøringen og opplastede dokumenter –
 * uten AI. Hvert treff viser dokument, side og tekstutdraget, så brukeren kan sjekke det selv.
 * Brukes som førstelinje (også når AI ikke er tilgjengelig) og som kryssjekk av AI-funnene.
 */
import type { AnalysisSource } from '@/domain/ai/sources';

export type TermCategory =
  | 'dagbot'
  | 'betalingsvilkar'
  | 'prisregulering'
  | 'garanti'
  | 'erstatningsansvar'
  | 'leveringsfrist'
  | 'forsikring'
  | 'volum'
  | 'standardkontrakt';

export const TERM_LABELS: Record<TermCategory, string> = {
  dagbot: 'Dagbøter og sanksjoner',
  betalingsvilkar: 'Betalingsvilkår',
  prisregulering: 'Prisregulering',
  garanti: 'Garantier og sikkerhetsstillelse',
  erstatningsansvar: 'Erstatningsansvar og ansvarsbegrensning',
  leveringsfrist: 'Leveringsfrister',
  forsikring: 'Forsikring',
  volum: 'Volum og opsjoner',
  standardkontrakt: 'Standardkontrakt',
};

const PATTERNS: Record<TermCategory, RegExp> = {
  dagbot: /dagbot|dagmulkt|dagsbot|konvensjonalbot|liquidated damages|delay penalt|penalty for delay/i,
  betalingsvilkar: /betalingsfrist|betalingsbetingelse|betalingsvilkår|betales innen|netto \d+ dager|\d+ dager netto|payment terms|payment within|within \d+ days of (invoice|receipt)/i,
  prisregulering: /prisregulering|indeksregulering|konsumprisindeks|\bKPI\b|SSB[- ]indeks|prisjustering|price adjustment|indexation|price index|fastpris|faste priser|prisene er faste|priser(ne)? (er|skal være) faste|priser(ne)? (kan|skal) ikke (justeres|reguleres)|fixed price|prices (are|shall be) fixed/i,
  garanti: /bankgaranti|morselskapsgaranti|selvskyldnergaranti|sikkerhetsstillelse|garantistillelse|kontraktsgaranti|performance bond|parent company guarantee|bank guarantee/i,
  erstatningsansvar: /erstatningsansvar|ansvarsbegrensning|ansvarsbegrens|indirekte tap|skadesløs|holde oppdragsgiver skadesløs|limitation of liability|liability cap|indemnif|consequential loss/i,
  leveringsfrist: /leveringsfrist|ferdigstillelsesfrist|overtakelse|oppstartsdato|innen \d+ (virke)?dager|innen \d+ uker|delivery time|completion date|commencement date/i,
  forsikring: /ansvarsforsikring|yrkesskadeforsikring|forsikringssum|insurance/i,
  volum: /ingen garanti for (volum|omfang)|uten (forpliktelse|garantert volum)|estimert (volum|omfang)|ikke forpliktet til å|no guaranteed volume|non[- ]binding (estimate|volume)|opsjon(er)? på|option(s)? to extend/i,
  standardkontrakt: /NS ?84\d\d|NS ?8401|NS ?8402|NS ?8405|NS ?8406|NS ?8407|SSA[- ][A-Z]{1,3}\b|statens standardavtale/i,
};

export interface TermHit {
  category: TermCategory;
  sourceId: string;
  sourceTitle: string;
  page: number | null;
  snippet: string;
  /** Ordet eller uttrykket som ga treffet. */
  match: string;
}

export interface TermScan {
  hits: TermHit[];
  byCategory: Partial<Record<TermCategory, TermHit[]>>;
  /** Kategorier som ikke ble funnet i noen kilde. */
  notFound: TermCategory[];
  documentsScanned: number;
  noticeOnly: boolean;
}

function snippetAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 120);
  const end = Math.min(text.length, index + length + 160);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`;
}

export function scanContractTerms(sources: AnalysisSource[], maxPerCategoryPerSource = 3): TermScan {
  const hits: TermHit[] = [];
  for (const source of sources) {
    for (const category of Object.keys(PATTERNS) as TermCategory[]) {
      const re = new RegExp(PATTERNS[category].source, 'gi');
      let found = 0;
      for (const page of source.pages) {
        if (found >= maxPerCategoryPerSource) break;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(page.text)) && found < maxPerCategoryPerSource) {
          hits.push({ category, sourceId: source.id, sourceTitle: source.title, page: page.page, snippet: snippetAround(page.text, m.index, m[0].length), match: m[0] });
          found++;
          // Hopp videre så samme setning ikke gir flere treff.
          re.lastIndex = m.index + m[0].length + 200;
        }
      }
    }
  }
  const byCategory: Partial<Record<TermCategory, TermHit[]>> = {};
  for (const h of hits) (byCategory[h.category] ??= []).push(h);
  const notFound = (Object.keys(PATTERNS) as TermCategory[]).filter((c) => !byCategory[c]?.length && c !== 'standardkontrakt');
  const documentsScanned = sources.filter((s) => s.kind === 'document').length;
  return { hits, byCategory, notFound, documentsScanned, noticeOnly: documentsScanned === 0 };
}
