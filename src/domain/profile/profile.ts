import { z } from 'zod';
import { first, type Tx } from '@/lib/db';
import { audit } from '@/lib/audit';
import { CERT_BY_ID, INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
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
  version: number;
  onboardingCompletedAt: Date | null;
  updatedAt: Date;
}

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
  })
  .refine((v) => v.minContractValue === null || v.maxContractValue === null || v.minContractValue <= v.maxContractValue, {
    message: 'Minste verdi kan ikke være større enn største verdi.',
    path: ['maxContractValue'],
  })
  .refine((v) => v.regions.length > 0, { message: 'Velg minst ett fylke eller «Hele landet».', path: ['regions'] });

export type ProfileForm = z.infer<typeof profileFormSchema>;

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
      excluded_keywords, min_days_to_deadline, onboarding_completed_at, updated_by
    ) values (
      ${ctx.orgId}, ${data.companyName}, ${data.orgNumber}, ${data.description}, ${data.industries}::text[], ${data.services},
      ${data.keywords}::text[], ${data.cpvCodes}::text[], ${data.regions}::text[], ${['NO']}::text[], ${data.companySize},
      ${data.certifications}::text[], ${data.experience}, ${data.minContractValue}, ${data.maxContractValue},
      ${data.contractTypes}::text[], ${data.excludedCpv}::text[], ${data.excludedKeywords}::text[], ${data.minDaysToDeadline},
      now(), ${ctx.userId}
    )
    on conflict (org_id) do update set
      company_name = excluded.company_name, org_number = excluded.org_number, description = excluded.description,
      industries = excluded.industries, services = excluded.services, keywords = excluded.keywords,
      cpv_codes = excluded.cpv_codes, regions = excluded.regions, company_size = excluded.company_size,
      certifications = excluded.certifications, experience = excluded.experience,
      min_contract_value = excluded.min_contract_value, max_contract_value = excluded.max_contract_value,
      contract_types = excluded.contract_types, excluded_cpv = excluded.excluded_cpv,
      excluded_keywords = excluded.excluded_keywords, min_days_to_deadline = excluded.min_days_to_deadline,
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
