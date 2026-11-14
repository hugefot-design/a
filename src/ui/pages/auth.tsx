import { Alert, Button, buttonVariants, Checkbox, Field, Input, PostForm } from '../components';
import { useUi } from '../context';
import { AuthLayout } from '../layouts';
import { CodeInput, PasskeyForm, RecoveryCodeForm } from '../two-factor';
import { plural, rich } from '@/i18n/format';
import { LuArrowRight, LuEye, LuEyeOff, LuLock, LuMail } from 'react-icons/lu';

type Errors = Record<string, string>;

export function LoginPage({ email = '', error, next }: { email?: string; error?: string; next?: string }) {
  const { m, lp } = useUi();
  const t = m.auth.login;
  return (
    <AuthLayout title={t.title} intro={t.welcome}>
      <PostForm action={`${lp('/logg-inn')}${next ? `?neste=${encodeURIComponent(next)}` : ''}`} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t.email} htmlFor="email">
          <div className="relative">
            <LuMail className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} invalid={Boolean(error)} className="pl-11" />
          </div>
        </Field>
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="block text-[13px] font-semibold text-ink">
              {t.password}
            </label>
            <a href={lp('/glemt-passord')} className="inline-flex min-h-6 items-center text-[13px] font-medium">
              {t.forgot}
            </a>
          </div>
          <div className="relative">
            <LuLock className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
            <Input id="password" name="password" type="password" autoComplete="current-password" required invalid={Boolean(error)} className="pl-11 pr-12" />
            <button
              type="button"
              data-toggle-password="password"
              data-label-show={t.showPassword}
              data-label-hide={t.hidePassword}
              aria-label={t.showPassword}
              title={t.showPassword}
              aria-pressed="false"
              className="js-only group absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-strong/5 hover:text-strong"
            >
              <LuEye className="size-[18px] group-aria-pressed:hidden" aria-hidden />
              <LuEyeOff className="hidden size-[18px] group-aria-pressed:block" aria-hidden />
            </button>
          </div>
        </div>
        <Button type="submit" variant="signal" size="lg" className="w-full" busyLabel={t.busy}>
          {t.submit}
          <LuArrowRight className="size-[18px]" aria-hidden />
        </Button>
      </PostForm>
      <div className="mt-7 border-t border-line pt-6 text-center">
        <p className="text-[14px] text-muted">{t.newHere}</p>
        <a href={lp('/registrer')} className={buttonVariants({ variant: 'secondary', size: 'lg', className: 'mt-3 w-full' })}>
          {t.createLink}
        </a>
      </div>
    </AuthLayout>
  );
}

export function RegisterPage({
  values = {},
  errors = {},
  next,
  origin,
}: {
  values?: Record<string, string>;
  errors?: Errors;
  next?: string;
  /** Siden og kilden som førte hit (måling uten informasjonskapsler – se recordSignupOrigin). */
  origin?: { path: string | null; source: string | null };
}) {
  const { trialDays, m, lp, locale } = useUi();
  const t = m.auth.register;
  const doc = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener">
      {label}
    </a>
  );
  return (
    <AuthLayout
      title={t.title}
      intro={
        <>
          {rich(t.intro, { days: plural(locale, m.units.days, trialDays), link: <a href={lp('/logg-inn')}>{t.loginLink}</a> })}
          {t.languageNote ? <span className="mt-2 block text-[13px]">{t.languageNote}</span> : null}
        </>
      }
    >
      <PostForm action={`${lp('/registrer')}${next ? `?neste=${encodeURIComponent(next)}` : ''}`} className="space-y-4">
        {origin?.path ? <input type="hidden" name="fra" value={origin.path} /> : null}
        {origin?.source ? <input type="hidden" name="kilde" value={origin.source} /> : null}
        <Field label={t.name} htmlFor="name" error={errors.name}>
          <Input id="name" name="name" autoComplete="name" required defaultValue={values.name} invalid={Boolean(errors.name)} />
        </Field>
        <Field label={t.email} htmlFor="email" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={values.email} invalid={Boolean(errors.email)} />
        </Field>
        <Field label={t.password} htmlFor="password" hint={t.passwordHint} error={errors.password}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} invalid={Boolean(errors.password)} />
        </Field>
        <div>
          <Checkbox
            name="acceptTerms"
            label={rich(t.terms, {
              terms: doc('/vilkar', t.termsLink),
              dpa: doc('/databehandleravtale', t.dpaLink),
              privacy: doc('/personvern', t.privacyLink),
            })}
          />
          {errors.acceptTerms ? <p className="mt-1 text-[13px] font-medium text-danger">{errors.acceptTerms}</p> : null}
        </div>
        <Button type="submit" variant="signal" size="lg" className="w-full" busyLabel={t.busy}>
          {t.submit}
        </Button>
      </PostForm>
    </AuthLayout>
  );
}

/**
 * Steg to i innloggingen: passkey (Face ID / fingeravtrykk) hvis brukeren har det, ellers koden fra
 * kode-appen. Reservekode ligger sammenfoldet under.
 */
