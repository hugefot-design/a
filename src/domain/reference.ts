/**
 * Referansedata brukt i ren kode (tolking av søk, matching, visning).
 * Speiler db/migrations/0003_reference_data.sql – en integrasjonstest sjekker at de er like.
 */

export interface Region {
  code: string;
  name: string;
  nuts: string[];
}

/**
 * Fylker fra 2024 med NUTS-koder. Første kode er NUTS 2024 (brukes av TED og Doffin nå –
 * verifisert mot bynavn i ekte TED-kunngjøringer 1.11.2026: NO083 Fredrikstad/Sarpsborg/Moss,
 * NO084 Sandvika/Asker/Ski, NO085 Drammen/Hønefoss, NO093 Sandefjord/Larvik, NO094 Skien,
 * NO072 Tromsø/Harstad, NO073 Vadsø/Alta/Hammerfest). Eldre NUTS 2021-koder (NO082 Viken,
 * NO091 Vestfold og Telemark, NO074 Troms og Finnmark) dekket flere fylker og står på alle.
 */
export const REGIONS: Region[] = [
  { code: '03', name: 'Oslo', nuts: ['NO081'] },
  { code: '32', name: 'Akershus', nuts: ['NO084', 'NO082'] },
  { code: '31', name: 'Østfold', nuts: ['NO083', 'NO082'] },
  { code: '33', name: 'Buskerud', nuts: ['NO085', 'NO082'] },
  { code: '34', name: 'Innlandet', nuts: ['NO020'] },
  { code: '39', name: 'Vestfold', nuts: ['NO093', 'NO091'] },
  { code: '40', name: 'Telemark', nuts: ['NO094', 'NO091'] },
  { code: '42', name: 'Agder', nuts: ['NO092'] },
  { code: '11', name: 'Rogaland', nuts: ['NO0A1'] },
  { code: '46', name: 'Vestland', nuts: ['NO0A2'] },
  { code: '15', name: 'Møre og Romsdal', nuts: ['NO0A3'] },
  { code: '50', name: 'Trøndelag', nuts: ['NO060'] },
  { code: '18', name: 'Nordland', nuts: ['NO071'] },
  { code: '55', name: 'Troms', nuts: ['NO072', 'NO074'] },
  { code: '56', name: 'Finnmark', nuts: ['NO073', 'NO074'] },
];

export const REGION_BY_CODE = new Map(REGIONS.map((r) => [r.code, r]));

/** NUTS2-regioner (fallback for NUTS3-koder vi ikke kjenner, f.eks. nye 2024-koder). */
const NUTS2_TO_REGIONS: Record<string, string[]> = {
  NO02: ['34'],
  NO06: ['50'],
  NO07: ['18', '55', '56'],
  NO08: ['03', '32', '31', '33'],
  NO09: ['39', '40', '42'],
  NO0A: ['11', '46', '15'],
};

/** Oversetter NUTS-koder til fylkeskoder. Ukjente koder gir tom liste (aldri gjetning). */
export function regionsFromNuts(nutsCodes: string[]): string[] {
  const out = new Set<string>();
  for (const raw of nutsCodes) {
    const code = raw.trim().toUpperCase();
    if (!code.startsWith('NO')) continue;
    let matched = false;
    for (const r of REGIONS) {
      if (r.nuts.includes(code)) {
        out.add(r.code);
        matched = true;
      }
    }
    if (!matched && code.length >= 4) {
      for (const rc of NUTS2_TO_REGIONS[code.slice(0, 4)] ?? []) out.add(rc);
    }
  }
  return [...out].sort();
}

export interface Industry {
  id: string;
  name: string;
  description: string;
  cpvPrefixes: string[];
  keywords: string[];
}

