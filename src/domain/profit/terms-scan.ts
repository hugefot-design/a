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
  dagbot: /dagb[oø]t|dagmulkt|dagsb[oø]t|konvensjonalb[oø]t|liquidated damages|delay penalt|penalty for delay/i,
  betalingsvilkar: /betalingsfrist|betalingsbetingelse|betalingsvilkår|betales innen|netto \d+ dager|\d+ dager netto|payment terms|payment within|within \d+ days of (invoice|receipt)/i,
  prisregulering: /prisregulering|indeksregulering|konsumprisindeks|\bKPI\b|SSB[- ]indeks|prisjustering|price adjustment|indexation|price index|fastpris|faste priser|prisene er faste|priser(ne)? (er|skal være) faste|priser(ne)? (kan|skal) ikke (justeres|reguleres)|fixed price|prices (are|shall be) fixed/i,
  garanti: /bankgaranti|morselskapsgaranti|selvskyldnergaranti|sikkerhetsstillelse|garantistillelse|kontraktsgaranti|performance bond|parent company guarantee|bank guarantee/i,
  erstatningsansvar: /erstatningsansvar|ansvarsbegrensning|ansvarsbegrens|indirekte tap|skadesløs|holde oppdragsgiver skadesløs|limitation of liability|liability cap|indemnif|consequential loss/i,
  leveringsfrist: /leveringsfrist|ferdigstillelsesfrist|overtakelse|oppstartsdato|innen \d+ (virke)?dager|innen \d+ uker|delivery time|completion date|commencement date/i,
  forsikring: /ansvarsforsikring|yrkesskadeforsikring|forsikringssum|\bforsikring|insurance/i,
  volum: /ingen garanti for (volum|omfang)|uten (forpliktelse|garantert volum)|estimert (volum|omfang)|ikke forpliktet til å|no guaranteed volume|non[- ]binding (estimate|volume)|opsjon(er)? på|forlengelsesopsjon|kan forlenges|option(s)? to extend/i,
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
  /** Teksten ser ut til å si at vilkåret ikke gjelder («Det vil ikke bli ilagt dagbot.»). Heuristikk – vises med utdraget. */
  negated: boolean;
}

export interface TermScan {
  hits: TermHit[];
  byCategory: Partial<Record<TermCategory, TermHit[]>>;
  /** Kategorier som ikke ble funnet i noen kilde. */
  notFound: TermCategory[];
  /** Kategorier der alle treff ser ut til å si at vilkåret ikke gjelder. */
  negatedOnly: TermCategory[];
  documentsScanned: number;
  noticeOnly: boolean;
}

// ---------------------------------------------------------------------------
// Nektelser: «Det vil ikke bli ilagt dagbot», «Dagbot gjelder ikke for denne avtalen».
//
// Bevisst forsiktig: et ekte vilkår som feilaktig merkes «gjelder ikke» er verre enn en nektelse vi
// ikke oppdager (da står treffet bare som et vanlig funn brukeren leser). Derfor:
// - bare kategorier der nektelsen betyr mindre forpliktelse. «Ingen ansvarsbegrensning» og «ingen
//   prisregulering» betyr MER risiko og skal aldri merkes som ikke gjeldende;
// - nektelsesordet må stå i samme leddsetning, med høyst to faste fyllord imellom («ikke krav om»,
//   «ikke bli ilagt») – ikke «Ved ikke rettidig levering påløper dagbot»;
// - resten av setningen må være tom eller bare si hvor nektelsen gjelder («i denne avtalen»).
//   Forbehold som «ved force majeure», «utover 100 dager» eller «men morselskapsgaranti» gir ingen merking.
// ---------------------------------------------------------------------------
const NEGATABLE = new Set<TermCategory>(['dagbot', 'garanti', 'forsikring']);
const NEG_WORDS = new Set(['ingen', 'ikke', 'ikkje', 'uten', 'utan', 'no', 'not', 'without']);
const FILLERS = new Set([
  'krav', 'om', 'til', 'bestemmelse', 'bestemmelser', 'regler', 'noen', 'form', 'for', 'bli',
  'ilagt', 'ilagd', 'ilegge', 'ilegges', 'kreve', 'kreves', 'krevd', 'stille', 'stilles', 'stilt', 'betale', 'betales', 'benyttes', 'brukes',
  'any', 'a', 'an', 'be', 'required', 'imposed', 'charged', 'requirement',
]);
// Det som kan stå etter treffet uten at det er et forbehold: resten av ordet, et verb og «i denne avtalen».
const REST_WORD = String.raw`[\p{L}\d-]*`;
const REST_VERB = String.raw`(?:\s+(?:påløper|gjelder|gjeld|kreves|ilegges|stilles|apply|applies|will apply|shall apply|is required|are required))?`;
const REST_SCOPE = String.raw`(?:\s+(?:(?:i|for|under)\s+(?:denne|dette|den|hele)\s+[\p{L}-]+|i avtaleperioden|for oppdraget|(?:in|under|for) this \w+))?`;
const CLEAN_REST = new RegExp(`^${REST_WORD}${REST_VERB}${REST_SCOPE}\\s*$`, 'iu');
const NEG_AFTER = new RegExp(
  `^${REST_WORD}\\s+(?:gjelder ikke|gjeld ikkje|kommer ikke til anvendelse|er ikke aktuelt?|kreves ikke|ilegges ikke|stilles ikke|` +
    `skal ikke (?:ilegges|betales|kreves|stilles|anvendes|benyttes)|vil ikke (?:bli (?:ilagt|krevd|stilt|anvendt)|komme til anvendelse)|` +
    `blir ikke (?:ilagt|krevd|stilt|anvendt)|does not apply|do not apply|shall not apply|will not apply|(?:is|are) not applicable|` +
    `will not be (?:applied|imposed|required|charged))${REST_SCOPE}\\s*$`,
  'iu',
);

