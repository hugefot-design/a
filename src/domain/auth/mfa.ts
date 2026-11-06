/**
 * Totrinnsinnlogging med kode-app (TOTP). Påkrevd for plattform-administratorer, valgfritt for andre.
 *
 * - Hemmeligheten lagres kryptert (encryptSecret) og endres bare av eier-rollen (systemSql).
 * - Oppsett: en ventende hemmelighet vises som QR-kode og aktiveres først når en gyldig kode er tastet.
 * - Innlogging: etter riktig passord lages en kortvarig utfordring (10 min, maks 5 forsøk, engangs).
 *   Først når koden (eller en passkey, se passkeys.ts) er riktig, opprettes økten. Samme kode kan ikke
 *   brukes to ganger (siste steg lagres).
 * - Reservekoder: 10 engangskoder, lagret som HMAC. Vises bare én gang.
 * - Feil koder telles per bruker på tvers av innlogginger: 10 per 15 min eller 30 per døgn gir pause
 *   (passkey virker fortsatt), og brukeren får et varsel på e-post.
 * - Hver økt husker når totrinn sist ble bekreftet. Admin krever under 12 timer, viktige endringer
 *   under 15 minutter (se /konto/bekreft).
 */
import QRCode from 'qrcode';
import { audit } from '@/lib/audit';
import { systemSql } from '@/lib/db';
import { decryptSecret, encryptSecret, hmacHex, randomToken, sha256Hex, verifyPassword } from '@/lib/crypto';
import { hitRateLimit, rateLimitCount } from '@/lib/rate-limit';
import { base32Encode, generateTotpSecret, otpauthUri, verifyTotp } from '@/lib/totp';
import { randomBytes } from 'node:crypto';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { authenticationOptions, removeAllPasskeys, verifyPasskey, type Binding } from './passkeys';
import { notifySecurityEvent } from './security';

export const CHALLENGE_TTL_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const RECOVERY_CODE_COUNT = 10;
/** En ventende hemmelighet gjenbrukes en stund, så QR-koden ikke endrer seg om siden lastes på nytt. */
const PENDING_REUSE_MINUTES = 30;

/** Admin-panelet ber om ny bekreftelse når det er mer enn 12 timer siden sist. */
export const ADMIN_REVERIFY_MS = 12 * 60 * 60_000;
/** Viktige endringer (tilganger, planer, datakilder, import, passkeys) krever bekreftelse de siste 15 minuttene. */
export const SENSITIVE_REVERIFY_MS = 15 * 60_000;
/** Feil koder per bruker før koden settes på pause. */
export const CODE_FAILURES_PER_15_MIN = 10;
export const CODE_FAILURES_PER_DAY = 30;

/** Kode fra appen / reservekode, eller svaret fra en passkey (JSON fra nettleseren). */
export type SecondFactorInput = { code: string } | { passkey: string };
export type SecondFactorMethod = 'totp' | 'recovery' | 'passkey';
export interface RequestInfo {
  ipHash?: string;
  userAgent?: string;
}

type Row = Record<string, unknown>;
const first = <T>(rows: unknown): T | undefined => (rows as T[])[0];

export interface MfaStatus {
  enabled: boolean;
  enabledAt: Date | null;
  recoveryLeft: number;
}

export async function mfaStatus(userId: string): Promise<MfaStatus> {
  const sql = systemSql();
  const row = first<{ totpEnabledAt: Date | null; left: number }>(
    await sql`
      select u.totp_enabled_at,
        (select count(*)::int from user_recovery_codes r where r.user_id = u.id and r.used_at is null) as left
      from users u where u.id = ${userId}
    `,
  );
  return { enabled: Boolean(row?.totpEnabledAt), enabledAt: row?.totpEnabledAt ?? null, recoveryLeft: row?.left ?? 0 };
}

function normalizeRecovery(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}
const recoveryHash = (code: string) => hmacHex(`recovery:${normalizeRecovery(code)}`);

