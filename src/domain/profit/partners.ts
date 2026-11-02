/**
 * Anbudspartnere: finn bedrifter som kan dekke mangler i kapasitet, kompetanse, sertifiseringer
 * eller utstyr – med samtykke og kontroll over hva som deles.
 *
 * Personvern og sikkerhet
 *  - En partnerprofil er usynlig for andre til organisasjonen publiserer den med samtykke
 *    (tidspunkt og tekstversjon lagres). Den kan skjules igjen når som helst.
 *  - Profilen inneholder bare felt som er laget for å deles. Kalkyler, priser, kunder og
 *    dokumenter deles aldri.
 *  - Avsenderen deler sin kontaktinfo i forespørselen. Mottakerens kontaktinfo deles bare
 *    hvis mottakeren godtar. Databasen håndhever hvem som kan godta, avslå og trekke tilbake.
 *
 * Konkurranserett
 *  - Samarbeid om anbud mellom bedrifter som hver for seg kunne levert, kan være ulovlig
 *    (konkurranseloven § 10). Forespørsler der begge oppgir at de kan levere alene, stoppes,
 *    og alle forespørsler viser Konkurransetilsynets veiledning.
 */
import { z } from 'zod';
import { first, systemSql, type Tx } from '@/lib/db';
import { audit } from '@/lib/audit';
import { insertNotifications } from '@/domain/notifications/engine';
import { CERT_BY_ID, INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { containsTerm } from '@/domain/tenders/normalize';
import type { CompanyProfile } from '@/domain/profile/profile';

export const PARTNER_CONSENT_VERSION = 'partner-v1';
export const PARTNER_CONSENT_TEXT =
  'Vi samtykker til at partnerprofilen vises for andre AnbudRadar-kunder som leter etter samarbeidspartnere, og at de kan sende oss forespørsler gjennom AnbudRadar. Kontaktinformasjonen vår deles bare når vi selv godtar en forespørsel. Vi kan skjule profilen når som helst.';

export const COMPETITION_GUIDANCE_URL = 'https://konkurransetilsynet.no/wp-content/uploads/2018/09/prosjektveileder_-2014.pdf';

export const PARTNER_ROLES = [
  { id: 'underleverandor', label: 'Underleverandør' },
  { id: 'samarbeidspartner', label: 'Samarbeidspartner (felles tilbud)' },
  { id: 'hovedleverandor', label: 'Hovedleverandør (tar inn underleverandører)' },
] as const;
export type PartnerRole = (typeof PARTNER_ROLES)[number]['id'];
export const PARTNER_ROLE_LABEL = new Map<string, string>(PARTNER_ROLES.map((r) => [r.id, r.label]));

export const SELF_ASSESSMENTS = [
  { id: 'ingen_kan_alene', label: 'Ingen av oss kan levere hele oppdraget alene' },
  { id: 'bare_en_kan_alene', label: 'Bare én av oss kan levere hele oppdraget alene' },
  { id: 'usikker', label: 'Vi er usikre' },
  { id: 'begge_kan_alene', label: 'Begge kan levere hele oppdraget alene' },
] as const;
export type SelfAssessment = (typeof SELF_ASSESSMENTS)[number]['id'];

export const COMPETITION_BLOCK_MESSAGE =
  'Forespørselen er ikke sendt. Når begge bedrifter kan levere hele oppdraget alene, er et felles tilbud som hovedregel ulovlig samarbeid mellom konkurrenter (konkurranseloven § 10). Gi tilbud hver for dere, eller få en konkret juridisk vurdering først.';

/** Grense per organisasjon for å hindre masseutsendelser. */
export const PARTNER_REQUESTS_PER_DAY = 20;

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------
export interface PartnerProfile {
  orgId: string;
  published: boolean;
  displayName: string;
  summary: string | null;
  capabilities: string | null;
  industries: string[];
  regions: string[];
  certifications: string[];
  partnerRoles: PartnerRole[];
  employeeCount: number | null;
  consentAt: Date | null;
  consentVersion: string | null;
  updatedAt: Date;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' && v ? [v] : []);

export const partnerProfileSchema = z
  .object({
    displayName: z.string().trim().min(1, 'Skriv inn navnet som skal vises.').max(160),
    summary: z.string().trim().max(2000).transform((v) => v || null),
    capabilities: z.string().trim().max(3000).transform((v) => v || null),
    industries: z.preprocess(list, z.array(z.string())).transform((a) => [...new Set(a.filter((i) => INDUSTRY_BY_ID.has(i)))].slice(0, 10)),
    regions: z
      .preprocess(list, z.array(z.string()))
      .transform((a) => (a.includes('ALL') ? ['ALL'] : [...new Set(a.filter((r) => REGION_BY_CODE.has(r)))])),
    certifications: z.preprocess(list, z.array(z.string())).transform((a) => [...new Set(a.filter((c) => CERT_BY_ID.has(c)))]),
    partnerRoles: z
      .preprocess(list, z.array(z.enum(['underleverandor', 'samarbeidspartner', 'hovedleverandor'])))
      .refine((a) => a.length > 0, 'Velg minst én rolle dere kan ha.'),
    employeeCount: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s/g, ''))
      .refine((v) => v === '' || /^\d{1,7}$/.test(v), 'Antall ansatte må være et helt tall.')
      .transform((v) => (v === '' ? null : Number(v))),
    published: z.boolean(),
    consent: z.boolean(),
  })
  .superRefine((d, ctx) => {
    if (d.published && !d.consent) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['consent'], message: 'Dere må samtykke for å publisere profilen.' });
    if (d.published && d.regions.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['regions'], message: 'Velg hvor dere kan levere.' });
  });