function negatedBefore(clause: string): boolean {
  const words = clause.trim().split(/\s+/).filter(Boolean).map((w) => w.toLowerCase().replace(/[«»"'()]/g, ''));
  for (let fillers = 0; fillers <= 2 && fillers < words.length; fillers++) {
    const neg = words[words.length - 1 - fillers]!;
    if (NEG_WORDS.has(neg) && words.slice(words.length - fillers).every((w) => FILLERS.has(w))) return true;
  }
  return false;
}

/** Om treffet (fra `index`, lengde `length`) står i en setning som sier at vilkåret ikke gjelder. */
export function isNegated(text: string, index: number, length: number, category?: TermCategory): boolean {
  if (category && !NEGATABLE.has(category)) return false;
  // Enkle linjeskift kommer ofte fra PDF-ombrekking midt i en setning; tom linje skiller avsnitt.
  const clause = text.slice(Math.max(0, index - 80), index).split(/[.,;:!?()]|\n\s*\n/).pop() ?? '';
  const rest = (text.slice(index + length, index + length + 160).split(/[.;!?]|\n\s*\n/)[0] ?? '').replace(/\s+/g, ' ').trimEnd();
  if (negatedBefore(clause)) return CLEAN_REST.test(rest);
  return NEG_AFTER.test(rest);
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
      let negatedFound = 0;
      for (const page of source.pages) {
        if (found >= maxPerCategoryPerSource) break;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(page.text)) && found < maxPerCategoryPerSource) {
          const negated = isNegated(page.text, m.index, m[0].length, category);
          if (!negated || negatedFound < maxPerCategoryPerSource) {
            hits.push({
              category,
              sourceId: source.id,
              sourceTitle: source.title,
              page: page.page,
              snippet: snippetAround(page.text, m.index, m[0].length),
              match: m[0],
              negated,
            });
          }
          if (negated) {
            // Teller ikke mot grensen, og neste setning leses: «Det kreves ikke bankgaranti. Det kreves morselskapsgaranti.»
            negatedFound++;
            re.lastIndex = m.index + m[0].length;
          } else {
            found++;
            // Hopp videre så samme setning ikke gir flere treff.
            re.lastIndex = m.index + m[0].length + 200;
          }
        }
      }
    }
  }
  const byCategory: Partial<Record<TermCategory, TermHit[]>> = {};
  for (const h of hits) (byCategory[h.category] ??= []).push(h);
  const notFound = (Object.keys(PATTERNS) as TermCategory[]).filter((c) => !byCategory[c]?.length && c !== 'standardkontrakt');
  const negatedOnly = (Object.keys(byCategory) as TermCategory[]).filter((c) => byCategory[c]!.every((h) => h.negated));
  const documentsScanned = sources.filter((s) => s.kind === 'document').length;
  return { hits, byCategory, notFound, negatedOnly, documentsScanned, noticeOnly: documentsScanned === 0 };
}
