/**
 * Ordene bedriften bruker om det den leverer, mot ordene i kunngjøringen.
 *
 * Norske fagord er ofte sammensatte, og bedriften og oppdragsgiveren bruker sjelden samme form: «vakthold» og
 * «vakttjenester», «elektroinstallasjon» og «elektriske fordelinger», «brøyting» og «snøbrøyting». Kundesimuleringen
 * 16.11.2026 (docs/KUNDESIMULERING.md) viste at et vaktselskap og en elektriker derfor ikke fikk opp anbudene som
 * faktisk var deres. To regler, begge bare i treffmotoren (containsTerm brukes uendret alle andre steder):
 *
 * 1. Et ord teller når kunngjøringen har et ord som begynner med det (som før), og et langt ord (minst 7 bokstaver)
 *    teller også inne i et sammensatt ord: «renhold» i «kontorrenhold», «brøyting» i «snøbrøyting».
 * 2. Vanlige fagord er samlet i små grupper. Bruker bedriften ett av dem, ser vi også etter de andre: «vakthold» gir
 *    også «vakttjenester» og «vektertjenester». Gruppene er bevisst snevre – «vakt» alene er ikke med, fordi
 *    «vaktmester» er noe helt annet.
 *
 * Ingen AI og ingen gjetting: listen står her og på metodesiden, og samme ord gir alltid samme resultat.
 */

/** Ord som ikke sier noe om hva bedriften leverer. */
export const STOP_WORDS = new Set(
  'og i på av for til med som det den de en et er vi oss vår våre har kan skal fra om ved alle innen samt eller både mer leverer levering tjenester tjeneste produkter produkt'.split(
    ' ',
  ),
);

/** Ord med minst så mange bokstaver teller også inne i et sammensatt ord. */
export const MIN_INNER_LENGTH = 7;

/**
 * Faggrupper: ordstammer som betyr det samme for en kunde. En stamme treffer ord som begynner med den
 * («vakttjenest» → «vakttjenester», «vakttjenesten»). `not`: ord som ligner, men er noe annet («elektronikk» er
 * ikke elektroarbeid).
 */
export const TRADE_GROUPS: readonly { name: string; stems: readonly string[]; not?: readonly string[] }[] = [
  { name: 'vakt', stems: ['vakthold', 'vakttjenest', 'vaktselskap', 'vekter', 'sikkerhetsvakt', 'objektsikring', 'alarmrespons', 'security guard', 'guarding'] },
  {
    name: 'elektro',
    stems: ['elektr', 'elinstall', 'el-install', 'elanlegg', 'el-anlegg', 'elkraft', 'el-kraft', 'elarbeid', 'el-arbeid', 'belysning', 'ladepunkt', 'ladestasjon', 'ladeanlegg', 'tavleanlegg', 'electrical'],
    not: ['elektron'],
  },
  { name: 'rør', stems: ['rørlegger', 'rørarbeid', 'rørinstallasjon', 'vvs', 'sanitæranlegg', 'sprinkler', 'plumbing'] },
  { name: 'ventilasjon', stems: ['ventilasjon', 'luftbehandling', 'kjøleanlegg', 'klimaanlegg', 'varmepumpe', 'ventilation'] },
  { name: 'maler', stems: ['malerarbeid', 'malertjenest', 'malearbeid', 'overflatebehandling', 'painting'] },
  { name: 'tømrer', stems: ['tømrer', 'snekker', 'carpentry'] },
  { name: 'vinter', stems: ['brøyt', 'snøbrøyt', 'snørydd', 'snømåk', 'vinterdrift', 'vintervedlikehold', 'strøing', 'snow removal', 'winter maintenance'] },
  {
    name: 'grønt',
    stems: ['grøntanlegg', 'grøntareal', 'grøntvedlikehold', 'grøntarbeid', 'parkdrift', 'parkvedlikehold', 'gressklipp', 'plenklipp', 'anleggsgartner', 'skjøtsel', 'trepleie', 'trefelling', 'landscaping'],
  },
  { name: 'skyss', stems: ['skoleskyss', 'skyss', 'elevtransport', 'skoletransport', 'school transport'] },
  { name: 'gods', stems: ['varetransport', 'godstransport', 'budtjenest', 'budbil', 'freight', 'goods transport'] },
  { name: 'renhold', stems: ['renhold', 'rengjøring', 'vinduspuss', 'hovedrengjøring', 'cleaning'] },
  { name: 'prosjektering', stems: ['prosjektering', 'byggeled', 'ingeniørtjenest', 'rådgivende ingeniør', 'byggherreombud', 'uavhengig kontroll', 'engineering', 'construction management'] },
  { name: 'kantine', stems: ['kantine', 'catering', 'matlevering', 'matservering', 'canteen'] },
];

