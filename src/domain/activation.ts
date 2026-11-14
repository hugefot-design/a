/**
 * Aktivering og måling – uten tredjepart og uten informasjonskapsler.
 *
 * - `feature_first_use`: første gang en organisasjon bruker en funksjon (én rad per organisasjon og funksjon).
 * - `user_active_days`: dager en bruker har vært inne i appen (én rad per bruker per dag, norsk tid).
 *
 * Brukes til «Kom i gang» på Oversikt og til Admin → Kundereise. Ingen sidevisninger, klokkeslett eller
 * IP-adresser lagres. Skrivingen feiler aldri forespørselen, og hver nøkkel skrives høyst én gang per prosess.
 */
import { systemSql } from '@/lib/db';
import { log } from '@/lib/logger';

export const FEATURES = ['tender_viewed', 'intelligence_viewed', 'profit_opened', 'pdf_downloaded', 'plan_interest'] as const;
export type Feature = (typeof FEATURES)[number];

const MAX_REMEMBERED = 50_000;
const written = new Set<string>();

function remember(key: string): void {
  if (written.size >= MAX_REMEMBERED) written.clear();
  written.add(key);
}

/** Bare for tester: glem hva prosessen allerede har skrevet. */
export function resetActivationCache(): void {
  written.clear();
}

const osloDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Dagens dato i norsk tid, «2026-11-14». */
export function osloDate(now = new Date()): string {
  return osloDay.format(now);
}

/** Første gang organisasjonen bruker funksjonen. Senere kall gjør ingenting. */
export async function markFeatureUsed(orgId: string, userId: string | null, feature: Feature): Promise<void> {
  const key = `f:${orgId}:${feature}`;
  if (written.has(key)) return;
  try {
    await systemSql()`
      insert into feature_first_use (org_id, feature, user_id) values (${orgId}, ${feature}, ${userId})
      on conflict (org_id, feature) do nothing
    `;
    remember(key);
  } catch (err) {
    log.warn('feature_first_use_failed', { feature, err: err instanceof Error ? err.message : String(err) });
  }
}

/** Brukeren har vært inne i appen i dag. Én rad per bruker per dag. */
export async function recordActiveDay(userId: string, now = new Date()): Promise<void> {
  const day = osloDate(now);
  const key = `d:${userId}:${day}`;
  if (written.has(key)) return;
  try {
    await systemSql()`insert into user_active_days (user_id, day) values (${userId}, ${day}) on conflict (user_id, day) do nothing`;
    remember(key);
  } catch (err) {
    log.warn('active_day_failed', { err: err instanceof Error ? err.message : String(err) });
  }
}

/** Funksjonene organisasjonen har brukt minst én gang. */
export async function featuresUsed(orgId: string): Promise<Set<Feature>> {
  const rows = (await systemSql()`select feature from feature_first_use where org_id = ${orgId}`) as unknown as { feature: string }[];
  return new Set(rows.map((r) => r.feature).filter((f): f is Feature => (FEATURES as readonly string[]).includes(f)));
}

// ---------------------------------------------------------------------------
// «Kom i gang» på Oversikt
// ---------------------------------------------------------------------------
export interface StartStep {
  key: 'profile' | 'assessment' | 'save' | 'profit' | 'sharpen';
  title: string;
  text: string;
  href: string;
  cta: string;
  done: boolean;
}

export interface StartInput {
  /** Det beste åpne treffet akkurat nå (null når det ikke finnes noen anbud å vise). */
  topTenderId: string | null;
  used: Set<Feature>;
  savedCount: number;
  hasCalculation: boolean;
  /** Planen har lønnsomhetskalkulatoren. */
  profitCalculator: boolean;
  /** Profilen har noe utover oppstarten (sertifiseringer, omsetning, referanser, CPV eller kontraktsstørrelse). */
  profileSharpened: boolean;
}

