/**
 * Totrinnsinnlogging: oppsett med QR-kode, reservekoder (vises én gang) og status.
 * Påkrevd for administratorer, valgfritt for alle andre. Bare på norsk (del av appen).
 */
import { LuDownload, LuShieldCheck, LuSmartphone } from 'react-icons/lu';
import type { MfaStatus } from '@/domain/auth/mfa';
import { Alert, Button, Field, Input, PostForm } from '../components';
import { formatDate } from '../format';
import { AuthLayout } from '../layouts';

function NextField({ next }: { next?: string }) {
  return next ? <input type="hidden" name="neste" value={next} /> : null;
}

export function MfaSetupPage({ qrDataUrl, secret, error, required, next }: { qrDataUrl: string; secret: string; error?: string; required: boolean; next?: string }) {
  const grouped = secret.match(/.{1,4}/g)?.join(' ') ?? secret;
  return (
    <AuthLayout
      title="Slå på totrinnsinnlogging"
      intro={
        required
          ? 'Admin-panelet viser alle kundene, så det krever en kode fra telefonen i tillegg til passordet. Det tar to minutter.'
          : 'Med totrinnsinnlogging trengs en kode fra telefonen i tillegg til passordet. Da hjelper det ikke å kjenne passordet ditt alene.'
      }
    >
      {error ? (
        <Alert tone="danger" className="mb-5">
          {error}
        </Alert>
      ) : null}
      <ol className="space-y-6">
        <li>
          <p className="flex items-center gap-2 font-semibold text-night">
            <LuSmartphone className="size-4" aria-hidden /> 1. Installer en kode-app
          </p>
          <p className="mt-1 text-[14px] text-muted">For eksempel Google Authenticator, Microsoft Authenticator eller 1Password. Gratis i App Store og Google Play.</p>
        </li>
        <li>
          <p className="font-semibold text-night">2. Skann QR-koden med appen</p>
          <img src={qrDataUrl} alt="QR-kode for å legge AnbudRadar til i kode-appen" width={184} height={184} className="mt-3 rounded-xl border border-line bg-white p-2" />
          <p className="mt-3 text-[13px] text-muted">Kan du ikke skanne? Skriv inn denne nøkkelen i appen:</p>
          <p className="mt-1 select-all break-all rounded-lg bg-cream px-3 py-2 font-mono text-[14px] text-night">{grouped}</p>
        </li>
        <li>
          <p className="font-semibold text-night">3. Skriv inn koden appen viser</p>
          <PostForm action="/konto/totrinn" className="mt-3 space-y-3">
            <NextField next={next} />
            <Field label="Sekssifret kode" htmlFor="code">
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" required maxLength={7} className="text-center font-mono text-[22px] tracking-[0.3em]" />
            </Field>
            <Button type="submit" className="w-full" busyLabel="Sjekker …">
              Slå på
            </Button>
          </PostForm>
        </li>
      </ol>
    </AuthLayout>
  );
}

export function MfaRecoveryCodesPage({ codes, next, fresh }: { codes: string[]; next?: string; fresh: boolean }) {
  const text = `AnbudRadar – reservekoder\nHver kode kan brukes én gang hvis du ikke har telefonen.\n\n${codes.join('\n')}\n`;
  return (
    <AuthLayout
      title={fresh ? 'Totrinnsinnlogging er på' : 'Nye reservekoder'}
      intro="Lagre reservekodene et trygt sted, for eksempel i passordbehandleren din. Hver kode virker én gang hvis du mister telefonen. De vises bare nå."
    >
      <Alert tone="ok" className="mb-5" title={fresh ? 'Ferdig' : 'Laget'}>
        {fresh ? 'Fra nå trenger du en kode fra appen når du logger inn. Andre innlogginger er logget ut.' : 'De gamle reservekodene virker ikke lenger.'}
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-2xl bg-cream p-4 font-mono text-[15px] text-night">
        {codes.map((c) => (
          <li key={c} className="select-all text-center">
            {c}
          </li>
        ))}
      </ul>
      <a
        href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
        download="anbudradar-reservekoder.txt"
        className="mt-4 inline-flex items-center gap-2 text-[14px] font-semibold"
      >
        <LuDownload className="size-4" aria-hidden /> Last ned som tekstfil
      </a>
      <a href={next ?? '/konto/totrinn'} className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-night text-[15px] font-semibold text-white no-underline hover:bg-night-700">
        Jeg har lagret kodene
      </a>
    </AuthLayout>
  );
}

export function MfaStatusPage({ status, isAdmin, error }: { status: MfaStatus; isAdmin: boolean; error?: string }) {
  return (
    <AuthLayout title="Totrinnsinnlogging" intro="Du trenger en kode fra kode-appen i tillegg til passordet når du logger inn.">
      {error ? (
        <Alert tone="danger" className="mb-5">
          {error}
        </Alert>
      ) : null}
      <p className="flex items-center gap-2 rounded-2xl bg-ok-soft px-4 py-3 text-[14px] text-ok">
        <LuShieldCheck className="size-5 shrink-0" aria-hidden />
        <span>
          Slått på {status.enabledAt ? formatDate(status.enabledAt) : ''}. {status.recoveryLeft} av 10 reservekoder er ubrukt.
        </span>
      </p>
      <section className="mt-7">
        <h2 className="text-[16px] font-semibold text-night">Nye reservekoder</h2>
        <p className="mt-1 text-[14px] text-muted">Lager 10 nye koder. De gamle slutter å virke.</p>
        <PostForm action="/konto/totrinn/reservekoder" className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Kode fra appen" htmlFor="code-r">
            <Input id="code-r" name="code" inputMode="numeric" autoComplete="one-time-code" required maxLength={7} className="w-40 font-mono tracking-[0.2em]" />
          </Field>
          <Button type="submit" variant="secondary">
            Lag nye koder
          </Button>
        </PostForm>
      </section>
      <section className="mt-8 border-t border-line pt-6">
        <h2 className="text-[16px] font-semibold text-night">Slå av</h2>
        {isAdmin ? (
          <p className="mt-1 text-[14px] text-muted">Administratorer må ha totrinnsinnlogging. Har du mistet telefonen, bruk en reservekode og sett opp på nytt.</p>
        ) : (
          <PostForm action="/konto/totrinn/av" className="mt-3 space-y-3" confirm="Slå av totrinnsinnlogging?">
            <Field label="Passord" htmlFor="pw">
              <Input id="pw" name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="Kode fra appen eller en reservekode" htmlFor="code-off">
              <Input id="code-off" name="code" autoComplete="one-time-code" required maxLength={20} className="font-mono" />
            </Field>
            <Button type="submit" variant="danger">
              Slå av totrinnsinnlogging
            </Button>
          </PostForm>
        )}
      </section>
      <p className="mt-8 text-center text-[14px]">
        <a href="/app/innstillinger">Tilbake til innstillinger</a>
      </p>
    </AuthLayout>
  );
}