/** Ordene som betyr noe i en tekst (minst 5 bokstaver, ikke småord). */
export function significantWords(text: string): string[] {
  const out: string[] = [];
  for (const word of text.toLowerCase().split(/\s+/)) {
    const w = word.replace(/[^\p{L}\p{N}-]/gu, '').replace(/^-+|-+$/g, '');
    if (w.length >= 5 && !STOP_WORDS.has(w)) out.push(w);
  }
  return out;
}

/**
 * Bruker bedriften dette ordet om noe i gruppen? «vakthold», «vakt», «snøbrøyting», «kontorrenhold». Et kort ord
 * («vakt») teller bare mot stammer uten mellomrom – «construction» skal ikke gi «construction management».
 */
function triggers(term: string, stem: string): boolean {
  if (term.length < 4) return false;
  return term.startsWith(stem) || (!stem.includes(' ') && stem.startsWith(term)) || (stem.length >= 6 && term.includes(stem));
}

const EXCLUSIONS = new Map<string, readonly string[]>();
for (const group of TRADE_GROUPS) {
  if (!group.not?.length) continue;
  for (const s of group.stems) EXCLUSIONS.set(s, [...(EXCLUSIONS.get(s) ?? []), ...group.not]);
}

/**
 * Ord en stamme fra faggruppene ikke skal treffe: «elektr» skal ikke treffe «elektronisk» – nesten alle kunngjøringer
 * sier at tilbudet skal leveres elektronisk.
 */
export function stemExclusions(stem: string): readonly string[] {
  return EXCLUSIONS.get(stem) ?? [];
}

/** Stammene fra faggruppene bedriftens ord hører til (uten ordene den allerede har). */
export function expandTerms(terms: readonly string[]): string[] {
  const own = new Set(terms);
  const out = new Set<string>();
  for (const group of TRADE_GROUPS) {
    const used = terms.some((t) => !group.not?.some((n) => t.startsWith(n)) && group.stems.some((s) => triggers(t, s)));
    if (!used) continue;
    for (const s of group.stems) if (!own.has(s)) out.add(s);
  }
  return [...out];
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g;
const cache = new Map<string, { start: RegExp; inner: RegExp | null }>();

function patterns(term: string) {
  let p = cache.get(term);
  if (!p) {
    const escaped = term.toLowerCase().replace(ESCAPE, '\\$&');
    p = {
      // Ordet begynner med termen (samme regel som containsTerm).
      start: new RegExp(`(?<![\\p{L}\\p{N}])${escaped}[\\p{L}\\p{N}-]*`, 'gu'),
      // Termen inne i et sammensatt ord: minst tre bokstaver foran («kontor|renhold»).
      inner: term.length >= MIN_INNER_LENGTH ? new RegExp(`[\\p{L}\\p{N}]{3,}${escaped}[\\p{L}\\p{N}-]*`, 'gu') : null,
    };
    if (cache.size > 5_000) cache.clear();
    cache.set(term, p);
  }
  return p;
}

function firstAllowed(re: RegExp, text: string, not: readonly string[]): string | null {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!not.some((n) => m![0].startsWith(n))) return m[0];
  }
  return null;
}

/** Ordet i teksten som termen treffer (med små bokstaver), eller null. `not`: ord som begynner slik, teller ikke. */
export function matchedWord(text: string, term: string, not: readonly string[] = []): string | null {
  const lower = text.toLowerCase();
  const p = patterns(term);
  return firstAllowed(p.start, lower, not) ?? (p.inner ? firstAllowed(p.inner, lower, not) : null);
}
