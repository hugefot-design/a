/**
 * Planer og rettigheter. Alle tilgangsbeslutninger tas på serveren ut fra
 * abonnementsraden i databasen – aldri ut fra noe nettleseren sier.
 */
export type PlanId = 'free' | 'starter' | 'professional' | 'business' | 'enterprise';
export type PaidPlanId = 'starter' | 'professional' | 'business';

export interface Entitlements {
  plan: PlanId;
  /** Distinkte søk per dag (filtre/fritekst). Å bla i en liste eller gjenta et søk teller ikke. */
  searchesPerDay: number;
  advancedSearch: boolean;
  maxBookmarks: number;
  maxSavedSearches: number;
  alerts: 'none' | 'basic' | 'full';
  aiAnalysesPerMonth: number;
  aiFullAnalysis: boolean;
  documentUpload: boolean;
  matching: boolean;
  bidAssistant: boolean;
  aiBidDraftsPerMonth: number;
  competitorIntel: boolean;
  advancedAnalytics: boolean;
  maxMembers: number;
  /** Lønnsomhetskalkulator med egne kostnader (selvkost, minstepris, prisintervall, følsomhet). */
  profitCalculator: boolean;
  /** Profit Intelligence med AI: kostnadsdrivere og kontraktsrisiko fra dokumentene, kapasitetsanalyse. */
  profitAI: boolean;
  /** Kan publisere partnerprofil og motta forespørsler (bli funnet). */
  partnerListing: boolean;
  /** Kan søke etter partnere og sende forespørsler. */
  partnerSearch: boolean;
  /** Future Opportunities: planlagte anskaffelser og politiske saker før de blir anbud (Enterprise). */
  futureOpportunities: boolean;
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  priceNok: number | null;
  tagline: string;
  features: string[];
  entitlements: Entitlements;
}

