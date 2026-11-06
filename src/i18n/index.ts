/**
 * Oversettelser for de offentlige sidene. Se docs/SPRAK.md for hvordan tekster endres og språk legges til.
 */
import type { Locale } from './locales';
import { nb, type Messages } from './messages/nb';
import { en } from './messages/en';
import { sv } from './messages/sv';
import { da } from './messages/da';

export type { Messages } from './messages/nb';
export * from './locales';

export const MESSAGES: Record<Locale, Messages> = { nb, en, sv, da };

export function messages(locale: Locale): Messages {
  return MESSAGES[locale];
}

/** «Doffin (Norge) og TED (EU)» på riktig språk – bare kildene som faktisk er i bruk. */
export function sourcesText(m: Messages, live: string[], long = false): string {
  const names = [
    live.includes('doffin') ? (long ? m.sources.doffinLong : m.sources.doffin) : null,
    live.includes('ted') ? (long ? m.sources.tedLong : m.sources.ted) : null,
  ].filter((n): n is string => n !== null);
  return names.length ? names.join(` ${m.sources.and} `) : m.sources.fallback;
}

/**
 * Feilmeldingene fra registreringen kommer på norsk fra domenet (src/domain/auth/auth.ts).
 * Her oversettes de ved å slå opp den norske teksten; ukjente meldinger vises som de er.
 */
export function translateAuthErrors(m: Messages, errors: Record<string, string>): Record<string, string> {
  if (m === nb) return errors;
  const keyByText = new Map(Object.entries(nb.auth.errors).map(([k, v]) => [v, k as keyof Messages['auth']['errors']]));
  return Object.fromEntries(Object.entries(errors).map(([field, text]) => [field, m.auth.errors[keyByText.get(text)!] ?? text]));
}
