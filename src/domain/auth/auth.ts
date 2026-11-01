import { z } from 'zod';
import { appSql, first, systemSql } from '@/lib/db';
import { dummyPasswordCheck, hashPassword, randomToken, sha256Hex, verifyPassword } from '@/lib/crypto';
import { isProd } from '@/lib/env';
import { sendEmailSoon } from '@/lib/email';
import { audit } from '@/lib/audit';
import { rateLimit, resetRateLimit } from '@/lib/rate-limit';
import { absoluteUrl, passwordResetTemplate, verifyEmailTemplate } from '@/domain/email/templates';
import type { AuthUser } from '@/server/http';

export const SESSION_COOKIE = isProd ? '__Host-ar_session' : 'ar_session';
export const SESSION_TTL_DAYS = 30;
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;

// ---------------------------------------------------------------------------
// Validering
// ---------------------------------------------------------------------------
const COMMON_PASSWORDS = new Set([
  'passord123', 'passord1234', 'password123', 'password1234', '1234567890', 'qwertyuiop', 'sommer2024',
  'sommer2025', 'sommer2026', 'vinter2025', 'vinter2026', 'abcdefghij', 'passordpassord', 'iloveyou12',
]);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Skriv inn e-postadressen din.')
  .max(254, 'E-postadressen er for lang.')
  .email('Skriv inn en gyldig e-postadresse.');

export const passwordSchema = z
  .string()
  .min(10, 'Passordet må ha minst 10 tegn.')
  .max(200, 'Passordet kan ha maks 200 tegn.')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), 'Passordet er for vanlig. Velg et annet.');

export const nameSchema = z.string().trim().min(1, 'Skriv inn navnet ditt.').max(120, 'Navnet er for langt.');

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal('on', { errorMap: () => ({ message: 'Du må godta vilkårene for å opprette konto.' }) }),
});

export type FieldErrors = Record<string, string>;

export function zodErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sesjoner
// ---------------------------------------------------------------------------
interface UserRow {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
  isPlatformAdmin: boolean;
  currentOrgId: string | null;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerifiedAt !== null,
    isPlatformAdmin: row.isPlatformAdmin,
    currentOrgId: row.currentOrgId,
  };
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ipHash?: string },
): Promise<{ token: string; csrfToken: string; sessionId: string }> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const rows = (await appSql()`
    insert into sessions (user_id, token_hash, csrf_token, expires_at, user_agent, ip_hash)
    values (${userId}, ${sha256Hex(token)}, ${csrfToken}, now() + make_interval(days => ${SESSION_TTL_DAYS}),
            ${(meta.userAgent ?? '').slice(0, 300)}, ${meta.ipHash ?? null})
    returning id
  `) as unknown as { id: string }[];
  return { token, csrfToken, sessionId: rows[0]!.id };
}

export interface SessionLookup {
  sessionId: string;
  csrfToken: string;
  user: AuthUser;
}

export async function getSession(token: string): Promise<SessionLookup | null> {
  if (!token || token.length > 100) return null;
  const sql = appSql();
  const row = first(
    (await sql`
      select s.id as session_id, s.csrf_token, s.last_seen_at, s.created_at as session_created_at,
             u.id, u.email, u.name, u.email_verified_at, u.is_platform_admin, u.current_org_id, u.password_changed_at
      from sessions s join users u on u.id = s.user_id
      where s.token_hash = ${sha256Hex(token)} and s.expires_at > now()
    `) as unknown as (UserRow & {
      sessionId: string;
      csrfToken: string;
      lastSeenAt: Date;
      sessionCreatedAt: Date;
      passwordChangedAt: Date;
    })[],
  );
  if (!row) return null;
  // Sesjoner opprettet før siste passordbytte er ugyldige.
  if (row.sessionCreatedAt < row.passwordChangedAt) {
    await sql`delete from sessions where id = ${row.sessionId}`;
    return null;
  }
  // Glidende utløp: forleng når sesjonen er i aktiv bruk (maks én skriving per 10 min).
  if (Date.now() - row.lastSeenAt.getTime() > 10 * 60 * 1000) {
    await sql`
      update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_TTL_DAYS})
      where id = ${row.sessionId}
    `;
  }
  return { sessionId: row.sessionId, csrfToken: row.csrfToken, user: toAuthUser(row) };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await appSql()`delete from sessions where id = ${sessionId}`;
}

