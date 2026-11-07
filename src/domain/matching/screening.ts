/**
 * Forhåndsvurdering av treff – uten AI, regnet ut på stedet (ingen lagrede data).
 *
 * Samler det som avgjør om et anbud er verdt tiden: frist, krav dere ikke oppfyller, obligatorisk befaring,
 * kostbare kontraktsvilkår i kunngjøringen og opplysninger som mangler. Hvert punkt sier hvorfor, og
 * vurderingen er det alvorligste punktet:
 *   stopp  → «Passer trolig ikke»
 *   sjekk  → «Sjekk først»
 *   ellers → «Verdt å se på»
 * Bygger bare på kunngjøringen og profilen (konkurransegrunnlaget leses på anbudssiden og i Lønnsomhet).
 */
import type { AnalysisSource } from '@/domain/ai/sources';
import { scanRequirements } from '@/domain/documents/requirements';
import { scanContractTerms, TERM_LABELS, type TermCategory } from '@/domain/profit/terms-scan';
import type { MatchBreakdown } from './engine';

export type ScreeningVerdict = 'se_paa' | 'sjekk' | 'passer_ikke';
export type PointTone = 'stop' | 'warn' | 'info' | 'ok';

/** Hva punktet gjelder – så andre deler av appen (Intelligence) kan bruke vurderingen uten å tolke teksten. */
export type ScreeningKey =
  | 'deadline_passed'
  | 'deadline_soon'
  | 'deadline_short'
  | 'deadline_ok'
  | 'deadline_unknown'
  | 'excluded'
  | 'unfulfilled'
  | 'missing_info'
  | 'uncertainty'
  | 'fit'
  | 'mandatory_visit'
  | 'costly_terms'
  | 'requirements';

export interface ScreeningPoint {
  key: ScreeningKey;
  tone: PointTone;
  text: string;
}

export interface Screening {
  verdict: ScreeningVerdict;
  label: string;
  points: ScreeningPoint[];
}

export const VERDICT_LABEL: Record<ScreeningVerdict, string> = {
  se_paa: 'Verdt å se på',
  sjekk: 'Sjekk først',
  passer_ikke: 'Passer trolig ikke',
};

/** Vilkår som ofte koster penger hvis de overses. De andre (betaling, prisregulering …) vises i Lønnsomhet. */
const COSTLY_TERMS: TermCategory[] = ['dagbot', 'garanti', 'erstatningsansvar'];
const MANDATORY = /obligatorisk|påkrevd|skal delta|må delta|må gjennomføres|mandatory|compulsory/i;

export interface NoticeSignals {
  /** Setningen om obligatorisk befaring, forkortet. */
  mandatoryVisit: string | null;
  rejectionClauses: number;
  minimumRequirements: number;
  costlyTerms: TermCategory[];
}

const shorten = (s: string, max = 140) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Signaler fra kunngjøringens beskrivelse (ordsøk – samme som kravsjekken og vilkårssøket). */
export function noticeSignals(description: string | null): NoticeSignals {
  if (!description?.trim()) return { mandatoryVisit: null, rejectionClauses: 0, minimumRequirements: 0, costlyTerms: [] };
  const source: AnalysisSource = { id: 'S0', kind: 'notice', title: 'Kunngjøringen', pages: [{ page: null, text: description }], totalPages: null, isPrivate: false };
  const req = scanRequirements([source]);
  const visit = req.byKind.befaring.find((h) => /befaring|site visit/i.test(h.text) && MANDATORY.test(h.text)) ?? null;
  const terms = scanContractTerms([source], 1);
  const costlyTerms = COSTLY_TERMS.filter((c) => (terms.byCategory[c] ?? []).some((h) => !h.negated));
  return { mandatoryVisit: visit ? shorten(visit.text) : null, rejectionClauses: req.counts.avvisning, minimumRequirements: req.counts.minstekrav, costlyTerms };
}

export interface ScreeningInput {
  /** Null når organisasjonen ikke har matching (da vurderes bare frist og kunngjøringen). */
  match: { score: number; excluded: boolean; breakdown: MatchBreakdown } | null;
  deadlineAt: Date | null;
  /** Fra profilen: minste antall dager før frist bedriften vil jobbe med. */
  minDaysToDeadline: number;
  signals: NoticeSignals;
  now?: Date;
}