export const UNLIMITED = 1_000_000;

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: 'free',
    name: 'Gratis',
    priceNok: 0,
    tagline: 'Smak på produktet med ekte anbud fra Doffin og TED.',
    features: ['Ekte anbud fra Doffin og TED', '5 søk per dag', '3 lagrede anbud', '1 AI-sammendrag per måned'],
    entitlements: {
      plan: 'free',
      searchesPerDay: 5,
      advancedSearch: false,
      maxBookmarks: 3,
      maxSavedSearches: 0,
      alerts: 'none',
      aiAnalysesPerMonth: 1,
      aiFullAnalysis: false,
      documentUpload: false,
      matching: false,
      bidAssistant: false,
      aiBidDraftsPerMonth: 0,
      competitorIntel: false,
      advancedAnalytics: false,
      maxMembers: 1,
      profitCalculator: false,
      profitAI: false,
      partnerListing: false,
      partnerSearch: false,
      futureOpportunities: false,
    },
  },
  starter: {
    id: 'starter',
    name: 'Start',
    priceNok: 299,
    tagline: 'For deg som vil følge med på egne bransjer.',
    features: [
      'Søk med filtre for bransje, sted, verdi og frist',
      'Inntil 25 lagrede anbud',
      '3 lagrede søk med e-postvarsel',
      '10 enkle AI-sammendrag per måned',
      'Fristpåminnelser for lagrede anbud',
      'Bli funnet som anbudspartner',
    ],
    entitlements: {
      plan: 'starter',
      searchesPerDay: UNLIMITED,
      advancedSearch: false,
      maxBookmarks: 25,
      maxSavedSearches: 3,
      alerts: 'basic',
      aiAnalysesPerMonth: 10,
      aiFullAnalysis: false,
      documentUpload: false,
      matching: false,
      bidAssistant: false,
      aiBidDraftsPerMonth: 0,
      competitorIntel: false,
      advancedAnalytics: false,
      maxMembers: 1,
      profitCalculator: false,
      profitAI: false,
      partnerListing: true,
      partnerSearch: false,
      futureOpportunities: false,
    },
  },
  professional: {
    id: 'professional',
    name: 'Profesjonell',
    priceNok: 699,
    tagline: 'For bedrifter som leverer tilbud jevnlig.',
    features: [
      'Avansert søk med naturlig språk, CPV og ekskluderinger',
      'Full AI-analyse av kunngjøringer og opplastede dokumenter',
      'Personlig rangering mot bedriftsprofilen',
      'Fristvarsler og varsel om endringer',
      'Lønnsomhetskalkulator: selvkost, minstepris og prisintervall med egne kostnader',
      'Inntil 200 lagrede anbud og 20 lagrede søk',
      '60 AI-analyser per måned',
    ],
    entitlements: {
      plan: 'professional',
      searchesPerDay: UNLIMITED,
      advancedSearch: true,
      maxBookmarks: 200,
      maxSavedSearches: 20,
      alerts: 'full',
      aiAnalysesPerMonth: 60,
      aiFullAnalysis: true,
      documentUpload: true,
      matching: true,
      bidAssistant: false,
      aiBidDraftsPerMonth: 0,
      competitorIntel: false,
      advancedAnalytics: false,
      maxMembers: 2,
      profitCalculator: true,
      profitAI: false,
      partnerListing: true,
      partnerSearch: false,
      futureOpportunities: false,
    },
  },
  business: {
    id: 'business',
    name: 'Bedrift',
    priceNok: 1490,
    tagline: 'For team som jobber med tilbud sammen.',
    features: [
      'Alt i Profesjonell',
      'Profit Intelligence: AI finner kostnadsdrivere og kontraktsrisiko (dagbøter, betalingsvilkår, prisregulering) med kildehenvisning',
      'Kapasitetsanalyse og anbudspartnere',
      'Inntil 10 brukere',
      'Tilbudsarbeidsflate med AI-assistent',
      'Innsikt i tildelinger og konkurrenter',
      'Utvidet statistikk',
      '150 AI-analyser og 50 AI-utkast per måned',
    ],
    entitlements: {
      plan: 'business',
      searchesPerDay: UNLIMITED,
      advancedSearch: true,
      maxBookmarks: UNLIMITED,
      maxSavedSearches: 100,
      alerts: 'full',
      aiAnalysesPerMonth: 150,
      aiFullAnalysis: true,
      documentUpload: true,
      matching: true,
      bidAssistant: true,
      aiBidDraftsPerMonth: 50,
      competitorIntel: true,
      advancedAnalytics: true,
      maxMembers: 10,
      profitCalculator: true,
      profitAI: true,
      partnerListing: true,
      partnerSearch: true,
      futureOpportunities: false,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceNok: 4990,
    tagline: 'For større virksomheter som vil se prosjektene tidlig.',
    features: [
      'Alt i Bedrift',
      'Future Opportunities: planlagte anskaffelser og politiske saker før de blir anbud',
      'Følg prosjekter og få varsel når de utlyses',
      'Inntil 25 brukere, 500 AI-analyser og 200 AI-utkast per måned',
      'Prioritert støtte og betaling med faktura',
    ],
    entitlements: {
      plan: 'enterprise',
      searchesPerDay: UNLIMITED,
      advancedSearch: true,
      maxBookmarks: UNLIMITED,
      maxSavedSearches: UNLIMITED,
      alerts: 'full',
      aiAnalysesPerMonth: 500,
      aiFullAnalysis: true,
      documentUpload: true,
      matching: true,
      bidAssistant: true,
      aiBidDraftsPerMonth: 200,
      competitorIntel: true,
      advancedAnalytics: true,
      maxMembers: 25,
      profitCalculator: true,
      profitAI: true,
      partnerListing: true,
      partnerSearch: true,
      futureOpportunities: true,
    },
  },
};

export const PAID_PLANS: PaidPlanId[] = ['starter', 'professional', 'business'];
export const TRIAL_PLAN: PlanId = 'professional';