function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const raw = base32Encode(randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

async function storeRecoveryCodes(userId: string): Promise<string[]> {
  const sql = systemSql();
  const codes = newRecoveryCodes();
  await sql`delete from user_recovery_codes where user_id = ${userId}`;
  for (const c of codes) await sql`insert into user_recovery_codes (user_id, code_hash) values (${userId}, ${recoveryHash(c)})`;
  return codes;
}

// ---------------------------------------------------------------------------
// Oppsett
// ---------------------------------------------------------------------------
export async function beginSetup(userId: string, account: string): Promise<{ secret: string; qrDataUrl: string }> {
  const sql = systemSql();
  const row = first<{ totpPendingEnc: string | null; totpPendingAt: Date | null }>(
    await sql`select totp_pending_enc, totp_pending_at from users where id = ${userId}`,
  );
  let secret: string | null = null;
  if (row?.totpPendingEnc && row.totpPendingAt && Date.now() - row.totpPendingAt.getTime() < PENDING_REUSE_MINUTES * 60_000) {
    try {
      secret = decryptSecret(row.totpPendingEnc);
    } catch {
      secret = null;
    }
  }
  if (!secret) {
    secret = generateTotpSecret();
    await sql`update users set totp_pending_enc = ${encryptSecret(secret)}, totp_pending_at = now() where id = ${userId}`;
  }
  const svg = await QRCode.toString(otpauthUri(account, secret), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#060e1bff', light: '#ffffffff' } });
  return { secret, qrDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
}

export async function confirmSetup(
  userId: string,
  code: string,
  ctx: { keepSessionId: string | null } & RequestInfo,
): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  const sql = systemSql();
  const row = first<{ totpPendingEnc: string | null }>(await sql`select totp_pending_enc from users where id = ${userId}`);
  if (!row?.totpPendingEnc) return { ok: false, error: 'Oppsettet er utløpt. Last inn siden på nytt og skann QR-koden igjen.' };
  const secret = decryptSecret(row.totpPendingEnc);
  const step = verifyTotp(secret, code);
  if (step === null) return { ok: false, error: 'Koden stemmer ikke. Sjekk at klokken på telefonen er riktig, og prøv den nyeste koden.' };
  await sql`
    update users set totp_secret_enc = ${row.totpPendingEnc}, totp_enabled_at = now(), totp_last_step = ${step},
      totp_pending_enc = null, totp_pending_at = null
    where id = ${userId}
  `;
  const recoveryCodes = await storeRecoveryCodes(userId);
  // Andre innlogginger (laget uten totrinn) logges ut. Denne økten har nettopp bevist koden.
  if (ctx.keepSessionId) {
    await sql`delete from sessions where user_id = ${userId} and id <> ${ctx.keepSessionId}`;
    await markSessionVerified(ctx.keepSessionId);
  } else await sql`delete from sessions where user_id = ${userId}`;
  await audit({ action: 'auth.mfa_enabled', actorUserId: userId, targetType: 'user', targetId: userId, ipHash: ctx.ipHash });
  await notifySecurityEvent(userId, 'mfa_enabled', { userAgent: ctx.userAgent });
  return { ok: true, recoveryCodes };
}

/** Kode fra appen eller en reservekode. Oppdaterer siste steg / merker reservekoden som brukt. */
async function checkSecondFactor(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
  const sql = systemSql();
  const row = first<{ totpSecretEnc: string | null; totpLastStep: string | number | null }>(
    await sql`select totp_secret_enc, totp_last_step from users where id = ${userId} and totp_enabled_at is not null`,
  );
  if (!row?.totpSecretEnc) return null;
  const digits = code.replace(/\s/g, '');
  if (/^\d{6}$/.test(digits)) {
    const step = verifyTotp(decryptSecret(row.totpSecretEnc), digits, { lastStep: row.totpLastStep === null ? null : Number(row.totpLastStep) });
    if (step === null) return null;
    // Bare ett vellykket bruk per steg, også ved samtidige forsøk.
    const updated = (await sql`
      update users set totp_last_step = ${step}
      where id = ${userId} and (totp_last_step is null or totp_last_step < ${step})
      returning id
    `) as unknown as Row[];
    return updated.length ? 'totp' : null;
  }
  if (normalizeRecovery(code).length !== 10) return null;
  const used = (await sql`
    update user_recovery_codes set used_at = now()
    where id = (select id from user_recovery_codes where user_id = ${userId} and code_hash = ${recoveryHash(code)} and used_at is null limit 1)
    returning id
  `) as unknown as Row[];
  return used.length ? 'recovery' : null;
}

// ---------------------------------------------------------------------------
// Feil koder per bruker
// ---------------------------------------------------------------------------
const failKeys = (userId: string) => [`mfa-fail:15m:${userId}`, `mfa-fail:24h:${userId}`] as const;

/** For mange feil koder nylig: koden sjekkes ikke (passkey virker fortsatt). */
export async function codesPaused(userId: string): Promise<boolean> {
  const [k15, k24] = failKeys(userId);
  return (await rateLimitCount(k15, 15 * 60)) >= CODE_FAILURES_PER_15_MIN || (await rateLimitCount(k24, 86_400)) >= CODE_FAILURES_PER_DAY;
}

async function recordCodeFailure(userId: string, info: RequestInfo): Promise<void> {
  const [k15, k24] = failKeys(userId);
  const recent = await hitRateLimit(k15, 15 * 60);
  await hitRateLimit(k24, 86_400);
  // Varsle én gang når grensen nås: noen kan kjenne passordet.
  if (recent === CODE_FAILURES_PER_15_MIN) await notifySecurityEvent(userId, 'mfa_failures', { userAgent: info.userAgent });
}

/** Kode eller reservekode, med pause etter for mange feil. */
async function verifyCode(userId: string, code: string, info: RequestInfo): Promise<'totp' | 'recovery' | 'paused' | null> {
  if (await codesPaused(userId)) return 'paused';
  const factor = await checkSecondFactor(userId, code);
  if (!factor) await recordCodeFailure(userId, info);
  return factor;
}

async function verifySecondFactor(userId: string, input: SecondFactorInput, binding: Binding, info: RequestInfo): Promise<SecondFactorMethod | 'paused' | null> {
  if ('passkey' in input) return (await verifyPasskey(userId, binding, input.passkey)) ? 'passkey' : null;
  return verifyCode(userId, input.code, info);
}

export async function disableMfa(userId: string, password: string, code: string, info: RequestInfo = {}): Promise<{ ok: boolean; error?: string }> {
  const sql = systemSql();
  const row = first<{ passwordHash: string; isPlatformAdmin: boolean }>(await sql`select password_hash, is_platform_admin from users where id = ${userId}`);
  if (!row) return { ok: false, error: 'Fant ikke brukeren.' };
  if (row.isPlatformAdmin) return { ok: false, error: 'Administratorer må ha totrinnsinnlogging.' };
  if (!(await verifyPassword(password, row.passwordHash))) return { ok: false, error: 'Feil passord.' };
  const factor = await verifyCode(userId, code, info);
  if (factor === 'paused') return { ok: false, error: 'For mange feil koder. Vent 15 minutter og prøv igjen.' };
  if (!factor) return { ok: false, error: 'Koden stemmer ikke.' };
  await sql`
    update users set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null, totp_pending_enc = null, totp_pending_at = null
    where id = ${userId}
  `;
  await sql`delete from user_recovery_codes where user_id = ${userId}`;
  await removeAllPasskeys(userId);
  await sql`update sessions set mfa_verified_at = null where user_id = ${userId}`;
  await audit({ action: 'auth.mfa_disabled', actorUserId: userId, targetType: 'user', targetId: userId, ipHash: info.ipHash });
  await notifySecurityEvent(userId, 'mfa_disabled', { userAgent: info.userAgent });
  return { ok: true };
}

export async function regenerateRecoveryCodes(userId: string, code: string, info: RequestInfo = {}): Promise<{ ok: true; recoveryCodes: string[] } | { ok: false; error: string }> {
  // Bare koder fra appen: en reservekode her ville blitt brukt opp uten grunn.
  if (!/^\d{6}$/.test(code.replace(/\s/g, ''))) return { ok: false, error: 'Skriv inn den sekssifrede koden fra appen (ikke en reservekode).' };
  const factor = await verifyCode(userId, code, info);
  if (factor === 'paused') return { ok: false, error: 'For mange feil koder. Vent 15 minutter og prøv igjen.' };
  if (factor !== 'totp') return { ok: false, error: 'Koden stemmer ikke. Prøv den nyeste koden i appen.' };
  const recoveryCodes = await storeRecoveryCodes(userId);
  await audit({ action: 'auth.mfa_recovery_regenerated', actorUserId: userId, targetType: 'user', targetId: userId, ipHash: info.ipHash });
  return { ok: true, recoveryCodes };
}

// ---------------------------------------------------------------------------
// Innlogging: utfordring etter riktig passord
// ---------------------------------------------------------------------------
export async function createLoginChallenge(userId: string, nextPath: string | null): Promise<string> {
  const sql = systemSql();
  await sql`delete from login_challenges where expires_at < now() - interval '1 hour' or user_id = ${userId}`;
  const token = randomToken(32);
  await sql`
    insert into login_challenges (user_id, token_hash, next_path, expires_at)
    values (${userId}, ${sha256Hex(token)}, ${nextPath}, now() + make_interval(mins => ${CHALLENGE_TTL_MINUTES}))
  `;
  return token;
}

async function findChallenge(token: string): Promise<{ id: string; userId: string; nextPath: string | null; attempts: number } | undefined> {
  if (!token || token.length > 100) return undefined;
  return first(await systemSql()`select id, user_id, next_path, attempts from login_challenges where token_hash = ${sha256Hex(token)} and expires_at > now()`);
}

/** Valg for passkey på kodesiden, eller null om brukeren ikke har passkeys (eller utfordringen er ugyldig). */
export async function loginPasskeyOptions(token: string): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const ch = await findChallenge(token);
  return ch ? authenticationOptions(ch.userId, { loginChallengeId: ch.id }) : null;
}

export type ChallengeResult =
  | { ok: true; userId: string; nextPath: string | null; method: SecondFactorMethod }
  | { ok: false; reason: 'expired' | 'invalid' | 'too_many' | 'paused'; attemptsLeft?: number };

export async function verifyLoginChallenge(token: string, input: SecondFactorInput, info: RequestInfo = {}): Promise<ChallengeResult> {
  const ch = await findChallenge(token);
  if (!ch) return { ok: false, reason: 'expired' };
  const sql = systemSql();
  if (ch.attempts >= MAX_CODE_ATTEMPTS) {
    await sql`delete from login_challenges where id = ${ch.id}`;
    return { ok: false, reason: 'too_many' };
  }
  const method = await verifySecondFactor(ch.userId, input, { loginChallengeId: ch.id }, info);
  if (method === 'paused') return { ok: false, reason: 'paused' };
  if (!method) {
    const [row] = (await sql`update login_challenges set attempts = attempts + 1 where id = ${ch.id} returning attempts`) as unknown as { attempts: number }[];
    await audit({ action: 'auth.mfa_failed', actorUserId: ch.userId, targetType: 'user', targetId: ch.userId, ipHash: info.ipHash, metadata: { passkey: 'passkey' in input } });
    const left = MAX_CODE_ATTEMPTS - (row?.attempts ?? MAX_CODE_ATTEMPTS);
    if (left <= 0) {
      await sql`delete from login_challenges where id = ${ch.id}`;
      return { ok: false, reason: 'too_many' };
    }
    return { ok: false, reason: 'invalid', attemptsLeft: left };
  }
  await sql`delete from login_challenges where id = ${ch.id}`;
  await audit({
    action: method === 'recovery' ? 'auth.mfa_recovery_used' : 'auth.mfa_verified',
    actorUserId: ch.userId,
    targetType: 'user',
    targetId: ch.userId,
    ipHash: info.ipHash,
    metadata: { method },
  });
  return { ok: true, userId: ch.userId, nextPath: ch.nextPath, method };
}

// ---------------------------------------------------------------------------
// Ny bekreftelse i en økt (admin hver 12. time, viktige endringer innen 15 minutter)
// ---------------------------------------------------------------------------
export function verifiedWithin(verifiedAt: Date | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  if (!verifiedAt) return false;
  const age = now - verifiedAt.getTime();
  return age >= -60_000 && age <= maxAgeMs;
}

export async function markSessionVerified(sessionId: string): Promise<void> {
  await systemSql()`update sessions set mfa_verified_at = now() where id = ${sessionId}`;
}

/** Valg for passkey på bekreftelsessiden, eller null om brukeren ikke har passkeys. */
export async function stepUpPasskeyOptions(userId: string, sessionId: string): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  return authenticationOptions(userId, { sessionId });
}

