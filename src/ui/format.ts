const TZ = 'Europe/Oslo';

const dateFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const dateLongFmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const intFmt = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 1, minimumFractionDigits: 0 });

export function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: Date | string | null | undefined, long = false): string {
  const d = toDate(value);
  if (!d) return '–';
  return (long ? dateLongFmt : dateFmt).format(d);
}

export function formatDateTime(value: Date | string | null | undefined, withTime = true): string {
  const d = toDate(value);
  if (!d) return '–';
  return withTime ? `${dateFmt.format(d)} kl. ${timeFmt.format(d)}` : dateFmt.format(d);
}

export function formatInt(n: number | null | undefined): string {
  return n === null || n === undefined ? '–' : intFmt.format(n);
}

/** Beløp i kroner. Store beløp vises kompakt ("4,2 mill. kr"). */
export function formatMoney(value: number | null | undefined, currency: string | null = 'NOK', compact = true): string {
  if (value === null || value === undefined) return 'Ikke oppgitt';
  const suffix = !currency || currency === 'NOK' ? 'kr' : currency;
  if (compact && value >= 1_000_000_000) return `${decFmt.format(value / 1_000_000_000)} mrd. ${suffix}`;
  if (compact && value >= 1_000_000) return `${decFmt.format(value / 1_000_000)} mill. ${suffix}`;
  return `${intFmt.format(value)} ${suffix}`;
}

/** Hele dager til fristen (negative etter fristen). */
export function daysUntil(value: Date | string | null | undefined, now = new Date()): number | null {
  const d = toDate(value);
  if (!d) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}

export function deadlineLabel(value: Date | string | null | undefined, now = new Date()): string {
  const d = toDate(value);
  if (!d) return 'Frist ikke oppgitt';
  const ms = d.getTime() - now.getTime();
  if (ms <= 0) {
    const ago = Math.floor(-ms / 86_400_000);
    return ago === 0 ? 'Fristen gikk ut i dag' : `Fristen gikk ut for ${ago} ${ago === 1 ? 'dag' : 'dager'} siden`;
  }
  const hours = ms / 3_600_000;
  if (hours < 24) return `Frist om ${Math.max(1, Math.round(hours))} t`;
  const days = Math.ceil(hours / 24);
  return days === 1 ? 'Frist i morgen' : `Frist om ${days} dager`;
}

export function pluralize(n: number, one: string, many: string): string {
  return `${formatInt(n)} ${n === 1 ? one : many}`;
}

export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export function relativeTime(value: Date | string | null | undefined, now = new Date()): string {
  const d = toDate(value);
  if (!d) return '–';
  const sec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return 'akkurat nå';
  const min = Math.round(sec / 60);
  if (min < 60) return `for ${min} min siden`;
  const h = Math.round(min / 60);
  if (h < 24) return `for ${h} t siden`;
  const days = Math.round(h / 24);
  if (days < 30) return `for ${days} ${days === 1 ? 'dag' : 'dager'} siden`;
  return formatDate(d);
}

/** Navn på datakildene som faktisk er koblet til – aldri flere enn de som er verifisert. */
export function sourcesPhrase(live: string[], long = false): string {
  const names = [
    live.includes('doffin') ? (long ? 'Doffin (Norge)' : 'Doffin') : null,
    live.includes('ted') ? (long ? 'TED (EU)' : 'TED') : null,
  ].filter((n): n is string => n !== null);
  return names.length ? names.join(' og ') : 'offentlige kilder';
}
