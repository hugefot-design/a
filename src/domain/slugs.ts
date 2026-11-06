/**
 * Norske adresser for bransje- og fylkessidene (/bransjer/renhold, /fylker/trondelag).
 * Ordene folk søker etter, gir bedre treff i Google enn de interne ID-ene (cleaning, 50).
 * De engelske, svenske og danske sidene bruker fortsatt ID-ene (/en/industries/cleaning).
 * Ingen avhengigheter, så filen kan brukes både av språkrutingen og av sidene.
 */
export const INDUSTRY_SLUG_NB: Record<string, string> = {
  construction: 'bygg-og-anlegg',
  it: 'it',
  cybersecurity: 'cybersikkerhet',
  healthcare: 'helse',
  cleaning: 'renhold',
  security: 'vakthold',
  transport: 'transport',
  consulting: 'radgivning',
  energy: 'energi',
  environmental: 'miljotjenester',
  manufacturing: 'industri',
  maintenance: 'drift-og-vedlikehold',
  telecom: 'telekom',
};

const INDUSTRY_ID_BY_NB_SLUG = new Map(Object.entries(INDUSTRY_SLUG_NB).map(([id, slug]) => [slug, id]));

/** Bransje-ID fra en norsk adresse («renhold») eller en ID («cleaning»). */
export function industryIdFromSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  if (INDUSTRY_ID_BY_NB_SLUG.has(slug)) return INDUSTRY_ID_BY_NB_SLUG.get(slug)!;
  return Object.hasOwn(INDUSTRY_SLUG_NB, slug) ? slug : null;
}

export function industrySlugNb(id: string): string {
  return INDUSTRY_SLUG_NB[id] ?? id;
}

/** Fylkesnummer → adresse. */
export const REGION_SLUG: Record<string, string> = {
  '03': 'oslo',
  '32': 'akershus',
  '31': 'ostfold',
  '33': 'buskerud',
  '34': 'innlandet',
  '39': 'vestfold',
  '40': 'telemark',
  '42': 'agder',
  '11': 'rogaland',
  '46': 'vestland',
  '15': 'more-og-romsdal',
  '50': 'trondelag',
  '18': 'nordland',
  '55': 'troms',
  '56': 'finnmark',
};

const REGION_CODE_BY_SLUG = new Map(Object.entries(REGION_SLUG).map(([code, slug]) => [slug, code]));

export function regionCodeFromSlug(slug: string | null | undefined): string | null {
  return (slug && REGION_CODE_BY_SLUG.get(slug)) || null;
}

export function regionSlug(code: string): string {
  return REGION_SLUG[code] ?? code;
}

/** Adressen til bransjesiden for ett fylke (bare på norsk). */
export function industryRegionPath(industryId: string, regionCode: string): string {
  return `/bransjer/${industrySlugNb(industryId)}/${regionSlug(regionCode)}`;
}

export function regionPath(regionCode: string): string {
  return `/fylker/${regionSlug(regionCode)}`;
}

/** Så mange åpne anbud må en bransje i et fylke ha før siden står i Google (ellers er den for tynn). */
export const MIN_OPEN_FOR_INDEXING = 3;
