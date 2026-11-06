/**
 * Totrinnsinnlogging og kontosikkerhet:
 * - /konto/totrinn – slå på, se status, lag nye reservekoder, slå av (ikke for administratorer)
 * - /konto/bekreft – bekreft at det er deg (kode, reservekode eller passkey). Admin krever dette hver
 *   12. time og før viktige endringer (se `sensitive` i ruterne og dispatch i server/app.ts).
 * - /konto/passkey – legg til og fjern passkeys (krever bekreftelse de siste 15 minuttene)
 * - /konto/logg-ut-overalt – lenken i sikkerhetsvarslene: logger ut alle enheter
 * Krever innlogging (ikke organisasjon), så administratorer uten organisasjon også når sidene.
 */
import { isProd } from '@/lib/env';
import { suggestPasskeyName } from '@/lib/device';
import { rateLimit } from '@/lib/rate-limit';
import { SESSION_COOKIE } from '@/domain/auth/auth';
import {
  beginSetup,
  confirmSetup,
  disableMfa,
  mfaStatus,
  regenerateRecoveryCodes,
  SENSITIVE_REVERIFY_MS,
  stepUpPasskeyOptions,
  verifiedWithin,
  verifyStepUp,
} from '@/domain/auth/mfa';
import { finishRegistration, listPasskeys, registrationOptions, removePasskey } from '@/domain/auth/passkeys';
import { notifySecurityEvent, revokeAllSessions, verifyRevokeAllToken } from '@/domain/auth/security';
import { redirectWith } from '@/server/flash';
import { HttpError, homePath, json, safeRedirectPath, serializeCookie, type RequestContext } from '@/server/http';
import { render } from '@/server/render';
import { isUuid, type Router } from '@/server/router';
import { MessagePage } from '@/ui/pages/auth';
import { secondFactorFrom } from './helpers';
import { MfaRecoveryCodesPage, MfaSetupPage, MfaStatusPage, RevokeAllConfirmPage, RevokeAllDonePage, StepUpPage } from '@/ui/pages/mfa';

function str(form: FormData, key: string, max = 200): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function nextOf(value: string | null): string | undefined {
  return value ? safeRedirectPath(value, '') || undefined : undefined;
}

async function guard(ctx: RequestContext): Promise<void> {
  if (!(await rateLimit(`mfa-settings:${ctx.user!.id}`, 20, 15 * 60))) throw new HttpError(429, 'For mange forsøk. Vent litt og prøv igjen.');
}

const info = (ctx: RequestContext) => ({ ipHash: ctx.ipHash, userAgent: ctx.userAgent });

async function statusPage(ctx: RequestContext, error?: string, status = 200) {
  const user = ctx.user!;
  const [mfa, passkeys] = await Promise.all([mfaStatus(user.id), listPasskeys(user.id)]);
  return render(
    ctx,
    <MfaStatusPage
      status={mfa}
      isAdmin={user.isPlatformAdmin}
      passkeys={passkeys}
      recentlyVerified={verifiedWithin(ctx.session?.mfaVerifiedAt, SENSITIVE_REVERIFY_MS)}
      suggestedName={suggestPasskeyName(ctx.userAgent)}
      error={error}
    />,
    { title: 'Totrinnsinnlogging', status, noindex: true },
  );
}

async function stepUpPage(ctx: RequestContext, next: string, error?: string, status = 200) {
  const options = await stepUpPasskeyOptions(ctx.user!.id, ctx.session!.id);
  return render(ctx, <StepUpPage next={next} error={error} passkeyOptions={options ? JSON.stringify(options) : null} isAdmin={ctx.user!.isPlatformAdmin} />, {
    title: 'Bekreft at det er deg',
    status,
    noindex: true,
  });
}

