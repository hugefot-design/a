/**
 * Planer og rettigheter. Alle tilgangsbeslutninger tas på serveren ut fra
 * abonnementsraden i databasen – aldri ut fra noe nettleseren sier.
 */
export type PlanId = 'free' | 'starter' | 'professional' | 'business' | 'enterprise';
export type PaidPlanId = 'starter' | 'professional' | 'business';

export interface Entitlements {
  plan: PlanId;
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
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  priceNok: number | null;
  tagline: string;
  features: string[];
  entitlements: Entitlements;
}

const UNLIMITED = 1_000_000;

export const PLANS: Record<PlanId, PlanInfo> = {
  free: {
    id: 'free',
    name: 'Gratis',
    priceNok: 0,
    tagline: 'Etter prøveperioden, eller for å se deg rundt.',
    features: ['Søk i kunngjøringer', 'Inntil 5 lagrede anbud'],
    entitlements: {
      plan: 'free',
      advancedSearch: false,
      maxBookmarks: 5,
      maxSavedSearches: 0,
      alerts: 'none',
      aiAnalysesPerMonth: 0,
      aiFullAnalysis: false,
      documentUpload: false,
      matching: false,
      bidAssistant: false,
      aiBidDraftsPerMonth: 0,
      competitorIntel: false,
      advancedAnalytics: false,
      maxMembers: 1,
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceNok: 199,
    tagline: 'For deg som vil følge med på egne bransjer.',
    features: [
      'Søk med filtre for bransje, sted, verdi og frist',
      'Inntil 25 lagrede anbud',
      '3 lagrede søk med e-postvarsel',
      '10 enkle AI-sammendrag per måned',
    ],
    entitlements: {
      plan: 'starter',
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
    },
  },
  professional: {
    id: 'professional',
    name: 'Profesjonell',
    priceNok: 499,
    tagline: 'For bedrifter som leverer tilbud jevnlig.',
    features: [
      'Avansert søk med naturlig språk, CPV og ekskluderinger',
      'Full AI-analyse av kunngjøringer og opplastede dokumenter',
      'Personlig rangering mot bedriftsprofilen',
      'Fristvarsler og varsel om endringer',
      'Inntil 200 lagrede anbud og 20 lagrede søk',
      '60 AI-analyser per måned',
    ],
    entitlements: {
      plan: 'professional',
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
    },
  },
  business: {
    id: 'business',
    name: 'Bedrift',
    priceNok: 999,
    tagline: 'For team som jobber med tilbud sammen.',
    features: [
      'Alt i Profesjonell',
      'Inntil 10 brukere',
      'Tilbudsarbeidsflate med AI-assistent',
      'Innsikt i tildelinger og konkurrenter',
      'Utvidet statistikk',
      '250 AI-analyser og 100 AI-utkast per måned',
    ],
    entitlements: {
      plan: 'business',
      advancedSearch: true,
      maxBookmarks: UNLIMITED,
      maxSavedSearches: 100,
      alerts: 'full',
      aiAnalysesPerMonth: 250,
      aiFullAnalysis: true,
      documentUpload: true,
      matching: true,
      bidAssistant: true,
      aiBidDraftsPerMonth: 100,
      competitorIntel: true,
      advancedAnalytics: true,
      maxMembers: 10,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceNok: null,
    tagline: 'Egne avtaler for større organisasjoner.',
    features: ['Alt i Bedrift', 'Avtalte grenser for brukere og AI-bruk', 'Fakturaavtale'],
    entitlements: {
      plan: 'enterprise',
      advancedSearch: true,
      maxBookmarks: UNLIMITED,
      maxSavedSearches: UNLIMITED,
      alerts: 'full',
      aiAnalysesPerMonth: 2000,
      aiFullAnalysis: true,
      documentUpload: true,
      matching: true,
      bidAssistant: true,
      aiBidDraftsPerMonth: 1000,
      competitorIntel: true,
      advancedAnalytics: true,
      maxMembers: 100,
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
  | 'advancedAnalytics';

export const FEATURE_LABELS: Record<Feature, { name: string; minPlan: PlanId }> = {
  advancedSearch: { name: 'Avansert søk', minPlan: 'professional' },
  aiFullAnalysis: { name: 'Full AI-analyse', minPlan: 'professional' },
  documentUpload: { name: 'Opplasting av konkurransedokumenter', minPlan: 'professional' },
  matching: { name: 'Personlig rangering', minPlan: 'professional' },
  bidAssistant: { name: 'Tilbudsarbeidsflate', minPlan: 'business' },
  competitorIntel: { name: 'Konkurrentinnsikt', minPlan: 'business' },
  advancedAnalytics: { name: 'Utvidet statistikk', minPlan: 'business' },
};
