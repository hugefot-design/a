/**
 * /konto/totrinn – slå på, se status, lag nye reservekoder og slå av totrinnsinnlogging.
 * Krever innlogging (ikke organisasjon), så administratorer uten organisasjon også når siden.
 */
import { beginSetup, confirmSetup, disableMfa, mfaStatus, regenerateRecoveryCodes } from '@/domain/auth/mfa';
import { rateLimit } from '@/lib/rate-limit';
import { redirectWith } from '@/server/flash';
import { HttpError, safeRedirectPath, type RequestContext } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import { MfaRecoveryCodesPage, MfaSetupPage, MfaStatusPage } from '@/ui/pages/mfa';

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

export function registerMfaRoutes(router: Router): void {
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
    return render(ctx, <MfaStatusPage status={await mfaStatus(user.id)} isAdmin={user.isPlatformAdmin} />, { title: 'Totrinnsinnlogging', noindex: true });
  });

  router.post('/konto/totrinn', 'user', async (ctx) => {
    await guard(ctx);
    const user = ctx.user!;
    const form = await ctx.form();
    const next = nextOf(str(form, 'neste', 500)) ?? (user.isPlatformAdmin ? '/admin' : '/konto/totrinn');
    if (user.totpEnabled) return redirectWith(ctx, '/konto/totrinn', 'info', 'Totrinnsinnlogging er allerede på.');
    const res = await confirmSetup(user.id, str(form, 'code', 20), { keepSessionId: ctx.session?.id ?? null, ipHash: ctx.ipHash });
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
    const res = await regenerateRecoveryCodes(user.id, str(form, 'code', 20), ctx.ipHash);
    if (!res.ok) return render(ctx, <MfaStatusPage status={await mfaStatus(user.id)} isAdmin={user.isPlatformAdmin} error={res.error} />, { title: 'Totrinnsinnlogging', status: 422, noindex: true });
    return render(ctx, <MfaRecoveryCodesPage codes={res.recoveryCodes} fresh={false} />, { title: 'Reservekoder', noindex: true });
  });

  router.post('/konto/totrinn/av', 'user', async (ctx) => {
    await guard(ctx);
    const user = ctx.user!;
    const form = await ctx.form();
    const res = await disableMfa(user.id, str(form, 'password', 300), str(form, 'code', 20), ctx.ipHash);
    if (!res.ok) return render(ctx, <MfaStatusPage status={await mfaStatus(user.id)} isAdmin={user.isPlatformAdmin} error={res.error} />, { title: 'Totrinnsinnlogging', status: 422, noindex: true });
    return redirectWith(ctx, '/app/innstillinger', 'success', 'Totrinnsinnlogging er slått av.');
  });
}