export type PartnerProfileForm = z.infer<typeof partnerProfileSchema>;

export function partnerFormFromData(form: FormData): Record<string, unknown> {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : '';
  };
  return {
    displayName: str('displayName'),
    summary: str('summary'),
    capabilities: str('capabilities'),
    industries: form.getAll('industries'),
    regions: form.getAll('regions'),
    certifications: form.getAll('certifications'),
    partnerRoles: form.getAll('partnerRoles'),
    employeeCount: str('employeeCount'),
    published: str('published') === '1',
    consent: str('consent') === 'on' || str('consent') === '1',
  };
}

export async function getOwnPartnerProfile(tx: Tx, orgId: string): Promise<PartnerProfile | null> {
  return first((await tx`select * from partner_profiles where org_id = ${orgId}`) as unknown as PartnerProfile[]);
}

/** Forslag til partnerprofil fra bedriftsprofilen – brukeren velger selv hva som publiseres. */
export function partnerDefaultsFromCompany(profile: CompanyProfile | null, orgName: string): Omit<PartnerProfile, 'orgId' | 'consentAt' | 'consentVersion' | 'updatedAt'> {
  const capabilities = [profile?.services, profile?.competencies].filter(Boolean).join('\n\n') || null;
  return {
    published: false,
    displayName: profile?.companyName ?? orgName,
    summary: profile?.description ?? null,
    capabilities,
    industries: profile?.industries ?? [],
    regions: profile?.regions ?? [],
    certifications: profile?.certifications ?? [],
    partnerRoles: ['underleverandor'],
    employeeCount: profile?.employeeCount ?? null,
  };
}

export async function savePartnerProfile(tx: Tx, ctx: { orgId: string; userId: string; ipHash?: string }, data: PartnerProfileForm): Promise<void> {
  const before = await getOwnPartnerProfile(tx, ctx.orgId);
  const giveConsent = data.published && data.consent;
  await tx`
    insert into partner_profiles (org_id, published, display_name, summary, capabilities, industries, regions, certifications,
                                  partner_roles, employee_count, consent_at, consent_version, published_by, updated_at)
    values (${ctx.orgId}, ${data.published}, ${data.displayName}, ${data.summary}, ${data.capabilities}, ${data.industries}::text[],
            ${data.regions}::text[], ${data.certifications}::text[], ${data.partnerRoles}::text[], ${data.employeeCount},
            ${giveConsent ? new Date() : null}, ${giveConsent ? PARTNER_CONSENT_VERSION : null}, ${data.published ? ctx.userId : null}, now())
    on conflict (org_id) do update set
      published = excluded.published, display_name = excluded.display_name, summary = excluded.summary,
      capabilities = excluded.capabilities, industries = excluded.industries, regions = excluded.regions,
      certifications = excluded.certifications, partner_roles = excluded.partner_roles, employee_count = excluded.employee_count,
      consent_at = coalesce(excluded.consent_at, partner_profiles.consent_at),
      consent_version = coalesce(excluded.consent_version, partner_profiles.consent_version),
      published_by = coalesce(excluded.published_by, partner_profiles.published_by),
      updated_at = now()
  `;
  const action = data.published && !before?.published ? 'partner.profile_published' : !data.published && before?.published ? 'partner.profile_hidden' : 'partner.profile_updated';
  await audit(
    { action, orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'partner_profile', targetId: ctx.orgId, metadata: giveConsent ? { consentVersion: PARTNER_CONSENT_VERSION } : {}, ipHash: ctx.ipHash },
    tx,
  );
}