export async function verifyStepUp(
  userId: string,
  sessionId: string,
  input: SecondFactorInput,
  info: RequestInfo = {},
): Promise<{ ok: true; method: SecondFactorMethod } | { ok: false; reason: 'invalid' | 'paused' }> {
  const method = await verifySecondFactor(userId, input, { sessionId }, info);
  if (method === 'paused') return { ok: false, reason: 'paused' };
  if (!method) {
    await audit({ action: 'auth.mfa_failed', actorUserId: userId, targetType: 'user', targetId: userId, ipHash: info.ipHash, metadata: { stepUp: true, passkey: 'passkey' in input } });
    return { ok: false, reason: 'invalid' };
  }
  await markSessionVerified(sessionId);
  await audit({
    action: method === 'recovery' ? 'auth.mfa_recovery_used' : 'auth.mfa_verified',
    actorUserId: userId,
    targetType: 'user',
    targetId: userId,
    ipHash: info.ipHash,
    metadata: { stepUp: true, method },
  });
  return { ok: true, method };
}

/** Har brukeren slått på totrinnsinnlogging? (Brukes i innloggingen før økten lages.) */
export async function hasMfa(userId: string): Promise<boolean> {
  const row = first<{ on: boolean }>(await systemSql()`select totp_enabled_at is not null as on from users where id = ${userId}`);
  return Boolean(row?.on);
}