export async function deleteOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const rows = await appSql()`delete from sessions where user_id = ${userId} and id <> ${keepSessionId} returning id`;
  return rows.length;
}

// ---------------------------------------------------------------------------
// Registrering og innlogging
// ---------------------------------------------------------------------------
export async function registerUser(input: { name: string; email: string; password: string }, ipHash?: string) {
  const sql = appSql();
  const existing = first(await sql`select id from users where email = ${input.email}`);
  if (existing) {
    return { ok: false as const, errors: { email: 'Det finnes allerede en konto med denne e-postadressen.' } };
  }
  const passwordHash = await hashPassword(input.password);
  const rows = (await sql`
    insert into users (email, name, password_hash) values (${input.email}, ${input.name}, ${passwordHash})
    on conflict (email) do nothing
    returning id, email, name, email_verified_at, is_platform_admin, current_org_id
  `) as unknown as UserRow[];
  const row = rows[0];
  if (!row) return { ok: false as const, errors: { email: 'Det finnes allerede en konto med denne e-postadressen.' } };
  await audit({ action: 'auth.register', actorUserId: row.id, targetType: 'user', targetId: row.id, ipHash });
  await sendVerificationEmail(row.id, row.email, row.name);
  return { ok: true as const, user: toAuthUser(row) };
}

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: 'invalid' | 'locked' | 'rate_limited' };

export async function authenticate(emailRaw: string, password: string, ipHash: string): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const allowedIp = await rateLimit(`login:ip:${ipHash}`, 30, 15 * 60);
  const allowedEmail = await rateLimit(`login:email:${sha256Hex(email)}`, 15, 15 * 60);
  if (!allowedIp || !allowedEmail) return { ok: false, reason: 'rate_limited' };

  const sql = appSql();
  const row = first(
    (await sql`
      select id, email, name, email_verified_at, is_platform_admin, current_org_id, password_hash, locked_until
      from users where email = ${email}
    `) as unknown as (UserRow & { passwordHash: string; lockedUntil: Date | null })[],
  );
  if (!row) {
    await dummyPasswordCheck(password);
    return { ok: false, reason: 'invalid' };
  }
  if (row.lockedUntil && row.lockedUntil > new Date()) {
    return { ok: false, reason: 'locked' };
  }
  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) {
    await sql`
      update users set failed_login_count = failed_login_count + 1,
        locked_until = case when failed_login_count + 1 >= ${MAX_FAILED_LOGINS}
                            then now() + make_interval(mins => ${LOCK_MINUTES}) else locked_until end
      where id = ${row.id}
    `;
    await audit({ action: 'auth.login_failed', actorUserId: row.id, targetType: 'user', targetId: row.id, ipHash });
    return { ok: false, reason: 'invalid' };
  }
  await sql`update users set failed_login_count = 0, locked_until = null, last_login_at = now() where id = ${row.id}`;
  await resetRateLimit(`login:email:${sha256Hex(email)}`);
  await audit({ action: 'auth.login', actorUserId: row.id, targetType: 'user', targetId: row.id, ipHash });
  return { ok: true, user: toAuthUser(row) };
}

// ---------------------------------------------------------------------------
// E-posttokens (bekreftelse og tilbakestilling)
// ---------------------------------------------------------------------------
async function createEmailToken(userId: string, email: string, purpose: 'verify_email' | 'reset_password', ttlMinutes: number) {
  const token = randomToken(32);
  const sql = appSql();
  // Ugyldiggjør tidligere ubrukte tokens av samme type.
  await sql`update email_tokens set used_at = now() where user_id = ${userId} and purpose = ${purpose} and used_at is null`;
  await sql`
    insert into email_tokens (user_id, purpose, token_hash, email, expires_at)
    values (${userId}, ${purpose}, ${sha256Hex(token)}, ${email}, now() + make_interval(mins => ${ttlMinutes}))
  `;
  return token;
}

async function consumeEmailToken(token: string, purpose: 'verify_email' | 'reset_password') {
  if (!token || token.length > 100) return null;
  const rows = (await appSql()`
    update email_tokens set used_at = now()
    where token_hash = ${sha256Hex(token)} and purpose = ${purpose} and used_at is null and expires_at > now()
    returning user_id, email
  `) as unknown as { userId: string; email: string }[];
  return rows[0] ?? null;
}

