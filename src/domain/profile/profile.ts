import { z } from 'zod';
import { first, toJson, type Tx } from '@/lib/db';
import { audit } from '@/lib/audit';
import { CERT_BY_ID, COMPANY_SIZES, INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { cleanCpv } from '@/domain/tenders/normalize';
import { recomputeMatchesForOrg } from '@/domain/matching/service';
import { orgNumberSchema } from '@/domain/org/org';

export interface CompanyProfile {
  orgId: string;
  companyName: string;
  orgNumber: string | null;
  description: string | null;
  industries: string[];
  services: string | null;
  keywords: string[];
  cpvCodes: string[];
  regions: string[];
  countries: string[];
  companySize: string | null;
  certifications: string[];
  experience: string | null;
  minContractValue: number | null;
  maxContractValue: number | null;
  contractTypes: string[];
  excludedCpv: string[];
  excludedKeywords: string[];
  minDaysToDeadline: number;
  products: string | null;
  competencies: string | null;
  employeeCount: number | null;
  annualRevenue: number | null;
  referenceProjects: ReferenceProject[];
  version: number;
  onboardingCompletedAt: Date | null;
  updatedAt: Date;
}

export interface ReferenceProject {
  title: string;
  client: string | null;
  year: number | null;
  value: number | null;
  description: string | null;
}

export const MAX_REFERENCES = 5;

const splitList = (v: string) =>
  v
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const optionalMoney = z
  .string()
  .transform((v) => v.replace(/[\s ]/g, '').replace(',', '.'))
  .refine((v) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= 0), 'Skriv inn et beløp i kroner.')
  .transform((v) => (v === '' ? null : Math.round(Number(v))));

export const profileFormSchema = z
  .object({
    companyName: z.string().trim().min(1, 'Skriv inn firmanavnet.').max(160),
    orgNumber: orgNumberSchema,
    description: z.string().trim().max(2000).transform((v) => v || null),
    industries: z
      .array(z.string())
      .transform((a) => a.filter((i) => INDUSTRY_BY_ID.has(i)))
      .refine((a) => a.length > 0, 'Velg minst én bransje.'),
    services: z.string().trim().max(3000).transform((v) => v || null),
    keywords: z
      .string()
      .max(1000)
      .transform((v) => [...new Set(splitList(v).map((k) => k.toLowerCase()))].slice(0, 40)),
    cpvCodes: z
      .string()
      .max(1000)
      .transform((v) => [...new Set(splitList(v).map(cleanCpv).filter((c): c is string => c !== null))].slice(0, 50)),
    regions: z.array(z.string()).transform((a) => (a.includes('ALL') ? ['ALL'] : a.filter((r) => REGION_BY_CODE.has(r)))),
    companySize: z
      .enum(['', '1-9', '10-49', '50-249', '250+'])
      .transform((v) => (v === '' ? null : v)),
    certifications: z.array(z.string()).transform((a) => a.filter((c) => CERT_BY_ID.has(c))),
    experience: z.string().trim().max(5000).transform((v) => v || null),
    minContractValue: optionalMoney,
    maxContractValue: optionalMoney,
    contractTypes: z.array(z.enum(['works', 'supplies', 'services'])),
    excludedCpv: z
      .string()
      .max(1000)
      .transform((v) => [...new Set(splitList(v).map(cleanCpv).filter((c): c is string => c !== null))].slice(0, 50)),
    excludedKeywords: z
      .string()
      .max(1000)
      .transform((v) => [...new Set(splitList(v).map((k) => k.toLowerCase()))].slice(0, 40)),
    minDaysToDeadline: z.coerce.number().int().min(0, 'Minst 0 dager.').max(120, 'Maks 120 dager.'),
    products: z.string().trim().max(3000).default('').transform((v) => v || null),
    competencies: z.string().trim().max(3000).default('').transform((v) => v || null),
    employeeCount: z
      .string()
      .default('')
      .transform((v) => v.replace(/[\s ]/g, ''))
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) <= 1_000_000), 'Skriv inn et helt tall.')
      .transform((v) => (v === '' ? null : Number(v))),
    // zod 4: standardverdien brukes som ferdig verdi (kjøres ikke gjennom transformasjonene).
    annualRevenue: optionalMoney.default(null),
    referenceProjects: z
      .array(
        z.object({
          title: z.string().trim().max(200),
          client: z.string().trim().max(200).transform((v) => v || null),
          year: z
            .string()
            .trim()
            .refine((v) => v === '' || (/^\d{4}$/.test(v) && Number(v) >= 1950 && Number(v) <= 2100), 'Skriv inn et årstall.')
            .transform((v) => (v === '' ? null : Number(v))),
          value: optionalMoney,
          description: z.string().trim().max(1500).transform((v) => v || null),
        }),
      )
      .max(MAX_REFERENCES)
      .default([])
      .transform((refs) => refs.filter((r) => r.title !== '')),
  })
  .transform((v) => ({
    ...v,
    companySize:
      v.companySize ??
      (v.employeeCount === null ? null : v.employeeCount < 10 ? '1-9' : v.employeeCount < 50 ? '10-49' : v.employeeCount < 250 ? '50-249' : '250+'),
  }))
  .refine((v) => v.minContractValue === null || v.maxContractValue === null || v.minContractValue <= v.maxContractValue, {
    message: 'Minste verdi kan ikke være større enn største verdi.',
    path: ['maxContractValue'],
  })
  .refine((v) => v.regions.length > 0, { message: 'Velg minst ett fylke eller «Hele landet».', path: ['regions'] });

