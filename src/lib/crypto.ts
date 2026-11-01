import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { env } from './env';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmacHex(data: string, key = env.SESSION_SECRET): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Pseudonymisert IP for logging og rate limiting (personvern: vi lagrer aldri rå IP). */
export function ipHash(ip: string): string {
  return hmacHex(`ip:${ip}`).slice(0, 24);
}

// ---------------------------------------------------------------------------
// Passord: scrypt (OWASP-anbefalt parametersett N=2^15, r=8, p=3 ≈ 32 MiB minne)
// Format: scrypt$N$r$p$salt$hash (base64url)
// ---------------------------------------------------------------------------
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 3;
const KEYLEN = 32;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P);
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64url');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64url'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Brukes for å jevne ut svartid når brukeren ikke finnes (hindrer brukeroppregning). */
let dummyHash: string | null = null;
export async function dummyPasswordCheck(password: string): Promise<void> {
  dummyHash ??= await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
}