// ---------------------------------------------------------------------------
// Søk og forslag
// ---------------------------------------------------------------------------
export interface PartnerCard {
  orgId: string;
  displayName: string;
  summary: string | null;
  capabilities: string | null;
  industries: string[];
  regions: string[];
  certifications: string[];
  partnerRoles: PartnerRole[];
  employeeCount: number | null;
  updatedAt: Date;
}

export interface PartnerSearch {
  text: string;
  region: string;
  certification: string;
  industry: string;
  role: string;
}

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function searchPartners(tx: Tx, orgId: string, q: PartnerSearch): Promise<PartnerCard[]> {
  const text = q.text.trim().slice(0, 100);
  const region = REGION_BY_CODE.has(q.region) ? q.region : null;
  const cert = CERT_BY_ID.has(q.certification) ? q.certification : null;
  const industry = INDUSTRY_BY_ID.has(q.industry) ? q.industry : null;
  const role = PARTNER_ROLE_LABEL.has(q.role) ? q.role : null;
  return (await tx`
    select org_id, display_name, summary, capabilities, industries, regions, certifications, partner_roles, employee_count, updated_at
    from partner_profiles
    where published and org_id <> ${orgId}
      and (${region}::text is null or regions && array[${region}::text, 'ALL'])
      and (${cert}::text is null or ${cert}::text = any(certifications))
      and (${industry}::text is null or ${industry}::text = any(industries))
      and (${role}::text is null or ${role}::text = any(partner_roles))
      and (${text || null}::text is null or display_name ilike ${likePattern(text)} or summary ilike ${likePattern(text)}
           or capabilities ilike ${likePattern(text)})
    order by updated_at desc
    limit 50
  `) as unknown as PartnerCard[];
}

export interface PartnerGaps {
  /** Sertifiseringer/godkjenninger (id-er fra referansedata) som mangler. */
  certifications: string[];
  /** Utstyr som nevnes i dokumentene, men ikke er registrert. */
  equipment: string[];
  /** Kompetanse eller fag som mangler (fritekst, f.eks. fra AI-vurderingen). */
  competencies: string[];
  regions: string[];
  industries: string[];
  /** Timer per år som mangler (positivt = for lite kapasitet). */
  capacityHours: number | null;
}

export interface PartnerSuggestion {
  partner: PartnerCard;
  score: number;
  reasons: string[];
}

export function hasGaps(g: PartnerGaps): boolean {
  return g.certifications.length > 0 || g.equipment.length > 0 || g.competencies.length > 0 || (g.capacityHours !== null && g.capacityHours > 0);
}

