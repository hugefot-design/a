import type { ReactNode } from 'react';
import { LuCheck } from 'react-icons/lu';
import { PAID_PLANS, PLANS, type PlanId } from '@/domain/billing/plans';
import { buttonVariants, cn, Logo, Panel } from '../components';
import { AppShell } from '../layouts';

const ORDER: PlanId[] = ['free', 'starter', 'professional', 'business', 'enterprise'];

/** Planene som gir mer enn `from`, fra og med `minPlan`. Enterprise vises som «etter avtale». */
function plansFrom(minPlan: PlanId): PlanId[] {
  const start = ORDER.indexOf(minPlan);
  return ORDER.filter((p, i) => i >= start && (PAID_PLANS.includes(p as never) || p === 'enterprise'));
}

/** Felles oppgraderingsvisning: hva som er nådd/låst, hva planene gir, og én tydelig vei videre. */
function UpgradePanel({ title, intro, meter, minPlan }: { title: string; intro: ReactNode; meter?: { used: number; limit: number; label: string }; minPlan: PlanId }) {
  const plans = plansFrom(minPlan);
  return (
    <AppShell>
      <div className="max-w-4xl">
        <h1 className="text-[28px] font-[760] leading-tight tracking-[-0.02em] text-navy-950 sm:text-[34px]">{title}</h1>
        <div className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink">{intro}</div>
        {meter ? (
          <div className="mt-5 max-w-md">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-semibold text-ink">{meter.label}</span>
              <span className="font-mono text-navy-950">
                {meter.used} av {meter.limit}
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-navy-100" role="meter" aria-valuemin={0} aria-valuemax={meter.limit} aria-valuenow={meter.used} aria-label={meter.label}>
              <div className="h-2 rounded-full bg-navy-600" style={{ width: `${Math.min(100, (meter.used / Math.max(1, meter.limit)) * 100)}%` }} />
            </div>
          </div>
        ) : null}
        <div className={cn('mt-8 grid grid-cols-1 gap-4', plans.length > 2 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
          {plans.slice(0, 3).map((id) => {
            const p = PLANS[id];
            return (
              <Panel key={id} className="flex flex-col p-5">
                <p className="text-[17px] font-[720] text-navy-950">{p.name}</p>
                <p className="mt-1 text-[22px] font-[760] text-navy-950">
                  {p.priceNok ? (
                    <>
                      {p.priceNok} <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">kr/mnd eks. mva.</span>
                    </>
                  ) : (
                    'Pris etter avtale'
                  )}
                </p>
                <ul className="mt-3 flex-1 space-y-1.5 text-[13px] text-ink">
                  {p.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex gap-2">
                      <LuCheck className="mt-[3px] size-3.5 shrink-0 text-navy-700" aria-hidden strokeWidth={2.5} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={id === 'enterprise' ? '/kontakt' : '/app/abonnement'}
                  className={buttonVariants({ variant: id === minPlan ? 'primary' : 'secondary', className: 'mt-4 w-full' })}
                >
                  {id === 'enterprise' ? 'Kontakt oss' : `Velg ${p.name}`}
                </a>
              </Panel>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <a href="/app/abonnement" className={buttonVariants({ variant: 'ghost' })}>
            Sammenlign alle planer
          </a>
          <a href="/app" className={buttonVariants({ variant: 'ghost' })}>
            Tilbake til oversikten
          </a>
        </div>
      </div>
    </AppShell>
  );
}

/** Når en gratisgrense er nådd (håndheves på serveren). */
export function LimitReachedPage({ kind, used, limit }: { kind: 'search' | 'bookmarks' | 'ai'; used: number; limit: number }) {
  const copy = {
    search: {
      title: 'Dagens søk er brukt opp',
      intro: `Gratisplanen har ${limit} søk per dag. Du kan fortsatt bla i listen og gjenta søk du har gjort i dag. Grensen nullstilles ved midnatt.`,
      label: 'Søk i dag',
    },
    bookmarks: {
      title: 'Du har lagret så mange anbud som planen tillater',
      intro: `Gratisplanen har plass til ${limit} lagrede anbud. Fjern et anbud, eller oppgrader for å lagre flere.`,
      label: 'Lagrede anbud',
    },
    ai: {
      title: 'Månedens AI-sammendrag er brukt',
      intro: `Gratisplanen har ${limit} AI-sammendrag per måned. Det fornyes den 1. i neste måned.`,
      label: 'AI denne måneden',
    },
  }[kind];
  return <UpgradePanel title={copy.title} intro={<p>{copy.intro} Med en betalt plan forsvinner grensen.</p>} meter={{ used, limit, label: copy.label }} minPlan="starter" />;
}

export function ErrorPage({ status, message, requestId }: { status: number; message: string; requestId: string }) {
  const title =
    status === 404 ? 'Vi fant ikke siden' : status === 403 ? 'Ingen tilgang' : status === 401 ? 'Du må logge inn' : status === 413 ? 'Filen er for stor' : 'Noe gikk galt';
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
        <a href="/" className="no-underline">
          <Logo />
        </a>
      </header>
      <main id="innhold" className="mx-auto w-full max-w-xl flex-1 px-4 pt-10 sm:px-6">
        <p className="num text-[13px] font-semibold text-muted">Feil {status}</p>
        <h1 className="mt-1 font-serif text-[30px] font-semibold text-navy-900">{title}</h1>
        <p className="mt-3 text-[15px] text-ink">{message}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <a href="/app" className={buttonVariants({ variant: 'primary' })}>
            Til oversikten
          </a>
          <a href="/" className={buttonVariants({ variant: 'secondary' })}>
            Til forsiden
          </a>
        </div>
        {status >= 500 ? (
          <p className="mt-8 text-[12px] text-muted">
            Referanse: <span className="num">{requestId}</span>
          </p>
        ) : null}
      </main>
    </div>
  );
}

export function FeatureLockedPage({ feature, minPlan }: { feature: string; minPlan: PlanId }) {
  const plan = PLANS[minPlan];
  return (
    <UpgradePanel
      title={`${feature} er ikke med i planen din`}
      intro={
        <p>
          {feature} er med fra {plan.name}
          {plan.priceNok ? ` (${plan.priceNok} kr per måned eks. mva.)` : ' (pris etter avtale)'}. Tilgangen styres av abonnementet, så funksjonen åpner seg
          med en gang du oppgraderer.
        </p>
      }
      minPlan={minPlan}
    />
  );
}
