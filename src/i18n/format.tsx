/**
 * Formatering og enkle maler for de oversatte sidene. Norsk bruker de eksisterende funksjonene i
 * src/ui/format.ts, så de norske sidene ser ut akkurat som før.
 */
import { Fragment, type ReactNode } from 'react';
import { formatDate, formatInt, formatMoney } from '@/ui/format';
import { LOCALE_INFO, type Locale } from './locales';

/** Bøyningsformer etter tall (Intl.PluralRules). «other» må alltid finnes. */
export interface Plural {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

const TZ = 'Europe/Oslo';
const intl = (l: Locale) => LOCALE_INFO[l].intl;

/** Setter inn {navn} i en mal. */
export function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));
}

/** Som fill, men verdiene kan være React-elementer (lenker, markering). */
export function rich(template: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{\w+\})/g);
  return parts.map((part, i) => {
    const key = /^\{(\w+)\}$/.exec(part)?.[1];
    return <Fragment key={i}>{key && key in nodes ? nodes[key] : part}</Fragment>;
  });
}

export function int(locale: Locale, n: number): string {
  return locale === 'nb' ? formatInt(n) : new Intl.NumberFormat(intl(locale)).format(n);
}

/** Malen med riktig bøyning for tallet (med {n} urørt). */
export function pluralTemplate(locale: Locale, forms: Plural, n: number): string {
  const category = new Intl.PluralRules(intl(locale)).select(n) as keyof Plural;
  return forms[category] ?? forms.other;
}

/** Velger riktig bøyning og setter inn tallet som {n}. */
export function plural(locale: Locale, forms: Plural, n: number): string {
  return fill(pluralTemplate(locale, forms, n), { n: int(locale, n) });
}

export function money(locale: Locale, value: number, currency: string | null): string {
  if (locale === 'nb') return formatMoney(value, currency);
  return new Intl.NumberFormat(intl(locale), { style: 'currency', currency: currency || 'NOK', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function longDate(locale: Locale, d: Date): string {
  return locale === 'nb' ? formatDate(d, true) : new Intl.DateTimeFormat(intl(locale), { dateStyle: 'long', timeZone: TZ }).format(d);
}

/** «05.48» på norsk, ellers språkets vanlige klokkeslett. */
export function clockTime(locale: Locale, d: Date): string {
  const s = new Intl.DateTimeFormat(intl(locale), { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(d);
  return locale === 'nb' ? s.replace(':', '.') : s;
}

/** «tirsdag 3. november». */
export function weekdayLong(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(intl(locale), { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(d);
}

/** «tir. 04.11» – kort dag og dato til fristtavla. */
export function weekdayShort(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(intl(locale), { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ }).format(d).replace(/\.$/, '');
}

/** Kort månedsnavn («nov.») og dag i måneden (Oslo-tid), til datobokser. */
export function monthShort(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(intl(locale), { month: 'short', timeZone: TZ }).format(d).replace(/\.$/, '');
}
export function dayOfMonth(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: TZ }).format(d);
}

/** «2. nov.» */
export function shortDate(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(intl(locale), { day: 'numeric', month: 'short', timeZone: TZ }).format(d);
}

/** Kalenderdag i Oslo (YYYY-MM-DD), for «i dag» og «i morgen». */
export function osloDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

/** «om 4 timer», «in 3 days», «za 2 godziny» – fram til et tidspunkt. */
export function timeUntil(locale: Locale, target: Date, now = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat(intl(locale), { numeric: 'always' });
  const ms = Math.max(0, target.getTime() - now.getTime());
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return rtf.format(Math.max(1, minutes), 'minute');
  const hours = Math.round(ms / 3_600_000);
  if (hours < 36) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(ms / 86_400_000), 'day');
}

/** «mars 2027» – måned og år (anslag for når en kontrakt utløper). */
export function monthYear(locale: Locale, d: Date): string {
  return new Intl.DateTimeFormat(intl(locale), { month: 'long', year: 'numeric', timeZone: TZ }).format(d);
}

/** «1,2 mill.» / «1.2M» – korte tall til akser. */
export function compactNumber(locale: Locale, n: number): string {
  return new Intl.NumberFormat(intl(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
