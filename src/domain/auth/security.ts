/**
 * Sikkerhetsvarsler på e-post og «logg ut alle enheter».
 *
 * - Innlogging på en administratorkonto varsles når den skjer fra en ny enhet eller en ny IP-adresse
 *   (sammenlignet med administratorens egne innlogginger de siste 90 dagene, etter siste «logg ut alle»
 *   eller passordbytte). Innlogging med reservekode eller uten totrinn varsles alltid.
 * - Mange feil koder etter riktig passord varsles (passordet kan være kjent for andre).
 * - Ny eller fjernet innloggingsmetode (kode-app, passkey) varsles.
 * Alle varsler har en signert lenke (gjelder i 7 dager) som logger ut alle enheter for kontoen.
 * Lenken gjør ingenting ved et vanlig klikk/forhåndsvisning – brukeren må trykke en knapp.
 */
import { isIPv6 } from 'node:net';
import { audit } from '@/lib/audit';
import { hmacHex, safeEqual } from '@/lib/crypto';
import { systemSql } from '@/lib/db';
import { describeDevice } from '@/lib/device';
import { sendEmailSoon } from '@/lib/email';
import { isProd } from '@/lib/env';
import { log } from '@/lib/logger';
import { absoluteUrl, securityNoticeTemplate } from '@/domain/email/templates';

export const REVOKE_LINK_DAYS = 7;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ---------------------------------------------------------------------------
// «Logg ut alle enheter»-lenken
// ---------------------------------------------------------------------------
export function revokeAllToken(userId: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + REVOKE_LINK_DAYS * 86_400;
  return `${userId}.${exp}.${hmacHex(`revoke-all:${userId}:${exp}`)}`;
}

/** Bruker-ID-en lenken gjelder, eller null om den er ugyldig eller utløpt. */
export function verifyRevokeAllToken(token: string | null | undefined, now = Date.now()): string | null {
  if (!token || token.length > 200) return null;
  const [userId = '', expRaw = '', sig = ''] = token.split('.');
  const exp = Number(expRaw);
  if (!UUID_RE.test(userId) || !Number.isInteger(exp) || exp * 1000 < now) return null;
  return safeEqual(sig, hmacHex(`revoke-all:${userId}:${exp}`)) ? userId : null;
}

export function revokeAllUrl(userId: string): string {
  return absoluteUrl(`/konto/logg-ut-overalt?token=${encodeURIComponent(revokeAllToken(userId))}`);
}

