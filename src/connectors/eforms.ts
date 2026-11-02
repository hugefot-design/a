/**
 * eForms-kunngjøringer (UBL-XML) → AnbudRadars felles format.
 *
 * Brukes for Doffins nedlasting (GET /v2/download/{doffinId}). Feltene leses etter XPath-ene i
 * DFØs eForms SDK NOR (fields/*.json i release v1.14.2-patch7, basert på EUs eForms SDK 1.14.2):
 *  - EU-skjemaer (over EØS-terskel, CustomizationID …:2023:eforms:eu),
 *  - nasjonale N4/N16/N29 (under terskel, …:2023:eforms:national),
 *  - nye nasjonale E2/E3/E4 (…:2026:eforms:national-e).
 *
 * Prinsipper: verdier som mangler i XML-en, blir null – ingenting fylles inn. Kunngjøringen er
 * allerede validert av Doffin før publisering; vi avviser den ikke, men logger det vi ikke forstår.
 * Sikkerhet: XML med DOCTYPE/ENTITY avvises (eForms bruker aldri det), og størrelsen er begrenset.
 */
import { DOMParser, type Element } from '@xmldom/xmldom';
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
  type NoticeLot,
} from '@/domain/tenders/normalize';

export const EFORMS_MAX_BYTES = 10 * 1024 * 1024;

const NS: Record<string, string> = {
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  ext: 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
  efext: 'http://data.europa.eu/p27/eforms-ubl-extensions/1',
  efac: 'http://data.europa.eu/p27/eforms-ubl-extension-aggregate-components/1',
  efbc: 'http://data.europa.eu/p27/eforms-ubl-extension-basic-components/1',
};

export class EformsError extends Error {}

// ---------------------------------------------------------------------------
// Små DOM-hjelpere (navnerom-sikre, uten XPath-motor)
// ---------------------------------------------------------------------------
function kids(el: Element | null | undefined, step: string): Element[] {
  if (!el) return [];
  const [prefix, local] = step.split(':') as [string, string];
  const ns = NS[prefix];
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const e = n as Element;
      if (e.namespaceURI === ns && e.localName === local) out.push(e);
    }
  }
  return out;
}

/** Alle elementer langs en sti som «cac:A/cac:B/cbc:C» (som XPath uten predikater). */
function all(el: Element | null | undefined, path: string): Element[] {
  let current: Element[] = el ? [el] : [];
  for (const step of path.split('/')) current = current.flatMap((c) => kids(c, step));
  return current;
}

function one(el: Element | null | undefined, path: string): Element | null {
  return all(el, path)[0] ?? null;
}

function txt(el: Element | null | undefined): string | null {
  const t = el?.textContent?.trim();
  return t ? t : null;
}

function texts(el: Element | null | undefined, path: string): string[] {
  return all(el, path)
    .map(txt)
    .filter((t): t is string => t !== null);
}

function attr(el: Element | null | undefined, name: string): string | null {
  const v = el?.getAttribute(name);
  return v ? v : null;
}

const NORWEGIAN = new Set(['NOR', 'NOB', 'NNO']);

/** Flerspråklige tekster: norsk først, ellers første verdi. Returnerer også språket. */
function localized(el: Element | null | undefined, path: string): { text: string | null; lang: string | null } {
  const nodes = all(el, path).filter((n) => txt(n));
  const nb = nodes.find((n) => NORWEGIAN.has((attr(n, 'languageID') ?? '').toUpperCase()));
  const chosen = nb ?? nodes[0];
  if (!chosen) return { text: null, lang: null };
  const lang = (attr(chosen, 'languageID') ?? '').toUpperCase();
  return { text: txt(chosen), lang: NORWEGIAN.has(lang) ? 'nb' : lang === 'ENG' ? 'en' : lang ? lang.toLowerCase() : null };
}

function ext(el: Element | null | undefined): Element | null {
  return one(el, 'ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/efext:EformsExtension');
}

