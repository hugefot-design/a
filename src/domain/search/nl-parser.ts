/**
 * Tolker søk på naturlig språk (norsk og engelsk) til strukturerte filtre – uten AI.
 * Eksempel: «byggekontrakter i Trøndelag over 5 millioner med frist om minst 30 dager»
 *
 * Alt som tolkes vises for brukeren som «Tolket som …», så ingenting skjer skjult.
 */
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import type { TenderQuery, TenderStatus } from './filters';

export interface ParsedNaturalQuery {
  query: Partial<TenderQuery>;
  interpretations: string[];
  remainder: string;
}

const NUM = String.raw`(\d{1,3}(?:[   .]\d{3})+|\d+(?:[.,]\d+)?)`;
const MONEY_UNIT = String.raw`(?:(milliarder|milliard|mrd\.?|billion|bn|millioner|millions|million|mill\.?|mnok|mkr|kroner|kr\.?|nok|tusen|thousand|m|k)(?![\p{L}\p{N}]))`;
const TIME_UNIT = String.raw`(døgn|dager|dag|days|day|uker|uke|weeks|week|måneder|måned|mnd|months|month)`;

function parseNumber(raw: string): number {
  const compact = raw.replace(/[   ]/g, '');
  // "5.000.000" (tusenskille) vs "5.5" (desimal)
  if (/^\d{1,3}(\.\d{3})+$/.test(compact)) return Number(compact.replace(/\./g, ''));
  return Number(compact.replace(',', '.'));
}

function moneyMultiplier(unit: string | undefined): number {
  if (!unit) return 1;
  const u = unit.replace(/\.$/, '');
  if (['milliarder', 'milliard', 'mrd', 'billion', 'bn'].includes(u)) return 1e9;
  if (['millioner', 'million', 'millions', 'mill', 'mnok', 'mkr', 'm'].includes(u)) return 1e6;
  if (['tusen', 'thousand', 'k'].includes(u)) return 1e3;
  return 1;
}

function daysFor(n: number, unit: string): number {
  if (/^(uke|uker|week|weeks)$/.test(unit)) return n * 7;
  if (/^(måned|måneder|mnd|month|months)$/.test(unit)) return n * 30;
  return n;
}

function formatNok(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} mrd. kr`;
  if (value >= 1e6) return `${(value / 1e6).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} mill. kr`;
  return `${value.toLocaleString('nb-NO')} kr`;
}

const B = String.raw`(?<![\p{L}\p{N}-])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const word = (alternatives: string) => new RegExp(`${B}(?:${alternatives})${E}`, 'u');

const COUNTRY_WORDS: [RegExp, string][] = [
  [word('norge|norway|norsk|norske|norwegian'), 'NO'],
  [word('sverige|sweden|svensk|svenske|swedish'), 'SE'],
  [word('danmark|denmark|dansk|danske|danish'), 'DK'],
  [word('finland|finsk|finske|finnish'), 'FI'],
  [word('tyskland|germany|tysk|tyske|german'), 'DE'],
];

const REGION_WORDS: [RegExp, string[]][] = [
  [/midt[- ]norge|central norway/u, ['50', '15']],
  [/nord[- ]norge|northern norway/u, ['18', '55', '56']],
  [/vestlandet|western norway/u, ['11', '46', '15']],
  [/østlandet|eastern norway/u, ['03', '32', '31', '33', '34', '39', '40']],
  [/sørlandet|southern norway/u, ['42']],
  [/møre og romsdal|more og romsdal/u, ['15']],
  [/trøndelag|trondelag/u, ['50']],
  [word('oslo'), ['03']],
  [/akershus/u, ['32']],
  [/østfold|ostfold/u, ['31']],
  [/buskerud/u, ['33']],
  [/innlandet/u, ['34']],
  [/vestfold/u, ['39']],
  [/telemark/u, ['40']],
  [word('agder'), ['42']],
  [/rogaland/u, ['11']],
  [word('vestland'), ['46']],
  [/nordland/u, ['18']],
  [word('troms'), ['55']],
  [/finnmark/u, ['56']],
];

