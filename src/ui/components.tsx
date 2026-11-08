import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import { LuCircleAlert, LuCircleCheck, LuInfo, LuMoon, LuSun, LuTriangleAlert } from 'react-icons/lu';
import { useUi } from './context';
import { daysUntil, deadlineLabel, formatDateTime } from './format';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Knapper
// ---------------------------------------------------------------------------
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold no-underline transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2',
  {
    variants: {
      variant: {
        /** Natt med hvit tekst; i mørk modus lys knapp med mørk tekst. */
        primary: 'bg-strong text-surface hover:bg-night-700 dark:hover:bg-ink',
        /** Den gule knappen fra nettsiden – til de viktigste handlingene (oppgradere, starte). */
        signal: 'bg-signal text-night shadow-[0_8px_24px_-12px_rgba(245,178,16,0.9)] hover:bg-[#ffd36b]',
        secondary: 'border border-line-strong bg-surface text-strong hover:border-strong',
        ghost: 'text-strong hover:bg-strong/5',
        danger: 'border border-danger/30 bg-surface text-danger hover:bg-danger-soft',
        inverse: 'bg-white text-night hover:bg-[#fbf8f1]',
        link: 'px-0 py-0 text-navy-700 underline hover:text-strong',
      },
      size: {
        sm: 'h-8 px-3.5 text-[13px]',
        md: 'h-10 px-5 text-[14px]',
        lg: 'h-12 px-6 text-[15px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonVariantProps = VariantProps<typeof buttonVariants>;

export function Button({
  variant,
  size,
  className,
  busyLabel,
  children,
  ...rest
}: ButtonVariantProps & React.ButtonHTMLAttributes<HTMLButtonElement> & { busyLabel?: string }) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...rest}>
      {busyLabel ? (
        <>
          <span className="idle-label inline-flex items-center gap-2">{children}</span>
          <span className="busy-label">{busyLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export function LinkButton({
  variant,
  size,
  className,
  ...rest
}: ButtonVariantProps & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cn(buttonVariants({ variant, size }), className)} {...rest} />;
}

// ---------------------------------------------------------------------------
// Skjema
// ---------------------------------------------------------------------------
export function CsrfField() {
  const { csrfToken } = useUi();
  return <input type="hidden" name="_csrf" value={csrfToken} />;
}

/** POST-skjema med CSRF-token innebygd. */
export function PostForm({
  action,
  children,
  className,
  confirm,
  multipart,
  id,
}: {
  action: string;
  children: ReactNode;
  className?: string;
  confirm?: string;
  multipart?: boolean;
  id?: string;
}) {
  return (
    <form
      id={id}
      method="post"
      action={action}
      className={className}
      encType={multipart ? 'multipart/form-data' : undefined}
      data-confirm={confirm}
    >
      <CsrfField />
      {children}
    </form>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-[13px] text-muted">{hint}</p> : null}
      {error ? (
        <p className="text-[13px] font-medium text-danger" id={htmlFor ? `${htmlFor}-error` : undefined}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, invalid, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn('field-input', className)}
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={invalid && rest.id ? `${rest.id}-error` : undefined}
      {...rest}
    />
  );
}

export function Textarea({ className, invalid, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea className={cn('field-input min-h-24', className)} aria-invalid={invalid ? 'true' : undefined} {...rest} />;
}

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('field-input', className)} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({ label, hint, className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-[14px]', className)}>
      <input type="checkbox" className="mt-[3px] size-4 shrink-0 accent-navy-900" {...rest} />
      <span>
        <span className="text-ink">{label}</span>
        {hint ? <span className="block text-[13px] text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Struktur
// ---------------------------------------------------------------------------
export function Panel({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={cn('rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(6,14,27,0.04)]', className)}>{children}</As>;
}

export function PanelHeader({ title, action, description }: { title: ReactNode; action?: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15.5px] font-[680] tracking-[-0.01em] text-strong">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-3xl">
        <h1 className="text-[28px] font-[780] leading-[1.08] tracking-[-0.03em] text-strong sm:text-[34px]">{title}</h1>
        {description ? <p className="mt-2 text-[15px] text-muted">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5 whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-navy-50 text-navy-800',
      ok: 'bg-ok-soft text-ok',
      urgent: 'bg-urgent-soft text-urgent',
      info: 'bg-info-soft text-info',
      danger: 'bg-danger-soft text-danger',
      marker: 'bg-marker-soft text-ink',
      ai: 'bg-ai-soft text-ai',
      outline: 'border border-line-strong text-muted',
      sample: 'border border-dashed border-urgent/50 bg-urgent-soft text-urgent',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ tone, className, children, title }: VariantProps<typeof badgeVariants> & { className?: string; children: ReactNode; title?: string }) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} title={title}>
      {children}
    </span>
  );
}

export function SampleBadge() {
  return (
    <Badge tone="sample" title="Fiktiv kunngjøring laget for utvikling. Ikke en ekte anskaffelse.">
      Eksempeldata
    </Badge>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'ok' | 'warning' | 'danger';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-info/20 bg-info-soft text-ink',
    ok: 'border-ok/20 bg-ok-soft text-ink',
    warning: 'border-urgent/25 bg-urgent-soft text-ink',
    danger: 'border-danger/25 bg-danger-soft text-ink',
  }[tone];
  const Icon = { info: LuInfo, ok: LuCircleCheck, warning: LuTriangleAlert, danger: LuCircleAlert }[tone];
  const iconColor = { info: 'text-info', ok: 'text-ok', warning: 'text-urgent', danger: 'text-danger' }[tone];
  return (
    <div className={cn('flex gap-3 rounded-lg border px-4 py-3 text-[14px]', styles, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon className={cn('mt-0.5 size-[18px] shrink-0', iconColor)} aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title ? 'mt-0.5' : '', 'text-[14px]')}>{children}</div> : null}
      </div>
    </div>
  );
}

export function FlashMessage() {
  const { flash } = useUi();
  if (!flash) return null;
  const tone = flash.type === 'success' ? 'ok' : flash.type === 'error' ? 'danger' : 'info';
  return (
    <div className="mb-5" data-flash>
      <Alert tone={tone}>{flash.message}</Alert>
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-10 sm:px-8">
      {icon ? <div className="text-navy-300">{icon}</div> : null}
      <div>
        <p className="font-semibold text-navy-900">{title}</p>
        {children ? <div className="mt-1 max-w-xl text-[14px] text-muted">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="num mt-1 text-[24px] font-semibold leading-tight text-navy-900">{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function DefinitionList({ items, className }: { items: { term: ReactNode; detail: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('divide-y divide-line', className)}>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-3 py-2.5 text-[14px] sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <dt className="text-muted">{item.term}</dt>
          <dd className="min-w-0 break-words text-ink">{item.detail}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Domenespesifikke småkomponenter
// ---------------------------------------------------------------------------
export function DeadlineChip({ deadline, timeKnown = true, now }: { deadline: Date | string | null; timeKnown?: boolean; now?: Date }) {
  const days = daysUntil(deadline, now);
  const label = deadlineLabel(deadline, now);
  const tone = days === null ? 'outline' : days <= 0 ? 'outline' : days <= 3 ? 'urgent' : days <= 10 ? 'marker' : 'neutral';
  const title = deadline ? `Frist: ${formatDateTime(deadline, timeKnown)}` : 'Fristen er ikke oppgitt i kunngjøringen';
  return (
    <Badge tone={tone} title={title}>
      {label}
    </Badge>
  );
}

export function ScoreBar({ score, label = 'Relevans' }: { score: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = clamped >= 75 ? 'bg-navy-900' : clamped >= 50 ? 'bg-navy-600' : 'bg-navy-300';
  return (
    <div className="flex items-center gap-2" title={`${label}: ${clamped} av 100. Viser samsvar med profilen – ikke sjansen for å vinne.`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-navy-100" aria-hidden>
        <div className={cn('h-full rounded-full', color)} style={{ width: `${clamped}%` }} />
      </div>
      <span className="num text-[13px] font-semibold text-navy-900">{clamped} %</span>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function SourceTag({ source }: { source: string }) {
  const labels: Record<string, string> = { ted: 'TED', doffin: 'Doffin', manual: 'Manuell import', sample: 'Eksempel' };
  return <Badge tone={source === 'sample' ? 'sample' : 'outline'}>{labels[source] ?? source}</Badge>;
}

export function Pagination({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (p: number) => string }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[14px]" aria-label="Sider">
      {page > 1 ? (
        <a href={hrefFor(page - 1)} className={buttonVariants({ variant: 'secondary', size: 'sm' })} rel="prev">
          Forrige
        </a>
      ) : (
        <span />
      )}
      <span className="num text-muted">
        Side {page} av {totalPages}
      </span>
      {page < totalPages ? (
        <a href={hrefFor(page + 1)} className={buttonVariants({ variant: 'secondary', size: 'sm' })} rel="next">
          Neste
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function Tabs({ items }: { items: { href: string; label: ReactNode; active: boolean; count?: number }[] }) {
  return (
    <nav className="scroll-x -mx-1 mb-6 border-b border-line" aria-label="Faner">
      <ul className="flex min-w-max gap-1 px-1">
        {items.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[14px] font-semibold no-underline',
                item.active ? 'border-strong text-strong' : 'border-transparent text-muted hover:text-strong',
              )}
            >
              {item.label}
              {item.count !== undefined ? <span className={cn('num rounded-full px-1.5 text-[12px]', item.active ? 'bg-signal text-night' : 'bg-strong/5 text-navy-800')}>{item.count}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Bryter for lys og mørk modus. Vises bare med JavaScript (uten følger siden innstillingen på enheten).
 * Månen vises i lys modus, solen i mørk. Skriptet setter aria-pressed og husker valget.
 */
export function ThemeToggle({ dark = false, className }: { dark?: boolean; className?: string }) {
  const { m } = useUi();
  return (
    <button
      type="button"
      data-theme-toggle
      aria-pressed="false"
      aria-label={m.nav.theme}
      title={m.nav.theme}
      className={cn(
        'js-only flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
        dark ? 'text-white/80 hover:bg-white/10 hover:text-white' : 'text-muted hover:bg-strong/5 hover:text-strong',
        className,
      )}
    >
      <LuMoon className="size-[18px] dark:hidden" aria-hidden />
      <LuSun className="hidden size-[18px] dark:block" aria-hidden />
    </button>
  );
}

/** Logo: radarbue som treffer en markert prikk. Egendesignet, ikke basert på andre merker. */
export function Logo({ inverse = false, className }: { inverse?: boolean; className?: string }) {
  const stroke = 'currentColor';
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true" className={inverse ? 'text-white' : 'text-strong'}>
        <path d="M5 27 A22 22 0 0 1 27 5" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M11 27 A16 16 0 0 1 27 11" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" opacity="0.55" />
        <path d="M17 27 A10 10 0 0 1 27 17" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" opacity="0.3" />
        <circle cx="25.5" cy="25.5" r="3.6" fill="#ffc845" stroke={stroke} strokeWidth="1.4" />
      </svg>
      <span className={cn('text-[17px] font-bold tracking-[-0.01em]', inverse ? 'text-white' : 'text-strong')}>AnbudRadar</span>
    </span>
  );
}