export interface SubscriptionRow {
  plan: PlanId;
  status: string;
  source: 'trial' | 'stripe' | 'manual';
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface BillingState {
  effectivePlan: PlanId;
  label: string;
  status: 'trial' | 'active' | 'past_due' | 'expired' | 'canceled' | 'none';
  notice: string | null;
  trialEndsAt: Date | null;
  renewsAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Dager etter periodeslutt uten bekreftet fornyelse før tilgangen stoppes (webhooks + avstemming har feilet). */
export const STRIPE_RENEWAL_GRACE_DAYS = 14;

/** Avgjør hvilken plan som faktisk gjelder nå. Ren funksjon – testes isolert. */
export function resolveBilling(sub: SubscriptionRow | null, now = new Date()): BillingState {
  const base = { trialEndsAt: null, renewsAt: null, cancelAtPeriodEnd: false };
  if (!sub) {
    return { ...base, effectivePlan: 'free', label: PLANS.free.name, status: 'none', notice: null };
  }
  if (sub.source === 'trial') {
    if (sub.trialEndsAt && sub.trialEndsAt > now) {
      return {
        ...base,
        effectivePlan: sub.plan,
        label: `${PLANS[sub.plan].name} (prøveperiode)`,
        status: 'trial',
        notice: null,
        trialEndsAt: sub.trialEndsAt,
      };
    }
    return {
      ...base,
      effectivePlan: 'free',
      label: PLANS.free.name,
      status: 'expired',
      notice: 'Prøveperioden er over. Velg en plan for å fortsette med alle funksjoner.',
      trialEndsAt: sub.trialEndsAt,
    };
  }
  if (sub.source === 'manual') {
    const expired = sub.currentPeriodEnd !== null && sub.currentPeriodEnd <= now;
    if (sub.status === 'active' && !expired) {
      return { ...base, effectivePlan: sub.plan, label: PLANS[sub.plan].name, status: 'active', notice: null, renewsAt: sub.currentPeriodEnd };
    }
    return { ...base, effectivePlan: 'free', label: PLANS.free.name, status: 'expired', notice: 'Avtalen er utløpt.' };
  }
  // Stripe
  const renewsAt = sub.currentPeriodEnd;
  // Sikkerhetsnett hvis både webhooks og avstemming har feilet: en periode som er utløpt for lenge
  // siden uten bekreftet fornyelse gir ikke evig tilgang.
  const overdueDays = renewsAt ? (now.getTime() - renewsAt.getTime()) / 86_400_000 : 0;
  if ((sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due') && overdueDays > STRIPE_RENEWAL_GRACE_DAYS) {
    return { ...base, effectivePlan: 'free', label: PLANS.free.name, status: 'expired', notice: 'Vi har ikke fått bekreftet fornyelsen av abonnementet. Åpne betalingsportalen eller kontakt oss.' };
  }
  if ((sub.status === 'active' || sub.status === 'trialing') && sub.cancelAtPeriodEnd && overdueDays > 1) {
    return { ...base, effectivePlan: 'free', label: PLANS.free.name, status: 'canceled', notice: 'Abonnementet er avsluttet.' };
  }
  switch (sub.status) {
    case 'active':
    case 'trialing':
      return {
        ...base,
        effectivePlan: sub.plan,
        label: PLANS[sub.plan].name,
        status: 'active',
        notice: sub.cancelAtPeriodEnd ? 'Abonnementet avsluttes ved slutten av perioden.' : null,
        renewsAt,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      };
    case 'past_due':
      return {
        ...base,
        effectivePlan: sub.plan,
        label: PLANS[sub.plan].name,
        status: 'past_due',
        notice: 'Siste betaling feilet. Oppdater betalingsmåten for å beholde tilgangen.',
        renewsAt,
      };
    default:
      return {
        ...base,
        effectivePlan: 'free',
        label: PLANS.free.name,
        status: 'canceled',
        notice: 'Abonnementet er ikke aktivt.',
      };
  }
}

export function entitlementsFor(plan: PlanId): Entitlements {
  return PLANS[plan].entitlements;
}

export type Feature =
  | 'advancedSearch'
  | 'aiFullAnalysis'
  | 'documentUpload'
  | 'matching'
  | 'bidAssistant'
  | 'competitorIntel'
  | 'advancedAnalytics'
  | 'profitCalculator'
  | 'profitAI'
  | 'partnerListing'
  | 'partnerSearch'
  | 'futureOpportunities';

export const FEATURE_LABELS: Record<Feature, { name: string; minPlan: PlanId }> = {
  advancedSearch: { name: 'Avansert søk', minPlan: 'professional' },
  aiFullAnalysis: { name: 'Full AI-analyse', minPlan: 'professional' },
  documentUpload: { name: 'Opplasting av konkurransedokumenter', minPlan: 'professional' },
  matching: { name: 'Personlig rangering', minPlan: 'professional' },
  bidAssistant: { name: 'Tilbudsarbeidsflate', minPlan: 'business' },
  competitorIntel: { name: 'Konkurrentinnsikt', minPlan: 'business' },
  advancedAnalytics: { name: 'Utvidet statistikk', minPlan: 'business' },
  profitCalculator: { name: 'Lønnsomhetskalkulator', minPlan: 'professional' },
  profitAI: { name: 'Profit Intelligence med AI', minPlan: 'business' },
  partnerListing: { name: 'Partnerprofil', minPlan: 'starter' },
  partnerSearch: { name: 'Søk etter anbudspartnere', minPlan: 'business' },
  futureOpportunities: { name: 'Future Opportunities', minPlan: 'enterprise' },
};
