/**
 * Felles fakta for de juridiske sidene (vilkår, personvern, databehandleravtale, underleverandører,
 * informasjonskapsler, sikkerhet). Én kilde, så sidene aldri sier forskjellige ting.
 *
 * Alt her beskriver det appen faktisk gjør. Endres appen (ny leverandør, ny informasjonskapsel,
 * ny lagringstid), skal dette oppdateres – og LEGAL_VERSION økes når teksten endres vesentlig.
 * Tekstene er utkast og skal gjennomgås av advokat før lansering (LEGAL_PAGES_REVIEWED).
 */
import { env } from '@/lib/env';

/** Versjonen av vilkårene og databehandleravtalen. Lagres på brukeren ved registrering. */
export const LEGAL_VERSION = '2026-11-03';
export const LEGAL_UPDATED = new Date('2026-11-03T00:00:00Z');

export interface CompanyInfo {
  name: string;
  orgNumber: string;
  address: string;
  email: string;
}

export function companyInfo(): CompanyInfo {
  return { name: env.COMPANY_LEGAL_NAME, orgNumber: env.COMPANY_ORG_NUMBER, address: env.COMPANY_ADDRESS, email: env.COMPANY_CONTACT_EMAIL };
}

/** Plassholderverdi (standardverdiene i env.ts) – ikke en ekte opplysning. */
export function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return v === '' || v.startsWith('[') || /@example\.(com|org|net)$/i.test(v);
}

/** Er firmaopplysningene fylt inn (COMPANY_*)? Før det vises de ikke som ekte opplysninger. */
export function companyConfigured(c: CompanyInfo = companyInfo()): boolean {
  return ![c.name, c.orgNumber, c.address, c.email].some(isPlaceholder);
}

/** Kontaktadressen er en Gmail-konto: e-post til oss mottas og lagres da hos Google. */
export function contactIsGmail(c: CompanyInfo = companyInfo()): boolean {
  return /@(gmail|googlemail)\.com$/i.test(c.email.trim());
}

/** De juridiske dokumentene – brukt i bunnteksten, på dokumentsidene og i sitemap. */
export const LEGAL_DOCS: { href: string; label: string }[] = [
  { href: '/vilkar', label: 'Vilkår for bruk' },
  { href: '/personvern', label: 'Personvernerklæring' },
  { href: '/databehandleravtale', label: 'Databehandleravtale' },
  { href: '/underleverandorer', label: 'Underleverandører' },
  { href: '/informasjonskapsler', label: 'Informasjonskapsler' },
  { href: '/sikkerhet', label: 'Sikkerhet' },
];

export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
  transfer: string;
  /** Ikke i bruk ennå (nøkkel ikke satt) – vises som «planlagt». */
  planned?: boolean;
}

