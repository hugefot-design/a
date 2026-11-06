/**
 * Engangskoder fra en kode-app (TOTP, RFC 6238): SHA-1, 6 sifre, 30 sekunder – det alle vanlige
 * apper bruker (Google Authenticator, Microsoft Authenticator, 1Password …). Ingen ekstern avhengighet.
 */
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Ugyldig base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Ny hemmelighet: 20 tilfeldige byte (160 bit), som RFC 4226 anbefaler. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Koden for et gitt 30-sekunders steg. `digits` kan settes for testvektorene i RFC 6238. */
export function totpAt(secretBase32: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function currentStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD);
}

/**
 * Sjekker en kode mot forrige, nåværende og neste steg (klokker går litt feil).
 * Returnerer steget koden gjelder, eller null. Steg som allerede er brukt (lastStep), avvises.
 */
export function verifyTotp(secretBase32: string, code: string, opts: { now?: number; lastStep?: number | null } = {}): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const now = currentStep(opts.now);
  for (const step of [now - 1, now, now + 1]) {
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    const expected = totpAt(secretBase32, step);
    // Lik lengde og konstant tid er ikke kritisk for 6 sifre med forsøksgrense, men koster ingenting.
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ digits.charCodeAt(i);
    if (diff === 0) return step;
  }
  return null;
}

/** Adressen kode-appene leser fra QR-koden. */
export function otpauthUri(account: string, secretBase32: string, issuer = 'AnbudRadar'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD) });
  return `otpauth://totp/${label}?${params}`;
}
