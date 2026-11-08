/**
 * Totrinnsinnlogging: oppsett med QR-kode, reservekoder (vises én gang), status med passkeys,
 * «bekreft at det er deg» (admin hver 12. time og før viktige endringer) og «logg ut alle enheter».
 * Bare på norsk (del av appen). Samme mørke/gule uttrykk som nettsiden.
 */
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { LuCircleCheck, LuCopy, LuDownload, LuFingerprint, LuKeyRound, LuLogOut, LuShieldAlert, LuShieldCheck, LuSmartphone, LuTrash2 } from 'react-icons/lu';
import type { MfaStatus } from '@/domain/auth/mfa';
import type { Passkey } from '@/domain/auth/passkeys';
import { Alert, Button, buttonVariants, cn, CsrfField, Field, Input, PostForm } from '../components';
import { useUi } from '../context';
import { formatDate, formatDateTime } from '../format';
import { AuthLayout, type AuthSide } from '../layouts';
import { CodeInput, PasskeyForm, RecoveryCodeForm } from '../two-factor';

function useSecureSide(): AuthSide {
  const { m } = useUi();
  return { ...m.auth.mfa.side, secure: true };
}

function NextField({ next }: { next?: string }) {
  return next ? <input type="hidden" name="neste" value={next} /> : null;
}