/** Logger ut alle enheter og stopper påbegynte innlogginger. Returnerer antall økter som ble avsluttet. */
export async function revokeAllSessions(userId: string, ipHash?: string): Promise<number> {
  const sql = systemSql();
  const rows = (await sql`delete from sessions where user_id = ${userId} returning id`) as unknown as unknown[];
  await sql`delete from login_challenges where user_id = ${userId}`;
  await audit({ action: 'auth.sessions_revoked', actorUserId: userId, targetType: 'user', targetId: userId, ipHash, metadata: { via: 'email_link', count: rows.length } });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Varsler
// ---------------------------------------------------------------------------
export type SecurityEvent = 'admin_login' | 'mfa_failures' | 'mfa_enabled' | 'mfa_disabled' | 'passkey_added' | 'passkey_removed';

/** Hvordan andre steg ble gjort ved innlogging. */
export type LoginMethod = 'totp' | 'recovery' | 'passkey' | 'password_only';

const METHOD_LABEL: Record<LoginMethod, string> = {
  totp: 'Passord og kode fra appen',
  recovery: 'Passord og en reservekode',
  passkey: 'Passord og passkey (Face ID, fingeravtrykk eller nøkkel)',
  password_only: 'Bare passord – totrinn er ikke satt opp ennå',
};

// ---------------------------------------------------------------------------
// Kjente enheter og IP-adresser (bare administratorer)
// ---------------------------------------------------------------------------
/** Informasjonskapsel som kjenner igjen enheten. Verdien er en tilfeldig nøkkel; vi lagrer bare en hash av den. */
export const DEVICE_COOKIE = isProd ? '__Host-ar_enhet' : 'ar_enhet';
export const DEVICE_COOKIE_DAYS = 365;
/** Så lenge regnes en enhet eller IP-adresse som kjent etter siste innlogging derfra. */
export const KNOWN_LOGIN_DAYS = 90;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{32,64}$/;

/** Enhetsnøkkelen fra informasjonskapselen, eller null hvis den mangler eller er ugyldig. */
export function validDeviceId(value: string | undefined): string | null {
  return value && DEVICE_ID_RE.test(value) ? value : null;
}

/**
 * Nettet en IP-adresse hører til. IPv4: hele adressen. IPv6: de første 64 bitene – enheter bytter resten
 * av adressen ofte (personvernadresser), mens nettet hjemme eller på kontoret er det samme.
 */
export function networkKey(ip: string): string {
  const raw = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1]!;
  const addr = raw.split('%')[0]!;
  if (!isIPv6(addr)) return raw;
  const groups = (s: string) => (s ? s.split(':').flatMap((g) => (g.includes('.') ? ['0', '0'] : [g])) : []);
  const [head = '', tail] = addr.split('::');
  const h = groups(head);
  const t = tail === undefined ? [] : groups(tail);
  const all = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${all.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

const shortHash = (kind: string, value: string) => hmacHex(`${kind}:${value}`).slice(0, 24);

/** Hvorfor en administrator-innlogging varsles. */
export type LoginNoticeReason = 'new_device' | 'new_network' | 'new_device_and_network' | 'recovery_code' | 'no_mfa';

const REASON_LABEL: Record<LoginNoticeReason, string> = {
  new_device: 'Ny enhet eller nettleser',
  new_network: 'Ny IP-adresse',
  new_device_and_network: 'Ny enhet og ny IP-adresse',
  recovery_code: 'Innlogging med reservekode',
  no_mfa: 'Totrinn er ikke satt opp',
};

/** Varsel bare ved ny enhet eller ny IP-adresse – men alltid ved reservekode og uten totrinn. null = ingen e-post. */
export function loginNoticeReason(method: LoginMethod, known: { device: boolean; network: boolean }): LoginNoticeReason | null {
  if (method === 'password_only') return 'no_mfa';
  if (method === 'recovery') return 'recovery_code';
  if (!known.device && !known.network) return 'new_device_and_network';
  if (!known.device) return 'new_device';
  if (!known.network) return 'new_network';
  return null;
}

/**
 * Har administratoren logget inn fra denne enheten og fra dette nettet før? Teller bare innlogginger de siste
 * 90 dagene og etter siste «logg ut alle enheter» eller passordbytte – da varsles alt på nytt.
 */
async function knownLogin(userId: string, device: string, net: string): Promise<{ device: boolean; network: boolean }> {
  const [row] = (await systemSql()`
    select coalesce(bool_or(metadata->>'device' = ${device}), false) as device,
           coalesce(bool_or(metadata->>'net' = ${net}), false) as network
    from audit_logs
    where action = 'auth.admin_login' and actor_user_id = ${userId}
      and created_at > now() - make_interval(days => ${KNOWN_LOGIN_DAYS})
      and created_at > coalesce((
        select max(created_at) from audit_logs
        where action in ('auth.sessions_revoked', 'auth.password_changed', 'auth.password_reset')
          and (actor_user_id = ${userId} or target_id = ${userId})
      ), '-infinity'::timestamptz)
  `) as unknown as { device: boolean; network: boolean }[];
  return { device: row?.device ?? false, network: row?.network ?? false };
}

/**
 * Etter fullført innlogging på en administratorkonto: lagrer enhet og nett (bare som hash) i revisjonsloggen og
 * sender e-post når enheten eller IP-adressen er ny. Feiler oppslaget, sendes varselet – heller én e-post for mye.
 */
export async function noticeAdminLogin(
  userId: string,
  info: { method: LoginMethod; deviceId: string; ip: string; ipHash?: string; userAgent?: string; now?: Date },
): Promise<LoginNoticeReason | null> {
  const device = shortHash('device', info.deviceId);
  const net = shortHash('net', networkKey(info.ip));
  let known = { device: false, network: false };
  try {
    known = await knownLogin(userId, device, net);
  } catch (err) {
    log.error('admin_login_lookup_failed', { err });
  }
  const reason = loginNoticeReason(info.method, known);
  await audit({ action: 'auth.admin_login', actorUserId: userId, targetType: 'user', targetId: userId, ipHash: info.ipHash, metadata: { method: info.method, device, net, notice: reason } });
  if (reason) await notifySecurityEvent(userId, 'admin_login', { userAgent: info.userAgent, method: info.method, reason, now: info.now });
  return reason;
}

const osloTime = new Intl.DateTimeFormat('nb-NO', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Oslo' });

interface EventText {
  subject: string;
  intro: string;
}

function eventText(event: SecurityEvent): EventText {
  switch (event) {
    case 'admin_login':
      return { subject: 'Ny innlogging i admin-panelet', intro: 'Noen logget nettopp inn på administratorkontoen din hos AnbudRadar.' };
    case 'mfa_failures':
      return {
        subject: 'Mange feil koder på kontoen din',
        intro:
          'Noen har skrevet riktig passord, men feil kode fra kode-appen mange ganger. Passordet ditt kan være kjent for andre. Innlogging med kode er satt på pause i 15 minutter.',
      };
    case 'mfa_enabled':
      return { subject: 'Totrinnsinnlogging er slått på', intro: 'Totrinnsinnlogging med kode-app ble slått på for kontoen din.' };
    case 'mfa_disabled':
      return { subject: 'Totrinnsinnlogging er slått av', intro: 'Totrinnsinnlogging ble slått av for kontoen din. Nå holder passordet alene for å logge inn.' };
    case 'passkey_added':
      return { subject: 'Ny passkey lagt til', intro: 'En ny passkey (Face ID, fingeravtrykk eller sikkerhetsnøkkel) ble lagt til som innloggingsmetode på kontoen din.' };
    case 'passkey_removed':
      return { subject: 'En passkey er fjernet', intro: 'En passkey ble fjernet fra kontoen din.' };
  }
}

/**
 * Sender et sikkerhetsvarsel til kontoens e-postadresse. Feiler aldri forespørselen: e-posten legges i
 * utboksen og sendes straks, eller av arbeideren senere.
 */
export async function notifySecurityEvent(
  userId: string,
  event: SecurityEvent,
  info: { userAgent?: string; method?: LoginMethod; reason?: LoginNoticeReason; passkeyName?: string; now?: Date } = {},
): Promise<void> {
  try {
    const [user] = (await systemSql()`select email, name from users where id = ${userId}`) as unknown as { email: string; name: string }[];
    if (!user) return;
    const now = info.now ?? new Date();
    const text = eventText(event);
    const details: [string, string][] = [];
    if (info.passkeyName) details.push(['Passkey', info.passkeyName]);
    details.push(['Tid', osloTime.format(now)]);
    details.push(['Enhet', describeDevice(info.userAgent).label]);
    if (info.method) details.push(['Innlogging', METHOD_LABEL[info.method]]);
    if (info.reason) details.push(['Varslet fordi', REASON_LABEL[info.reason]]);
    const tpl = securityNoticeTemplate({ name: user.name, subject: text.subject, heading: text.subject, intro: text.intro, details, revokeUrl: revokeAllUrl(userId) });
    // Bare ett varsel om feil koder i timen.
    const dedupeKey = event === 'mfa_failures' ? `mfa_failures:${userId}:${now.toISOString().slice(0, 13)}` : undefined;
    await sendEmailSoon({ to: user.email, ...tpl, kind: `security_${event}`, userId, dedupeKey });
  } catch (err) {
    log.error('security_notice_failed', { event, err });
  }
}
