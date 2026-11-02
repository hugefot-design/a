import { Alert, Button, buttonVariants, Checkbox, Field, Input, PostForm } from '../components';
import { useUi } from '../context';
import { AuthLayout } from '../layouts';

type Errors = Record<string, string>;

export function LoginPage({ email = '', error, next }: { email?: string; error?: string; next?: string }) {
  return (
    <AuthLayout title="Logg inn" intro={<>Har du ikke konto? <a href="/registrer">Opprett en gratis prøvekonto</a>.</>}>
      <PostForm action={`/logg-inn${next ? `?neste=${encodeURIComponent(next)}` : ''}`} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="E-post" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} invalid={Boolean(error)} />
        </Field>
        <Field label="Passord" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required invalid={Boolean(error)} />
        </Field>
        <Button type="submit" className="w-full" busyLabel="Logger inn …">
          Logg inn
        </Button>
        <p className="text-center text-[14px]">
          <a href="/glemt-passord">Glemt passordet?</a>
        </p>
      </PostForm>
    </AuthLayout>
  );
}

export function RegisterPage({ values = {}, errors = {}, next }: { values?: Record<string, string>; errors?: Errors; next?: string }) {
  const { trialDays } = useUi();
  return (
    <AuthLayout
      title="Opprett konto"
      intro={
        <>
          {`Du får ${trialDays} dager med alle funksjoner i Profesjonell. Ingen kortinformasjon trengs. Har du konto? `}
          <a href="/logg-inn">Logg inn</a>.
        </>
      }
    >
      <PostForm action={`/registrer${next ? `?neste=${encodeURIComponent(next)}` : ''}`} className="space-y-4">
        <Field label="Navn" htmlFor="name" error={errors.name}>
          <Input id="name" name="name" autoComplete="name" required defaultValue={values.name} invalid={Boolean(errors.name)} />
        </Field>
        <Field label="Jobb-e-post" htmlFor="email" error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={values.email} invalid={Boolean(errors.email)} />
        </Field>
        <Field label="Passord" htmlFor="password" hint="Minst 10 tegn. En setning du husker fungerer godt." error={errors.password}>
          <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} invalid={Boolean(errors.password)} />
        </Field>
        <div>
          <Checkbox
            name="acceptTerms"
            label={
              <>
                Jeg godtar <a href="/vilkar" target="_blank" rel="noopener">vilkårene</a> og har lest{' '}
                <a href="/personvern" target="_blank" rel="noopener">personvernerklæringen</a>.
              </>
            }
          />
          {errors.acceptTerms ? <p className="mt-1 text-[13px] font-medium text-danger">{errors.acceptTerms}</p> : null}
        </div>
        <Button type="submit" className="w-full" busyLabel="Oppretter konto …">
          Opprett konto
        </Button>
      </PostForm>
    </AuthLayout>
  );
}

export function ForgotPasswordPage({ sent = false }: { sent?: boolean }) {
  return (
    <AuthLayout title="Glemt passord" intro="Skriv inn e-postadressen din, så sender vi en lenke for å velge nytt passord.">
      {sent ? (
        <Alert tone="ok" title="Sjekk e-posten din">
          Hvis det finnes en konto med denne adressen, har vi sendt en lenke. Lenken gjelder i 1 time.
        </Alert>
      ) : (
        <PostForm action="/glemt-passord" className="space-y-4">
          <Field label="E-post" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <Button type="submit" className="w-full" busyLabel="Sender …">
            Send lenke
          </Button>
        </PostForm>
      )}
      <p className="mt-4 text-center text-[14px]">
        <a href="/logg-inn">Tilbake til innlogging</a>
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
