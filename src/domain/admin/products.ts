/**
 * Admin → Produkter: alle produktene i AnbudRadar på ett sted, med lenke rett inn i appen, hvilken plan
 * kundene trenger og om funksjonen virker fullt ut i dag (AI, betaling og fillagring krever oppsett).
 * Administratorens egen organisasjon har admin-tilgang (alle funksjoner, AI i testmodus når AI er av).
 */
import { systemSql } from '@/lib/db';
import { env, integrationStatus } from '@/lib/env';
import { PLANS, type Entitlements, type PlanId } from '@/domain/billing/plans';
import { getProvider } from '@/domain/ai/provider';

type BoolFeature = { [K in keyof Entitlements]: Entitlements[K] extends boolean ? K : never }[keyof Entitlements];

export interface ProductItem {
  name: string;
  what: string;
  /** Lenke i appen. «:anbud» byttes ut med et åpent anbud. */
  href: string;
  /** Funksjonen som styrer tilgangen (laveste plan som har den, vises). Uten: alle planer. */
  feature?: BoolFeature | 'aiAnalysesPerMonth';
  needs?: 'ai' | 'stripe' | 'storage';
}

export const PRODUCT_GROUPS: { title: string; items: ProductItem[] }[] = [
  {
    title: 'Finn anbud',
    items: [
      { name: 'Oversikt og «Til handling»', what: 'Nye treff, frister og oppgaver som venter – det første kunden ser.', href: '/app' },
      { name: 'Søk i alle anbud', what: 'Fritekst og filtre på bransje, fylke, verdi og frist, fra Doffin og TED.', href: '/app/anbud' },
      { name: 'Treff og forhåndsvurdering', what: 'Anbud som passer profilen, med «Verdt å se på» eller «Sjekk først» og grunnene.', href: '/app/anbud?sorter=match', feature: 'matching' },
      { name: 'Lagrede søk og e-postvarsler', what: 'Lagre et søk og få varsel når nye anbud dukker opp.', href: '/app/sok' },
      { name: 'Lagrede anbud', what: 'Anbudene bedriften følger med på, med status fra vurdering til levert.', href: '/app/lagret' },
    ],
  },
  {
    title: 'Vurder et anbud',
    items: [
      { name: 'Anbudssiden', what: 'Frist, skal-krav og avvisningsgrunner, vilkår som koster penger og oppdragsgiverens historikk.', href: '/app/anbud/:anbud' },
      { name: 'AI-analyse', what: 'Sammendrag, risiko og egnethet med kontrollerte sitater fra kildene.', href: '/app/anbud/:anbud/analyse', feature: 'aiAnalysesPerMonth', needs: 'ai' },
      { name: 'Spør om anbudet', what: 'Still spørsmål om hele anbudet; svarene viser hva som står i kilden og hva som er vurdering.', href: '/app/anbud/:anbud#sporsmal', feature: 'aiAnalysesPerMonth', needs: 'ai' },
      { name: 'Last opp konkurransegrunnlaget', what: 'PDF og Word leses, så kravsjekk, vilkårssøk og AI får med hele grunnlaget.', href: '/app/anbud/:anbud#dokumenter-for-analyse', feature: 'documentUpload', needs: 'storage' },
    ],
  },
  {
    title: 'Lønnsomhet',
    items: [
      { name: 'Kalkyle og markedspris', what: 'Selvkost, minstepris og prisintervall, sammenlignet med tidligere tildelinger.', href: '/app/anbud/:anbud/lonnsomhet', feature: 'profitCalculator' },
      { name: 'Portefølje', what: 'Alle kalkylene samlet: hvilke anbud som lønner seg.', href: '/app/lonnsomhet', feature: 'profitCalculator' },
      { name: 'Kapasitet per måned', what: 'Folk og utstyr mot kontraktene dere har – også sesongarbeid.', href: '/app/kapasitet', feature: 'profitCalculator' },
      { name: 'Anbudspartnere', what: 'Finn partnere til anbud dere ikke kan levere alene, med konkurranserettslig sperre.', href: '/app/partnere', feature: 'partnerSearch' },
    ],
  },
  {
    title: 'Tilbud og læring',
    items: [
      { name: 'Tilbudsarbeid', what: 'Sjekkliste fra kravene, struktur, AI-utkast og gjennomgang før levering.', href: '/app/tilbud', feature: 'bidAssistant' },
      { name: 'Resultater', what: 'Vunnet og tapt, pris mot vinner og hva bedriften kan lære.', href: '/app/resultater' },
    ],
  },
  {
    title: 'Marked',
    items: [
      { name: 'Konkurrenter og oppdragsgivere', what: 'Hvem vinner hva, til hvilke priser, hos hvilke oppdragsgivere.', href: '/app/konkurrenter', feature: 'competitorIntel' },
      { name: 'Kontraktsutløp', what: 'Kontrakter som løper ut snart – neste konkurranse før den kunngjøres.', href: '/app/konkurrenter/utlop', feature: 'competitorIntel' },
      { name: 'Fremtidige anskaffelser', what: 'Planlagte anskaffelser og politiske saker før de blir anbud.', href: '/app/fremtidige', feature: 'futureOpportunities' },
    ],
  },
  {
    title: 'Konto',
    items: [
      { name: 'Bedriftsprofil', what: 'Bransjer, fylker og størrelse – grunnlaget for treff og vurderinger.', href: '/app/profil' },
      { name: 'Innstillinger, team og eksport', what: 'Medlemmer og roller, varsler og eksport av alle data.', href: '/app/innstillinger' },
      { name: 'Abonnement og betaling', what: 'Velg plan og betal med kort; kundeportal for faktura og oppsigelse.', href: '/app/abonnement', needs: 'stripe' },
    ],
  },
];