export async function sendVerificationEmail(userId: string, email: string, name: string): Promise<void> {
  const token = await createEmailToken(userId, email, 'verify_email', 24 * 60);
  const tpl = verifyEmailTemplate(name, absoluteUrl(`/bekreft-epost?token=${encodeURIComponent(token)}`));
  await sendEmailSoon({ to: email, ...tpl, kind: 'verify_email', userId });
}

export async function verifyEmailToken(token: string): Promise<{ userId: string } | null> {
  const consumed = await consumeEmailToken(token, 'verify_email');
  if (!consumed) return null;
  const rows = await appSql()`
    update users set email_verified_at = coalesce(email_verified_at, now())
    where id = ${consumed.userId} and email = ${consumed.email}
    returning id
  `;
  if (!rows.length) return null;
  await audit({ action: 'auth.email_verified', actorUserId: consumed.userId, targetType: 'user', targetId: consumed.userId });
  return { userId: consumed.userId };
}

export async function requestPasswordReset(emailRaw: string, ipHash: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const allowed = await rateLimit(`reset:${ipHash}`, 10, 60 * 60);
  const allowedEmail = await rateLimit(`reset:email:${sha256Hex(email)}`, 3, 60 * 60);
  if (!allowed || !allowedEmail) return;
  const user = first((await appSql()`select id, name, email from users where email = ${email}`) as unknown as UserRow[]);
  if (!user) return; // Samme svar uansett – ingen brukeroppregning.
  const token = await createEmailToken(user.id, user.email, 'reset_password', 60);
  const tpl = passwordResetTemplate(user.name, absoluteUrl(`/tilbakestill-passord?token=${encodeURIComponent(token)}`));
  await sendEmailSoon({ to: user.email, ...tpl, kind: 'reset_password', userId: user.id });
  await audit({ action: 'auth.password_reset_requested', actorUserId: user.id, targetType: 'user', targetId: user.id, ipHash });
}

export async function peekResetToken(token: string): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const rows = await appSql()`
    select 1 from email_tokens where token_hash = ${sha256Hex(token)} and purpose = 'reset_password'
      and used_at is null and expires_at > now()
  `;
  return rows.length > 0;
}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const consumed = await consumeEmailToken(token, 'reset_password');
  if (!consumed) return false;
  const hash = await hashPassword(newPassword);
  const sql = appSql();
  await sql`
    update users set password_hash = ${hash}, password_changed_at = now(), failed_login_count = 0, locked_until = null,
      email_verified_at = coalesce(email_verified_at, now())
    where id = ${consumed.userId}
  `;
  await sql`delete from sessions where user_id = ${consumed.userId}`;
  await audit({ action: 'auth.password_reset', actorUserId: consumed.userId, targetType: 'user', targetId: consumed.userId });
  return true;
}

export async function changePassword(userId: string, current: string, next: string, keepSessionId: string) {
  const sql = appSql();
  const row = first((await sql`select password_hash from users where id = ${userId}`) as unknown as { passwordHash: string }[]);
  if (!row || !(await verifyPassword(current, row.passwordHash))) {
    return { ok: false as const, errors: { currentPassword: 'Nåværende passord er feil.' } as FieldErrors };
  }
  const parsed = passwordSchema.safeParse(next);
  if (!parsed.success) return { ok: false as const, errors: { newPassword: parsed.error.issues[0]!.message } as FieldErrors };
  const hash = await hashPassword(next);
  // Behold gjeldende sesjon: den opprettes "etter" passordbyttet ved å oppdatere created_at.
  await sql`update users set password_hash = ${hash}, password_changed_at = now() where id = ${userId}`;
  await sql`update sessions set created_at = now() where id = ${keepSessionId}`;
  await sql`delete from sessions where user_id = ${userId} and id <> ${keepSessionId}`;
  await audit({ action: 'auth.password_changed', actorUserId: userId, targetType: 'user', targetId: userId });
  return { ok: true as const };
}

/** Brukes av CLI for å gi plattform-admin. */
export async function setPlatformAdmin(email: string, value: boolean): Promise<boolean> {
  const rows = await systemSql()`update users set is_platform_admin = ${value} where email = ${email.toLowerCase()} returning id`;
  return rows.length > 0;
}