export type ProfileForm = z.infer<typeof profileFormSchema>;

// ---------------------------------------------------------------------------
// Kort oppstart: bare det som trengs for å rangere anbud (firmanavn, bransje, område, stikkord).
// Resten av profilen har trygge standardverdier og fylles ut senere under Bedriftsprofil.
// ---------------------------------------------------------------------------
export const quickStartSchema = z.object({
  companyName: z.string().trim().min(1, 'Skriv inn firmanavnet.').max(160),
  orgNumber: orgNumberSchema,
  industries: z
    .array(z.string())
    .transform((a) => a.filter((i) => INDUSTRY_BY_ID.has(i)))
    .refine((a) => a.length > 0, 'Velg minst én bransje.'),
  regions: z
    .array(z.string())
    .transform((a) => (a.includes('ALL') ? ['ALL'] : a.filter((r) => REGION_BY_CODE.has(r))))
    .refine((a) => a.length > 0, 'Velg minst ett fylke eller «Hele landet».'),
  /**
   * Lovpålagte godkjenninger (vaktvirksomhet, renholdsregisteret, sentral godkjenning …). Spørres om i oppstarten
   * fordi anbud som krever dem ellers blir merket «passer trolig ikke» for bedrifter som faktisk har dem.
   */
  certifications: z
    .array(z.string())
    .default([])
    .transform((a) => a.filter((c) => CERT_BY_ID.has(c))),
  services: z.string().trim().max(3000),
});
export type QuickStart = z.infer<typeof quickStartSchema>;

/**
 * Stikkord fra feltet «Hva leverer dere?»: korte ledd skilt med komma blir nøkkelord («VVS», «stasjonært vakthold»).
 * Hele setninger blir ikke nøkkelord – de brukes som tjenestebeskrivelse, der matchingen henter ordene selv.
 */
export function keywordsFromServices(text: string): string[] {
  const parts = splitList(text)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length >= 3 && p.length <= 40 && p.split(/\s+/).length <= 4);
  return [...new Set(parts)].slice(0, 15);
}

