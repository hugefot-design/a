import { hmacHex, safeEqual } from '@/lib/crypto';
import { isProd } from '@/lib/env';
import { serializeCookie, type Flash, type RequestContext } from './http';

export const FLASH_COOKIE = 'ar_flash';

export function encodeFlash(flash: Flash): string {
  const payload = Buffer.from(JSON.stringify(flash)).toString('base64url');
  return `${payload}.${hmacHex(`flash:${payload}`).slice(0, 32)}`;
}

export function decodeFlash(value: string | undefined): Flash | null {
  if (!value) return null;
  const [payload, sig] = value.split('.');
  if (!payload || !sig || !safeEqual(sig, hmacHex(`flash:${payload}`).slice(0, 32))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Flash;
    if (typeof parsed.message !== 'string' || !['success', 'error', 'info'].includes(parsed.type)) return null;
    return { type: parsed.type, message: parsed.message.slice(0, 500) };
  } catch {
    return null;
  }
}

/** Setter en melding som vises på neste side (etter omdirigering). */
export function setFlash(ctx: RequestContext, type: Flash['type'], message: string): void {
  ctx.responseCookies.push(serializeCookie(FLASH_COOKIE, encodeFlash({ type, message }), { maxAge: 60, secure: isProd }));
}

/** Omdiriger med en melding. */
export function redirectWith(ctx: RequestContext, location: string, type: Flash['type'], message: string): Response {
  setFlash(ctx, type, message);
  return new Response(null, { status: 303, headers: { Location: location } });
}