function num(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function httpUrls(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    try {
      const u = new URL(v.trim());
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !out.includes(u.toString())) out.push(u.toString());
    } catch {
      /* ikke en nettadresse – hoppes over */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------
export type EformsVariant = 'eu' | 'national' | 'national-e' | 'unknown';

export interface EformsAwardCriterion {
  type: string | null;
  name: string | null;
  weight: number | null;
  /** BT-5421: per-exa (prosent), poi-exa (poeng), ord-imp (prioritet) … */
  weightKind: string | null;
}

export interface EformsLot {
  id: string | null;
  scheme: string | null;
  title: string | null;
  description: string | null;
  tenderDeadline: { iso: string | null; timeKnown: boolean };
  participationDeadline: { iso: string | null; timeKnown: boolean };
  questionsDeadline: { iso: string | null; timeKnown: boolean };
  documentsUrls: string[];
  documentsRestricted: string | null;
  submissionUrls: string[];
  eSubmission: string | null;
  duration: { months: number; text: string } | null;
  start: string | null;
  end: string | null;
  framework: string | null;
  estimatedValue: { amount: number; currency: string | null } | null;
  awardCriteria: EformsAwardCriterion[];
  selectionCriteria: string[];
  strategicProcurement: string[];
  cpv: string[];
  nuts: string[];
  city: string | null;
}

export interface EformsOrganization {
  id: string;
  name: string | null;
  orgNumber: string | null;
  city: string | null;
  country: string | null;
}

export interface EformsResult {
  lotId: string | null;
  resultCode: string | null;
  receivedTenders: number | null;
  winners: { name: string; orgNumber: string | null; value: number | null; currency: string | null; contractDate: string | null }[];
}

export interface EformsNotice {
  rootType: string;
  customizationId: string | null;
  variant: EformsVariant;
  noticeSubtype: string | null;
  noticeTypeCode: string | null;
  noticeIdentifier: string | null;
  noticeVersion: number | null;
  procedureIdentifier: string | null;
  issued: { iso: string | null; timeKnown: boolean };
  title: string | null;
  description: string | null;
  language: string | null;
  buyerReference: string | null;
  procedureType: string | null;
  contractNature: string | null;
  mainCpv: string | null;
  cpv: string[];
  nuts: string[];
  city: string | null;
  estimatedValue: { amount: number; currency: string | null } | null;
  legalBasis: { id: string | null; description: string | null }[];
  buyerLegalType: string | null;
  buyer: EformsOrganization | null;
  lots: EformsLot[];
  results: EformsResult[];
  changeDescription: string | null;
}

export function variantOf(customizationId: string | null): EformsVariant {
  if (!customizationId) return 'unknown';
  if (/eforms:national-e\b/.test(customizationId)) return 'national-e';
  if (/eforms:national\b/.test(customizationId)) return 'national';
  if (/eforms:eu\b/.test(customizationId) || /^eforms-sdk-\d/.test(customizationId)) return 'eu';
  return 'unknown';
}

const ISO3_TO_ISO2: Record<string, string> = { NOR: 'NO', SWE: 'SE', DNK: 'DK', FIN: 'FI', DEU: 'DE', ISL: 'IS' };

function amountOf(el: Element | null): { amount: number; currency: string | null } | null {
  const amount = num(txt(el));
  if (amount === null || amount < 0) return null;
  return { amount, currency: attr(el, 'currencyID')?.toUpperCase() ?? null };
}

function dateTime(period: Element | null): { iso: string | null; timeKnown: boolean } {
  return combineDateTime(txt(one(period, 'cbc:EndDate')), txt(one(period, 'cbc:EndTime')));
}

function parseLot(lot: Element): EformsLot {
  const project = one(lot, 'cac:ProcurementProject');
  const process = one(lot, 'cac:TenderingProcess');
  const terms = one(lot, 'cac:TenderingTerms');
  const docRefs = all(terms, 'cac:CallForTendersDocumentReference');
  // BT-15: helst lenken til de åpne dokumentene; ellers hvilken som helst dokumentlenke.
  const openDocs = docRefs.filter((r) => txt(one(r, 'cbc:DocumentType')) !== 'restricted-document');
  const urls = (refs: Element[]) => httpUrls(refs.flatMap((r) => texts(r, 'cac:Attachment/cac:ExternalReference/cbc:URI')));
  const duration = one(project, 'cac:PlannedPeriod/cbc:DurationMeasure');
  const criteria = all(terms, 'cac:AwardingTerms/cac:AwardingCriterion/cac:SubordinateAwardingCriterion').map((c) => {
    const param = all(ext(c), 'efac:AwardCriterionParameter').find((p) => attr(one(p, 'efbc:ParameterCode'), 'listName') === 'number-weight');
    return {
      type: txt(one(c, 'cbc:AwardingCriterionTypeCode')),
      name: localized(c, 'cbc:Name').text,
      weight: num(txt(one(param, 'efbc:ParameterNumeric'))),
      weightKind: txt(one(param, 'efbc:ParameterCode')),
    };
  });
  const framework = all(process, 'cac:ContractingSystem')
    .map((s) => one(s, 'cbc:ContractingSystemTypeCode'))
    .find((c) => attr(c, 'listName') === 'framework-agreement');
  const selection = all(ext(terms), 'efac:SelectionCriteria').map((s) => localized(s, 'cbc:Description').text).filter((t): t is string => t !== null);
  const strategic = all(project, 'cac:ProcurementAdditionalType')
    .map((t) => one(t, 'cbc:ProcurementTypeCode'))
    .filter((c) => attr(c, 'listName') === 'strategic-procurement')
    .map(txt)
    .filter((t): t is string => t !== null);
  const esub = all(process, 'cbc:SubmissionMethodCode').find((c) => attr(c, 'listName') === 'esubmission');
  return {
    id: txt(one(lot, 'cbc:ID')),
    scheme: attr(one(lot, 'cbc:ID'), 'schemeName'),
    title: localized(project, 'cbc:Name').text,
    description: localized(project, 'cbc:Description').text,
    tenderDeadline: dateTime(one(process, 'cac:TenderSubmissionDeadlinePeriod')),
    participationDeadline: dateTime(one(process, 'cac:ParticipationRequestReceptionPeriod')),
    questionsDeadline: dateTime(one(process, 'cac:AdditionalInformationRequestPeriod')),
    documentsUrls: urls(openDocs).length ? urls(openDocs) : urls(docRefs),
    documentsRestricted: txt(one(docRefs[0] ?? null, 'cbc:DocumentType')),
    submissionUrls: httpUrls(texts(terms, 'cac:TenderRecipientParty/cbc:EndpointID')),
    eSubmission: txt(esub ?? null),
    duration: duration ? durationFrom(txt(duration), attr(duration, 'unitCode')) : null,
    start: combineDateTime(txt(one(project, 'cac:PlannedPeriod/cbc:StartDate')), null).iso,
    end: combineDateTime(txt(one(project, 'cac:PlannedPeriod/cbc:EndDate')), null).iso,
    framework: txt(framework ?? null),
    estimatedValue: amountOf(one(project, 'cac:RequestedTenderTotal/cbc:EstimatedOverallContractAmount')),
    awardCriteria: criteria,
    selectionCriteria: selection,
    strategicProcurement: strategic,
    cpv: [
      ...texts(project, 'cac:MainCommodityClassification/cbc:ItemClassificationCode'),
      ...texts(project, 'cac:AdditionalCommodityClassification/cbc:ItemClassificationCode'),
    ],
    nuts: texts(project, 'cac:RealizedLocation/cac:Address/cbc:CountrySubentityCode'),
    city: txt(one(project, 'cac:RealizedLocation/cac:Address/cbc:CityName')),
  };
}

function parseOrganizations(rootExt: Element | null): Map<string, EformsOrganization> {
  const map = new Map<string, EformsOrganization>();
  for (const company of all(rootExt, 'efac:Organizations/efac:Organization/efac:Company')) {
    const id = txt(one(company, 'cac:PartyIdentification/cbc:ID'));
    if (!id) continue;
    const country = txt(one(company, 'cac:PostalAddress/cac:Country/cbc:IdentificationCode'));
    map.set(id, {
      id,
      name: localized(company, 'cac:PartyName/cbc:Name').text,
      orgNumber: txt(one(company, 'cac:PartyLegalEntity/cbc:CompanyID')),
      city: txt(one(company, 'cac:PostalAddress/cbc:CityName')),
      country: country ? (ISO3_TO_ISO2[country.toUpperCase()] ?? country.toUpperCase()) : null,
    });
  }
  return map;
}

function parseResults(rootExt: Element | null, orgs: Map<string, EformsOrganization>): EformsResult[] {
  const result = one(rootExt, 'efac:NoticeResult');
  if (!result) return [];
  const tenders = new Map<string, { value: { amount: number; currency: string | null } | null; party: string | null }>();
  for (const t of kids(result, 'efac:LotTender')) {
    const id = txt(one(t, 'cbc:ID'));
    if (id) tenders.set(id, { value: amountOf(one(t, 'cac:LegalMonetaryTotal/cbc:PayableAmount')), party: txt(one(t, 'efac:TenderingParty/cbc:ID')) });
  }
  const parties = new Map<string, string[]>();
  for (const p of kids(result, 'efac:TenderingParty')) {
    const id = txt(one(p, 'cbc:ID'));
    if (id) parties.set(id, texts(p, 'efac:Tenderer/cbc:ID'));
  }
  const contractDates = new Map<string, string | null>();
  for (const c of kids(result, 'efac:SettledContract')) {
    // Avtaledatoen er en dato (BT-145) – lagres som ÅÅÅÅ-MM-DD, så tidssonen ikke kan flytte den.
    const raw = txt(one(c, 'cbc:IssueDate'));
    const date = raw && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
    for (const tenderId of texts(c, 'efac:LotTender/cbc:ID')) contractDates.set(tenderId, date);
  }
  return kids(result, 'efac:LotResult').map((lr) => {
    const stats = kids(lr, 'efac:ReceivedSubmissionsStatistics').find((s) => txt(one(s, 'efbc:StatisticsCode')) === 'tenders');
    const winners: EformsResult['winners'] = [];
    for (const tenderId of texts(lr, 'efac:LotTender/cbc:ID')) {
      const tender = tenders.get(tenderId);
      for (const orgId of parties.get(tender?.party ?? '') ?? []) {
        const org = orgs.get(orgId);
        if (!org?.name) continue;
        winners.push({
          name: org.name,
          orgNumber: org.orgNumber,
          value: tender?.value?.amount ?? null,
          currency: tender?.value?.currency ?? null,
          contractDate: contractDates.get(tenderId) ?? null,
        });
      }
    }
    return {
      lotId: txt(one(lr, 'efac:TenderLot/cbc:ID')),
      resultCode: txt(one(lr, 'cbc:TenderResultCode')),
      receivedTenders: num(txt(one(stats ?? null, 'efbc:StatisticsNumeric'))),
      winners,
    };
  });
}

/** Leser en eForms-kunngjøring. Kaster EformsError ved ugyldig eller mistenkelig XML. */
export function parseEformsXml(xml: string): EformsNotice {
  if (Buffer.byteLength(xml, 'utf8') > EFORMS_MAX_BYTES) throw new EformsError('Kunngjøringen er for stor.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new EformsError('XML med DOCTYPE/ENTITY avvises.');
  let doc;
  try {
    doc = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new EformsError(message);
      },
    }).parseFromString(xml, 'text/xml');
  } catch (err) {
    throw new EformsError(`Ugyldig XML: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
  }
  const root = doc.documentElement;
  if (!root || !['ContractNotice', 'ContractAwardNotice', 'PriorInformationNotice'].includes(root.localName ?? '')) {
    throw new EformsError(`Ukjent dokumenttype: ${root?.localName ?? 'tom'}`);
  }
  const rootExt = ext(root);
  const orgs = parseOrganizations(rootExt);
  const project = one(root, 'cac:ProcurementProject');
  const customizationId = txt(one(root, 'cbc:CustomizationID'));
  const title = localized(project, 'cbc:Name');
  const buyerRef = txt(one(root, 'cac:ContractingParty/cac:Party/cac:PartyIdentification/cbc:ID'));
  const legalBasis = all(root, 'cac:TenderingTerms/cac:ProcurementLegislationDocumentReference')
    .filter((d) => !['CrossBorderLaw'].includes(txt(one(d, 'cbc:ID')) ?? ''))
    .map((d) => ({ id: txt(one(d, 'cbc:ID')), description: localized(d, 'cbc:DocumentDescription').text }));
  const internalId = all(project, 'cbc:ID').find((e) => attr(e, 'schemeName') === 'InternalID') ?? one(project, 'cbc:ID');
  return {
    rootType: root.localName ?? '',
    customizationId,
    variant: variantOf(customizationId),
    noticeSubtype: txt(one(rootExt, 'efac:NoticeSubType/cbc:SubTypeCode')),
    noticeTypeCode: txt(one(root, 'cbc:NoticeTypeCode')),
    noticeIdentifier: txt(kids(root, 'cbc:ID').find((e) => attr(e, 'schemeName') === 'notice-id') ?? null),
    noticeVersion: num(txt(one(root, 'cbc:VersionID'))),
    procedureIdentifier: txt(one(root, 'cbc:ContractFolderID')),
    issued: combineDateTime(txt(one(root, 'cbc:IssueDate')), txt(one(root, 'cbc:IssueTime'))),
    title: title.text,
    description: localized(project, 'cbc:Description').text,
    language: title.lang,
    buyerReference: txt(internalId),
    procedureType: txt(one(root, 'cac:TenderingProcess/cbc:ProcedureCode')),
    contractNature: txt(one(project, 'cbc:ProcurementTypeCode')),
    mainCpv: txt(one(project, 'cac:MainCommodityClassification/cbc:ItemClassificationCode')),
    cpv: [
      ...texts(project, 'cac:MainCommodityClassification/cbc:ItemClassificationCode'),
      ...texts(project, 'cac:AdditionalCommodityClassification/cbc:ItemClassificationCode'),
    ],
    nuts: texts(project, 'cac:RealizedLocation/cac:Address/cbc:CountrySubentityCode'),
    city: txt(one(project, 'cac:RealizedLocation/cac:Address/cbc:CityName')),
    estimatedValue: amountOf(one(project, 'cac:RequestedTenderTotal/cbc:EstimatedOverallContractAmount')),
    legalBasis,
    buyerLegalType: txt(
      all(root, 'cac:ContractingParty/cac:ContractingPartyType/cbc:PartyTypeCode').find((c) => attr(c, 'listName') === 'buyer-legal-type') ?? null,
    ),
    buyer: buyerRef ? (orgs.get(buyerRef) ?? null) : null,
    lots: kids(root, 'cac:ProcurementProjectLot').map(parseLot),
    results: parseResults(rootExt, orgs),
    changeDescription: localized(rootExt, 'efac:Changes/efac:Change/efbc:ChangeDescription').text,
  };
}

// ---------------------------------------------------------------------------
// eForms → felles format
// ---------------------------------------------------------------------------
export function eformsLifecycle(p: Pick<EformsNotice, 'noticeTypeCode' | 'results'>): Lifecycle {
  const t = (p.noticeTypeCode ?? '').toLowerCase();
  if (t.startsWith('pin-cfc') || t === 'qu-sy') return 'competition';
  if (t.startsWith('pin') || t === 'pmc') return 'planned';
  if (t.startsWith('cn') || t === 'subco') return 'competition';
  if (t === 'veat') return 'direct_award';
  if (t.startsWith('can')) {
    // Avsluttet uten vinner på alle delkontrakter = konkurransen er avsluttet uten tildeling.
    if (p.results.length && p.results.every((r) => r.resultCode === 'clos-nw')) return 'cancelled';
    return 'awarded';
  }
  return 'other';
}

/** Norske navn på tildelingskriterietyper (DFØs oversettelser, gjennomgått). */
export const AWARD_CRITERION_LABEL: Record<string, string> = {
  price: 'Pris',
  cost: 'Kostnad',
  quality: 'Kvalitet',
  'quality-nor-env-criteria': 'Klima- og miljøhensyn (tildelingskriterium)',
  'quality-nor-env-spec': 'Klima- og miljøhensyn (krav i spesifikasjonen)',
  'quality-nor-env-none': 'Klima- og miljøhensyn: ikke relevant',
  'quality-nor-env-exempt-critical-interest': 'Klima- og miljøhensyn: unntak (vesentlig interesse)',
  'quality-nor-env-exempt-insignificant': 'Klima- og miljøhensyn: unntak (ubetydelig miljøbelastning)',
  'quality-nor-env-exempt-national-minimum': 'Klima- og miljøhensyn: unntak (under nasjonal minsteverdi)',
};

function weightText(c: EformsAwardCriterion): string | null {
  if (c.weight === null) return null;
  const n = c.weight.toLocaleString('nb-NO');
  switch (c.weightKind) {
    case 'per-exa':
    case 'per-ran':
      return `${n} %`;
    case 'poi-exa':
    case 'poi-ran':
      return `${n} poeng`;
    case 'ord-imp':
      return `prioritet ${n}`;
    default:
      return n;
  }
}

function earliest(values: { iso: string | null; timeKnown: boolean }[]): { iso: string | null; timeKnown: boolean; differ: boolean } {
  const valid = values.filter((v): v is { iso: string; timeKnown: boolean } => v.iso !== null).sort((a, b) => a.iso.localeCompare(b.iso));
  return { iso: valid[0]?.iso ?? null, timeKnown: valid[0]?.timeKnown ?? false, differ: new Set(valid.map((v) => v.iso)).size > 1 };
}

function dedupe(values: string[], max: number, maxLen: number): string[] {
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

export interface EformsSourceMeta {
  sourceNoticeId: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
}

/** Kompakt sammendrag som lagres som «raw» for kunngjøringen (ikke hele XML-en). */
export function eformsRawSummary(p: EformsNotice, meta: EformsSourceMeta) {
  const envCriteria = p.lots.flatMap((l) => l.awardCriteria.filter((c) => (c.type ?? '').startsWith('quality-nor-env')));
  return {
    format: 'eforms-xml' as const,
    doffinId: meta.sourceNoticeId,
    sha256: meta.sha256,
    bytes: meta.bytes,
    customizationId: p.customizationId,
    variant: p.variant,
    noticeSubtype: p.noticeSubtype,
    noticeTypeCode: p.noticeTypeCode,
    legalBasis: p.legalBasis,
    buyerLegalType: p.buyerLegalType,
    strategicProcurement: [...new Set(p.lots.flatMap((l) => l.strategicProcurement))],
    environmentalCriteria: envCriteria.map((c) => ({ type: c.type, weight: c.weight, weightKind: c.weightKind })),
    eSubmission: p.lots.find((l) => l.eSubmission)?.eSubmission ?? null,
    lotCount: p.lots.length,
  };
}

export function eformsToNotice(p: EformsNotice, meta: EformsSourceMeta): NormalizedNotice {
  const lifecycle = eformsLifecycle(p);
  const lots = p.lots;
  const competition = lifecycle === 'competition';
  const tender = earliest(lots.map((l) => l.tenderDeadline));
  const participation = earliest(lots.map((l) => l.participationDeadline));
  const questions = earliest(lots.map((l) => l.questionsDeadline));
  // Frist bare på konkurransekunngjøringer. Uten tilbudsfrist, men med frist for å be om å delta
  // (begrenset konkurranse), er det den som gjelder.
  const deadline = competition ? (tender.iso ? tender : participation.iso ? participation : null) : null;
  const deadlineKind = deadline ? (tender.iso ? 'tender' : 'participation') : null;

  const cpv = [...new Set([...p.cpv, ...lots.flatMap((l) => l.cpv)].map(cleanCpv).filter((c): c is string => c !== null))];
  const nuts = cleanNutsCodes([...p.nuts, ...lots.flatMap((l) => l.nuts)]);
  const durations = lots.map((l) => l.duration).filter((d): d is { months: number; text: string } => d !== null);
  const longest = durations.sort((a, b) => b.months - a.months)[0] ?? null;
  const starts = lots.map((l) => l.start).filter((d): d is string => d !== null).sort();
  const ends = lots.map((l) => l.end).filter((d): d is string => d !== null).sort();
  const frameworks = lots.map((l) => l.framework).filter((f): f is string => f !== null);

  const value = p.estimatedValue ?? (lots.length === 1 ? lots[0]!.estimatedValue : null);
  const estimated = lifecycle === 'awarded' ? null : (value?.amount ?? null);

  const criteriaSeen = new Set<string>();
  const awardCriteria: NoticeAwardCriterion[] = [];
  for (const c of lots.flatMap((l) => l.awardCriteria)) {
    const name = (c.name ?? (c.type ? (AWARD_CRITERION_LABEL[c.type] ?? c.type) : null))?.slice(0, 500);
    if (!name) continue;
    const item = { name, type: c.type, weight: weightText(c) };
    const key = `${item.type}|${item.name}|${item.weight}`;
    if (criteriaSeen.has(key)) continue;
    criteriaSeen.add(key);
    awardCriteria.push(item);
    if (awardCriteria.length >= 30) break;
  }

  const lotTitle = new Map(lots.map((l) => [l.id, l.title]));
  const awards: NoticeAward[] = [];
  for (const r of p.results) {
    if (r.resultCode !== 'selec-w') continue;
    for (const w of r.winners) {
      awards.push({
        lotTitle: lots.length > 1 ? (lotTitle.get(r.lotId)?.slice(0, 1000) ?? r.lotId) : null,
        supplierName: w.name.slice(0, 500),
        supplierOrgNumber: w.orgNumber ? cleanOrgNumber(w.orgNumber, 'NO') : null,
        value: w.value,
        currency: w.currency,
        awardDate: w.contractDate,
      });
    }
  }
  const receivedTenders = p.results.length === 1 ? (p.results[0]!.receivedTenders ?? null) : null;

  const noticeLots: NoticeLot[] =
    lots.length > 1
      ? lots.slice(0, 300).map((l) => ({
          id: l.id,
          title: stripHtml(l.title)?.slice(0, 1000) ?? null,
          estimatedValue: l.estimatedValue?.amount ?? null,
          durationText: l.duration?.text ?? null,
        }))
      : [];
  const title = stripHtml(p.title) ?? stripHtml(lots[0]?.title ?? null) ?? `Doffin ${meta.sourceNoticeId}`;
  const description = stripHtml(p.description) ?? stripHtml(lots[0]?.description ?? null);
  const buyerCountry = p.buyer?.country ?? 'NO';
  // Planleggingskunngjøringer etablerer ikke en anskaffelsesprosedyre (DFØ: notice-identifiers, R-15/R-17).
  const procedureId = lifecycle === 'planned' ? null : p.procedureIdentifier;

  return {
    source: 'doffin',
    sourceNoticeId: meta.sourceNoticeId,
    sourceUrl: meta.sourceUrl,
    noticeType: p.noticeTypeCode,
    lifecycle,
    procedureId,
    buyerReference: p.buyerReference?.slice(0, 200) ?? null,
    title: title.slice(0, 1000),
    description,
    buyerName: p.buyer?.name?.slice(0, 500) ?? null,
    buyerOrgNumber: p.buyer?.orgNumber ? cleanOrgNumber(p.buyer.orgNumber, buyerCountry) : null,
    buyerCity: p.buyer?.city ?? null,
    countryCode: buyerCountry.length === 2 ? buyerCountry : 'NO',
    nutsCodes: nuts,
    placeText: p.city ?? lots.find((l) => l.city)?.city ?? null,
    cpvCodes: cpv,
    mainCpv: cleanCpv(p.mainCpv) ?? mostSpecificCpv(cpv),
    contractNature: p.contractNature === 'works' || p.contractNature === 'supplies' || p.contractNature === 'services' ? p.contractNature : null,
    procedureType: p.procedureType,
    estimatedValue: estimated,
    currency: estimated !== null ? (value?.currency ?? 'NOK') : null,
    publishedAt: p.issued.iso,
    deadlineAt: deadline?.iso ?? null,
    deadlineTimeKnown: deadline?.timeKnown ?? false,
    documentsUrl: lots.flatMap((l) => l.documentsUrls)[0] ?? null,
    receivedTenders,
    awards,
    details: {
      noticeIdentifier: p.noticeIdentifier,
      noticeVersion: p.noticeVersion,
      questionsDeadlineAt: questions.iso,
      participationDeadlineAt: participation.iso,
      deadlineKind,
      lotDeadlinesDiffer: deadlineKind === 'tender' ? tender.differ : deadlineKind === 'participation' ? participation.differ : false,
      durationMonths: longest?.months ?? null,
      durationText: longest?.text ?? null,
      contractStart: starts[0] ?? null,
      contractEnd: ends.at(-1) ?? null,
      submissionUrl: lots.flatMap((l) => l.submissionUrls)[0] ?? null,
      lots: noticeLots,
      selectionCriteria: dedupe(lots.flatMap((l) => l.selectionCriteria), 30, 4000),
      awardCriteria,
      isFramework: frameworks.length ? frameworks.some((f) => f !== 'none') : null,
      changeDescription: p.changeDescription?.slice(0, 4000) ?? null,
      language: p.language ?? 'nb',
    },
    raw: eformsRawSummary(p, meta),
  };
}