export const INDUSTRIES: Industry[] = [
  {
    id: 'construction',
    name: 'Bygg og anlegg',
    description: 'Bygge- og anleggsarbeid, rehabilitering, arkitekt- og ingeniørtjenester.',
    cpvPrefixes: ['45', '44', '71'],
    keywords: ['bygg', 'anlegg', 'entreprise', 'totalentreprise', 'rehabilitering', 'nybygg', 'riving', 'grunnarbeid', 'veiarbeid', 'bru', 'tunnel', 'construction', 'building'],
  },
  {
    id: 'it',
    name: 'IT og programvare',
    description: 'Programvare, skytjenester, IT-drift, systemutvikling og datautstyr.',
    cpvPrefixes: ['72', '48', '302'],
    keywords: ['programvare', 'software', 'skytjeneste', 'saas', 'lisens', 'it-drift', 'systemutvikling', 'digitalisering', 'fagsystem', 'plattform'],
  },
  {
    id: 'cybersecurity',
    name: 'Cybersikkerhet',
    description: 'Informasjonssikkerhet, sikkerhetstesting, overvåking av IT-systemer og rådgivning.',
    cpvPrefixes: ['48730', '48760', '72800'],
    keywords: ['cybersikkerhet', 'informasjonssikkerhet', 'it-sikkerhet', 'sikkerhetstest', 'penetrasjonstest', 'pentest', 'soc', 'siem', 'sårbarhet', 'iso 27001', 'cyber'],
  },
  {
    id: 'healthcare',
    name: 'Helse og medisinsk',
    description: 'Medisinsk utstyr, legemidler, helse- og omsorgstjenester.',
    cpvPrefixes: ['33', '85'],
    keywords: ['helse', 'medisinsk', 'sykehus', 'legemidler', 'pleie', 'omsorg', 'hjemmetjeneste', 'laboratorium', 'forbruksmateriell'],
  },
  {
    id: 'cleaning',
    name: 'Renhold og eiendomsdrift',
    description: 'Renhold, vinduspuss, vaktmester og drift av bygg.',
    cpvPrefixes: ['909', '79993', '3983'],
    keywords: ['renhold', 'rengjøring', 'vaktmester', 'eiendomsdrift', 'fdv', 'vinduspuss', 'matteservice', 'driftstjenester'],
  },
  {
    id: 'security',
    name: 'Vakt og sikkerhet',
    description: 'Vakthold, alarmmottak, adgangskontroll og sikkerhetsutstyr.',
    cpvPrefixes: ['7971', '3512'],
    keywords: ['vakthold', 'vekter', 'vakttjenester', 'sikkerhetstjenester', 'alarmmottak', 'adgangskontroll', 'objektsikring', 'kameraovervåking', 'security services', 'guarding'],
  },
  {
    id: 'transport',
    name: 'Transport og logistikk',
    description: 'Persontransport, skoleskyss, godstransport, lager og logistikk.',
    cpvPrefixes: ['60', '63', '34'],
    keywords: ['transport', 'logistikk', 'skoleskyss', 'pasienttransport', 'drosje', 'frakt', 'budtjenester', 'lager', 'kjøretøy'],
  },
  {
    id: 'consulting',
    name: 'Rådgivning',
    description: 'Forretnings- og ledelsesrådgivning, utredning, analyse og FoU.',
    cpvPrefixes: ['794', '793', '73'],
    keywords: ['rådgivning', 'konsulent', 'utredning', 'analyse', 'prosjektledelse', 'evaluering', 'consulting', 'advisory'],
  },
  {
    id: 'energy',
    name: 'Energi',
    description: 'Strøm, fjernvarme, solenergi, energieffektivisering og ladeinfrastruktur.',
    cpvPrefixes: ['09', '65', '71314'],
    keywords: ['energi', 'strøm', 'kraft', 'solcelle', 'varmepumpe', 'fjernvarme', 'ladestasjon', 'lading', 'energieffektivisering', 'enøk'],
  },
  {
    id: 'environmental',
    name: 'Miljøtjenester',
    description: 'Avfall, renovasjon, gjenvinning, avløp og grøntanlegg.',
    cpvPrefixes: ['905', '907', '904', '773'],
    keywords: ['avfall', 'renovasjon', 'gjenvinning', 'miljø', 'forurensning', 'avløp', 'grøntanlegg', 'miljøkartlegging'],
  },
  {
    id: 'manufacturing',
    name: 'Industri og produksjon',
    description: 'Maskiner, utstyr, møbler og industriprodukter.',
    cpvPrefixes: ['42', '43', '31', '39', '38', '16', '19', '24', '14'],
    keywords: ['produksjon', 'industri', 'maskiner', 'utstyr', 'fabrikasjon', 'tilvirkning', 'møbler'],
  },
  {
    id: 'maintenance',
    name: 'Drift og vedlikehold',
    description: 'Service, reparasjon og vedlikehold av bygg, anlegg og utstyr.',
    cpvPrefixes: ['50', '51', '45259', '45453'],
    keywords: ['vedlikehold', 'service', 'reparasjon', 'serviceavtale', 'utbedring', 'periodisk kontroll', 'ettersyn'],
  },
  {
    id: 'telecom',
    name: 'Telekom',
    description: 'Telefoni, bredbånd, fiber, mobil og radiokommunikasjon.',
    cpvPrefixes: ['32', '642'],
    keywords: ['telekom', 'bredbånd', 'fiber', 'mobil', 'telefoni', 'nødnett', 'radiokommunikasjon', 'nettverk'],
  },
];