const CITIES = [
  'trondheim', 'bergen', 'stavanger', 'tromsø', 'bodø', 'kristiansand', 'drammen', 'fredrikstad', 'ålesund', 'levanger',
  'verdal', 'steinkjer', 'stjørdal', 'namsos', 'hamar', 'lillehammer', 'gjøvik', 'tønsberg', 'skien', 'porsgrunn', 'arendal',
  'grimstad', 'haugesund', 'sandnes', 'molde', 'kristiansund', 'alta', 'harstad', 'narvik', 'hammerfest', 'sarpsborg', 'halden',
  'moss', 'lillestrøm', 'bærum', 'asker', 'kongsberg', 'larvik', 'sandefjord', 'førde', 'florø', 'mo i rana', 'kirkenes', 'vadsø',
];

const INDUSTRY_WORDS: [RegExp, string][] = [
  [/(cyber\s?security|cybersikkerhet|it-sikkerhet|it sikkerhet|informasjonssikkerhet|information security|pentest\w*|penetrasjonstest\w*|sikkerhetstest\w*|\bsoc\b)/u, 'cybersecurity'],
  [/(security services|guarding|\bguards?\b|vakthold|vekter\w*|vakttjeneste\w*|sikkerhetstjeneste\w*|alarmmottak|\bvakt\b)/u, 'security'],
  [/(bygg\w*|anlegg\w*|entrepren\w*|entreprise\w*|construction|building|civil engineering|rehabilitering|renovering)/u, 'construction'],
  [/(\bit\b|it-tjeneste\w*|programvare|software|skytjeneste\w*|\bcloud\b|\bsaas\b|digitalisering|fagsystem\w*)/u, 'it'],
  [/(helse\w*|medisinsk\w*|medical|healthcare|sykehus\w*|legemid\w*|pharma\w*)/u, 'healthcare'],
  [/(renhold\w*|rengjøring\w*|cleaning|vaktmester\w*|facility management|facilities|eiendomsdrift)/u, 'cleaning'],
  [/(transport\w*|logistikk|logistics|skoleskyss|pasienttransport|frakt)/u, 'transport'],
  [/(rådgiv\w*|konsulent\w*|consulting|consultancy|advisory|utredning\w*)/u, 'consulting'],
  [/(energi\w*|\benergy\b|\bstrøm\b|solcelle\w*|\bsolar\b|enøk|fjernvarme)/u, 'energy'],
  [/(miljøtjeneste\w*|avfall\w*|renovasjon\w*|\bwaste\b|environmental|gjenvinning)/u, 'environmental'],
  [/(produksjon\w*|manufacturing|industri\w*|maskiner)/u, 'manufacturing'],
  [/(vedlikehold\w*|maintenance|reparasjon\w*|serviceavtale\w*)/u, 'maintenance'],
  [/(telekom\w*|telecom\w*|bredbånd\w*|\bfiber\w*|mobiltelefon\w*|telefoni)/u, 'telecom'],
];

const STATUS_WORDS: [RegExp, TenderStatus[]][] = [
  [word('tildelt|tildelte|awarded'), ['awarded']],
  [word('planlagte|forhåndskunngjøringer|forhåndskunngjøring|planned|prior information'), ['planned']],
  [word('åpne|aktive|open|active'), ['open']],
];

const STOPWORDS = new Set(
  (
    'finn find vis show me meg søk search etter after for contracts contract kontrakter kontrakt kontraktene anbud anbudet tenders tender ' +
    'opportunities opportunity oppdrag konkurranser konkurranse kunngjøringer kunngjøring i in på on at med with som that worth verdt verdi ' +
    'value valued of av og and the a an en et ei til to from fra all alle nye new offentlige offentlig public procurement procurements ' +
    'anskaffelser anskaffelse innkjøp deadline deadlines frist frister fristen away unna er is are har have mer more than enn over under ' +
    'minst least innen within publisert published siste last kommune kommuner fylke region regionen rundt around near nær hele whole ' +
    'which hvilke hva what any noen gi give list liste jobber jobs work arbeid tjenester tjeneste services service leveranser'
  ).split(' '),
);