/** Rangerer publiserte partnere etter hvor godt de dekker manglene. Rent regelbasert og forklart. */
export function rankPartners(partners: PartnerCard[], gaps: PartnerGaps): PartnerSuggestion[] {
  const out: PartnerSuggestion[] = [];
  for (const p of partners) {
    const reasons: string[] = [];
    let score = 0;
    const text = `${p.displayName} ${p.summary ?? ''} ${p.capabilities ?? ''}`;
    for (const c of gaps.certifications) {
      if (p.certifications.includes(c)) {
        score += 3;
        reasons.push(`Har ${CERT_BY_ID.get(c)?.label ?? c}`);
      }
    }
    for (const e of gaps.equipment) {
      const term = significantTerms(e).find((w) => containsTerm(text, w));
      if (term) {
        score += 2;
        reasons.push(`Nevner «${term}» i profilen`);
      }
    }
    // Kompetansemangler (fritekst fra egnethetsvurderingen) er for upresise til automatisk matching –
    // de vises på siden, men gir ikke poeng.
    const regionOverlap = p.regions.includes('ALL') ? gaps.regions : gaps.regions.filter((r) => p.regions.includes(r));
    const industryOverlap = gaps.industries.filter((i) => p.industries.includes(i));
    if (regionOverlap.length) {
      score += 1;
      reasons.push(p.regions.includes('ALL') ? 'Leverer i hele landet' : `Leverer i ${regionOverlap.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ')}`);
    }
    if (industryOverlap.length) {
      score += 1;
      reasons.push(`Samme bransje: ${industryOverlap.map((i) => INDUSTRY_BY_ID.get(i)?.name ?? i).join(', ')}`);
    }
    if (gaps.capacityHours !== null && gaps.capacityHours > 0 && regionOverlap.length && industryOverlap.length) {
      score += 2;
      reasons.push('Kan gi ekstra kapasitet i samme bransje og område');
    }
    // Bare bransje eller område alene er ikke nok til å foreslå en partner.
    if (score >= 3) out.push({ partner: p, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.partner.displayName.localeCompare(b.partner.displayName, 'nb')).slice(0, 5);
}

const EQUIPMENT_STOP = new Set(['egnet', 'egnede', 'utstyr', 'minst', 'eller', 'skal', 'kunne', 'type', 'typer', 'annet', 'ulike', 'nødvendig', 'nødvendige']);

/** Ord som sier noe om utstyret («Hjullaster med skjær» → «Hjullaster», «skjær»). */
export function significantTerms(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((w) => w.length >= 5 && !EQUIPMENT_STOP.has(w.toLowerCase()))
    .slice(0, 3);
}

export async function suggestPartners(tx: Tx, orgId: string, gaps: PartnerGaps): Promise<PartnerSuggestion[]> {
  if (!hasGaps(gaps)) return [];
  const partners = (await tx`
    select org_id, display_name, summary, capabilities, industries, regions, certifications, partner_roles, employee_count, updated_at
    from partner_profiles where published and org_id <> ${orgId}
    order by updated_at desc limit 500
  `) as unknown as PartnerCard[];
  return rankPartners(partners, gaps);
}

// ---------------------------------------------------------------------------
// Forespørsler
// ---------------------------------------------------------------------------
export const partnerRequestSchema = z.object({
  toOrgId: z.string().uuid('Ugyldig mottaker.'),
  tenderId: z
    .string()
    .trim()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().uuid().safeParse(v).success, 'Ugyldig anbud.'),
  roleSought: z.enum(['underleverandor', 'samarbeidspartner', 'hovedleverandor'], { message: 'Velg hvilken rolle dere ønsker.' }),
  message: z.string().trim().min(10, 'Skriv en kort melding (minst 10 tegn).').max(2000),
  selfAssessment: z.enum(['ingen_kan_alene', 'bare_en_kan_alene', 'usikker', 'begge_kan_alene'], { message: 'Svar på om dere kan levere alene.' }),
  contactName: z.string().trim().min(1, 'Skriv inn kontaktperson.').max(120),
  contactEmail: z.string().trim().toLowerCase().email('Skriv inn en gyldig e-postadresse.').max(254),
  confirmNoPrices: z.literal(true, { errorMap: () => ({ message: 'Bekreft at dere ikke deler priser eller tilbudsstrategi.' }) }),
});
export type PartnerRequestForm = z.infer<typeof partnerRequestSchema>;

export function partnerRequestFromData(form: FormData): Record<string, unknown> {
  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : '';
  };
  return {
    toOrgId: str('toOrgId'),
    tenderId: str('tenderId'),
    roleSought: str('roleSought'),
    message: str('message'),
    selfAssessment: str('selfAssessment'),
    contactName: str('contactName'),
    contactEmail: str('contactEmail'),
    confirmNoPrices: str('confirmNoPrices') === 'on' || str('confirmNoPrices') === '1',
  };
}

export type PartnerResult = { ok: true; id: string } | { ok: false; error: string };

async function managerUserIds(orgId: string): Promise<string[]> {
  const rows = (await systemSql()`
    select user_id from organization_members where org_id = ${orgId} and role in ('owner', 'admin')
  `) as unknown as { userId: string }[];
  return rows.map((r) => r.userId);
}

