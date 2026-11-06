/**
 * Byggeklosser for andre steg i innloggingen: stor kodeboks, passkey-knapp og reservekode.
 * Brukes av kodesiden ved innlogging (oversatt) og av sidene under /konto (norsk).
 * Alt virker uten JavaScript, bortsett fra passkey-knappen, som bare vises når nettleseren støtter det.
 */
import { LuFingerprint, LuKeyRound } from 'react-icons/lu';
import { Button, buttonVariants, cn, CsrfField, Field, Input } from './components';

function HiddenFields({ fields }: { fields: Record<string, string | undefined> }) {
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />))}
    </>
  );
}

/** Seks siffer: talltastatur på mobil, kan limes inn, og skjemaet sendes når alle seks er skrevet. */
export function CodeInput({ label, invalid, autoFocus = true, id = 'code' }: { label: string; invalid?: boolean; autoFocus?: boolean; id?: string }) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-[13px] font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        name="code"
        className="code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        required
        autoFocus={autoFocus}
        placeholder="······"
        aria-invalid={invalid ? 'true' : undefined}
        data-code-autosubmit
      />
    </div>
  );
}

/**
 * «Bruk Face ID / fingeravtrykk». Valgene til nettleseren ligger i data-passkey-auth; klientskriptet
 * spør enheten, legger svaret i skjemaet og sender det. Skjult til skriptet ser at nettleseren støtter det.
 */
export function PasskeyForm({
  action,
  optionsJson,
  fields,
  label,
  busyLabel,
  failedText,
  orText,
}: {
  action: string;
  optionsJson: string;
  fields: Record<string, string | undefined>;
  label: string;
  busyLabel: string;
  failedText: string;
  orText?: string;
}) {
  return (
    <form method="post" action={action} data-passkey-auth={optionsJson} hidden className="mb-7">
      <CsrfField />
      <HiddenFields fields={fields} />
      <input type="hidden" name="passkey" value="" />
      <button type="button" data-passkey-start className={cn(buttonVariants({ variant: 'signal', size: 'lg' }), 'h-14 w-full text-[16px]')}>
        <span className="idle-label inline-flex items-center gap-2.5">
          <LuFingerprint className="size-5" aria-hidden /> {label}
        </span>
        <span className="busy-label">{busyLabel}</span>
      </button>
      <p data-passkey-error hidden role="alert" className="mt-3 text-[13px] font-medium text-danger">
        {failedText}
      </p>
      {orText ? (
        <p className="mt-7 flex items-center gap-3 text-[13px] text-muted">
          <span className="h-px flex-1 bg-line" aria-hidden />
          {orText}
          <span className="h-px flex-1 bg-line" aria-hidden />
        </p>
      ) : null}
    </form>
  );
}

/** Reservekode i en egen, sammenfoldet boks – koden fra appen er det vanlige. */
export function RecoveryCodeForm({
  action,
  fields,
  toggle,
  label,
  submit,
  busy,
}: {
  action: string;
  fields: Record<string, string | undefined>;
  toggle: string;
  label: string;
  submit: string;
  busy: string;
}) {
  return (
    <details className="mt-6 rounded-2xl border border-line bg-cream/60 px-4 py-3" data-keep-open>
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[14px] font-semibold text-night [&::-webkit-details-marker]:hidden">
        <LuKeyRound className="size-4 text-muted" aria-hidden /> {toggle}
      </summary>
      <form method="post" action={action} className="mt-4 space-y-3 pb-1">
        <CsrfField />
        <HiddenFields fields={fields} />
        <Field label={label} htmlFor="recovery-code">
          <Input
            id="recovery-code"
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            maxLength={20}
            placeholder="XXXXX-XXXXX"
            className="font-mono tracking-[0.15em]"
          />
        </Field>
        <Button type="submit" variant="secondary" className="w-full" busyLabel={busy}>
          {submit}
        </Button>
      </form>
    </details>
  );
}