/**
 * Stegene fra første treff til første vurdering. Ren funksjon – testes isolert. Alt bygger på det kunden
 * faktisk har gjort; ingenting krysses av på forhånd bortsett fra profilen (den er ferdig når siden vises).
 */
export function startSteps(i: StartInput): StartStep[] {
  const tender = i.topTenderId ? `/app/anbud/${i.topTenderId}` : '/app/anbud';
  const steps: StartStep[] = [
    { key: 'profile', title: 'Profilen er klar', text: 'Anbudene er rangert etter bransje, område og stikkord.', href: '/app/profil', cta: 'Se profilen', done: true },
    {
      key: 'assessment',
      title: 'Se vurderingen av det beste treffet',
      text: 'Gå videre, avklar først eller ikke gå videre – med grunner, risiko og kilde på alt.',
      href: i.topTenderId ? `${tender}/intelligence` : '/app/anbud',
      cta: i.topTenderId ? 'Åpne samlet vurdering' : 'Finn et anbud',
      done: i.used.has('intelligence_viewed'),
    },
    {
      key: 'save',
      title: 'Lagre et anbud dere vil følge',
      text: 'Da minner vi dere på fristen, og anbudet samles under Lagrede anbud.',
      href: tender,
      cta: i.topTenderId ? 'Åpne anbudet' : 'Finn et anbud',
      done: i.savedCount > 0,
    },
  ];
  if (i.profitCalculator) {
    steps.push({
      key: 'profit',
      title: 'Regn på lønnsomheten',
      text: 'Legg inn timer og kostnader, og få selvkost, minstepris og målpris.',
      href: i.topTenderId ? `${tender}/lonnsomhet` : '/app/lonnsomhet',
      cta: 'Åpne kalkylen',
      done: i.hasCalculation,
    });
  }
  steps.push({
    key: 'sharpen',
    title: 'Gjør vurderingene skarpere',
    text: 'Legg til sertifiseringer, omsetning, kontraktsstørrelse og referanser i bedriftsprofilen.',
    href: '/app/profil',
    cta: 'Fyll ut mer',
    done: i.profileSharpened,
  });
  return steps;
}

// ---------------------------------------------------------------------------
// Hvor registreringen kom fra (uten informasjonskapsler)
// ---------------------------------------------------------------------------
const SAFE_PATH = /^\/[\p{L}\p{N}\-._~/%]*$/u;
const SAFE_SOURCE = /^[a-z0-9._-]{1,60}$/;

/** Siden på vårt eget nettsted som lenket til registreringen (fra Referer), uten spørring. Null ellers. */
export function signupPathFrom(referer: string | undefined, appUrl: string): string | null {
  if (!referer) return null;
  try {
    const ref = new URL(referer);
    if (ref.host !== new URL(appUrl).host) return null;
    const path = ref.pathname.length > 1 ? ref.pathname.replace(/\/+$/, '') : ref.pathname;
    // Registrerings- og innloggingssiden selv sier ikke noe om hvor kunden kom fra.
    if (/(^|\/)(registrer|logg-inn|register|login)$/.test(path)) return null;
    return SAFE_PATH.test(path) ? path.slice(0, 200) : null;
  } catch {
    return null;
  }
}

/**
 * Lagrer siden og kilden registreringen kom fra (f.eks. «/anbud/…» og «ukesbrev»). Bare én gang per bruker,
 * og bare trygge verdier. Feiler aldri registreringen.
 */
export async function recordSignupOrigin(userId: string, path: string | null, source: string | null): Promise<void> {
  const p = path && SAFE_PATH.test(path) ? path.slice(0, 200) : null;
  const src = source && SAFE_SOURCE.test(source) ? source : null;
  if (!p && !src) return;
  try {
    await systemSql()`update users set signup_path = ${p}, signup_source = ${src} where id = ${userId} and signup_path is null and signup_source is null`;
  } catch (err) {
    log.warn('signup_origin_failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