export function parseNaturalQuery(input: string): ParsedNaturalQuery {
  const query: Partial<TenderQuery> = {};
  const interpretations: string[] = [];
  let text = ` ${input.toLowerCase().normalize('NFC').replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ')} `;
  const consume = (match: string) => {
    text = text.replace(match, ' ');
  };

  // --- Verdi: intervall -------------------------------------------------------
  const range = new RegExp(String.raw`(?:mellom|between)\s+${NUM}\s*${MONEY_UNIT}?\s*(?:og|and|-|–)\s*${NUM}\s*${MONEY_UNIT}?`, 'u').exec(text);
  if (range) {
    const unitB = range[4];
    const unitA = range[2] ?? unitB;
    const min = parseNumber(range[1]!) * moneyMultiplier(unitA);
    const max = parseNumber(range[3]!) * moneyMultiplier(unitB);
    if (min > 0 && max >= min) {
      query.valueMin = Math.round(min);
      query.valueMax = Math.round(max);
      interpretations.push(`Verdi: ${formatNok(min)} – ${formatNok(max)}`);
      consume(range[0]);
    }
  }

  // --- Frist og publisering (tidsenheter) ------------------------------------
  const deadlinePatterns: [RegExp, 'min' | 'max'][] = [
    [new RegExp(String.raw`(?:frist\w*|deadlines?|closing|stenger)?\s*(?:om|in)?\s*(?:minst|at least|mer enn|more than|over)\s+${NUM}\s*${TIME_UNIT}(?:\s*(?:unna|away|frem|fram|igjen|left|from now))?`, 'u'), 'min'],
    [new RegExp(String.raw`(?:frist\w*|deadlines?|closing|stenger)\s*(?:om\s+)?(?:innen|within|under|mindre enn|less than|i løpet av)\s+${NUM}\s*${TIME_UNIT}`, 'u'), 'max'],
    [new RegExp(String.raw`(?:frist\w*|deadlines?|closing|stenger)\s+(?:om|in)\s+${NUM}\s*${TIME_UNIT}`, 'u'), 'max'],
  ];
  for (const [re, kind] of deadlinePatterns) {
    const m = re.exec(text);
    if (!m) continue;
    const days = daysFor(parseNumber(m[1]!), m[2]!);
    if (kind === 'min') {
      query.deadlineMinDays = days;
      interpretations.push(`Frist: om minst ${days} dager`);
    } else {
      query.deadlineMaxDays = days;
      interpretations.push(`Frist: innen ${days} dager`);
    }
    consume(m[0]);
  }
  if (/frist\w*\s+(neste uke|next week)|deadline\w*\s+next week/u.test(text)) {
    query.deadlineMaxDays = 14;
    query.deadlineMinDays = query.deadlineMinDays ?? 0;
    interpretations.push('Frist: innen 14 dager');
    text = text.replace(/frist\w*\s+(neste uke|next week)|deadline\w*\s+next week/u, ' ');
  }
  const published = new RegExp(String.raw`(?:publisert|published|lagt ut|nye|new)\s*(?:i\s+|in\s+)?(?:de\s+|the\s+)?(?:siste|last|past)\s+(?:${NUM}\s*)?${TIME_UNIT}`, 'u').exec(text);
  if (published) {
    const n = published[1] ? parseNumber(published[1]) : 1;
    const days = daysFor(n, published[2]!);
    query.publishedWithinDays = days;
    interpretations.push(`Publisert: siste ${days} dager`);
    consume(published[0]);
  }

  // --- Verdi: minimum / maksimum ---------------------------------------------
  const valuePatterns: [RegExp, 'min' | 'max'][] = [
    [new RegExp(String.raw`(?:over|mer enn|more than|above|greater than|minst|at least|fra|from|større enn|worth more than|worth over|>\s*=?)\s*${NUM}\s*${MONEY_UNIT}?`, 'u'), 'min'],
    [new RegExp(String.raw`(?:under|mindre enn|less than|below|maks|max|maximum|inntil|up to|worth less than|<\s*=?)\s*${NUM}\s*${MONEY_UNIT}?`, 'u'), 'max'],
  ];
  for (const [re, kind] of valuePatterns) {
    if ((kind === 'min' && query.valueMin !== undefined) || (kind === 'max' && query.valueMax !== undefined)) continue;
    const m = re.exec(text);
    if (!m) continue;
    // Tall uten pengeenhet tolkes som beløp bare hvis de er store nok til å være kroner.
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12);
    if (new RegExp(String.raw`^\s*${TIME_UNIT}`, 'u').test(after)) continue;
    const amount = parseNumber(m[1]!) * moneyMultiplier(m[2]);
    if (!m[2] && amount < 1000) continue;
    if (kind === 'min') {
      query.valueMin = Math.round(amount);
      interpretations.push(`Verdi: over ${formatNok(amount)}`);
    } else {
      query.valueMax = Math.round(amount);
      interpretations.push(`Verdi: under ${formatNok(amount)}`);
    }
    consume(m[0]);
  }
  text = text.replace(/\b(kr|nok|kroner|mnok)\b/gu, ' ');

  // --- Status, land, regioner, sted, bransjer --------------------------------
  for (const [re, statuses] of STATUS_WORDS) {
    const m = re.exec(text);
    if (m) {
      query.statuses = [...new Set([...(query.statuses ?? []), ...statuses])];
      consume(m[0]);
    }
  }
  if (query.statuses?.length) interpretations.push(`Status: ${query.statuses.map((s) => ({ open: 'åpne', awarded: 'tildelte', planned: 'planlagte' })[s as 'open'] ?? s).join(', ')}`);

  const regions = new Set<string>();
  for (const [re, codes] of REGION_WORDS) {
    const m = re.exec(text);
    if (m) {
      codes.forEach((c) => regions.add(c));
      consume(m[0]);
    }
  }
  if (regions.size) {
    query.regions = [...regions];
    interpretations.push(`Fylke: ${[...regions].map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ')}`);
  }

  const countries = new Set<string>();
  for (const [re, code] of COUNTRY_WORDS) {
    const m = re.exec(text);
    if (m) {
      countries.add(code);
      consume(m[0]);
    }
  }
  if (countries.size) {
    query.countries = [...countries];
    const names: Record<string, string> = { NO: 'Norge', SE: 'Sverige', DK: 'Danmark', FI: 'Finland', DE: 'Tyskland' };
    interpretations.push(`Land: ${[...countries].map((c) => names[c]).join(', ')}`);
  }

  for (const city of CITIES) {
    const m = new RegExp(String.raw`(^|[^\p{L}])${city}([^\p{L}]|$)`, 'u').exec(text);
    if (m) {
      query.place = city.replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
      interpretations.push(`Sted: ${query.place}`);
      consume(city);
      break;
    }
  }

  const industries = new Set<string>();
  for (const [re, id] of INDUSTRY_WORDS) {
    const global = new RegExp(re.source, 'gu');
    let m: RegExpExecArray | null;
    let found = false;
    while ((m = global.exec(text)) !== null) {
      found = true;
      text = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length);
    }
    if (found) industries.add(id);
  }
  if (industries.size) {
    query.industries = [...industries];
    interpretations.push(`Bransje: ${[...industries].map((i) => INDUSTRY_BY_ID.get(i)?.name ?? i).join(', ')}`);
  }

  // --- Resten blir søkeord -----------------------------------------------------
  const standards: string[] = [];
  text = text.replace(/(?<![\p{L}])(iso|ns|ns-en)\s?(\d{3,5})(?![\p{N}])/gu, (_m, a: string, b: string) => {
    standards.push(`${a} ${b}`);
    return ' ';
  });
  const remainderWords = text
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^[\d-]+$/.test(w) && !/^-|-$/.test(w));
  const remainder = [...standards, ...remainderWords].join(' ');
  if (remainder) {
    query.q = remainder;
    interpretations.push(`Søkeord: ${remainder}`);
  }
  return { query, interpretations, remainder };
}
