/**
 * Feilovervåking i appen – gratis og uten ny leverandør.
 *
 * Alt som logges med log.error (feil i forespørsler, bakgrunnsjobber, henting, Stripe, e-post …) samles i
 * tabellen app_errors, gruppert per feiltype: samme hendelse, samme feilmelding og samme sted i koden blir
 * én rad med teller. Administratoren får én e-post i timen med nye feil (ADMIN_NOTIFICATION_EMAIL), og ser
 * alt under Admin → Feil, der feil merkes som løst. En løst feil som kommer tilbake, åpnes og varsles igjen.
 *
 * Personvern: e-postadresser, lange tall (telefon, personnummer, kontonummer, IP), nøkler og innlogging i
 * adresser fjernes før lagring. Ingen bruker-, organisasjons- eller forespørsels-ID lagres.
 */
import { createHash } from 'node:crypto';
import { systemSql } from '@/lib/db';
import { env } from '@/lib/env';
import { queueEmail } from '@/lib/email';
import { log, onErrorLogged } from '@/lib/logger';
import { adminAlertTemplate } from '@/domain/email/templates';

// ---------------------------------------------------------------------------
// Rene hjelpefunksjoner (enhetstestet)
// ---------------------------------------------------------------------------

/** Fjerner personopplysninger og hemmeligheter fra en tekst. */
export function scrub(text: string): string {
  return (
    text
      // Innlogging i adresser: postgres://bruker:passord@vert → postgres://[skjult]@vert
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[skjult]@')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-post]')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [skjult]')
      // Nøkler, tokens og ID-er: lange strenger av bokstaver og tall.
      .replace(/[A-Za-z0-9_-]{32,}/g, '[skjult]')
      // Telefon, personnummer, kontonummer, IP-adresser o.l.: seks eller flere sifre (også med mellomrom eller punktum).
      .replace(/\d(?:[ .]?\d){5,}/g, '[tall]')
  );
}

/** Variable deler (ID-er, tall) byttes ut, så samme feil med ulike verdier havner i samme gruppe. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Adresser i appen uten ID-er: /app/anbud/1f0c…/kalkyle → /app/anbud/:id/kalkyle. */
export function normalizePath(p: string): string {
  return p
    .split('?')[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 150);
}

interface Frame {
  fn: string;
  file: string;
}

function parseFrames(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const raw of stack.split('\n').slice(1)) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    const m = /^at (?:async )?(?:(.+?) \()?(.+?)\)?$/.exec(line);
    if (!m) continue;
    frames.push({ fn: (m[1] ?? '<anonym>').trim(), file: m[2]!.trim() });
  }
  return frames;
}

