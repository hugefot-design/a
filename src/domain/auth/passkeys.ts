/**
 * Passkeys (WebAuthn): Face ID, fingeravtrykk, Windows Hello eller en sikkerhetsnøkkel som andre steg
 * i stedet for koden fra appen. Passordet trengs fortsatt; passkeyen erstatter bare koden.
 *
 * Hvorfor: en passkey er knyttet til nettstedets adresse. En falsk innloggingsside på en annen adresse
 * kan ikke bruke den, slik den kan lure deg til å taste en kode. Bare den offentlige nøkkelen lagres.
 *
 * - Kode-appen må være satt opp først (reserve hvis enheten blir borte). Maks 10 passkeys per bruker.
 * - Hver utfordring brukes én gang og gjelder i 5 minutter, knyttet til økten (registrering,
 *   ny bekreftelse) eller til innloggingsutfordringen (passord ok, venter på andre steg).
 * - RP-ID er vertsnavnet i APP_URL. Bytter nettstedet domene, slutter passkeys å virke (koden virker).
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { audit } from '@/lib/audit';
import { systemSql } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/logger';

export const MAX_PASSKEYS = 10;
const CHALLENGE_TTL_MINUTES = 5;
const CEREMONY_TIMEOUT_MS = 120_000;
const RP_NAME = 'AnbudRadar';

export function relyingParty(): { id: string; origin: string } {
  const url = new URL(env.APP_URL);
  return { id: url.hostname, origin: url.origin };
}

export interface Passkey {
  id: string;
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  backedUp: boolean;
}

interface StoredCredential {
  id: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: string | number;
  transports: string[];
}

export type Binding = { sessionId: string } | { loginChallengeId: string };

const bindingCols = (b: Binding) => ('sessionId' in b ? { sessionId: b.sessionId, loginChallengeId: null } : { sessionId: null, loginChallengeId: b.loginChallengeId });

async function saveChallenge(userId: string, purpose: 'register' | 'authenticate', binding: Binding, challenge: string): Promise<void> {
  const sql = systemSql();
  const b = bindingCols(binding);
  await sql`delete from webauthn_challenges where expires_at < now()`;
  await sql`
    delete from webauthn_challenges where user_id = ${userId} and purpose = ${purpose}
      and session_id is not distinct from ${b.sessionId}::uuid and login_challenge_id is not distinct from ${b.loginChallengeId}::uuid
  `;
  await sql`
    insert into webauthn_challenges (user_id, purpose, session_id, login_challenge_id, challenge, expires_at)
    values (${userId}, ${purpose}, ${b.sessionId}, ${b.loginChallengeId}, ${challenge}, now() + make_interval(mins => ${CHALLENGE_TTL_MINUTES}))
  `;
}

/** Henter og sletter utfordringen (engangs). */
async function takeChallenge(userId: string, purpose: 'register' | 'authenticate', binding: Binding): Promise<string | null> {
  const b = bindingCols(binding);
  const rows = (await systemSql()`
    delete from webauthn_challenges
    where user_id = ${userId} and purpose = ${purpose}
      and session_id is not distinct from ${b.sessionId}::uuid and login_challenge_id is not distinct from ${b.loginChallengeId}::uuid
    returning challenge, expires_at > now() as valid
  `) as unknown as { challenge: string; valid: boolean }[];
  return rows.find((r) => r.valid)?.challenge ?? null;
}

async function storedCredentials(userId: string): Promise<StoredCredential[]> {
  return (await systemSql()`
    select id, credential_id, public_key, counter, transports from webauthn_credentials where user_id = ${userId} order by created_at
  `) as unknown as StoredCredential[];
}

export async function listPasskeys(userId: string): Promise<Passkey[]> {
  return (await systemSql()`
    select id, name, created_at, last_used_at, backed_up from webauthn_credentials where user_id = ${userId} order by created_at
  `) as unknown as Passkey[];
}

export async function hasPasskeys(userId: string): Promise<boolean> {
  const rows = (await systemSql()`select 1 from webauthn_credentials where user_id = ${userId} limit 1`) as unknown as unknown[];
  return rows.length > 0;
}

/** Brukerens faste, anonyme ID overfor autentiseringen (16 byte fra bruker-ID-en, ingen e-post). */
function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(userId.replace(/-/g, ''), 'hex'));
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || !value || value.length > 20_000) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as { id?: unknown; rawId?: unknown; type?: unknown; response?: unknown };
    if (typeof o.id !== 'string' || typeof o.rawId !== 'string' || o.type !== 'public-key' || !o.response || typeof o.response !== 'object') return null;
    return parsed as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Registrering
// ---------------------------------------------------------------------------
export async function registrationOptions(
  user: { id: string; email: string; name: string },
  sessionId: string,
): Promise<PublicKeyCredentialCreationOptionsJSON | { error: string }> {
  const existing = await storedCredentials(user.id);
  if (existing.length >= MAX_PASSKEYS) return { error: `Du kan ha maks ${MAX_PASSKEYS} passkeys. Fjern en før du legger til en ny.` };
  const rp = relyingParty();
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.id,
    userName: user.email,
    userDisplayName: user.name,
    userID: userHandle(user.id),
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, transports: c.transports as never })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  await saveChallenge(user.id, 'register', { sessionId }, options.challenge);
  return options;
}