export const INDUSTRY_BY_ID = new Map(INDUSTRIES.map((i) => [i.id, i]));

export const CPV_DIVISIONS: Record<string, string> = {
  '03': 'Landbruks-, fiskeri- og skogbruksprodukter',
  '09': 'Petroleumsprodukter, brensel, elektrisitet og andre energikilder',
  '14': 'Bergverk, basismetaller og tilknyttede produkter',
  '15': 'Næringsmidler, drikkevarer og tobakk',
  '16': 'Landbruksmaskiner',
  '18': 'Klær, fottøy, bagasje og tilbehør',
  '19': 'Lær, tekstiler, plast- og gummimaterialer',
  '22': 'Trykksaker og tilknyttede produkter',
  '24': 'Kjemiske produkter',
  '30': 'Kontor- og datamaskiner, utstyr og rekvisita',
  '31': 'Elektriske maskiner, apparater og utstyr; belysning',
  '32': 'Radio-, TV-, kommunikasjons- og telekomutstyr',
  '33': 'Medisinsk utstyr, legemidler og pleieprodukter',
  '34': 'Transportutstyr og tilbehør',
  '35': 'Sikkerhets-, brann-, politi- og forsvarsutstyr',
  '37': 'Musikkinstrumenter, sportsutstyr, spill og leker',
  '38': 'Laboratorie-, optisk og presisjonsutstyr',
  '39': 'Møbler, innredning, husholdningsapparater og rengjøringsprodukter',
  '41': 'Oppsamlet og renset vann',
  '42': 'Industrimaskiner',
  '43': 'Maskiner for bergverk, steinbrudd og anlegg',
  '44': 'Bygningskonstruksjoner og byggematerialer',
  '45': 'Bygge- og anleggsarbeid',
  '48': 'Programvarepakker og informasjonssystemer',
  '50': 'Reparasjons- og vedlikeholdstjenester',
  '51': 'Installasjonstjenester (unntatt programvare)',
  '55': 'Hotell-, restaurant- og detaljhandelstjenester',
  '60': 'Transporttjenester (unntatt avfallstransport)',
  '63': 'Støttetjenester for transport; reisebyråtjenester',
  '64': 'Post- og telekommunikasjonstjenester',
  '65': 'Offentlige forsyningstjenester',
  '66': 'Finans- og forsikringstjenester',
  '70': 'Eiendomstjenester',
  '71': 'Arkitekt-, ingeniør- og inspeksjonstjenester',
  '72': 'IT-tjenester: rådgivning, programvareutvikling, Internett og brukerstøtte',
  '73': 'Forsknings- og utviklingstjenester',
  '75': 'Offentlig administrasjon, forsvar og trygd',
  '76': 'Tjenester for olje- og gassindustrien',
  '77': 'Landbruks-, skogbruks-, hagebruks- og akvakulturtjenester',
  '79': 'Forretningstjenester: juss, markedsføring, rådgivning, rekruttering, trykking og sikkerhet',
  '80': 'Undervisnings- og opplæringstjenester',
  '85': 'Helse- og sosialtjenester',
  '90': 'Avløps-, avfalls-, rengjørings- og miljøtjenester',
  '92': 'Fritids-, kultur- og idrettstjenester',
  '98': 'Andre samfunns-, sosiale og personlige tjenester',
};

export const COUNTRIES: { code: string; name: string; active: boolean }[] = [
  { code: 'NO', name: 'Norge', active: true },
  { code: 'SE', name: 'Sverige', active: false },
  { code: 'DK', name: 'Danmark', active: false },
  { code: 'FI', name: 'Finland', active: false },
  { code: 'DE', name: 'Tyskland', active: false },
];

export const CONTRACT_NATURES: Record<string, string> = {
  works: 'Bygge- og anleggsarbeid',
  supplies: 'Varer',
  services: 'Tjenester',
};