export function TwoFactorLoginPage({ challenge, error, passkeyOptions }: { challenge: string; error?: string; passkeyOptions?: string | null }) {
  const { m, lp } = useUi();
  const t = m.auth.mfa;
  const action = lp('/logg-inn/kode');
  return (
    <AuthLayout title={t.title} intro={t.intro} side={{ ...t.side, secure: true }}>
      {error ? (
        <Alert tone="danger" className="mb-5">
          {error}
        </Alert>
      ) : null}
      {passkeyOptions ? (
        <PasskeyForm action={action} optionsJson={passkeyOptions} fields={{ challenge }} label={t.passkey} busyLabel={t.passkeyBusy} failedText={t.passkeyFailed} orText={t.or} />
      ) : null}
      <PostForm action={action} className="space-y-4">
        <input type="hidden" name="challenge" value={challenge} />
        <CodeInput label={t.code} invalid={Boolean(error)} autoFocus={!passkeyOptions} />
        <Button type="submit" size="lg" className="w-full" busyLabel={t.busy}>
          {t.submit}
        </Button>
      </PostForm>
      <RecoveryCodeForm action={action} fields={{ challenge }} toggle={t.recoveryToggle} label={t.recoveryLabel} submit={t.recoverySubmit} busy={t.busy} />
      <p className="mt-6 text-center text-[14px]">
        <a href={lp('/logg-inn')}>{t.back}</a>
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage({ sent = false }: { sent?: boolean }) {
  const { m, lp } = useUi();
  const t = m.auth.forgot;
  return (
    <AuthLayout title={t.title} intro={t.intro}>
      {sent ? (
        <Alert tone="ok" title={t.sentTitle}>
          {t.sentText}
        </Alert>
      ) : (
        <PostForm action={lp('/glemt-passord')} className="space-y-4">
          <Field label={t.email} htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Button type="submit" className="w-full" busyLabel={t.busy}>
            {t.submit}
          </Button>
        </PostForm>
      )}
      <p className="mt-4 text-center text-[14px]">
        <a href={lp('/logg-inn')}>{t.back}</a>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordPage({ token, valid, error }: { token: string; valid: boolean; error?: string }) {
  return (
    <AuthLayout title="Velg nytt passord">
      {!valid ? (
        <div className="space-y-4">
          <Alert tone="danger">Lenken er ugyldig eller utløpt. Be om en ny lenke.</Alert>
          <a href="/glemt-passord" className={buttonVariants({ variant: 'primary' })}>
            Be om ny lenke
          </a>
        </div>
      ) : (
        <PostForm action="/tilbakestill-passord" className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <Field label="Nytt passord" htmlFor="password" hint="Minst 10 tegn." error={error}>
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} invalid={Boolean(error)} />
          </Field>
          <Button type="submit" className="w-full" busyLabel="Lagrer …">
            Lagre nytt passord
          </Button>
        </PostForm>
      )}
    </AuthLayout>
  );
}

export function MessagePage({ title, tone, message, action }: { title: string; tone: 'ok' | 'danger' | 'info'; message: string; action?: { href: string; label: string } }) {
  return (
    <AuthLayout title={title}>
      <Alert tone={tone}>{message}</Alert>
      {action ? (
        <a href={action.href} className={buttonVariants({ variant: 'primary', className: 'mt-4' })}>
          {action.label}
        </a>
      ) : null}
    </AuthLayout>
  );
}

export function InvitationPage({
  orgName,
  email,
  token,
  loggedInAs,
  error,
}: {
  orgName: string;
  email: string;
  token: string;
  loggedInAs: string | null;
  error?: string;
}) {
  return (
    <AuthLayout title={`Bli med i ${orgName}`} intro={<>Invitasjonen ble sendt til {email}.</>}>
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      {loggedInAs ? (
        <PostForm action="/invitasjon" className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-[14px]">Du er logget inn som {loggedInAs}.</p>
          <Button type="submit" className="w-full">
            Godta invitasjonen
          </Button>
        </PostForm>
      ) : (
        <div className="space-y-3 text-[14px]">
          <p>Logg inn eller opprett konto med {email} for å godta invitasjonen.</p>
          <div className="flex flex-wrap gap-2">
            <a href={`/logg-inn?neste=${encodeURIComponent(`/invitasjon?token=${token}`)}`} className={buttonVariants({ variant: 'primary' })}>
              Logg inn
            </a>
            <a href={`/registrer?neste=${encodeURIComponent(`/invitasjon?token=${token}`)}`} className={buttonVariants({ variant: 'secondary' })}>
              Opprett konto
            </a>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}

/** Avmelding fra varsel-e-post. Knappen sender et vanlig skjema (ettklikks-avmelding fra e-postklienter går direkte). */
export function UnsubscribePage({ token, orgName, done }: { token: string; orgName: string; done: boolean }) {
  if (done) {
    return (
      <AuthLayout title="Du er meldt av">
        <Alert tone="ok">
          Du får ikke lenger varsel-e-post eller ukesoversikt fra AnbudRadar for {orgName}. Varslene vises fortsatt i appen.
        </Alert>
        <p className="mt-4 text-sm text-muted">
          Vil du ha e-post igjen? Logg inn og velg hyppighet under <a href="/app/varsler" className="underline">Varsler</a>.
          E-post om konto, sikkerhet og betaling sendes uansett, fordi den er nødvendig for avtalen.
        </p>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Meld av varsel-e-post" intro={`Gjelder varsler og ukesoversikt for ${orgName}.`}>
      <form method="post" action={`/avmeld?t=${encodeURIComponent(token)}`}>
        <button type="submit" className={buttonVariants({ variant: 'primary' })}>
          Meld meg av
        </button>
      </form>
    </AuthLayout>
  );
}