/** Underleverandørene ut fra faktisk oppsett. Planlagte vises tydelig merket. */
export function subprocessors(): Subprocessor[] {
  const filesInSupabase = env.STORAGE_DRIVER === 'supabase';
  const emailFromOwnDomain = !/@resend\.dev\b/i.test(env.EMAIL_FROM);
  const list: Subprocessor[] = [
    {
      name: 'Render Services, Inc.',
      purpose: filesInSupabase ? 'Drift av nettsiden og bakgrunnsjobber' : 'Drift av nettsiden, bakgrunnsjobber og lagring av opplastede dokumenter',
      data: 'Alle data som behandles i tjenesten, mens de behandles',
      location: 'EU (Frankfurt, Tyskland)',
      transfer: 'Lagres og behandles i EU. Selskapet er amerikansk; eventuell tilgang fra USA dekkes av EUs standardavtaler (SCC).',
    },
    {
      name: 'Supabase, Inc.',
      purpose: filesInSupabase ? 'Database og lagring av opplastede dokumenter' : 'Database',
      data: 'Kontoer, organisasjoner, profiler, lagrede anbud, tilbudsarbeid, kalkyler og logger',
      location: 'EU (Irland)',
      transfer: 'Lagres i EU. Selskapet er amerikansk; eventuell tilgang fra USA dekkes av EUs standardavtaler (SCC).',
    },
    {
      name: 'Resend, Inc.',
      purpose: 'Utsending av e-post (bekreftelser, varsler, ukesoversikt)',
      data: 'E-postadresse, navn og innholdet i e-posten',
      // Eget avsenderdomene (anbudradar.com) er lagt inn hos Resend med EU-region (eu-west-1, Irland).
      // Fellesadressen onboarding@resend.dev, som brukes før domenet er bekreftet, sender fra USA.
      location: emailFromOwnDomain ? 'EU (Irland) for utsending. Selskapet er amerikansk.' : 'USA',
      transfer: emailFromOwnDomain
        ? 'E-post sendes fra EU. Opplysninger kan også behandles i USA; det dekkes av EUs standardavtaler (SCC) i leverandørens databehandleravtale.'
        : 'EUs standardavtaler (SCC) i leverandørens databehandleravtale.',
      planned: env.EMAIL_PROVIDER !== 'resend' || !env.RESEND_API_KEY,
    },
    {
      name: 'Stripe Payments Europe, Ltd.',
      purpose: 'Betaling, abonnement og fakturering',
      data: 'Navn, e-post, firma, betalingsopplysninger (kortdata håndteres bare av Stripe)',
      location: 'EU (Irland), med behandling også i USA',
      transfer: 'EUs standardavtaler (SCC) og EU–US Data Privacy Framework. Stripe er selvstendig behandlingsansvarlig for blant annet svindelforebygging.',
      planned: !env.STRIPE_SECRET_KEY,
    },
    {
      name: env.AI_PROVIDER === 'openai' ? 'OpenAI, L.L.C.' : 'Anthropic, PBC',
      purpose: 'AI-analyse av kunngjøringer og dokumenter, egnethetsvurdering og tekstutkast – bare når en bruker ber om det',
      data: 'Kunngjøringstekst, dokumenter kunden laster opp, og ved egnethetsvurdering og tekstutkast utdrag fra bedriftsprofilen',
      location: 'USA',
      transfer: 'EUs standardavtaler (SCC) i leverandørens databehandleravtale. Data fra API-et brukes ikke til å trene modeller etter leverandørens vilkår.',
      planned: env.AI_PROVIDER === 'none' || env.AI_PROVIDER === 'mock' || !(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY),
    },
  ];
  return list;
}

export interface CookieInfo {
  name: string;
  purpose: string;
  duration: string;
}

/** Informasjonskapslene appen setter (se src/server/app.ts, flash.ts og domain/auth). Alle er nødvendige. */
export function cookies(): CookieInfo[] {
  return [
    {
      name: env.NODE_ENV === 'production' ? '__Host-ar_session' : 'ar_session',
      purpose: 'Holder deg innlogget. Verdien er en tilfeldig nøkkel; selve økten ligger hos oss.',
      duration: '30 dager, forlenges når du bruker tjenesten. Slettes når du logger ut.',
    },
    { name: 'ar_csrf', purpose: 'Beskytter skjemaer (innlogging, registrering, kontakt) mot falske innsendinger før du er logget inn.', duration: '24 timer' },
    { name: 'ar_flash', purpose: 'Viser en kort beskjed etter en handling, f.eks. «Lagret».', duration: '60 sekunder' },
  ];
}

export interface RetentionRule {
  what: string;
  how: string;
}

/** Lagringstider. Speiler applyRetention() i src/domain/ops/tasks.ts (testet i tests/unit/legal.test.ts). */
export const RETENTION: RetentionRule[] = [
  { what: 'Konto, organisasjon, profil, lagrede anbud, tilbudsarbeid, kalkyler og dokumenter', how: 'Så lenge kontoen eller organisasjonen finnes. Slettes når dere sletter dem.' },
  { what: 'Innloggingsøkter', how: 'Til de utløper (30 dager uten bruk) eller du logger ut.' },
  { what: 'Lenker for e-postbekreftelse og nytt passord', how: '7 dager etter at lenken utløp.' },
  { what: 'Varsler i appen', how: 'Leste etter 180 dager, alle etter 365 dager.' },
  { what: 'E-postlogg (hva som er sendt)', how: '90 dager.' },
  { what: 'Revisjonslogg og søkestatistikk', how: '365 dager.' },
  { what: 'Partnerforespørsler', how: 'Ubesvarte etter 180 dager, avslåtte og trukne etter 12 måneder, godtatte etter 24 måneder.' },
  { what: 'Invitasjoner', how: '90 dager etter at de ble brukt, trukket tilbake eller utløp.' },
  { what: 'Tekniske logger for henting av kunngjøringer', how: '90 til 365 dager (inneholder ikke personopplysninger utover det kildene publiserer).' },
  { what: 'Bevis på at vilkårene er godtatt (versjon og tidspunkt)', how: 'Så lenge kontoen finnes.' },
  { what: 'Regnskapsopplysninger (fakturaer i Stripe)', how: 'Så lenge bokføringsloven krever (normalt 5 år).' },
];
