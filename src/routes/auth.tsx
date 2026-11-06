import { isProd } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import {
  authenticate,
  createSession,
  deleteSession,
  passwordSchema,
  peekResetToken,
  registerSchema,
  registerUser,
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  verifyEmailToken,
  zodErrors,
} from '@/domain/auth/auth';
import { acceptInvitation, findInvitation } from '@/domain/org/org';
import { redirectWith } from '@/server/flash';
import { homePath, redirect, safeRedirectPath, serializeCookie, type RequestContext } from '@/server/http';
import { render } from '@/server/render';
import { messages, translateAuthErrors } from '@/i18n';
import { fill } from '@/i18n/format';
import { createLoginChallenge, verifyLoginChallenge } from '@/domain/auth/mfa';
import { systemSql } from '@/lib/db';
import type { Router } from '@/server/router';
import {
  ForgotPasswordPage,
  InvitationPage,
  LoginPage,
  MessagePage,
  RegisterPage,
  ResetPasswordPage,
  TwoFactorLoginPage,
} from '@/ui/pages/auth';

function str(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === 'string' ? v : '';
}

async function startSession(ctx: RequestContext, userId: string): Promise<void> {
  const { token } = await createSession(userId, { userAgent: ctx.userAgent, ipHash: ctx.ipHash });
  ctx.responseCookies.push(
    serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_DAYS * 86400, secure: isProd, httpOnly: true, sameSite: 'Lax' }),
  );
}

