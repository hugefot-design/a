/**
 * Deterministisk matchemotor. Ingen AI – samme input gir alltid samme resultat,
 * og hver poengsum har en forklaring brukeren kan se.
 *
 * VIKTIG: Poengsummen viser samsvar mellom bedriftsprofil og kunngjøring.
 * Den er IKKE en sannsynlighet for å vinne konkurransen.
 */
import { CERTIFICATIONS, CERT_BY_ID, INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { containsTerm, cpvPrefixes } from '@/domain/tenders/normalize';

export interface MatchProfile {
  industries: string[];
  cpvCodes: string[];
  keywords: string[];
  services: string | null;
  regions: string[];
  countries: string[];
  certifications: string[];
  minContractValue: number | null;
  maxContractValue: number | null;
  contractTypes: string[];
  excludedCpv: string[];
  excludedKeywords: string[];
  minDaysToDeadline: number;
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
}

export interface MatchBreakdown {
  reasons: string[];
  gaps: string[];
  disqualifiers: string[];
  nextSteps: string[];
  components: { cpv: number; keywords: number; geography: number; value: number; type: number; deadline: number };
  requiredCertifications: string[];
}

export interface MatchResult {
  score: number;
  excluded: boolean;
  breakdown: MatchBreakdown;
}

const STOP = new Set(
  'og i på av for til med som det den de en et er vi oss vår våre har kan skal fra om ved alle innen samt eller både mer leverer levering tjenester tjeneste'.split(' '),
);

/** Termer fra nøkkelord og tjenestebeskrivelse (maks 30). */
export function profileTerms(profile: Pick<MatchProfile, 'keywords' | 'services'>): string[] {
  const terms = new Set<string>();
  for (const k of profile.keywords) {
    const t = k.trim().toLowerCase();
    if (t.length >= 3) terms.add(t);
  }
  for (const part of (profile.services ?? '').toLowerCase().split(/[,;\n.]+/)) {
    for (const word of part.split(/\s+/)) {
      const w = word.replace(/[^\p{L}\p{N}-]/gu, '');
      if (w.length >= 5 && !STOP.has(w)) terms.add(w);
    }
  }
  return [...terms].slice(0, 30);
}

function sharedPrefixScore(profileCodes: string[], tenderCodes: string[]): { score: number; code: string | null } {
  let best = { score: 0, code: null as string | null };
  const tenderSet = new Set(tenderCodes);
  for (const p of profileCodes) {
    if (tenderSet.has(p)) return { score: 40, code: p };
    const pPrefixes = cpvPrefixes([p]);
    for (const t of tenderCodes) {
      const tPrefixes = new Set(cpvPrefixes([t]));
      let shared = 0;
      for (const prefix of pPrefixes) if (tPrefixes.has(prefix)) shared = Math.max(shared, prefix.length);
      const score = shared >= 5 ? 34 : shared === 4 ? 30 : shared === 3 ? 25 : shared === 2 ? 16 : 0;
      if (score > best.score) best = { score, code: t };
    }
  }
  return best;
}

export function detectCertifications(text: string): string[] {
  return CERTIFICATIONS.filter((c) => c.patterns.some((p) => p.test(text))).map((c) => c.id);
}

const LEGAL_REQUIREMENTS = new Set(['vaktvirksomhet', 'renholdsregister', 'sentral_godkjenning', 'elvirksomhet', 'nsm_klarering']);
const FINANCIAL_RE = /(omsetning|kredittvurdering|kredittverdighet|rating|egenkapital|soliditet|økonomisk(e)? kapasitet|financial standing)/i;

function formatMill(v: number): string {
  return v >= 1_000_000 ? `${(v / 1_000_000).toLocaleString('nb-NO', { maximumFractionDigits: 1 })} mill. kr` : `${Math.round(v).toLocaleString('nb-NO')} kr`;
}

export function scoreTender(profile: MatchProfile, tender: MatchTender, now = new Date()): MatchResult {
  const reasons: string[] = [];
  const gaps: string[] = [];
  const disqualifiers: string[] = [];
  const nextSteps: string[] = [];
  const text = `${tender.title}\n${tender.description ?? ''}`;
  const tenderPrefixes = cpvPrefixes(tender.cpvCodes);

  // 1. Bransje / CPV (maks 40)
  let cpv = 0;
  const cpvHit = sharedPrefixScore(profile.cpvCodes, tender.cpvCodes);
  if (cpvHit.score > 0 && cpvHit.code) {
    cpv = cpvHit.score;
    reasons.push(cpvHit.score === 40 ? `CPV-kode ${cpvHit.code} er den samme som i profilen din` : `CPV-kode ${cpvHit.code} ligger nær kodene i profilen din`);
  }
  const sharedIndustries = profile.industries.filter((i) => tender.industryIds.includes(i));
  if (sharedIndustries.length && cpv < 26) {
    cpv = 26;
    reasons.push(`Samme bransje: ${sharedIndustries.map((i) => INDUSTRY_BY_ID.get(i)?.name ?? i).join(', ')}`);
  }

  // 2. Nøkkelord (maks 25)
  const terms = profileTerms(profile);
  const titleHits = terms.filter((t) => containsTerm(tender.title, t));
  const descHits = terms.filter((t) => !titleHits.includes(t) && tender.description && containsTerm(tender.description, t));
  const keywords = Math.min(25, titleHits.length * 10 + descHits.length * 4);
  if (titleHits.length) reasons.push(`Nøkkelord i tittelen: ${titleHits.slice(0, 4).join(', ')}`);
  else if (descHits.length) reasons.push(`Nøkkelord i beskrivelsen: ${descHits.slice(0, 4).join(', ')}`);

  // 3. Geografi (maks 15)
  let geography = 0;
  const countries = profile.countries.length ? profile.countries : ['NO'];
  if (!countries.includes(tender.countryCode)) {
    disqualifiers.push('Oppdraget er utenfor landene du dekker');
  } else if (profile.regions.length === 0 || profile.regions.includes('ALL')) {
    geography = 15;
  } else if (tender.regionCodes.length === 0) {
    geography = 8;
    gaps.push('Kunngjøringen oppgir ikke sted i strukturert form – sjekk leveringssted');
  } else {
    const shared = tender.regionCodes.filter((r) => profile.regions.includes(r));
    if (shared.length) {
      geography = 15;
      reasons.push(`I området du dekker: ${shared.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ')}`);
    } else {
      gaps.push(`Utenfor området du dekker (${tender.regionCodes.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ')})`);
    }
  }

  // 4. Verdi (maks 10)
  let value = 5;
  const v = tender.currency && tender.currency !== 'NOK' ? null : tender.estimatedValue;
  if (v !== null && v !== undefined) {
    const min = profile.minContractValue;
    const max = profile.maxContractValue;
    if ((min === null || v >= min) && (max === null || v <= max)) {
      value = 10;
      if (min !== null || max !== null) reasons.push(`Estimert verdi (${formatMill(v)}) passer ønsket kontraktsstørrelse`);
    } else if (min !== null && v < min) {
      value = 4;
      gaps.push(`Mindre enn ønsket kontraktsstørrelse (${formatMill(v)})`);
    } else {
      value = 2;
      gaps.push(`Større enn ønsket kontraktsstørrelse (${formatMill(v)}) – vurder kapasitet eller samarbeid`);
      nextSteps.push('Vurder samarbeid med andre leverandører eller å gi tilbud på en delkontrakt.');
    }
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
  }

  // Sertifiseringer og krav nevnt i teksten
  const required = detectCertifications(text);
  for (const certId of required) {
    const label = CERT_BY_ID.get(certId)?.label ?? certId;
    if (profile.certifications.includes(certId)) {
      reasons.push(`Kunngjøringen nevner ${label}, som du har registrert`);
    } else if (LEGAL_REQUIREMENTS.has(certId)) {
      disqualifiers.push(`Mulig absolutt krav: ${label} – ikke registrert i profilen`);
      nextSteps.push(`Avklar om dere har ${label} før dere bruker tid på tilbudet.`);
    } else {
      gaps.push(`Kunngjøringen nevner ${label} – ikke registrert i profilen`);
    }
  }
  if (FINANCIAL_RE.test(text)) gaps.push('Kunngjøringen nevner krav til økonomisk kapasitet – sjekk at dere oppfyller dem');

  let score = cpv + keywords + geography + value + type + deadline;
  // Uten faglig treff skal ikke sted og verdi alene gjøre et anbud relevant.
  if (cpv === 0 && keywords === 0) score = Math.min(score, 25);
  if (disqualifiers.some((d) => d.startsWith('Oppdraget er utenfor'))) score = Math.min(score, 20);

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
      components: { cpv, keywords, geography, value, type, deadline },
      requiredCertifications: required,
    },
  };
}