const ORDER: Record<PointTone, number> = { stop: 0, warn: 1, info: 2, ok: 3 };

export function screenTender(input: ScreeningInput): Screening {
  const now = input.now ?? new Date();
  const points: ScreeningPoint[] = [];
  const m = input.match;

  // Frist
  if (input.deadlineAt) {
    const hours = (input.deadlineAt.getTime() - now.getTime()) / 3_600_000;
    // Samme avrunding som fristfeltet i appen (4,99 døgn = «5 dager»), så tallene aldri spriker på samme side.
    const days = Math.ceil(hours / 24);
    // Timer, ikke kalenderdager: «i dag» kan være feil når fristen er i morgen tidlig.
    if (hours < 0) points.push({ key: 'deadline_passed', tone: 'stop', text: 'Fristen har gått ut.' });
    else if (hours < 48) points.push({ key: 'deadline_soon', tone: 'stop', text: hours < 24 ? 'Under ett døgn til fristen.' : 'Under to døgn til fristen.' });
    else if (days < input.minDaysToDeadline) points.push({ key: 'deadline_short', tone: 'warn', text: `Bare ${days} dager til fristen (profilen sier minst ${input.minDaysToDeadline}).` });
    else points.push({ key: 'deadline_ok', tone: 'info', text: `${days} dager til fristen.` });
  } else {
    points.push({ key: 'deadline_unknown', tone: 'info', text: 'Fristen er ikke oppgitt i kunngjøringen.' });
  }

  // Treff mot profilen
  if (m) {
    // Eldre lagrede forklaringer (versjon 1) mangler noen felt – tåles.
    const b = m.breakdown;
    if (m.excluded) points.push({ key: 'excluded', tone: 'stop', text: b.disqualifiers?.[0] ?? 'Utelukket av profilen (ekskluderte koder eller ord).' });
    for (const u of (b.unfulfilled ?? []).slice(0, 2)) points.push({ key: 'unfulfilled', tone: 'stop', text: u });
    if (b.missingInfo?.length) points.push({ key: 'missing_info', tone: 'warn', text: b.missingInfo[0]! });
    if (b.uncertainty === 'høy') points.push({ key: 'uncertainty', tone: 'warn', text: 'Høy usikkerhet: kunngjøringen sier lite om innholdet.' });
    if (!m.excluded && b.reasons?.length) points.push({ key: 'fit', tone: 'ok', text: b.reasons[0]! });
  }

  // Kunngjøringen
  const s = input.signals;
  if (s.mandatoryVisit) points.push({ key: 'mandatory_visit', tone: 'warn', text: `Obligatorisk befaring: «${s.mandatoryVisit}»` });
  if (s.costlyTerms.length) points.push({ key: 'costly_terms', tone: 'warn', text: `Nevnt i kunngjøringen: ${s.costlyTerms.map((c) => TERM_LABELS[c].toLowerCase()).join(', ')}.` });
  if (s.rejectionClauses || s.minimumRequirements) {
    const parts = [
      s.rejectionClauses ? `${s.rejectionClauses} om avvisning` : null,
      s.minimumRequirements ? `${s.minimumRequirements} om minstekrav` : null,
    ].filter(Boolean);
    points.push({ key: 'requirements', tone: 'info', text: `Kravsetninger i kunngjøringen: ${parts.join(', ')}. Se «Krav og avvisningsrisiko».` });
  }

  points.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]);
  const verdict: ScreeningVerdict = points.some((p) => p.tone === 'stop') ? 'passer_ikke' : points.some((p) => p.tone === 'warn') ? 'sjekk' : 'se_paa';
  return { verdict, label: VERDICT_LABEL[verdict], points };
}

/** Rad i en liste (søk, oversikt) med det som trengs for vurderingen. */
export interface ScreenableRow {
  description?: string | null;
  deadlineAt: Date | null;
  score: number | null;
  matchExcluded?: boolean | null;
  matchBreakdown?: MatchBreakdown | null;
}

export function screenRow(row: ScreenableRow, minDaysToDeadline: number, now?: Date): Screening {
  return screenTender({
    match: row.score !== null && row.matchBreakdown ? { score: row.score, excluded: Boolean(row.matchExcluded), breakdown: row.matchBreakdown } : null,
    deadlineAt: row.deadlineAt,
    minDaysToDeadline,
    signals: noticeSignals(row.description ?? null),
    now,
  });
}