export function registerAuthRoutes(router: Router): void {
  router.get('/logg-inn', 'guest', async (ctx) =>
    render(ctx, <LoginPage next={ctx.query.get('neste') ?? undefined} />, { title: messages(ctx.locale).meta.login }),
  );

  router.post('/logg-inn', 'guest', async (ctx) => {
    const form = await ctx.form();
    const email = str(form, 'email');
    // Bare en gyldig «neste»-lenke huskes; ellers bestemmes målet av hvem som logger inn (admin → /admin).
    const requested = ctx.query.get('neste');
    const next = requested ? safeRedirectPath(requested, '') || undefined : undefined;
    const result = await authenticate(email, str(form, 'password'), ctx.ipHash);
    if (!result.ok) {
      const t = messages(ctx.locale);
      const error = result.reason === 'locked' ? t.auth.login.errors.locked : result.reason === 'rate_limited' ? t.auth.login.errors.rateLimited : t.auth.login.errors.invalid;
      return render(ctx, <LoginPage email={email} error={error} next={next} />, { title: t.meta.login, status: result.reason === 'invalid' ? 401 : 429 });
    }
    // Totrinnsinnlogging: riktig passord gir bare en kortvarig utfordring – økten lages når koden er riktig.
    if (result.user.totpEnabled) {
      const challenge = await createLoginChallenge(result.user.id, next ?? null);
      return render(ctx, <TwoFactorLoginPage challenge={challenge} />, { title: messages(ctx.locale).meta.login, noindex: true });
    }
    await startSession(ctx, result.user.id);
    return redirect(next ?? homePath(result.user));
  });

  router.post('/logg-inn/kode', 'guest', async (ctx) => {
    const t = messages(ctx.locale);
    const form = await ctx.form();
    const challenge = str(form, 'challenge');
    if (!(await rateLimit(`mfa:ip:${ctx.ipHash}`, 30, 15 * 60))) {
      return render(ctx, <LoginPage error={t.auth.login.errors.rateLimited} />, { title: t.meta.login, status: 429 });
    }
    const res = await verifyLoginChallenge(challenge, str(form, 'code'), ctx.ipHash);
    if (!res.ok) {
      if (res.reason === 'invalid') {
        return render(ctx, <TwoFactorLoginPage challenge={challenge} error={fill(t.auth.mfa.errors.invalid, { n: res.attemptsLeft ?? 0 })} />, {
          title: t.meta.login,
          status: 401,
          noindex: true,
        });
      }
      return render(ctx, <LoginPage error={res.reason === 'too_many' ? t.auth.mfa.errors.tooMany : t.auth.mfa.errors.expired} />, { title: t.meta.login, status: 401 });
    }
    const [user] = (await systemSql()`select is_platform_admin from users where id = ${res.userId}`) as unknown as { isPlatformAdmin: boolean }[];
    await startSession(ctx, res.userId);
    const next = res.nextPath ? safeRedirectPath(res.nextPath, '') || undefined : undefined;
    return redirect(next ?? homePath(user ?? null));
  });

  router.get('/registrer', 'guest', async (ctx) =>
    render(ctx, <RegisterPage next={ctx.query.get('neste') ?? undefined} />, { title: messages(ctx.locale).meta.register }),
  );

  router.post('/registrer', 'guest', async (ctx) => {
    const form = await ctx.form();
    const values = { name: str(form, 'name'), email: str(form, 'email') };
    const next = ctx.query.get('neste') ?? undefined;
    const t = messages(ctx.locale);
    if (!(await rateLimit(`register:${ctx.ipHash}`, 10, 3600))) {
      return render(ctx, <RegisterPage values={values} errors={{ email: t.auth.errors.tooMany }} next={next} />, {
        title: t.meta.register,
        status: 429,
      });
    }
    const parsed = registerSchema.safeParse({
      name: values.name,
      email: values.email,
      password: str(form, 'password'),
      acceptTerms: form.get('acceptTerms') ?? undefined,
    });
    if (!parsed.success) {
      return render(ctx, <RegisterPage values={values} errors={translateAuthErrors(t, zodErrors(parsed.error))} next={next} />, { title: t.meta.register, status: 422 });
    }
    const result = await registerUser(parsed.data, ctx.ipHash);
    if (!result.ok) {
      return render(ctx, <RegisterPage values={values} errors={translateAuthErrors(t, result.errors)} next={next} />, { title: t.meta.register, status: 422 });
    }
    await startSession(ctx, result.user.id);
    return redirectWith(ctx, safeRedirectPath(next, '/app/onboarding'), 'success', 'Kontoen er opprettet. Vi har sendt deg en e-post for å bekrefte adressen.');
  });

  router.post('/logg-ut', 'public', async (ctx) => {
    if (ctx.session) {
      await deleteSession(ctx.session.id);
      await audit({ action: 'auth.logout', actorUserId: ctx.user?.id, ipHash: ctx.ipHash });
    }
    ctx.responseCookies.push(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isProd }));
    return redirect('/');
  });

  router.get('/glemt-passord', 'public', async (ctx) => render(ctx, <ForgotPasswordPage />, { title: messages(ctx.locale).meta.forgot }));

  router.post('/glemt-passord', 'public', async (ctx) => {
    const form = await ctx.form();
    await requestPasswordReset(str(form, 'email'), ctx.ipHash);
    return render(ctx, <ForgotPasswordPage sent />, { title: messages(ctx.locale).meta.forgot });
  });

  router.get('/tilbakestill-passord', 'public', async (ctx) => {
    const token = ctx.query.get('token') ?? '';
    return render(ctx, <ResetPasswordPage token={token} valid={await peekResetToken(token)} />, { title: 'Velg nytt passord', noindex: true });
  });

  router.post('/tilbakestill-passord', 'public', async (ctx) => {
    const form = await ctx.form();
    const token = str(form, 'token');
    const password = str(form, 'password');
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) {
      return render(ctx, <ResetPasswordPage token={token} valid={await peekResetToken(token)} error={parsed.error.issues[0]!.message} />, {
        title: 'Velg nytt passord',
        status: 422,
      });
    }
    const ok = await resetPassword(token, password);
    if (!ok) return render(ctx, <ResetPasswordPage token={token} valid={false} />, { title: 'Velg nytt passord', status: 400 });
    if (ctx.session) ctx.responseCookies.push(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: isProd }));
    return redirectWith(ctx, '/logg-inn', 'success', 'Passordet er endret. Logg inn med det nye passordet.');
  });

  router.get('/bekreft-epost', 'public', async (ctx) => {
    const result = await verifyEmailToken(ctx.query.get('token') ?? '');
    if (!result) {
      return render(
        ctx,
        <MessagePage
          title="Lenken virker ikke"
          tone="danger"
          message="Lenken er ugyldig, utløpt eller allerede brukt. Logg inn og be om en ny lenke."
          action={{ href: '/app', label: 'Gå til appen' }}
        />,
        { title: 'Bekreft e-post', status: 400, noindex: true },
      );
    }
    return redirectWith(ctx, ctx.user ? '/app' : '/logg-inn', 'success', 'E-postadressen er bekreftet.');
  });

  router.post('/send-bekreftelse-pa-nytt', 'user', async (ctx) => {
    const user = ctx.user!;
    if (user.emailVerified) return redirectWith(ctx, '/app', 'info', 'E-postadressen er allerede bekreftet.');
    if (!(await rateLimit(`verify-resend:${user.id}`, 3, 3600))) {
      return redirectWith(ctx, '/app', 'error', 'Du har bedt om mange lenker. Vent en stund før du prøver igjen.');
    }
    await sendVerificationEmail(user.id, user.email, user.name);
    return redirectWith(ctx, '/app', 'success', `Ny lenke er sendt til ${user.email}.`);
  });

  router.get('/invitasjon', 'public', async (ctx) => {
    const token = ctx.query.get('token') ?? '';
    const inv = await findInvitation(token);
    if (!inv) {
      return render(ctx, <MessagePage title="Invitasjonen virker ikke" tone="danger" message="Invitasjonen er ugyldig eller utløpt. Be om en ny invitasjon." />, {
        title: 'Invitasjon',
        status: 404,
        noindex: true,
      });
    }
    return render(ctx, <InvitationPage orgName={inv.orgName} email={inv.email} token={token} loggedInAs={ctx.user?.email ?? null} />, {
      title: 'Invitasjon',
      noindex: true,
    });
  });

  router.post('/invitasjon', 'user', async (ctx) => {
    const form = await ctx.form();
    const token = str(form, 'token');
    const result = await acceptInvitation(ctx.user!, token);
    if (!result.ok) {
      const inv = await findInvitation(token);
      return render(
        ctx,
        inv ? (
          <InvitationPage orgName={inv.orgName} email={inv.email} token={token} loggedInAs={ctx.user!.email} error={result.error} />
        ) : (
          <MessagePage title="Invitasjonen virker ikke" tone="danger" message={result.error} />
        ),
        { title: 'Invitasjon', status: 400, noindex: true },
      );
    }
    return redirectWith(ctx, '/app', 'success', 'Du er nå med i organisasjonen.');
  });
}