const PLAN_ORDER: PlanId[] = ['free', 'starter', 'professional', 'business', 'enterprise'];

/** Laveste plan som gir funksjonen (navnet), eller «Alle planer». */
export function minPlanName(feature: ProductItem['feature']): string {
  if (!feature) return 'Alle planer';
  const plan = PLAN_ORDER.find((p) => {
    const v = PLANS[p].entitlements[feature];
    return typeof v === 'number' ? v > 0 : Boolean(v);
  });
  return plan ? (plan === 'free' ? 'Alle planer' : `${PLANS[plan].name} og høyere`) : 'Ingen plan';
}

export type ProductState = { tone: 'ok' | 'demo' | 'setup'; text: string };

export function productState(item: ProductItem, s: { aiOn: boolean; adminAccess: boolean; stripe: boolean; storage: boolean }): ProductState {
  if (item.needs === 'ai' && !s.aiOn) {
    return s.adminAccess ? { tone: 'demo', text: 'Testmodus – simulerte svar' } : { tone: 'setup', text: 'Av – AI er ikke slått på' };
  }
  if (item.needs === 'stripe' && !s.stripe) return { tone: 'setup', text: 'Betaling er ikke satt opp' };
  if (item.needs === 'storage' && !s.storage) return { tone: 'setup', text: 'Virker, men filene forsvinner til fillagring er satt opp' };
  return { tone: 'ok', text: 'Klar' };
}

export interface AdminProductContext {
  org: { id: string; name: string; onboarded: boolean } | null;
  tenderId: string | null;
  aiOn: boolean;
  stripe: boolean;
  storage: boolean;
}

/** Administratorens egen organisasjon (eier), et åpent anbud å vise frem, og hva som er satt opp. */
export async function adminProductContext(userId: string): Promise<AdminProductContext> {
  const sql = systemSql();
  const [org] = (await sql`
    select o.id, o.name, (p.onboarding_completed_at is not null) as onboarded
    from organization_members m join organizations o on o.id = m.org_id
    left join company_profiles p on p.org_id = o.id
    where m.user_id = ${userId} and m.role = 'owner'
    order by o.created_at limit 1
  `) as unknown as { id: string; name: string; onboarded: boolean }[];
  const [tender] = (await sql`
    select id from tenders
    where lifecycle = 'competition' and deadline_at > now() + interval '3 days'
    order by published_at desc nulls last limit 1
  `) as unknown as { id: string }[];
  const integrations = integrationStatus();
  return {
    org: org ?? null,
    tenderId: tender?.id ?? null,
    aiOn: getProvider() !== null,
    stripe: Boolean(integrations.stripe),
    storage: env.STORAGE_DRIVER === 'supabase',
  };
}