export const STATUS_LABELS: Record<string, string> = {
  open: 'Åpen',
  closed: 'Frist utløpt',
  planned: 'Planlagt (forhåndskunngjøring)',
  awarded: 'Tildelt',
  cancelled: 'Avlyst',
  direct_award: 'Direkte tildeling (intensjon)',
  withdrawn: 'Fjernet fra kilden',
  unknown: 'Ukjent',
};

export const COMPANY_SIZES: Record<string, string> = {
  '1-9': '1–9 ansatte',
  '10-49': '10–49 ansatte',
  '50-249': '50–249 ansatte',
  '250+': '250 eller flere',
};

/** Vanlige sertifiseringer og godkjenninger i norske anskaffelser (brukes i profil og matching). */
export const CERTIFICATIONS: { id: string; label: string; patterns: RegExp[] }[] = [
  { id: 'iso9001', label: 'ISO 9001 (kvalitet)', patterns: [/iso[\s-]?9001/i] },
  { id: 'iso14001', label: 'ISO 14001 (miljø)', patterns: [/iso[\s-]?14001/i] },
  { id: 'iso27001', label: 'ISO 27001 (informasjonssikkerhet)', patterns: [/iso[\s/-]?(iec[\s-]?)?27001/i] },
  { id: 'iso45001', label: 'ISO 45001 (HMS)', patterns: [/iso[\s-]?45001/i] },
  { id: 'miljofyrtarn', label: 'Miljøfyrtårn', patterns: [/milj(ø|o)fyrt(å|a)rn/i] },
  { id: 'startbank', label: 'StartBANK / Achilles', patterns: [/startbank/i, /achilles/i] },
  { id: 'sentral_godkjenning', label: 'Sentral godkjenning (byggesak)', patterns: [/sentral godkjenning/i] },
  { id: 'renholdsregister', label: 'Godkjent i renholdsregisteret', patterns: [/renholdsregister/i, /godkjent renholds/i] },
  { id: 'vaktvirksomhet', label: 'Godkjenning etter vaktvirksomhetsloven', patterns: [/vaktvirksomhetslov/i, /vaktvirksomhet.{0,40}(tillatelse|godkjenning)/i] },
  { id: 'svanemerket', label: 'Svanemerket', patterns: [/svanemerk/i] },
  { id: 'fg_godkjent', label: 'FG-godkjent (brann/innbrudd)', patterns: [/fg[\s-]?godkjen/i] },
  { id: 'elvirksomhet', label: 'Registrert elvirksomhet (DSB)', patterns: [/elvirksomhetsregister/i, /registrert elvirksomhet/i] },
  { id: 'nsm_klarering', label: 'Sikkerhetsklarering (NSM)', patterns: [/sikkerhetsklarer/i, /klarering.{0,20}nsm/i] },
];

export const CERT_BY_ID = new Map(CERTIFICATIONS.map((c) => [c.id, c]));

export function cpvLabel(code: string, labels?: Map<string, string>): string {
  const exact = labels?.get(code);
  if (exact) return exact;
  const div = CPV_DIVISIONS[code.slice(0, 2)];
  return div ? `${div} (hovedgruppe)` : 'Ukjent CPV-kode';
}

/** Prosedyretyper (eForms-kodeliste brukt av TED; Doffin bruker tilsvarende verdier). */
const PROCEDURE_LABELS: Record<string, string> = {
  open: 'Åpen anbudskonkurranse',
  restricted: 'Begrenset anbudskonkurranse',
  'neg-w-call': 'Konkurranse med forhandling',
  'neg-wo-call': 'Forhandling uten forutgående kunngjøring',
  'comp-dial': 'Konkurransepreget dialog',
  innovation: 'Innovasjonspartnerskap',
  'comp-tend': 'Konkurranse (kollektivtransport)',
  'oth-single': 'Annen prosedyre (ett trinn)',
  'oth-mult': 'Annen prosedyre (flere trinn)',
  'exp-int-rail': 'Interessekunngjøring (jernbane)',
  negotiated: 'Konkurranse med forhandling',
  competitive_dialogue: 'Konkurransepreget dialog',
  innovation_partnership: 'Innovasjonspartnerskap',
};

/** Gir norsk tekst for kjente prosedyrekoder, ellers verdien slik kilden oppgir den. */
export function procedureLabel(value: string): string {
  const key = value.trim().toLowerCase().replace(/\s+/g, '_');
  return PROCEDURE_LABELS[key] ?? PROCEDURE_LABELS[key.replace(/_/g, '-')] ?? value;
}