function Eyebrow({ tone = 'signal', icon: Icon, children }: { tone?: 'signal' | 'ok' | 'warn'; icon: IconType; children: ReactNode }) {
  const styles = {
    signal: 'bg-night text-signal',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-urgent-soft text-urgent',
  }[tone];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold uppercase tracking-[0.08em]', styles)}>
      <Icon className="size-3.5" aria-hidden /> {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Oppsett
// ---------------------------------------------------------------------------
function Step({ n, title, last, children }: { n: number; title: string; last?: boolean; children: ReactNode }) {
  return (
    <li className={cn('relative pl-12', last ? '' : 'pb-9')}>
      {last ? null : <span className="absolute bottom-0 left-[15px] top-10 w-px bg-line" aria-hidden />}
      <span className="absolute left-0 top-0 flex size-8 items-center justify-center rounded-full bg-night text-[14px] font-bold text-signal" aria-hidden>
        {n}
      </span>
      <p className="pt-1 text-[16px] font-semibold text-strong">
        <span className="sr-only">Steg {n}: </span>
        {title}
      </p>
      <div className="mt-2 text-[14px] leading-relaxed text-muted">{children}</div>
    </li>
  );
}

export function MfaSetupPage({ qrDataUrl, secret, error, required, next }: { qrDataUrl: string; secret: string; error?: string; required: boolean; next?: string }) {
  const side = useSecureSide();
  const grouped = secret.match(/.{1,4}/g)?.join(' ') ?? secret;
  return (
    <AuthLayout
      side={side}
      eyebrow={required ? <Eyebrow icon={LuShieldCheck}>Påkrevd for admin</Eyebrow> : null}
      title="Slå på totrinnsinnlogging"
      intro={
        required
          ? 'Admin-panelet viser alle kundene, så det krever en kode fra telefonen i tillegg til passordet. Det tar to minutter.'
          : 'Med totrinnsinnlogging trengs en kode fra telefonen i tillegg til passordet. Da hjelper det ikke å kjenne passordet ditt alene.'
      }
    >
      {error ? (
        <Alert tone="danger" className="mb-6">
          {error}
        </Alert>
      ) : null}
      <ol>
        <Step n={1} title="Hent en kode-app">
          For eksempel Google Authenticator, Microsoft Authenticator eller 1Password. Gratis i App Store og Google Play.
        </Step>
        <Step n={2} title="Skann QR-koden med appen">
          <div className="mt-3 rounded-2xl border border-line bg-surface p-4 shadow-[0_18px_40px_-30px_rgba(6,14,27,0.55)]">
            <div className="flex justify-center rounded-xl bg-cream/70 p-3">
              <img src={qrDataUrl} alt="QR-kode for å legge AnbudRadar til i kode-appen" width={176} height={176} className="rounded-lg bg-white p-1.5" />
            </div>
            <p className="mt-4 text-[13px]">Kan du ikke skanne? Skriv inn denne nøkkelen i appen:</p>
            <div className="mt-2 flex items-stretch gap-2">
              <p className="flex-1 select-all break-words rounded-lg bg-cream px-3 py-2 font-mono text-[14px] leading-relaxed text-strong">{grouped}</p>
              <button type="button" data-copy={secret} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'h-auto self-stretch px-3')} aria-label="Kopier nøkkelen">
                <LuCopy className="size-4" aria-hidden />
                <span data-label>Kopier</span>
              </button>
            </div>
          </div>
        </Step>
        <Step n={3} title="Skriv inn koden appen viser" last>
          <PostForm action="/konto/totrinn" className="mt-3 space-y-3">
            <NextField next={next} />
            <CodeInput label="Sekssifret kode" invalid={Boolean(error)} autoFocus={false} />
            <Button type="submit" size="lg" className="w-full" busyLabel="Sjekker …">
              Slå på totrinnsinnlogging
            </Button>
          </PostForm>
        </Step>
      </ol>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Reservekoder (vises bare én gang)
// ---------------------------------------------------------------------------
export function MfaRecoveryCodesPage({ codes, next, fresh }: { codes: string[]; next?: string; fresh: boolean }) {
  const side = useSecureSide();
  const text = `AnbudRadar – reservekoder\nHver kode kan brukes én gang hvis du ikke har telefonen.\n\n${codes.join('\n')}\n`;
  return (
    <AuthLayout
      side={side}
      eyebrow={<Eyebrow tone="ok" icon={LuCircleCheck}>{fresh ? 'Totrinn er på' : 'Nye koder laget'}</Eyebrow>}
      title="Lagre reservekodene"
      intro="Mister du telefonen, logger du inn med en av disse. Hver kode virker én gang. Lagre dem et trygt sted, for eksempel i passordbehandleren din – de vises bare nå."
    >
      <Alert tone={fresh ? 'ok' : 'info'} className="mb-5">
        {fresh ? 'Fra nå trenger du en kode fra appen når du logger inn. Andre innlogginger er logget ut.' : 'De gamle reservekodene virker ikke lenger.'}
      </Alert>
      <div className="rounded-2xl border border-line bg-cream p-5">
        <ol className="grid grid-cols-2 gap-x-6 gap-y-2.5 font-mono text-[15px] text-strong">
          {codes.map((c, i) => (
            <li key={c} className="flex items-baseline gap-2">
              <span className="w-5 text-right font-sans text-[12px] text-faint" aria-hidden>
                {i + 1}.
              </span>
              <span className="select-all">{c}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
          <button type="button" data-copy={codes.join('\n')} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <LuCopy className="size-4" aria-hidden /> <span data-label>Kopier alle</span>
          </button>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="anbudradar-reservekoder.txt" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            <LuDownload className="size-4" aria-hidden /> Last ned
          </a>
        </div>
      </div>
      <a href={next ?? '/konto/totrinn'} className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'mt-6 w-full')}>
        Jeg har lagret kodene
      </a>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Status: kode-app, passkeys, reservekoder, slå av
// ---------------------------------------------------------------------------
function Card({ id, icon: Icon, title, status, children }: { id?: string; icon: IconType; title: string; status?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-night text-signal" aria-hidden>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-[16px] font-semibold text-strong">{title}</h2>
            {status}
          </div>
          <div className="mt-1.5 text-[14px] leading-relaxed text-muted">{children}</div>
        </div>
      </div>
    </section>
  );
}

function Pill({ tone, children }: { tone: 'ok' | 'muted'; children: ReactNode }) {
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-semibold', tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-cream text-muted')}>{children}</span>
  );
}

const CONFIRM_FIRST = `/konto/bekreft?neste=${encodeURIComponent('/konto/totrinn#passkeys')}`;

export function MfaStatusPage({
  status,
  isAdmin,
  passkeys,
  recentlyVerified,
  suggestedName,
  error,
}: {
  status: MfaStatus;
  isAdmin: boolean;
  passkeys: Passkey[];
  recentlyVerified: boolean;
  suggestedName: string;
  error?: string;
}) {
  const side = useSecureSide();
  return (
    <AuthLayout
      side={side}
      eyebrow={<Eyebrow tone="ok" icon={LuShieldCheck}>Totrinn er på</Eyebrow>}
      title="Totrinnsinnlogging"
      intro="Passordet alene er ikke nok for å logge inn på kontoen din. Her ser du hvilke måter du kan bekrefte på."
    >
      {error ? (
        <Alert tone="danger" className="mb-5">
          {error}
        </Alert>
      ) : null}
      <div className="space-y-4">
        <Card icon={LuSmartphone} title="Kode-app" status={<Pill tone="ok">På</Pill>}>
          Slått på {status.enabledAt ? formatDate(status.enabledAt) : ''}. Skriv inn koden fra appen når du logger inn.
        </Card>

        <Card id="passkeys" icon={LuFingerprint} title="Face ID / fingeravtrykk" status={<Pill tone={passkeys.length ? 'ok' : 'muted'}>{passkeys.length ? `${passkeys.length} lagt til` : 'Valgfritt'}</Pill>}>
          <p>
            Bekreft med Face ID, fingeravtrykk, Windows Hello eller en sikkerhetsnøkkel i stedet for å skrive koden. Virker bare på vår adresse, så en falsk innloggingsside kan ikke lure deg.
          </p>
          {passkeys.length ? (
            <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
              {passkeys.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-strong">{p.name}</p>
                    <p className="text-[12px] text-muted">
                      Lagt til {formatDate(p.createdAt)} · {p.lastUsedAt ? `brukt ${formatDateTime(p.lastUsedAt)}` : 'ikke brukt ennå'}
                    </p>
                  </div>
                  <PostForm action={`/konto/passkey/${p.id}/fjern`} confirm={`Fjerne «${p.name}»?`}>
                    <Button type="submit" variant="ghost" size="sm" aria-label={`Fjern ${p.name}`} title="Fjern">
                      <LuTrash2 className="size-4" aria-hidden />
                    </Button>
                  </PostForm>
                </li>
              ))}
            </ul>
          ) : null}
          {recentlyVerified ? (
            <>
              <form method="post" action="/konto/passkey" data-passkey-register="/konto/passkey/valg" hidden className="mt-4 space-y-3">
                <CsrfField />
                <input type="hidden" name="response" value="" />
                <Field label="Navn på enheten" htmlFor="passkey-name" hint="Så du kjenner den igjen senere, for eksempel «iPhone» eller «Jobb-PC».">
                  <Input id="passkey-name" name="name" defaultValue={suggestedName} maxLength={60} required />
                </Field>
                <Button type="submit" variant="signal" busyLabel="Venter på enheten …">
                  <LuFingerprint className="size-4" aria-hidden /> Legg til Face ID / fingeravtrykk
                </Button>
                <p data-passkey-error hidden role="alert" className="text-[13px] font-medium text-danger" />
              </form>
              <p data-passkey-unsupported className="mt-3 text-[13px]">
                Krever en nyere nettleser med JavaScript slått på. Koden fra appen virker uansett.
              </p>
            </>
          ) : (
            <div className="mt-4">
              <a href={CONFIRM_FIRST} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                Bekreft med kode for å legge til
              </a>
              <p className="mt-2 text-[12px]">Av sikkerhetshensyn må du ha bekreftet de siste 15 minuttene før du endrer innloggingsmåter.</p>
            </div>
          )}
        </Card>

        <Card id="reservekoder" icon={LuKeyRound} title="Reservekoder" status={<Pill tone={status.recoveryLeft > 2 ? 'ok' : 'muted'}>{status.recoveryLeft} av 10 ubrukt</Pill>}>
          <p>Engangskoder for når du ikke har telefonen. Lag nye hvis du har brukt mange, eller tror noen har sett dem.</p>
          <PostForm action="/konto/totrinn/reservekoder" className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Kode fra appen" htmlFor="code-r">
              <Input id="code-r" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} className="w-40 font-mono tracking-[0.2em]" />
            </Field>
            <Button type="submit" variant="secondary">
              Lag nye koder
            </Button>
          </PostForm>
        </Card>

        <section className="rounded-2xl border border-dashed border-line-strong p-5">
          <h2 className="text-[16px] font-semibold text-strong">Slå av totrinnsinnlogging</h2>
          {isAdmin ? (
            <p className="mt-1 text-[14px] text-muted">Administratorer må ha totrinnsinnlogging. Har du mistet telefonen, bruk en reservekode og sett opp på nytt.</p>
          ) : (
            <PostForm action="/konto/totrinn/av" className="mt-3 space-y-3" confirm="Slå av totrinnsinnlogging? Da holder passordet alene.">
              <Field label="Passord" htmlFor="pw">
                <Input id="pw" name="password" type="password" autoComplete="current-password" required />
              </Field>
              <Field label="Kode fra appen" htmlFor="code-off">
                <Input id="code-off" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} className="font-mono tracking-[0.2em]" />
              </Field>
              <Button type="submit" variant="danger">
                Slå av
              </Button>
            </PostForm>
          )}
        </section>
      </div>
      <p className="mt-8 text-center text-[14px]">
        <a href={isAdmin ? '/admin' : '/app/innstillinger'}>{isAdmin ? 'Tilbake til admin' : 'Tilbake til innstillinger'}</a>
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Bekreft at det er deg (ny bekreftelse i en økt)
// ---------------------------------------------------------------------------
export function StepUpPage({ next, error, passkeyOptions, isAdmin }: { next: string; error?: string; passkeyOptions: string | null; isAdmin: boolean }) {
  const { m } = useUi();
  const t = m.auth.mfa;
  const side = useSecureSide();
  return (
    <AuthLayout
      side={side}
      eyebrow={<Eyebrow icon={LuShieldCheck}>Sikkerhetssjekk</Eyebrow>}
      title="Bekreft at det er deg"
      intro={
        isAdmin
          ? 'Admin-panelet ber om en ny bekreftelse hver 12. time og før viktige endringer, som tilganger og planer.'
          : 'Denne endringen krever at du bekrefter med kode eller passkey først.'
      }
    >
      {error ? (
        <Alert tone="danger" className="mb-5">
          {error}
        </Alert>
      ) : null}
      {passkeyOptions ? (
        <PasskeyForm action="/konto/bekreft" optionsJson={passkeyOptions} fields={{ neste: next }} label={t.passkey} busyLabel={t.passkeyBusy} failedText={t.passkeyFailed} orText={t.or} />
      ) : null}
      <PostForm action="/konto/bekreft" className="space-y-4">
        <NextField next={next} />
        <CodeInput label="Kode fra appen" invalid={Boolean(error)} autoFocus={!passkeyOptions} />
        <Button type="submit" size="lg" className="w-full" busyLabel={t.busy}>
          Bekreft
        </Button>
      </PostForm>
      <RecoveryCodeForm action="/konto/bekreft" fields={{ neste: next }} toggle={t.recoveryToggle} label={t.recoveryLabel} submit="Bekreft med reservekode" busy={t.busy} />
      <p className="mt-6 text-center text-[14px]">
        <a href="/">Avbryt</a>
      </p>
    </AuthLayout>
  );
}