export async function sendPartnerRequest(tx: Tx, ctx: { orgId: string; userId: string; ipHash?: string }, data: PartnerRequestForm): Promise<PartnerResult> {
  if (data.selfAssessment === 'begge_kan_alene') return { ok: false, error: COMPETITION_BLOCK_MESSAGE };
  if (data.toOrgId === ctx.orgId) return { ok: false, error: 'Dere kan ikke sende forespørsel til dere selv.' };
  const own = await getOwnPartnerProfile(tx, ctx.orgId);
  if (!own?.published) return { ok: false, error: 'Publiser partnerprofilen deres først, slik at mottakeren ser hvem dere er.' };
  const target = first(
    (await tx`select org_id, display_name from partner_profiles where org_id = ${data.toOrgId} and published`) as unknown as { orgId: string; displayName: string }[],
  );
  if (!target) return { ok: false, error: 'Partneren finnes ikke eller har skjult profilen sin.' };
  const [{ n } = { n: 0 }] = (await tx`
    select count(*)::int as n from partner_requests where from_org_id = ${ctx.orgId} and created_at > now() - interval '24 hours'
  `) as unknown as { n: number }[];
  if (n >= PARTNER_REQUESTS_PER_DAY) return { ok: false, error: `Dere kan sende høyst ${PARTNER_REQUESTS_PER_DAY} forespørsler per døgn.` };
  const duplicate = await tx`
    select 1 from partner_requests
    where from_org_id = ${ctx.orgId} and to_org_id = ${data.toOrgId} and status = 'pending'
      and tender_id is not distinct from ${data.tenderId}
  `;
  if (duplicate.length) return { ok: false, error: 'Dere har allerede en ubesvart forespørsel til denne partneren om samme anbud.' };
  let tenderTitle: string | null = null;
  if (data.tenderId) {
    const t = first((await tx`select title from tenders where id = ${data.tenderId}`) as unknown as { title: string }[]);
    if (!t) return { ok: false, error: 'Fant ikke anbudet.' };
    tenderTitle = t.title;
  }
  const [row] = (await tx`
    insert into partner_requests (from_org_id, to_org_id, tender_id, role_sought, message, self_assessment,
                                  requester_contact_name, requester_contact_email, created_by)
    values (${ctx.orgId}, ${data.toOrgId}, ${data.tenderId}, ${data.roleSought}, ${data.message}, ${data.selfAssessment},
            ${data.contactName}, ${data.contactEmail}, ${ctx.userId})
    returning id
  `) as unknown as { id: string }[];
  const id = row!.id;
  const recipients = await managerUserIds(data.toOrgId);
  await insertNotifications(
    recipients.map((userId) => ({
      orgId: data.toOrgId,
      userId,
      type: 'partner_request' as const,
      tenderId: data.tenderId,
      title: `${own.displayName} ønsker å samarbeide${tenderTitle ? ` om «${tenderTitle.slice(0, 120)}»` : ''}`,
      body: `Forespørsel som ${(PARTNER_ROLE_LABEL.get(data.roleSought) ?? data.roleSought).toLowerCase()}. Kontaktinformasjonen deres deles bare hvis dere godtar.`,
      url: '/app/partnere#innkommende',
      dedupeKey: `partner_request:${id}`,
    })),
  );
  await audit(
    { action: 'partner.request_sent', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'partner_request', targetId: id, metadata: { toOrgId: data.toOrgId, selfAssessment: data.selfAssessment, role: data.roleSought }, ipHash: ctx.ipHash },
    tx,
  );
  return { ok: true, id };
}

export const partnerAnswerSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('accept'),
    contactName: z.string().trim().min(1, 'Skriv inn kontaktperson.').max(120),
    contactEmail: z.string().trim().toLowerCase().email('Skriv inn en gyldig e-postadresse.').max(254),
  }),
  z.object({ decision: z.literal('decline') }),
]);
export type PartnerAnswer = z.infer<typeof partnerAnswerSchema>;