export function registerMfaRoutes(router: Router): void {
  // -------------------------------------------------------------------------
  // Oppsett og status
  // -------------------------------------------------------------------------
  router.get('/konto/totrinn', 'user', async (ctx) => {
    const user = ctx.user!;
    const next = nextOf(ctx.query.get('neste'));
    if (!user.totpEnabled) {
      const setup = await beginSetup(user.id, user.email);
      return render(ctx, <MfaSetupPage qrDataUrl={setup.qrDataUrl} secret={setup.secret} required={user.isPlatformAdmin} next={next} />, {
        title: 'Totrinnsinnlogging',
        noindex: true,
      });
    }
    return statusPage(ctx);
  });

  router.post('/konto/totrinn', 'user', async (ctx) => {
    await guard(ctx);
    const user = ctx.user!;
    const form = await ctx.form();
    const next = nextOf(str(form, 'neste', 500)) ?? (user.isPlatformAdmin ? '/admin' : '/konto/totrinn');
    if (user.totpEnabled) return redirectWith(ctx, '/konto/totrinn', 'info', 'Totrinnsinnlogging er allerede på.');
    const res = await confirmSetup(user.id, str(form, 'code', 20), { keepSessionId: ctx.session?.id ?? null, ...info(ctx) });
    if (!res.ok) {
      const setup = await beginSetup(user.id, user.email);
      return render(ctx, <MfaSetupPage qrDataUrl={setup.qrDataUrl} secret={setup.secret} required={user.isPlatformAdmin} next={next} error={res.error} />, {
        title: 'Totrinnsinnlogging',
        status: 422,
        noindex: true,
      });
    }
    return render(ctx, <MfaRecoveryCodesPage codes={res.recoveryCodes} next={next} fresh />, { title: 'Reservekoder', noindex: true });
  });

  router.post('/konto/totrinn/reservekoder', 'user', async (ctx) => {
    await guard(ctx);
    const user = ctx.user!;
    const form = await ctx.form();
    const res = await regenerateRecoveryCodes(user.id, str(form, 'code', 20), info(ctx));
    if (!res.ok) return statusPage(ctx, res.error, 422);
    return render(ctx, <MfaRecoveryCodesPage codes={res.recoveryCodes} fresh={false} />, { title: 'Reservekoder', noindex: true });
  });

  router.post('/konto/totrinn/av', 'user', async (ctx) => {
    await guard(ctx);
    const user = ctx.user!;
    const form = await ctx.form();
    const res = await disableMfa(user.id, str(form, 'password', 300), str(form, 'code', 20), info(ctx));
    if (!res.ok) return statusPage(ctx, res.error, 422);
    return redirectWith(ctx, '/app/innstillinger', 'success', 'Totrinnsinnlogging er slått av.');
  });

  // -------------------------------------------------------------------------
  // Bekreft at det er deg
  // -------------------------------------------------------------------------
  router.get('/konto/bekreft', 'user', async (ctx) => {
    const user = ctx.user!;
    const next = nextOf(ctx.query.get('neste')) ?? homePath(user);
    if (!user.totpEnabled) return redirectWith(ctx, `/konto/totrinn?neste=${encodeURIComponent(next)}`, 'info', 'Slå på totrinnsinnlogging først.');
    return stepUpPage(ctx, next);
  });

  router.post('/konto/bekreft', 'user', async (ctx) => {
    const user = ctx.user!;
    const form = await ctx.form();
    const next = nextOf(str(form, 'neste', 500)) ?? homePath(user);
    if (!user.totpEnabled || !ctx.session) return redirectWith(ctx, `/konto/totrinn?neste=${encodeURIComponent(next)}`, 'info', 'Slå på totrinnsinnlogging først.');
    if (!(await rateLimit(`stepup:${user.id}`, 20, 15 * 60))) return stepUpPage(ctx, next, 'For mange forsøk. Vent 15 minutter og prøv igjen.', 429);
    const input = secondFactorFrom(form);
    const res = await verifyStepUp(user.id, ctx.session.id, input, info(ctx));
    if (!res.ok) {
      const error =
        res.reason === 'paused'
          ? 'For mange feil koder på kontoen. Vent 15 minutter, eller bruk Face ID / fingeravtrykk.'
          : 'passkey' in input
            ? 'Passkeyen ble ikke godkjent. Prøv igjen, eller bruk koden fra appen.'
            : 'Koden stemmer ikke. Prøv den nyeste koden i appen.';
      return stepUpPage(ctx, next, error, res.reason === 'paused' ? 429 : 401);
    }
    return redirectWith(ctx, next, 'success', 'Bekreftet. Takk!');
  });

  // -------------------------------------------------------------------------
  // Passkeys (Face ID / fingeravtrykk / sikkerhetsnøkkel)
  // -------------------------------------------------------------------------
  router.post(
    '/konto/passkey/valg',
    'user',
    async (ctx) => {
      const user = ctx.user!;
      if (!user.totpEnabled) return json({ error: 'Slå på totrinnsinnlogging med kode-app først.' }, { status: 400 });
      await guard(ctx);
      const options = await registrationOptions(user, ctx.session!.id);
      if ('error' in options) return json(options, { status: 400 });
      return json(options, { headers: { 'Cache-Control': 'no-store' } });
    },
    { sensitive: true },
  );

  router.post(
    '/konto/passkey',
    'user',
    async (ctx) => {
      const user = ctx.user!;
      if (!user.totpEnabled) return redirectWith(ctx, '/konto/totrinn', 'error', 'Slå på totrinnsinnlogging med kode-app først.');
      await guard(ctx);
      const form = await ctx.form();
      const res = await finishRegistration(user.id, ctx.session!.id, str(form, 'response', 20_000), str(form, 'name', 120), ctx.ipHash);
      if (!res.ok) return redirectWith(ctx, '/konto/totrinn#passkeys', 'error', res.error);
      await notifySecurityEvent(user.id, 'passkey_added', { userAgent: ctx.userAgent, passkeyName: res.name });
      return redirectWith(ctx, '/konto/totrinn#passkeys', 'success', `«${res.name}» er lagt til. Neste gang kan du bekrefte med Face ID / fingeravtrykk.`);
    },
    { sensitive: true },
  );

  router.post(
    '/konto/passkey/:id/fjern',
    'user',
    async (ctx) => {
      const id = ctx.params.id;
      if (!isUuid(id)) throw new HttpError(404, 'Fant ikke passkeyen.');
      await guard(ctx);
      const name = await removePasskey(ctx.user!.id, id, ctx.ipHash);
      if (!name) throw new HttpError(404, 'Fant ikke passkeyen.');
      await notifySecurityEvent(ctx.user!.id, 'passkey_removed', { userAgent: ctx.userAgent, passkeyName: name });
      return redirectWith(ctx, '/konto/totrinn#passkeys', 'success', `«${name}» er fjernet.`);
    },
    { sensitive: true },
  );

  // -------------------------------------------------------------------------
  // Logg ut alle enheter (lenken i sikkerhetsvarslene)
  // -------------------------------------------------------------------------
  const invalidLink = (ctx: RequestContext) =>
    render(
      ctx,
      <MessagePage
        title="Lenken virker ikke"
        tone="danger"
        message="Lenken er ugyldig eller eldre enn 7 dager. Har noen andre logget inn på kontoen din, bytt passord med «Glemt passord» – da logges alle enheter ut."
        action={{ href: '/glemt-passord', label: 'Bytt passord' }}
      />,
      { title: 'Logg ut alle enheter', status: 400, noindex: true },
    );

  router.get('/konto/logg-ut-overalt', 'public', async (ctx) => {
    const token = ctx.query.get('token') ?? '';
    if (!verifyRevokeAllToken(token)) return invalidLink(ctx);
    // Ingenting skjer før knappen trykkes (e-postprogrammer åpner lenker for å sjekke dem).
    return render(ctx, <RevokeAllConfirmPage token={token} />, { title: 'Logg ut alle enheter', noindex: true });
  });

  router.post('/konto/logg-ut-overalt', 'public', async (ctx) => {
    const token = str(await ctx.form(), 'token', 300);
    const userId = verifyRevokeAllToken(token);
    if (!userId) return invalidLink(ctx);
    const count = await revokeAllSessions(userId, ctx.ipHash);
    if (ctx.user?.id === userId) ctx.responseCookies.push(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isProd }));
    return render(ctx, <RevokeAllDonePage count={count} />, { title: 'Alle enheter er logget ut', noindex: true });
  });
}
