import { createContext, useContext } from 'react';
import type { AuthUser, Flash, OrgContext } from '@/server/http';
import type { Locale } from '@/i18n/locales';
import { nb, type Messages } from '@/i18n/messages/nb';

export interface UiContextValue {
  path: string;
  csrfToken: string;
  user: AuthUser | null;
  org: OrgContext | null;
  flash: Flash | null;
  unreadCount: number;
  isDev: boolean;
  aiConfigured: boolean;
  aiIsMock: boolean;
  legalReviewed: boolean;
  /** Datakilder som er verifisert mot ekte API ("ted", "doffin"). */
  liveSources: string[];
  /** Lengden på gratis prøveperiode (TRIAL_DAYS), så markedsteksten alltid stemmer. */
  trialDays: number;
  /** Språket på de offentlige sidene, tekstene for det og lenker på samme språk. */
  locale: Locale;
  m: Messages;
  /** Norsk sti → samme side på gjeldende språk (sider som ikke er oversatt, beholder norsk adresse). */
  lp: (href: string) => string;
  /** Spørringen i adressen (?bransje=…), så språkvelgeren kan beholde den. */
  search: string;
  /** Språk nettleseren foretrekker, når siden finnes på det og vises på norsk (ellers null). */
  suggestLocale: Locale | null;
}

export const UiContext = createContext<UiContextValue>({
  path: '/',
  csrfToken: '',
  user: null,
  org: null,
  flash: null,
  unreadCount: 0,
  isDev: false,
  aiConfigured: false,
  aiIsMock: false,
  legalReviewed: false,
  liveSources: [],
  trialDays: 14,
  locale: 'nb',
  m: nb,
  lp: (href) => href,
  search: '',
  suggestLocale: null,
});

export function useUi(): UiContextValue {
  return useContext(UiContext);
}