export async function answerPartnerRequest(tx: Tx, ctx: { orgId: string; userId: string; ipHash?: string }, id: string, answer: PartnerAnswer): Promise<PartnerResult> {
  const req = first(
    (await tx`select id, from_org_id, to_org_id, status from partner_requests where id = ${id}`) as unknown as { id: string; fromOrgId: string; toOrgId: string; status: string }[],
  );
  if (!req || req.toOrgId !== ctx.orgId) return { ok: false, error: 'Fant ikke forespørselen.' };
  if (req.status !== 'pending') return { ok: false, error: 'Forespørselen er allerede besvart eller trukket tilbake.' };
  const accepted = answer.decision === 'accept';
  await tx`
    update partner_requests set
      status = ${accepted ? 'accepted' : 'declined'},
      responder_contact_name = ${accepted ? answer.contactName : null},
      responder_contact_email = ${accepted ? answer.contactEmail : null},
      responded_by = ${ctx.userId}, responded_at = now()
    where id = ${id}
  `;
  const own = await getOwnPartnerProfile(tx, ctx.orgId);
  const name = own?.displayName ?? 'Partneren';
  const recipients = await managerUserIds(req.fromOrgId);
  await insertNotifications(
    recipients.map((userId) => ({
      orgId: req.fromOrgId,
      userId,
      type: 'partner_response' as const,
      tenderId: null,
      title: accepted ? `${name} har godtatt forespørselen deres` : `${name} har avslått forespørselen deres`,
      body: accepted ? 'Kontaktinformasjonen er delt med dere i AnbudRadar.' : null,
      url: '/app/partnere#sendte',
      dedupeKey: `partner_response:${id}`,
    })),
  );
  await audit({ action: 'partner.request_answered', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'partner_request', targetId: id, metadata: { accepted }, ipHash: ctx.ipHash }, tx);
  return { ok: true, id };
}

export async function withdrawPartnerRequest(tx: Tx, ctx: { orgId: string; userId: string; ipHash?: string }, id: string): Promise<PartnerResult> {
  const req = first((await tx`select from_org_id, status from partner_requests where id = ${id}`) as unknown as { fromOrgId: string; status: string }[]);
  if (!req || req.fromOrgId !== ctx.orgId) return { ok: false, error: 'Fant ikke forespørselen.' };
  if (req.status !== 'pending') return { ok: false, error: 'Forespørselen er allerede besvart.' };
  await tx`update partner_requests set status = 'withdrawn', responded_by = ${ctx.userId}, responded_at = now() where id = ${id}`;
  await audit({ action: 'partner.request_withdrawn', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'partner_request', targetId: id, ipHash: ctx.ipHash }, tx);
  return { ok: true, id };
}

export interface PartnerRequestRow {
  id: string;
  fromOrgId: string;
  toOrgId: string;
  counterpartName: string | null;
  tenderId: string | null;
  tenderTitle: string | null;
  roleSought: PartnerRole;
  message: string;
  selfAssessment: SelfAssessment;
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  requesterContactName: string | null;
  requesterContactEmail: string | null;
  responderContactName: string | null;
  responderContactEmail: string | null;
  createdAt: Date;
  respondedAt: Date | null;
}

export async function listPartnerRequests(tx: Tx, orgId: string): Promise<{ incoming: PartnerRequestRow[]; outgoing: PartnerRequestRow[] }> {
  const rows = (await tx`
    select r.id, r.from_org_id, r.to_org_id, r.tender_id, t.title as tender_title, r.role_sought, r.message, r.self_assessment, r.status,
           r.requester_contact_name, r.requester_contact_email, r.responder_contact_name, r.responder_contact_email,
           r.created_at, r.responded_at,
           p.display_name as counterpart_name
    from partner_requests r
    left join tenders t on t.id = r.tender_id
    left join partner_profiles p on p.org_id = case when r.from_org_id = ${orgId} then r.to_org_id else r.from_org_id end
    where r.from_org_id = ${orgId} or r.to_org_id = ${orgId}
    order by r.created_at desc
    limit 200
  `) as unknown as PartnerRequestRow[];
  return { incoming: rows.filter((r) => r.toOrgId === orgId), outgoing: rows.filter((r) => r.fromOrgId === orgId) };
}

export async function getPartnerCard(tx: Tx, orgId: string): Promise<PartnerCard | null> {
  return first(
    (await tx`
      select org_id, display_name, summary, capabilities, industries, regions, certifications, partner_roles, employee_count, updated_at
      from partner_profiles where org_id = ${orgId} and published
    `) as unknown as PartnerCard[],
  );
}