// ---------------------------------------------------------------------------
// Logg ut alle enheter (lenken i sikkerhetsvarslene)
// ---------------------------------------------------------------------------
export function RevokeAllConfirmPage({ token }: { token: string }) {
  const side = useSecureSide();
  return (
    <AuthLayout
      side={side}
      eyebrow={<Eyebrow tone="warn" icon={LuShieldAlert}>Var det ikke deg?</Eyebrow>}
      title="Logg ut alle enheter"
      intro="Bruk dette hvis noen andre kan ha logget inn på kontoen din. Alle innlogginger avsluttes, også her."
    >
      <PostForm action="/konto/logg-ut-overalt" className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" variant="danger" size="lg" className="w-full" busyLabel="Logger ut …">
          <LuLogOut className="size-4" aria-hidden /> Logg ut alle enheter
        </Button>
      </PostForm>
      <p className="mt-4 text-[13px] leading-relaxed text-muted">Etterpå bør du bytte passord. Har noen tilgang til kode-appen din, setter du opp totrinn på nytt etter innlogging.</p>
    </AuthLayout>
  );
}

export function RevokeAllDonePage({ count }: { count: number }) {
  const side = useSecureSide();
  return (
    <AuthLayout
      side={side}
      eyebrow={<Eyebrow tone="ok" icon={LuCircleCheck}>Ferdig</Eyebrow>}
      title="Alle enheter er logget ut"
      intro={count === 1 ? 'Én innlogging ble avsluttet.' : `${count} innlogginger ble avsluttet.`}
    >
      <ol className="space-y-3 text-[14px] leading-relaxed text-muted">
        <li>
          <strong className="text-strong">1. Bytt passord nå.</strong> Den som logget inn, kan kjenne det.
        </li>
        <li>
          <strong className="text-strong">2. Logg inn igjen</strong> med det nye passordet og koden fra appen.
        </li>
        <li>
          <strong className="text-strong">3. Kan noen ha telefonen din?</strong> Sett opp totrinn på nytt under Innstillinger.
        </li>
      </ol>
      <a href="/glemt-passord" className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'mt-7 w-full')}>
        Bytt passord
      </a>
    </AuthLayout>
  );
}