/** Full profil fra den korte oppstarten (samme validering og standardverdier som det store skjemaet). */
export function quickStartProfile(q: QuickStart): ProfileForm {
  return profileFormSchema.parse({
    companyName: q.companyName,
    orgNumber: q.orgNumber ?? '',
    description: '',
    industries: q.industries,
    services: q.services,
    keywords: keywordsFromServices(q.services).join(', '),
    cpvCodes: '',
    regions: q.regions,
    companySize: '',
    certifications: q.certifications,
    experience: '',
    minContractValue: '',
    maxContractValue: '',
    contractTypes: [],
    excludedCpv: '',
    excludedKeywords: '',
    minDaysToDeadline: '10',
    products: '',
    competencies: '',
    employeeCount: '',
    annualRevenue: '',
    referenceProjects: [],
  });
}

export function profileFormFromData(form: FormData) {
  const s = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : '';
  };
  const all = (k: string) => form.getAll(k).filter((v): v is string => typeof v === 'string');
  return {
    companyName: s('companyName'),
    orgNumber: s('orgNumber'),
    description: s('description'),
    industries: all('industries'),
    services: s('services'),
    keywords: s('keywords'),
    cpvCodes: s('cpvCodes'),
    regions: all('regions'),
    companySize: s('companySize'),
    certifications: all('certifications'),
    experience: s('experience'),
    minContractValue: s('minContractValue'),
    maxContractValue: s('maxContractValue'),
    contractTypes: all('contractTypes'),
    excludedCpv: s('excludedCpv'),
    excludedKeywords: s('excludedKeywords'),
    minDaysToDeadline: s('minDaysToDeadline') || '10',
    products: s('products'),
    competencies: s('competencies'),
    employeeCount: s('employeeCount'),
    annualRevenue: s('annualRevenue'),
    referenceProjects: Array.from({ length: MAX_REFERENCES }, (_, i) => ({
      title: s(`ref_title_${i}`),
      client: s(`ref_client_${i}`),
      year: s(`ref_year_${i}`),
      value: s(`ref_value_${i}`),
      description: s(`ref_description_${i}`),
    })),
  };
}

export async function getProfile(tx: Tx, orgId: string): Promise<CompanyProfile | null> {
  return first((await tx`select * from company_profiles where org_id = ${orgId}`) as unknown as CompanyProfile[]);
}

/** Lagrer profil, markerer onboarding som fullført og beregner treff på nytt. */
export async function saveProfile(
  tx: Tx,
  ctx: { orgId: string; userId: string; ipHash?: string },
  data: ProfileForm,
): Promise<void> {
  await tx`
    insert into company_profiles (
      org_id, company_name, org_number, description, industries, services, keywords, cpv_codes, regions, countries,
      company_size, certifications, experience, min_contract_value, max_contract_value, contract_types, excluded_cpv,
      excluded_keywords, min_days_to_deadline, onboarding_completed_at, updated_by,
      products, competencies, employee_count, annual_revenue, reference_projects
    ) values (
      ${ctx.orgId}, ${data.companyName}, ${data.orgNumber}, ${data.description}, ${data.industries}::text[], ${data.services},
      ${data.keywords}::text[], ${data.cpvCodes}::text[], ${data.regions}::text[], ${['NO']}::text[], ${data.companySize},
      ${data.certifications}::text[], ${data.experience}, ${data.minContractValue}, ${data.maxContractValue},
      ${data.contractTypes}::text[], ${data.excludedCpv}::text[], ${data.excludedKeywords}::text[], ${data.minDaysToDeadline},
      now(), ${ctx.userId},
      ${data.products}, ${data.competencies}, ${data.employeeCount}, ${data.annualRevenue}, ${toJson(data.referenceProjects)}::text::jsonb
    )
    on conflict (org_id) do update set
      company_name = excluded.company_name, org_number = excluded.org_number, description = excluded.description,
      industries = excluded.industries, services = excluded.services, keywords = excluded.keywords,
      cpv_codes = excluded.cpv_codes, regions = excluded.regions, company_size = excluded.company_size,
      certifications = excluded.certifications, experience = excluded.experience,
      min_contract_value = excluded.min_contract_value, max_contract_value = excluded.max_contract_value,
      contract_types = excluded.contract_types, excluded_cpv = excluded.excluded_cpv,
      excluded_keywords = excluded.excluded_keywords, min_days_to_deadline = excluded.min_days_to_deadline,
      products = excluded.products, competencies = excluded.competencies, employee_count = excluded.employee_count,
      annual_revenue = excluded.annual_revenue, reference_projects = excluded.reference_projects,
      onboarding_completed_at = coalesce(company_profiles.onboarding_completed_at, now()),
      version = company_profiles.version + 1, updated_by = excluded.updated_by
  `;
  await tx`update organizations set name = ${data.companyName}, org_number = coalesce(${data.orgNumber}, org_number) where id = ${ctx.orgId}`;
  await audit({ action: 'profile.updated', orgId: ctx.orgId, actorUserId: ctx.userId, targetType: 'company_profile', targetId: ctx.orgId, ipHash: ctx.ipHash });
}

