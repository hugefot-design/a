import { PLANS, type PlanId } from '@/domain/billing/plans';
import { buttonVariants, Logo, Panel } from '../components';
import { AppShell } from '../layouts';

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
    <AppShell>
      <Panel className="max-w-2xl p-6 sm:p-8">
        <h1 className="font-serif text-[26px] font-semibold text-navy-900">{feature} er ikke med i planen din</h1>
        <p className="mt-3 text-[15px] text-ink">
          {feature} er tilgjengelig fra planen {plan.name}
          {plan.priceNok ? ` (${plan.priceNok} kr per måned eks. mva.)` : ''}.
        </p>
        <ul className="mt-4 space-y-1.5 text-[14px] text-muted">
          {plan.features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <div className="mt-6 flex flex-wrap gap-2">
          <a href="/app/abonnement" className={buttonVariants({ variant: 'primary' })}>
            Se planer
          </a>
          <a href="/app" className={buttonVariants({ variant: 'secondary' })}>
            Tilbake
          </a>
        </div>
      </Panel>
    </AppShell>
  );
}
