/**
 * Avmelding fra varsel-e-post med ett klikk (RFC 8058). Lenken er signert (HMAC) og gjelder én
 * bruker i én organisasjon. Ingen lagring – signaturen er beviset. Betalings- og sikkerhets-e-post
 * (bekreftelse, passord, mislykket betaling) har ikke avmelding, fordi de er nødvendige for kontoen.
 */
import { hmacHex, safeEqual } from '@/lib/crypto';
import { absoluteUrl } from './templates';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function unsubscribeToken(userId: string, orgId: string): string {
  const payload = Buffer.from(`${userId}:${orgId}`).toString('base64url');
  return `${payload}.${hmacHex(`unsubscribe:${userId}:${orgId}`).slice(0, 32)}`;
}

export function verifyUnsubscribeToken(token: string | null | undefined): { userId: string; orgId: string } | null {
  if (!token || token.length > 200) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [userId, orgId] = decoded.split(':');
  if (!userId || !orgId || !UUID.test(userId) || !UUID.test(orgId)) return null;
  if (!safeEqual(sig, hmacHex(`unsubscribe:${userId}:${orgId}`).slice(0, 32))) return null;
  return { userId, orgId };
}

export function unsubscribeUrl(userId: string, orgId: string): string {
  return absoluteUrl(`/avmeld?t=${encodeURIComponent(unsubscribeToken(userId, orgId))}`);
}

/** Headere som gir «Meld av»-knapp i Gmail, Outlook m.fl. */
export function listUnsubscribeHeaders(userId: string, orgId: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(userId, orgId)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
