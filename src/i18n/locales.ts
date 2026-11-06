/**
 * Språk på de offentlige sidene. Norsk (bokmål) er standard og ligger på rotadressene (/priser);
 * de andre språkene har et prefiks og engelske adresser (/en/pricing, /de/pricing).
 * Appen etter innlogging, e-poster og de juridiske dokumentene er på norsk.
 */
import { industryIdFromSlug, industrySlugNb } from '@/domain/slugs';

/** Bare språk som er ferdig oversatt, står her. Flere språk: se docs/SPRAK.md. */
export const LOCALES = ['nb', 'en', 'sv', 'da'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'nb';

/** Navnet på språket, skrevet på språket selv (slik det står i språkvelgeren), og formatering for Intl. */
export const LOCALE_INFO: Record<Locale, { name: string; intl: string }> = {
  nb: { name: 'Norsk', intl: 'nb-NO' },
  en: { name: 'English', intl: 'en-GB' },
  sv: { name: 'Svenska', intl: 'sv-SE' },
  da: { name: 'Dansk', intl: 'da-DK' },
};

export function isLocale(value: string | null | undefined): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Norsk sti → adresse på de andre språkene. Bare disse sidene er oversatt. */
const SLUGS: Record<string, string> = {
  '/': '',
  '/funksjoner': 'features',
  '/priser': 'pricing',
  '/bransjer': 'industries',
  '/om': 'about',
  '/kontakt': 'contact',
  '/registrer': 'register',
  '/logg-inn': 'login',
  '/logg-inn/kode': 'login-code',
  '/glemt-passord': 'forgot-password',
};
const FROM_SLUG = new Map(Object.entries(SLUGS).map(([path, slug]) => [slug, path]));

/** Sidene som har hreflang-lenker og står i nettstedskartet på alle språk. */
export const MARKETING_PATHS = ['/', '/funksjoner', '/priser', '/bransjer', '/om', '/kontakt'] as const;

/** Én side per bransje: /bransjer/bygg … → /en/industries/… */
const INDUSTRY_PAGE = /^\/bransjer\/([a-z-]+)$/;

export function isTranslatedPath(path: string): boolean {
  return Object.hasOwn(SLUGS, path) || INDUSTRY_PAGE.test(path);
}

/**
 * Lenke til en side på et språk. Tar en norsk sti (med eventuell ?spørring og #anker).
 * Sider som ikke er oversatt (appen, juridiske dokumenter), beholder den norske adressen.
 */
export function localePath(locale: Locale, href: string): string {
  if (locale === DEFAULT_LOCALE) return href;
  const m = /^([^?#]*)([?#].*)?$/.exec(href);
  const path = m?.[1] || '/';
  const rest = m?.[2] ?? '';
  const industry = industryIdFromSlug(INDUSTRY_PAGE.exec(path)?.[1]);
  if (industry) return `/${locale}/industries/${industry}${rest}`;
  const slug = SLUGS[path];
  if (slug === undefined) return href;
  return `/${locale}${slug ? `/${slug}` : ''}${rest}`;
}

/**
 * Leser språket fra adressen. «/en/pricing» → { locale: 'en', path: '/priser' }.
 * Et språkprefiks foran en side som ikke er oversatt, gir path: null (404).
 */
export function parseLocalePath(pathname: string): { locale: Locale; path: string | null } {
  const ind = /^\/([a-z]{2})\/industries\/([a-z-]+)\/?$/.exec(pathname);
  if (ind && isLocale(ind[1]) && ind[1] !== DEFAULT_LOCALE) {
    // Den norske adressen er felles nøkkel for alle språk (/en/industries/cleaning → /bransjer/renhold).
    const id = industryIdFromSlug(ind[2]);
    return { locale: ind[1], path: id ? `/bransjer/${industrySlugNb(id)}` : null };
  }
  const m = /^\/([a-z]{2})(?:\/([^/]*))?\/?$/.exec(pathname);
  const prefix = m?.[1];
  if (!m || !isLocale(prefix) || prefix === DEFAULT_LOCALE) {
    // «/en/noe/mer» eller «/nb/…» er ikke oversatte sider.
    const loose = /^\/([a-z]{2})(?:\/|$)/.exec(pathname)?.[1];
    if (isLocale(loose) && loose !== DEFAULT_LOCALE) return { locale: loose, path: null };
    return { locale: DEFAULT_LOCALE, path: pathname };
  }
  return { locale: prefix, path: FROM_SLUG.get(m[2] ?? '') ?? null };
}

/** Beste støttede språk fra Accept-Language (eller null). «no», «nn» og «nb» regnes som norsk. */
export function preferredLocale(acceptLanguage: string | undefined | null): Locale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { lang: tag.split('-')[0] ?? '', q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.lang && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { lang } of ranked) {
    if (lang === 'no' || lang === 'nn' || lang === 'nb') return 'nb';
    if (isLocale(lang)) return lang;
  }
  return null;
}
