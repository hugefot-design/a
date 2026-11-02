/**
 * Regelverk og klima/miljø fra en full Doffin-kunngjøring (eForms-XML), klart for visning.
 * Bare det kunngjøringen faktisk sier – ingen tolkning. Ukjente koder vises som de står.
 */
import { AWARD_CRITERION_LABEL, type EformsVariant } from '@/connectors/eforms';

/** Delen av `tender_sources.raw` (format «eforms-xml») som anbudssiden bruker. */
export interface EformsSourceSummary {
  variant: EformsVariant | null;
  noticeSubtype: string | null;
  legalBasis: { id: string | null; description: string | null }[] | null;
  strategicProcurement: string[] | null;
  environmentalCriteria: { type: string | null; weight: number | null; weightKind: string | null }[] | null;
  eSubmission: string | null;
}

export interface LegalBasisFact {
  label: string;
  /** Lenke til Lovdata (bare for forskrifter vi kjenner adressen til). */
  url: string | null;
  /** Teksten i kunngjøringen, f.eks. «Anskaffelsesforskriften Del 1 og 2». */
  description: string | null;
}

export interface EformsFacts {
  noticeKind: { label: string; hint: string } | null;
  subtype: string | null;
  legalBasis: LegalBasisFact[];
  environment: string[];
  strategic: string[];
  eSubmission: string | null;
}

// Adresseformatet er det Lovdata selv og offentlige virksomheter lenker med.
const lovdata = (nr: number) => `https://lovdata.no/dokument/SF/forskrift/2016-08-12-${nr}`;
const REGULATIONS: Record<string, { label: string; url: string }> = {
  974: { label: 'Anskaffelsesforskriften', url: lovdata(974) },
  975: { label: 'Forsyningsforskriften', url: lovdata(975) },
  976: { label: 'Konsesjonskontraktforskriften', url: lovdata(976) },
};
// eForms-koder for EU-regelverket (BT-01) og den norske forskriften som gjennomfører dem.
const EU_LEGAL_BASIS: Record<string, { label: string; regulation?: string }> = {
  '32014L0024': { label: 'Direktiv 2014/24/EU (offentlige anskaffelser)', regulation: '974' },
  '32014L0025': { label: 'Direktiv 2014/25/EU (forsyningssektorene)', regulation: '975' },
  '32014L0023': { label: 'Direktiv 2014/23/EU (konsesjonskontrakter)', regulation: '976' },
  '32009L0081': { label: 'Direktiv 2009/81/EF (forsvar og sikkerhet)' },
  '32007R1370': { label: 'Forordning (EF) nr. 1370/2007 (persontransport)' },
};

const STRATEGIC: Record<string, string> = {
  'env-imp': 'Redusere miljøpåvirkning',
  'soc-obj': 'Sosiale formål',
  'inn-pur': 'Innovativ anskaffelse',
};

const E_SUBMISSION: Record<string, string> = {
  required: 'Påkrevd',
  allowed: 'Tillatt',
  'not-allowed': 'Ikke tillatt',
};

/** Klima- og miljøkoder som ikke er tildelingskriterier (krav i spesifikasjonen, unntak, ikke relevant). */
export function isEnvironmentNonCriterion(type: string | null | undefined): boolean {
  return Boolean(type && type.startsWith('quality-nor-env-') && type !== 'quality-nor-env-criteria');
}

function weightText(weight: number | null, kind: string | null): string | null {
  if (weight === null || weight === undefined) return null;
  const n = weight.toLocaleString('nb-NO');
  // Hardt mellomrom, så «30 %» ikke brytes over to linjer.
  if (kind === 'per-exa' || kind === 'per-ran') return `${n}\u00a0%`;
  if (kind === 'poi-exa' || kind === 'poi-ran') return `${n}\u00a0poeng`;
  if (kind === 'ord-imp') return `prioritet ${n}`;
  return n;
}

/** «Anskaffelsesforskriften Del 1 og 2» → «Del 1 og 2» når forskriftens navn allerede vises. */
function withoutPrefix(text: string | null, prefix: string): string | null {
  if (!text) return null;
  const rest = text.toLowerCase().startsWith(prefix.toLowerCase()) ? text.slice(prefix.length).replace(/^[\s,:–—-]+/, '') : text;
  return rest || null;
}

function legalBasisFact(lb: { id: string | null; description: string | null }): LegalBasisFact | null {
  const id = lb.id?.trim() ?? '';
  const description = lb.description?.replace(/^NOR\s*[—–-]\s*/, '').trim() || null;
  const eli = /^https:\/\/lovdata\.no\/eli\/forskrift\/2016\/0?8\/12\/(97[4-6])$/.exec(id);
  if (eli) {
    const reg = REGULATIONS[eli[1]!]!;
    return { ...reg, description: withoutPrefix(description, reg.label) };
  }
  const eu = EU_LEGAL_BASIS[id];
  if (eu) {
    const reg = eu.regulation ? REGULATIONS[eu.regulation] : undefined;
    return reg
      ? { label: reg.label, url: reg.url, description: [eu.label, withoutPrefix(description, reg.label)].filter(Boolean).join('. ') }
      : { label: eu.label, url: null, description };
  }
  if (!id && !description) return null;
  // Ukjent eller «other»: vis kunngjøringens egen tekst, uten lenke.
  return { label: description ?? id, url: null, description: null };
}

export function eformsFacts(s: EformsSourceSummary | null | undefined): EformsFacts | null {
  if (!s) return null;
  const national = s.variant === 'national' || s.variant === 'national-e';
  const noticeKind =
    s.variant === 'eu'
      ? { label: 'EU-kunngjøring (også i TED)', hint: 'Brukes over EØS-terskelverdiene, eller når oppdragsgiver kunngjør frivillig i EU.' }
      : national
        ? { label: 'Nasjonal kunngjøring (bare i Doffin)', hint: 'Anskaffelsen er under EØS-terskelverdiene.' }
        : null;

  const seen = new Set<string>();
  const legalBasis: LegalBasisFact[] = [];
  for (const lb of s.legalBasis ?? []) {
    const fact = legalBasisFact(lb);
    if (!fact || seen.has(fact.label)) continue;
    seen.add(fact.label);
    legalBasis.push(fact);
  }

  const environment = [
    ...new Set(
      (s.environmentalCriteria ?? [])
        .filter((c) => c.type)
        .map((c) => {
          const label = AWARD_CRITERION_LABEL[c.type!] ?? c.type!;
          const w = weightText(c.weight, c.weightKind);
          return w ? `${label} – ${w}` : label;
        }),
    ),
  ];

  return {
    noticeKind,
    subtype: s.noticeSubtype ? `Skjema ${s.noticeSubtype}` : null,
    legalBasis,
    environment,
    strategic: [...new Set((s.strategicProcurement ?? []).map((c) => STRATEGIC[c]).filter((x): x is string => Boolean(x)))],
    eSubmission: s.eSubmission ? (E_SUBMISSION[s.eSubmission] ?? s.eSubmission) : null,
  };
}
