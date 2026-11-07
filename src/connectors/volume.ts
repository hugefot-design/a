/**
 * Måling av datamengde før et nytt land eller en ny kilde slås på (brukes av dry-run):
 * hvor mange kunngjøringer per måned, hvor mange som er åpne konkurranser, hvor mange som passer bransjene
 * i AnbudRadar, og omtrent hvor mye plass de tar i databasen. Ingenting lagres.
 */
import { CPV_DIVISIONS, INDUSTRIES } from '@/domain/reference';
import type { NormalizedNotice } from '@/domain/tenders/normalize';

export interface VolumeEstimate {
  notices: number;
  days: number;
  perMonth: number;
  competitionsPerMonth: number;
  /** Andel (0–100 %) som passer minst én bransje i AnbudRadar (etter CPV-kode). */
  relevantPct: number;
  /** Gjennomsnittlig størrelse per kunngjøring i kilden (lagres som original) og etter tolkning, i kB. */
  avgRawKb: number;
  avgNormalizedKb: number;
  /** Anslag for databasen: (original + tolket) × 2 for indekser og søk, per måned. */
  estimatedMbPerMonth: number;
  currencies: Record<string, number>;
  topCpvDivisions: { code: string; label: string; count: number }[];
}

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
const round1 = (n: number) => Math.round(n * 10) / 10;

export function matchesAnyIndustry(cpvCodes: string[]): boolean {
  return cpvCodes.some((code) => INDUSTRIES.some((ind) => ind.cpvPrefixes.some((p) => code.startsWith(p))));
}

export function measureVolume(notices: NormalizedNotice[], since: Date, until: Date = new Date()): VolumeEstimate {
  const n = notices.length;
  const days = Math.max(1, Math.round((until.getTime() - since.getTime()) / 86_400_000));
  const perMonth = Math.round((n / days) * 30);
  const competitions = notices.filter((x) => x.lifecycle === 'competition').length;
  let raw = 0;
  let normalized = 0;
  const currencies: Record<string, number> = {};
  const divisions = new Map<string, number>();
  let relevant = 0;
  for (const x of notices) {
    const { raw: r, ...rest } = x;
    raw += bytes(r);
    normalized += bytes(rest);
    if (x.currency) currencies[x.currency] = (currencies[x.currency] ?? 0) + 1;
    for (const div of new Set(x.cpvCodes.map((c) => c.slice(0, 2)))) divisions.set(div, (divisions.get(div) ?? 0) + 1);
    if (matchesAnyIndustry(x.cpvCodes)) relevant++;
  }
  const avgRaw = n ? raw / n : 0;
  const avgNorm = n ? normalized / n : 0;
  return {
    notices: n,
    days,
    perMonth,
    competitionsPerMonth: Math.round((competitions / days) * 30),
    relevantPct: n ? round1((relevant / n) * 100) : 0,
    avgRawKb: round1(avgRaw / 1024),
    avgNormalizedKb: round1(avgNorm / 1024),
    estimatedMbPerMonth: round1(((avgRaw + avgNorm) * 2 * perMonth) / (1024 * 1024)),
    currencies,
    topCpvDivisions: [...divisions.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, label: CPV_DIVISIONS[code] ?? 'Ukjent', count })),
  };
}
