/**
 * Deterministisk matchemotor (v2). Ingen AI – samme input gir alltid samme resultat,
 * og hver poengsum har en forklaring brukeren kan se:
 *   - hvorfor anbudet passer (reasons)
 *   - hvilke krav bedriften ser ut til å oppfylle (fulfilled) og ikke (unfulfilled)
 *   - hvilke opplysninger som mangler (missingInfo)
 *   - hvor usikker vurderingen er (uncertainty)
 *
 * VIKTIG: Poengsummen viser samsvar mellom bedriftsprofil og kunngjøring.
 * Den er IKKE en sannsynlighet for å vinne konkurransen. Søkeord alene gir aldri høy score.
 */
import { CERTIFICATIONS, CERT_BY_ID, INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { containsTerm, cpvPrefixes } from '@/domain/tenders/normalize';
import { expandTerms, matchedWord, significantWords, stemExclusions } from './terms';

export interface MatchProfile {
  industries: string[];
  cpvCodes: string[];
  keywords: string[];
  services: string | null;
  products?: string | null;
  competencies?: string | null;
  regions: string[];
  countries: string[];
  certifications: string[];
  minContractValue: number | null;
  maxContractValue: number | null;
  contractTypes: string[];
  excludedCpv: string[];
  excludedKeywords: string[];
  minDaysToDeadline: number;
  annualRevenue?: number | null;
  employeeCount?: number | null;
  referenceCount?: number;
}

export interface MatchTender {
  id: string;
  title: string;
  description: string | null;
  cpvCodes: string[];
  industryIds: string[];
  regionCodes: string[];
  countryCode: string;
  estimatedValue: number | null;
  currency: string | null;
  contractNature: string | null;
  deadlineAt: Date | null;
  lifecycle: string;
  /** Kvalifikasjonskrav fra kunngjøringen (TED). Tomt når kilden ikke har dem. */
  selectionCriteria?: string[];
}

export type Uncertainty = 'lav' | 'middels' | 'høy';

/**
 * Reglene i poengsummen, slik de vises på metodesiden (/metode). Bare dokumentasjon – selve utregningen står i
 * scoreTender, og testene sjekker at de stemmer med hverandre. Summen av maks er 100.
 */
export const SCORE_PARTS = [
  { key: 'cpv', label: 'Fagområde (CPV-kode eller bransje)', max: 40, rule: 'Samme CPV-kode: 40. Nær kode: 10–34 – jo flere like sifre, jo mer. Samme bransje: minst 22.' },
  {
    key: 'keywords',
    label: 'Det dere leverer (ordene i profilen)',
    max: 15,
    rule: '10 per ord i tittelen og 3 per ord i beskrivelsen. Maks 10 når fagområdet gir under 20. Lange ord teller også inne i sammensatte ord («brøyting» i «snøbrøyting»), og vanlige fagord kjennes igjen i flere former («vakthold» finner «vakttjenester»).',
  },
  { key: 'geography', label: 'Område', max: 15, rule: 'Fylke dere dekker, eller hele landet: 15. Sted ikke oppgitt: 8. Utenfor: 0.' },
  { key: 'value', label: 'Kontraktsverdi', max: 10, rule: 'Innenfor størrelsen dere ønsker (eller ingen grense satt): 10. Ikke oppgitt eller i annen valuta: 5. Under minstegrensen: 4. Over maksgrensen: 2.' },
  { key: 'type', label: 'Kontraktstype', max: 5, rule: 'Typen dere ønsker: 5. Ingen type valgt: 4. Ikke oppgitt i kunngjøringen: 3. En annen type: 0.' },
  { key: 'deadline', label: 'Tid til fristen', max: 5, rule: 'Nok tid: 5. Frist ikke oppgitt: 3. Kortere enn minimumet dere har satt: 1. Gått ut: 0.' },
  {
    key: 'requirements',
    label: 'Krav dere oppfyller',
    max: 10,
    rule: '5 for hver godkjenning eller sertifisering kunngjøringen nevner og dere har, 3 når dere oppfyller omsetningskravet, 2 når det bes om referanser og dere har det.',
  },
] as const satisfies readonly { key: keyof MatchBreakdown['components']; label: string; max: number; rule: string }[];

/** Tak på poengsummen. scoreTender bruker disse direkte, og teksten står i forklaringen til hvert treff. */
export const SCORE_CAPS = [
  { key: 'noFit', max: 25, text: 'Ingen faglige treff' },
  { key: 'keywordsOnly', max: 45, text: 'Bare søkeordtreff, ingen bransje- eller CPV-treff' },
  { key: 'groupOnly', max: 55, text: 'Bare treff på overordnet CPV-gruppe' },
  { key: 'wordsMissing', max: 45, text: 'Samme bransje, men ingen av ordene for det dere leverer står i kunngjøringen' },
  { key: 'legal', max: 40, text: 'Mulig absolutt krav som ikke er oppfylt' },
  { key: 'turnover', max: 35, text: 'Omsetningskravet er ikke oppfylt' },
] as const;
type CapKey = (typeof SCORE_CAPS)[number]['key'];
const CAP_BY_KEY = new Map(SCORE_CAPS.map((c) => [c.key, c]));

/** Utenfor landene profilen dekker, eller fristen har gått ut: aldri mer enn dette. */
export const DISQUALIFIED_MAX = 20;

export interface MatchBreakdown {
  reasons: string[];
  gaps: string[];
  disqualifiers: string[];
  nextSteps: string[];
  components: { cpv: number; keywords: number; geography: number; value: number; type: number; deadline: number; requirements: number };
  requiredCertifications: string[];
  fulfilled: string[];
  unfulfilled: string[];
  missingInfo: string[];
  uncertainty: Uncertainty;
  uncertaintyReasons: string[];
  /** Hva som begrenset poengsummen, f.eks. «bare søkeordtreff». */
  caps: string[];
  version: 2;
}

export interface MatchResult {
  score: number;
  excluded: boolean;
  breakdown: MatchBreakdown;
}

/** Poeng per ord fra profilen i tittelen og i beskrivelsen (se SCORE_PARTS). */
export const TITLE_HIT_POINTS = 10;
export const DESCRIPTION_HIT_POINTS = 3;

/**
 * Termer fra nøkkelord, tjenester og produkter (maks 40). Et nøkkelord med flere ord («resepsjon og alarmrespons»)
 * teller både som uttrykk og ord for ord – ellers ville det bare treffe når hele uttrykket står i kunngjøringen.
 */
export function profileTerms(profile: Pick<MatchProfile, 'keywords' | 'services' | 'products'>): string[] {
  const terms = new Set<string>();
  for (const k of profile.keywords) {
    const t = k.trim().toLowerCase();
    if (t.length >= 3) terms.add(t);
    if (/\s/.test(t)) for (const w of significantWords(t)) terms.add(w);
  }
  for (const text of [profile.services, profile.products]) {
    for (const part of (text ?? '').toLowerCase().split(/[,;\n.]+/)) {
      for (const w of significantWords(part)) terms.add(w);
    }
  }
  return [...terms].slice(0, 40);
}

function sharedPrefixScore(profileCodes: string[], tenderCodes: string[]): { score: number; code: string | null; depth: number } {
  let best = { score: 0, code: null as string | null, depth: 0 };
  const tenderSet = new Set(tenderCodes);
  for (const p of profileCodes) {
    if (tenderSet.has(p)) return { score: 40, code: p, depth: 8 };
    const pPrefixes = cpvPrefixes([p]);
    for (const t of tenderCodes) {
      const tPrefixes = new Set(cpvPrefixes([t]));
      let shared = 0;
      for (const prefix of pPrefixes) if (tPrefixes.has(prefix)) shared = Math.max(shared, prefix.length);
      const score = shared >= 5 ? 34 : shared === 4 ? 28 : shared === 3 ? 20 : shared === 2 ? 10 : 0;
      if (score > best.score) best = { score, code: t, depth: shared };
    }
  }
  return best;
}

export function detectCertifications(text: string): string[] {
  return CERTIFICATIONS.filter((c) => c.patterns.some((p) => p.test(text))).map((c) => c.id);
}

export const LEGAL_REQUIREMENTS = new Set(['vaktvirksomhet', 'renholdsregister', 'sentral_godkjenning', 'elvirksomhet', 'nsm_klarering']);
const FINANCIAL_RE = /(omsetning|kredittvurdering|kredittverdighet|rating|egenkapital|soliditet|økonomisk(e)? kapasitet|financial (standing|capacity)|turnover|credit rating)/i;
const REFERENCES_RE = /(referanse|tilsvarende oppdrag|relevant erfaring|relevante oppdrag|comparable (size|assignments|contracts)|relevant experience|references)/i;

const UNIT: Record<string, number> = {
  milliarder: 1e9, milliard: 1e9, 'mrd.': 1e9, mrd: 1e9, billion: 1e9,
  millioner: 1e6, million: 1e6, millions: 1e6, 'mill.': 1e6, mill: 1e6, mnok: 1e6, mkr: 1e6,
};

/**
 * Minstekrav til årlig omsetning i kroner, hvis teksten oppgir et tydelig beløp
 * («omsetning på minst 10 millioner», «turnover of at least NOK 300 million»). Ellers null.
 * Relative krav («to ganger kontraktsverdien») tolkes ikke.
 */
export function requiredTurnover(text: string): number | null {
  const re =
    /(?:omsetning|turnover|annual revenue)[^.;:]{0,120}?(?:minst|minimum|min\.|at least|not less than|på over|mer enn|above|exceeding)\s*(?:nok|kr\.?|kroner)?\s*([0-9][0-9 .,]*[0-9]|[0-9])\s*(milliarder|milliard|mrd\.?|billion|millioner|millions?|mill\.?|mnok|mkr)?/i;
  const m = re.exec(text);
  if (!m) return null;
  const digits = m[1]!.replace(/\s/g, '');
  // «1.500.000», «1 500 000» og «1,5» (desimal) – punktum/komma som tusenskille når det følges av tre sifre.
  const normalized = /^\d{1,3}([.,]\d{3})+$/.test(digits) ? digits.replace(/[.,]/g, '') : digits.replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ? (UNIT[m[2].toLowerCase()] ?? 1) : 1;
  const value = n * unit;
  // Små tall uten enhet er nesten alltid noe annet (f.eks. «2 ganger kontraktsverdien»).
  return value >= 10_000 ? value : null;
}

function formatMill(v: number): string {
  return v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} mill. kr` : `${Math.round(v).toLocaleString('nb-NO')} kr`;
}

export function scoreTender(profile: MatchProfile, tender: MatchTender, now = new Date()): MatchResult {
  const reasons: string[] = [];
  const gaps: string[] = [];
  const disqualifiers: string[] = [];
  const nextSteps: string[] = [];
  const fulfilled: string[] = [];
  const unfulfilled: string[] = [];
  const missingInfo: string[] = [];
  const uncertaintyReasons: string[] = [];
  const caps: string[] = [];
  const selection = (tender.selectionCriteria ?? []).join('\n');
  const text = `${tender.title}\n${tender.description ?? ''}\n${selection}`;
  const tenderPrefixes = cpvPrefixes(tender.cpvCodes);

  // 1. Faglig samsvar: CPV / bransje (maks 40)
  let cpv = 0;
  const cpvHit = sharedPrefixScore(profile.cpvCodes, tender.cpvCodes);
  if (cpvHit.score > 0 && cpvHit.code) {
    cpv = cpvHit.score;
    reasons.push(cpvHit.score === 40 ? `CPV-kode ${cpvHit.code} er den samme som i profilen din` : `CPV-kode ${cpvHit.code} ligger nær kodene i profilen din`);
  }
  const sharedIndustries = profile.industries.filter((i) => tender.industryIds.includes(i));
  if (sharedIndustries.length && cpv < 22) {
    cpv = 22;
    reasons.push(`Samme bransje: ${sharedIndustries.map((i) => INDUSTRY_BY_ID.get(i)?.name ?? i).join(', ')}`);
  }
  if (cpv >= 20) fulfilled.push('Fagområdet (bransje/CPV) passer profilen');

  // 2. Søkeord (maks 15, og bare 10 uten faglig treff). Bedriftens egne ord, og ord fra samme faggruppe
  // («vakthold» → «vakttjenester»), se terms.ts. For ord fra faggruppen vises ordet i kunngjøringen.
  const ownTerms = profileTerms(profile);
  const titleHits: string[] = [];
  const descHits: string[] = [];
  for (const [term, own] of [...ownTerms.map((t) => [t, true] as const), ...expandTerms(ownTerms).map((t) => [t, false] as const)]) {
    // Bedriftens egne ord teller som de er; stammer fra faggruppene har unntak («elektr» er ikke «elektronisk»).
    const not = own ? [] : stemExclusions(term);
    const inTitle = matchedWord(tender.title, term, not);
    if (inTitle) {
      const shown = own ? term : inTitle;
      if (!titleHits.includes(shown)) titleHits.push(shown);
      continue;
    }
    const inDescription = tender.description ? matchedWord(tender.description, term, not) : null;
    if (inDescription) {
      const shown = own ? term : inDescription;
      if (!descHits.includes(shown) && !titleHits.includes(shown)) descHits.push(shown);
    }
  }
  const keywordCap = cpv >= 20 ? 15 : 10;
  const keywords = Math.min(keywordCap, titleHits.length * TITLE_HIT_POINTS + descHits.length * DESCRIPTION_HIT_POINTS);
  if (titleHits.length) reasons.push(`Nøkkelord i tittelen: ${titleHits.slice(0, 4).join(', ')}`);
  else if (descHits.length) reasons.push(`Nøkkelord i beskrivelsen: ${descHits.slice(0, 4).join(', ')}`);

  // 3. Geografi (maks 15)
  let geography = 0;
  const countries = profile.countries.length ? profile.countries : ['NO'];
  if (!countries.includes(tender.countryCode)) {
    disqualifiers.push('Oppdraget er utenfor landene du dekker');
    unfulfilled.push('Oppdraget er utenfor landene dere dekker');
  } else if (profile.regions.length === 0 || profile.regions.includes('ALL')) {
    geography = 15;
  } else if (tender.regionCodes.length === 0) {
    geography = 8;
    gaps.push('Kunngjøringen oppgir ikke sted i strukturert form – sjekk leveringssted');
    missingInfo.push('Leveringssted er ikke oppgitt i strukturert form');
  } else {
    const shared = tender.regionCodes.filter((r) => profile.regions.includes(r));
    if (shared.length) {
      geography = 15;
      reasons.push(`I området du dekker: ${shared.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ')}`);
      fulfilled.push('Leveringsstedet er i området dere dekker');
    } else {
      const where = tender.regionCodes.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ');
      gaps.push(`Utenfor området du dekker (${where})`);
      unfulfilled.push(`Leveringssted utenfor området dere dekker (${where})`);
    }
  }

  // 4. Verdi og kapasitet (maks 10)
  let value = 5;
  const v = tender.currency && tender.currency !== 'NOK' ? null : tender.estimatedValue;
  if (v !== null && v !== undefined) {
    const min = profile.minContractValue;
    const max = profile.maxContractValue;
    if ((min === null || v >= min) && (max === null || v <= max)) {
      value = 10;
      if (min !== null || max !== null) {
        reasons.push(`Estimert verdi (${formatMill(v)}) passer ønsket kontraktsstørrelse`);
        fulfilled.push('Kontraktsstørrelsen passer det dere ønsker');
      }
    } else if (min !== null && v < min) {
      value = 4;
      gaps.push(`Mindre enn ønsket kontraktsstørrelse (${formatMill(v)})`);
    } else {
      value = 2;
      gaps.push(`Større enn ønsket kontraktsstørrelse (${formatMill(v)}) – vurder kapasitet eller samarbeid`);
      unfulfilled.push(`Kontrakten (${formatMill(v)}) er større enn dere har oppgitt at dere tar`);
      nextSteps.push('Vurder samarbeid med andre leverandører eller å gi tilbud på en delkontrakt.');
    }
  } else {
    missingInfo.push('Kunngjøringen oppgir ikke estimert verdi');
  }

  // 5. Kontraktstype (maks 5)
  let type = 4;
  if (profile.contractTypes.length && tender.contractNature) {
    if (profile.contractTypes.includes(tender.contractNature)) type = 5;
    else {
      type = 0;
      gaps.push('Kontraktstypen er en annen enn du foretrekker');
    }
  } else if (!tender.contractNature) type = 3;

  // 6. Frist (maks 5)
  let deadline = 3;
  if (tender.deadlineAt) {
    const days = Math.ceil((tender.deadlineAt.getTime() - now.getTime()) / 86_400_000);
    if (days <= 0) {
      deadline = 0;
      disqualifiers.push('Fristen har gått ut');
    } else if (days < profile.minDaysToDeadline) {
      deadline = 1;
      disqualifiers.push(`Kort frist: ${days} ${days === 1 ? 'dag' : 'dager'} igjen (du ønsker minst ${profile.minDaysToDeadline})`);
    } else {
      deadline = 5;
    }
    if (days > 0 && days <= 14) nextSteps.push(`Prioriter: fristen er om ${days} ${days === 1 ? 'dag' : 'dager'}.`);
  } else if (tender.lifecycle === 'competition') {
    missingInfo.push('Tilbudsfristen er ikke oppgitt i kunngjøringen');
  }

  // 7. Krav nevnt i kunngjøringen (sertifiseringer, godkjenninger, økonomi, referanser) – maks 10
  let requirements = 0;
  const required = detectCertifications(text);
  let legalMissing = false;
  for (const certId of required) {
    const label = CERT_BY_ID.get(certId)?.label ?? certId;
    if (profile.certifications.includes(certId)) {
      reasons.push(`Kunngjøringen nevner ${label}, som du har registrert`);
      fulfilled.push(`${label} (registrert i profilen)`);
      requirements += 5;
    } else if (LEGAL_REQUIREMENTS.has(certId)) {
      legalMissing = true;
      disqualifiers.push(`Mulig absolutt krav: ${label} – ikke registrert i profilen`);
      unfulfilled.push(`${label} er ikke registrert i profilen (kan være et absolutt krav)`);
      nextSteps.push(`Avklar om dere har ${label} før dere bruker tid på tilbudet.`);
    } else {
      gaps.push(`Kunngjøringen nevner ${label} – ikke registrert i profilen`);
      unfulfilled.push(`${label} er ikke registrert i profilen`);
    }
  }
  const turnover = requiredTurnover(text);
  let turnoverShort = false;
  if (turnover !== null) {
    if (profile.annualRevenue === null || profile.annualRevenue === undefined) {
      missingInfo.push(`Kunngjøringen krever omsetning på minst ${formatMill(turnover)} – legg inn omsetning i profilen`);
    } else if (profile.annualRevenue >= turnover) {
      fulfilled.push(`Omsetning (${formatMill(profile.annualRevenue)}) oppfyller kravet på ${formatMill(turnover)}`);
      requirements += 3;
    } else {
      turnoverShort = true;
      unfulfilled.push(`Krav til omsetning: minst ${formatMill(turnover)} – profilen oppgir ${formatMill(profile.annualRevenue)}`);
      disqualifiers.push(`Omsetningen er lavere enn kravet (${formatMill(turnover)})`);
      nextSteps.push('Vurder å støtte dere på andres økonomiske kapasitet (f.eks. morselskap) eller å samarbeide.');
    }
  } else if (FINANCIAL_RE.test(text)) {
    gaps.push('Kunngjøringen nevner krav til økonomisk kapasitet – sjekk at dere oppfyller dem');
    if (profile.annualRevenue === null || profile.annualRevenue === undefined) missingInfo.push('Profilen mangler omsetning (kunngjøringen nevner økonomiske krav)');
  }
  if (REFERENCES_RE.test(text)) {
    if ((profile.referenceCount ?? 0) > 0) {
      fulfilled.push(`Referanseprosjekter registrert (${profile.referenceCount})`);
      requirements += 2;
    } else {
      missingInfo.push('Kunngjøringen ber om referanser/erfaring – legg inn referanseprosjekter i profilen');
    }
  }
  requirements = Math.min(10, requirements);

  // Usikkerhet: hvor mye av grunnlaget vi faktisk har.
  if (!tender.description || tender.description.length < 200) uncertaintyReasons.push('Kunngjøringen har lite beskrivende tekst');
  if (!tender.cpvCodes.length) uncertaintyReasons.push('Kunngjøringen mangler CPV-koder');
  if (!(tender.selectionCriteria?.length) && tender.lifecycle === 'competition') {
    uncertaintyReasons.push('Kvalifikasjonskravene står trolig i konkurransegrunnlaget, som ikke er vurdert her');
  }
  // Ordene kan stå i nøkkelordene eller i det bedriften skrev om tjenestene sine (oppstarten fyller ut det siste).
  if (!profile.cpvCodes.length && !ownTerms.length) uncertaintyReasons.push('Profilen har verken CPV-koder eller ord for det dere leverer');
  if (turnover !== null && (profile.annualRevenue === null || profile.annualRevenue === undefined)) uncertaintyReasons.push('Omsetning mangler i profilen');
  const uncertainty: Uncertainty = uncertaintyReasons.length >= 3 ? 'høy' : uncertaintyReasons.length >= 1 ? 'middels' : 'lav';

  let score = cpv + keywords + geography + value + type + deadline + requirements;
  const cap = (key: CapKey) => {
    const c = CAP_BY_KEY.get(key)!;
    score = Math.min(score, c.max);
    caps.push(`${c.text} – maks ${c.max}`);
  };
  // Søkeord alene gir aldri høy score.
  if (cpv === 0 && keywords === 0) cap('noFit');
  else if (cpv === 0) cap('keywordsOnly');
  else if (cpv <= 10 && titleHits.length === 0) cap('groupOnly');
  // Samme bransje alene er et svakt tegn – bransjene er brede («Bygg og anlegg» rommer alle fag). Har bedriften sagt
  // hva den leverer, og ingen av ordene står i kunngjøringen, skal anbudet ikke gå foran et som faktisk nevner det,
  // heller ikke når det er i eget fylke. Lik eller nær CPV-kode (fire sifre eller mer) er et sterkt tegn og unntas.
  if (cpv > 0 && ownTerms.length > 0 && titleHits.length === 0 && descHits.length === 0 && cpvHit.score < 28) cap('wordsMissing');
  if (legalMissing) cap('legal');
  if (turnoverShort) cap('turnover');
  if (disqualifiers.some((d) => d.startsWith('Oppdraget er utenfor'))) score = Math.min(score, DISQUALIFIED_MAX);
  if (disqualifiers.includes('Fristen har gått ut')) score = Math.min(score, DISQUALIFIED_MAX);

  // Ekskluderinger
  let excluded = false;
  const excludedPrefixes = new Set(profile.excludedCpv.map((c) => cpvPrefixes([c]).at(-1)!));
  const excludedByCpv = tenderPrefixes.some((p) => excludedPrefixes.has(p));
  const excludedWord = profile.excludedKeywords.find((k) => k.trim() && containsTerm(text, k.trim()));
  if (excludedByCpv || excludedWord) {
    excluded = true;
    score = Math.min(score, 10);
    reasons.unshift(excludedWord ? `Ekskludert av innstillingene dine (ordet «${excludedWord}»)` : 'Ekskludert av innstillingene dine (CPV-kode)');
  }

  if (tender.lifecycle === 'planned') nextSteps.push('Følg med – selve konkurransen er ikke kunngjort ennå. Vurder å delta i markedsdialog.');
  nextSteps.unshift('Les kunngjøringen og konkurransegrunnlaget hos kilden.');
  if (!excluded && score >= 60 && disqualifiers.length === 0) nextSteps.push('Start tilbudsarbeid og fordel oppgavene i teamet.');

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    excluded,
    breakdown: {
      reasons,
      gaps,
      disqualifiers,
      nextSteps: [...new Set(nextSteps)],
      components: { cpv, keywords, geography, value, type, deadline, requirements },
      requiredCertifications: required,
      fulfilled: [...new Set(fulfilled)],
      unfulfilled: [...new Set(unfulfilled)],
      missingInfo: [...new Set(missingInfo)],
      uncertainty,
      uncertaintyReasons,
      caps,
      version: 2,
    },
  };
}
