/**
 * Sikkerhetsvarsler på e-post og «logg ut alle enheter».
 *
 * - Hver innlogging på en administratorkonto varsles (tid, enhet, metode).
 * - Mange feil koder etter riktig passord varsles (passordet kan være kjent for andre).
 * - Ny eller fjernet innloggingsmetode (kode-app, passkey) varsles.
 * Alle varsler har en signert lenke (gjelder i 7 dager) som logger ut alle enheter for kontoen.
 * Lenken gjør ingenting ved et vanlig klikk/forhåndsvisning – brukeren må trykke en knapp.
 */
import { audit } from '@/lib/audit';
import { hmacHex, safeEqual } from '@/lib/crypto';
import { systemSql } from '@/lib/db';
import { describeDevice } from '@/lib/device';
import { sendEmailSoon } from '@/lib/email';
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
  info: { userAgent?: string; method?: LoginMethod; passkeyName?: string; now?: Date } = {},
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
    const tpl = securityNoticeTemplate({ name: user.name, subject: text.subject, heading: text.subject, intro: text.intro, details, revokeUrl: revokeAllUrl(userId) });
    // Bare ett varsel om feil koder i timen.
    const dedupeKey = event === 'mfa_failures' ? `mfa_failures:${userId}:${now.toISOString().slice(0, 13)}` : undefined;
    await sendEmailSoon({ to: user.email, ...tpl, kind: `security_${event}`, userId, dedupeKey });
  } catch (err) {
    log.error('security_notice_failed', { event, err });
  }
}