function shortFile(file: string): string {
  // Bare stien inne i prosjektet (ingen mappenavn fra serveren).
  const s = file.replace(/^file:\/\//, '');
  const idx = Math.max(s.lastIndexOf('/src/'), s.lastIndexOf('/scripts/'), s.lastIndexOf('/dist/'));
  return idx >= 0 ? s.slice(idx + 1) : s.split('/').slice(-2).join('/');
}

function isAppFrame(f: Frame): boolean {
  return !f.file.includes('node_modules') && !f.file.startsWith('node:') && /\/(src|scripts|dist)\//.test(f.file);
}

/**
 * Stedet i koden der feilen oppsto (første ramme i appen) og en kort, renset stakk.
 * Funksjonsnavnene (ikke linjenumrene) brukes i grupperingen, så samme feil beholder gruppen etter en ny versjon.
 */
export function stackInfo(stack: string | undefined): { location: string | null; signature: string; stack: string | null } {
  if (!stack) return { location: null, signature: '', stack: null };
  const frames = parseFrames(stack);
  const app = frames.filter(isAppFrame);
  const first = app[0];
  const location = first ? `${first.fn} (${shortFile(first.file)})`.slice(0, 200) : null;
  const signature = app
    .slice(0, 3)
    .map((f) => f.fn)
    .join('>');
  const short = frames
    .filter((f) => !f.file.includes('node_modules'))
    .slice(0, 8)
    .map((f) => `at ${f.fn} (${shortFile(f.file)})`)
    .join('\n');
  return { location, signature, stack: short ? scrub(short).slice(0, 2000) : null };
}

export interface ErrorRecord {
  fingerprint: string;
  source: string;
  name: string;
  message: string;
  location: string | null;
  context: string | null;
  stack: string | null;
}

/** Gjør en log.error-hendelse om til en rad: feilen hentes fra data.err (Error) eller data.error (tekst). */
export function toErrorRecord(event: string, data: Record<string, unknown> | undefined): ErrorRecord {
  const d = data ?? {};
  const err = d.err ?? d.error;
  const isErr = err instanceof Error;
  const name = (isErr ? err.name : 'Feil').slice(0, 120) || 'Feil';
  const rawMessage = isErr ? err.message : typeof err === 'string' ? err : typeof d.message === 'string' ? d.message : '';
  const message = scrub(String(rawMessage || event)).replace(/\s+/g, ' ').trim().slice(0, 500);
  const info = stackInfo(isErr ? err.stack : undefined);
  const parts: string[] = [];
  if (typeof d.method === 'string') parts.push(d.method.toUpperCase().slice(0, 10));
  if (typeof d.path === 'string') parts.push(normalizePath(d.path));
  for (const k of ['source', 'kind', 'task', 'provider'] as const) {
    if (typeof d[k] === 'string') parts.push(`${k === 'kind' ? 'jobb' : k === 'task' ? 'oppgave' : k === 'source' ? 'kilde' : 'tjeneste'}: ${d[k]}`);
  }
  const context = parts.length ? scrub(parts.join(' ')).slice(0, 200) : null;
  // Sted i koden når det finnes; ellers adressen/jobben, så feil uten stakk ikke blandes sammen.
  const where = info.signature || context || '';
  const fingerprint = createHash('sha256').update([event, name, normalizeMessage(message), where].join('|')).digest('hex').slice(0, 32);
  return { fingerprint, source: event.slice(0, 80), name, message, location: info.location, context, stack: info.stack };
}

// ---------------------------------------------------------------------------
// Lagring (tåler at databasen er nede – logger bare en advarsel)
// ---------------------------------------------------------------------------
const THROTTLE_MS = 5_000;
const MAX_WRITES_PER_MINUTE = 120;
const recent = new Map<string, { at: number; pending: number }>();
let windowStart = 0;
let writesInWindow = 0;
const inFlight = new Set<Promise<void>>();

async function store(rec: ErrorRecord, count: number): Promise<void> {
  await systemSql()`
    insert into app_errors (fingerprint, source, name, message, location, context, stack, count)
    values (${rec.fingerprint}, ${rec.source}, ${rec.name}, ${rec.message}, ${rec.location}, ${rec.context}, ${rec.stack}, ${count})
    on conflict (fingerprint) do update set
      count = case when app_errors.resolved_at is null then app_errors.count + excluded.count else excluded.count end,
      last_seen_at = now(),
      message = excluded.message,
      location = coalesce(excluded.location, app_errors.location),
      context = coalesce(excluded.context, app_errors.context),
      stack = coalesce(excluded.stack, app_errors.stack),
      -- En løst feil som kommer tilbake, åpnes og varsles igjen.
      notified_at = case when app_errors.resolved_at is null then app_errors.notified_at else null end,
      resolved_at = null
  `;
}

/** Registrerer en feil. Kaster aldri; mange like feil på kort tid slås sammen til én skriving. */
export function recordError(event: string, data?: Record<string, unknown>): void {
  try {
    const rec = toErrorRecord(event, data);
    const now = Date.now();
    const seen = recent.get(rec.fingerprint);
    if (seen && now - seen.at < THROTTLE_MS) {
      seen.pending++;
      return;
    }
    if (now - windowStart > 60_000) {
      windowStart = now;
      writesInWindow = 0;
    }
    if (++writesInWindow > MAX_WRITES_PER_MINUTE) return;
    if (recent.size > 1000) recent.clear();
    const count = 1 + (seen?.pending ?? 0);
    recent.set(rec.fingerprint, { at: now, pending: 0 });
    const p: Promise<void> = store(rec, count)
      .catch((e: unknown) => log.warn('error_tracking_failed', { message: e instanceof Error ? e.message : String(e) }))
      .finally(() => inFlight.delete(p));
    inFlight.add(p);
  } catch {
    // Aldri la overvåkingen lage nye feil.
  }
}

/** Venter til alle registreringer er lagret (tester og nedstenging). */
export async function flushErrorTracking(): Promise<void> {
  await Promise.all([...inFlight]);
}

/** Nullstiller sammenslåingen (tester). */
export function resetErrorTrackingThrottle(): void {
  recent.clear();
  writesInWindow = 0;
}

let uninstall: (() => void) | null = null;

/** Kobler feilovervåkingen til log.error. Trygt å kalle flere ganger. */
export function installErrorTracking(): () => void {
  if (!uninstall) {
    const off = onErrorLogged((event, data) => {
      if (event === 'error_tracking_failed') return;
      recordError(event, data);
    });
    uninstall = () => {
      off();
      uninstall = null;
    };
  }
  return uninstall;
}

// ---------------------------------------------------------------------------
// Oppsummering på e-post og admin
// ---------------------------------------------------------------------------
export interface AppErrorRow {
  fingerprint: string;
  source: string;
  name: string;
  message: string;
  location: string | null;
  context: string | null;
  stack: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  notifiedAt: Date | null;
  resolvedAt: Date | null;
}

const TITLES: Record<string, string> = {
  request_failed: 'Side eller skjema feilet',
  worker_tick_failed: 'Bakgrunnsjobbene feilet',
  job_failed: 'Bakgrunnsjobb feilet for godt',
  unhandled_rejection: 'Uventet feil',
  ingest_failed: 'Henting av anbud feilet',
  stripe_webhook_failed: 'Betaling (Stripe) feilet',
  stripe_checkout_failed: 'Betaling (Stripe) feilet',
  stripe_portal_failed: 'Betaling (Stripe) feilet',
  stripe_cancel_failed: 'Betaling (Stripe) feilet',
  email_immediate_failed: 'E-post kunne ikke sendes',
};

export function errorTitle(source: string): string {
  return TITLES[source] ?? source.replace(/_/g, ' ');
}

function osloTime(d: Date): string {
  return new Intl.DateTimeFormat('nb-NO', { timeZone: 'Europe/Oslo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
}

/**
 * Én e-post med nye feil (og feil som fortsatt skjer, høyst én gang i døgnet per feil).
 * Sendes bare når ADMIN_NOTIFICATION_EMAIL er satt; uten den vises feilene bare i admin.
 */
export async function sendErrorDigest(): Promise<{ sent: boolean; errors: number }> {
  const to = env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) return { sent: false, errors: 0 };
  const sql = systemSql();
  const rows = (await sql`
    select fingerprint, source, name, message, location, context, count, last_seen_at, notified_at
    from app_errors
    where resolved_at is null
      and (notified_at is null or (last_seen_at > notified_at and notified_at < now() - interval '24 hours'))
    order by (notified_at is null) desc, count desc, last_seen_at desc
    limit 50
  `) as unknown as Pick<AppErrorRow, 'fingerprint' | 'source' | 'name' | 'message' | 'location' | 'context' | 'count' | 'lastSeenAt' | 'notifiedAt'>[];
  if (!rows.length) return { sent: false, errors: 0 };
  const fresh = rows.filter((r) => !r.notifiedAt).length;
  const title = fresh ? `${fresh} ny${fresh === 1 ? '' : 'e'} feil i appen` : `${rows.length} feil skjer fortsatt i appen`;
  const shown = rows.slice(0, 10);
  const lines = shown.map(
    (r) =>
      `• ${r.notifiedAt ? 'Fortsatt' : 'Ny'}: ${errorTitle(r.source)} – ${r.name}: ${r.message.slice(0, 200)}\n  ${r.count} gang${r.count === 1 ? '' : 'er'}, sist ${osloTime(r.lastSeenAt)}${r.context ? ` · ${r.context}` : ''}${r.location ? ` · ${r.location}` : ''}`,
  );
  if (rows.length > shown.length) lines.push(`… og ${rows.length - shown.length} til.`);
  const details = [
    `${lines.join('\n\n')}`,
    `Se alle og merk som løst: ${env.APP_URL.replace(/\/$/, '')}/admin/feil`,
    'Personopplysninger er fjernet fra feilmeldingene. Du får e-post igjen når en ny feil oppstår, eller høyst én gang i døgnet for feil som fortsetter.',
  ].join('\n\n');
  const fps = rows.map((r) => r.fingerprint);
  const key = createHash('sha256').update(fps.join(',')).digest('hex').slice(0, 16);
  const hour = new Date().toISOString().slice(0, 13);
  await queueEmail({ to, ...adminAlertTemplate(title, details), kind: 'admin_alert', dedupeKey: `error-digest:${hour}:${key}` });
  await sql`update app_errors set notified_at = now() where fingerprint = any(${fps})`;
  return { sent: true, errors: rows.length };
}

/** Åpne feil (nyeste først) og feil løst siste 30 dager. */
export async function listAppErrors(): Promise<{ open: AppErrorRow[]; resolved: AppErrorRow[] }> {
  const rows = (await systemSql()`
    select fingerprint, source, name, message, location, context, stack, count, first_seen_at, last_seen_at, notified_at, resolved_at
    from app_errors
    where resolved_at is null or resolved_at > now() - interval '30 days'
    order by (resolved_at is null) desc, last_seen_at desc
    limit 200
  `) as unknown as AppErrorRow[];
  return { open: rows.filter((r) => !r.resolvedAt), resolved: rows.filter((r) => r.resolvedAt) };
}

export async function resolveAppError(fingerprint: string): Promise<boolean> {
  const rows = await systemSql()`update app_errors set resolved_at = now() where fingerprint = ${fingerprint} and resolved_at is null returning 1`;
  return rows.length > 0;
}

export async function resolveAllAppErrors(): Promise<number> {
  const rows = await systemSql()`update app_errors set resolved_at = now() where resolved_at is null returning 1`;
  return rows.length;
}

/** Antall åpne feil som har skjedd siste døgn (til oversikten i admin). */
export async function openErrorCount(): Promise<number> {
  const [row] = (await systemSql()`
    select count(*)::int as n from app_errors where resolved_at is null and last_seen_at > now() - interval '24 hours'
  `) as unknown as { n: number }[];
  return row?.n ?? 0;
}