export async function finishRegistration(
  userId: string,
  sessionId: string,
  responseJson: unknown,
  nameRaw: string,
  ipHash?: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const name = nameRaw.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Passkey';
  const response = parseJson<RegistrationResponseJSON>(responseJson);
  if (!response) return { ok: false, error: 'Fikk ikke svar fra enheten. Nettleseren må ha JavaScript slått på. Prøv igjen.' };
  const challenge = await takeChallenge(userId, 'register', { sessionId });
  if (!challenge) return { ok: false, error: 'Det tok for lang tid. Prøv igjen.' };
  if ((await storedCredentials(userId)).length >= MAX_PASSKEYS) return { ok: false, error: `Du kan ha maks ${MAX_PASSKEYS} passkeys.` };
  const rp = relyingParty();
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      requireUserVerification: false,
    });
    if (!result.verified) return { ok: false, error: 'Enheten kunne ikke bekreftes. Prøv igjen.' };
    const info = result.registrationInfo;
    const inserted = (await systemSql()`
      insert into webauthn_credentials (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
      values (${userId}, ${info.credential.id}, ${Buffer.from(info.credential.publicKey)}, ${info.credential.counter},
              ${info.credential.transports ?? []}::text[], ${info.credentialDeviceType}, ${info.credentialBackedUp}, ${name})
      on conflict (credential_id) do nothing
      returning id
    `) as unknown as { id: string }[];
    if (!inserted.length) return { ok: false, error: 'Denne passkeyen er allerede lagt til.' };
    await audit({ action: 'auth.passkey_added', actorUserId: userId, targetType: 'user', targetId: userId, ipHash, metadata: { name, backedUp: info.credentialBackedUp } });
    return { ok: true, name };
  } catch (err) {
    log.warn('passkey_registration_failed', { err: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'Enheten kunne ikke bekreftes. Prøv igjen.' };
  }
}

// ---------------------------------------------------------------------------
// Bruk (innlogging og ny bekreftelse)
// ---------------------------------------------------------------------------
/** Valg for nettleseren, eller null om brukeren ikke har passkeys. */
export async function authenticationOptions(userId: string, binding: Binding): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const creds = await storedCredentials(userId);
  if (!creds.length) return null;
  const options = await generateAuthenticationOptions({
    rpID: relyingParty().id,
    allowCredentials: creds.map((c) => ({ id: c.credentialId, transports: c.transports })),
    userVerification: 'preferred',
    timeout: CEREMONY_TIMEOUT_MS,
  });
  await saveChallenge(userId, 'authenticate', binding, options.challenge);
  return options;
}

/** Sjekker svaret fra enheten. Utfordringen brukes opp uansett utfall. Returnerer navnet på passkeyen. */
export async function verifyPasskey(userId: string, binding: Binding, responseJson: unknown): Promise<{ name: string } | null> {
  const response = parseJson<AuthenticationResponseJSON>(responseJson);
  const challenge = await takeChallenge(userId, 'authenticate', binding);
  if (!response || !challenge) return null;
  const [cred] = (await systemSql()`
    select id, credential_id, public_key, counter, transports, name from webauthn_credentials
    where user_id = ${userId} and credential_id = ${response.id}
  `) as unknown as (StoredCredential & { name: string })[];
  if (!cred) return null;
  const rp = relyingParty();
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.id,
      credential: { id: cred.credentialId, publicKey: new Uint8Array(cred.publicKey), counter: Number(cred.counter), transports: cred.transports as never },
      requireUserVerification: false,
    });
    if (!result.verified) return null;
    // Telleren skal øke (eller stå på 0 for enheter som ikke teller); ellers kan nøkkelen være kopiert.
    const updated = (await systemSql()`
      update webauthn_credentials set counter = ${result.authenticationInfo.newCounter}, last_used_at = now(),
        backed_up = ${result.authenticationInfo.credentialBackedUp}
      where id = ${cred.id} and (counter < ${result.authenticationInfo.newCounter} or (counter = 0 and ${result.authenticationInfo.newCounter} = 0))
      returning id
    `) as unknown as unknown[];
    return updated.length ? { name: cred.name } : null;
  } catch (err) {
    log.warn('passkey_authentication_failed', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function removePasskey(userId: string, passkeyId: string, ipHash?: string): Promise<string | null> {
  const rows = (await systemSql()`delete from webauthn_credentials where id = ${passkeyId} and user_id = ${userId} returning name`) as unknown as { name: string }[];
  if (!rows[0]) return null;
  await audit({ action: 'auth.passkey_removed', actorUserId: userId, targetType: 'user', targetId: userId, ipHash, metadata: { name: rows[0].name } });
  return rows[0].name;
}

/** Når totrinn slås av, fjernes passkeys også (de er et alternativ til koden, ikke en egen innlogging). */
export async function removeAllPasskeys(userId: string): Promise<void> {
  await systemSql()`delete from webauthn_credentials where user_id = ${userId}`;
}