/** Etter at profiltransaksjonen er committet. */
export async function afterProfileSaved(orgId: string): Promise<number> {
  return recomputeMatchesForOrg(orgId);
}

/**
 * Opplysninger om bedriften slik AI-en får dem. Bare det bedriften selv har registrert – AI-en
 * får beskjed om aldri å legge til noe. Tomme felt utelates (og skal behandles som ukjent).
 */
export function profileFactsForAi(profile: CompanyProfile | null): string[] {
  if (!profile) return [];
  const money = (v: number) => `${Math.round(v).toLocaleString('nb-NO')} kr`;
  const facts: string[] = [`Firmanavn: ${profile.companyName}`];
  if (profile.orgNumber) facts.push(`Organisasjonsnummer: ${profile.orgNumber}`);
  if (profile.employeeCount !== null && profile.employeeCount !== undefined) facts.push(`Antall ansatte: ${profile.employeeCount}`);
  else if (profile.companySize) facts.push(`Antall ansatte: ${COMPANY_SIZES[profile.companySize] ?? profile.companySize}`);
  if (profile.annualRevenue !== null && profile.annualRevenue !== undefined) facts.push(`Årlig omsetning (oppgitt av bedriften): ${money(profile.annualRevenue)}`);
  if (profile.description) facts.push(`Om bedriften: ${profile.description}`);
  if (profile.industries.length) facts.push(`Bransjer: ${profile.industries.map((i) => INDUSTRY_BY_ID.get(i)?.name ?? i).join(', ')}`);
  if (profile.services) facts.push(`Tjenester: ${profile.services}`);
  if (profile.products) facts.push(`Produkter: ${profile.products}`);
  if (profile.competencies) facts.push(`Kompetanse: ${profile.competencies}`);
  if (profile.regions.length) {
    facts.push(`Leverer i: ${profile.regions.includes('ALL') ? 'hele landet' : profile.regions.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ')}`);
  }
  if (profile.certifications.length) {
    facts.push(`Sertifiseringer og godkjenninger (registrert av bedriften): ${profile.certifications.map((c) => CERT_BY_ID.get(c)?.label ?? c).join(', ')}`);
  } else {
    facts.push('Sertifiseringer og godkjenninger: ingen registrert');
  }
  if (profile.experience) facts.push(`Erfaring (oppgitt av bedriften): ${profile.experience}`);
  for (const [i, r] of (profile.referenceProjects ?? []).entries()) {
    const parts = [r.title, r.client ? `kunde ${r.client}` : null, r.year ? `år ${r.year}` : null, r.value ? `verdi ${money(r.value)}` : null].filter(Boolean);
    facts.push(`Referanse ${i + 1}: ${parts.join(', ')}${r.description ? ` – ${r.description}` : ''}`);
  }
  if (profile.minContractValue !== null || profile.maxContractValue !== null) {
    facts.push(
      `Ønsket kontraktsstørrelse: ${profile.minContractValue !== null ? `fra ${money(profile.minContractValue)}` : ''}${profile.maxContractValue !== null ? ` til ${money(profile.maxContractValue)}` : ''}`.trim(),
    );
  }
  return facts;
}
