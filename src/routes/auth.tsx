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
import { redirect, safeRedirectPath, serializeCookie, type RequestContext } from '@/server/http';
import { render } from '@/server/render';
import type { Router } from '@/server/router';
import {
  ForgotPasswordPage,
  InvitationPage,
  LoginPage,
  MessagePage,
  RegisterPage,
  ResetPasswordPage,
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
    render(ctx, <LoginPage next={ctx.query.get('neste') ?? undefined} />, { title: 'Logg inn' }),
  );

  router.post('/logg-inn', 'guest', async (ctx) => {
    const form = await ctx.form();
    const email = str(form, 'email');
    const next = safeRedirectPath(ctx.query.get('neste'), '/app');
    const result = await authenticate(email, str(form, 'password'), ctx.ipHash);
    if (!result.ok) {
      const error =
        result.reason === 'locked'
          ? 'Kontoen er midlertidig låst etter for mange mislykkede forsøk. Prøv igjen om 15 minutter, eller tilbakestill passordet.'
          : result.reason === 'rate_limited'
            ? 'For mange forsøk. Vent litt og prøv igjen.'
            : 'Feil e-post eller passord.';
      return render(ctx, <LoginPage email={email} error={error} next={next} />, { title: 'Logg inn', status: result.reason === 'invalid' ? 401 : 429 });
    }
    await startSession(ctx, result.user.id);
    return redirect(next);
  });

  router.get('/registrer', 'guest', async (ctx) =>
    render(ctx, <RegisterPage next={ctx.query.get('neste') ?? undefined} />, { title: 'Opprett konto' }),
  );

  router.post('/registrer', 'guest', async (ctx) => {
    const form = await ctx.form();
    const values = { name: str(form, 'name'), email: str(form, 'email') };
    const next = ctx.query.get('neste') ?? undefined;
    if (!(await rateLimit(`register:${ctx.ipHash}`, 10, 3600))) {
      return render(ctx, <RegisterPage values={values} errors={{ email: 'For mange registreringer fra denne adressen. Prøv igjen senere.' }} next={next} />, {
        title: 'Opprett konto',
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
      return render(ctx, <RegisterPage values={values} errors={zodErrors(parsed.error)} next={next} />, { title: 'Opprett konto', status: 422 });
    }
    const result = await registerUser(parsed.data, ctx.ipHash);
    if (!result.ok) {
      return render(ctx, <RegisterPage values={values} errors={result.errors} next={next} />, { title: 'Opprett konto', status: 422 });
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

  router.get('/glemt-passord', 'public', async (ctx) => render(ctx, <ForgotPasswordPage />, { title: 'Glemt passord' }));

  router.post('/glemt-passord', 'public', async (ctx) => {
    const form = await ctx.form();
    await requestPasswordReset(str(form, 'email'), ctx.ipHash);
    return render(ctx, <ForgotPasswordPage sent />, { title: 'Glemt passord' });
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
