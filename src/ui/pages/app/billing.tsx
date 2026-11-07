import { PAID_PLANS, PLANS, type PaidPlanId } from '@/domain/billing/plans';
import type { UsageSummary } from '@/domain/ai/usage';
import { useUi } from '../../context';
import { Alert, Badge, Button, cn, PageHeader, Panel, PanelHeader, PostForm } from '../../components';
import { AppShell } from '../../layouts';
import { formatDate, formatInt, formatMoney } from '../../format';

export interface BillingProps {
  stripeConfigured: boolean;
  stripeTestMode: boolean;
  usage: UsageSummary;
  payments: { amountCents: number; currency: string; status: string; createdAt: Date; hostedInvoiceUrl: string | null }[];
  hasStripeSubscription: boolean;
  hasCustomer: boolean;
  checkout: string | null;
  bookmarkCount: number;
  memberCount: number;
  searchQuota: { used: number; limit: number; unlimited: boolean };
}

/** Én linje med forbruk og en tynn måler når det finnes en grense. */
function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit >= 1_000_000;
  const pct = unlimited || limit <= 0 ? 0 : Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="flex justify-between gap-3">
        <dt className="text-muted">{label}</dt>
        <dd className="font-mono text-[13px] text-ink">
          {formatInt(used)}
          {unlimited ? ' · ubegrenset' : ` av ${formatInt(limit)}`}
        </dd>
      </div>
      {!unlimited && limit > 0 ? (
        <div className="mt-1 h-1.5 rounded-full bg-navy-100" aria-hidden>
          <div className={cn('h-1.5 rounded-full', pct >= 100 ? 'bg-urgent' : 'bg-navy-600')} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function BillingPage(p: BillingProps) {
  const { org, user } = useUi();
  const b = org!.billing;
  const canManage = org!.role === 'owner' || org!.role === 'admin';
  return (
    <AppShell>
      <PageHeader title="Abonnement" description="Priser er per måned, eks. mva. Abonnementet kan sies opp når som helst og gjelder ut perioden." />
      {org?.adminAccess ? (
        <Alert tone="info" className="mb-5" title="Admin-tilgang">
          Organisasjonen eies av en administrator og har alle funksjoner uten betaling. Kjøp her ville gitt et ekte abonnement –
          prøv betalingen med en vanlig testkonto i stedet.
        </Alert>
      ) : null}
      {p.checkout === 'fullfort' ? (
        <Alert tone="info" className="mb-5" title="Takk! Vi venter på bekreftelse fra Stripe.">
          Planen aktiveres så snart betalingen er bekreftet, vanligvis innen et minutt. Last inn siden på nytt om litt.
        </Alert>
      ) : null}
      {p.checkout === 'avbrutt' ? <Alert tone="info" className="mb-5">Betalingen ble avbrutt. Ingenting er trukket.</Alert> : null}
      {!p.stripeConfigured ? (
        user?.isPlatformAdmin ? (
          <Alert tone="warning" className="mb-5" title="Betaling er ikke satt opp ennå">
            Stripe-nøkler mangler i konfigurasjonen. Planer kan ikke kjøpes før de er lagt inn (se docs/INTEGRASJONER.md).
          </Alert>
        ) : (
          <Alert tone="info" className="mb-5" title="Betaling åpner snart">
            Prøveperioden og gratisplanen virker som vanlig. Vil du bestille en plan nå, <a href="/kontakt">kontakt oss</a>.
          </Alert>
        )
      ) : p.stripeTestMode ? (
        <Alert tone="info" className="mb-5">
          Stripe kjører i testmodus. Bruk testkort 4242 4242 4242 4242 – ingen ekte penger trekkes.
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader title="Nåværende plan" />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <div>
              <p className="text-[13px] text-muted">Plan</p>
              <p className="mt-1 text-[18px] font-semibold text-navy-900">{b.label}</p>
            </div>
            <div>
              <p className="text-[13px] text-muted">
                {b.status === 'trial' ? 'Prøveperioden varer til' : b.cancelAtPeriodEnd ? 'Avsluttes' : 'Fornyes'}
              </p>
              <p className="num mt-1 text-[15px]">{formatDate(b.trialEndsAt ?? b.renewsAt)}</p>
            </div>
            <div>
              <p className="text-[13px] text-muted">Status</p>
              <p className="mt-1">
                <Badge tone={b.status === 'past_due' ? 'danger' : b.status === 'active' || b.status === 'trial' ? 'ok' : 'outline'}>
                  {{ trial: 'Prøveperiode', active: 'Aktiv', past_due: 'Betaling feilet', expired: 'Utløpt', canceled: 'Avsluttet', none: 'Gratis' }[b.status]}
                </Badge>
              </p>
            </div>
          </div>
          {b.notice ? <p className="border-t border-line px-5 py-3 text-[14px]">{b.notice}</p> : null}
          {canManage && p.hasCustomer && p.stripeConfigured ? (
            <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
              <PostForm action="/app/abonnement/portal">
                <Button variant="secondary" size="sm">
                  Endre betalingsmåte og fakturaer
                </Button>
              </PostForm>
              {p.hasStripeSubscription ? (
                <PostForm action="/app/abonnement/avslutt" confirm={b.cancelAtPeriodEnd ? 'Fortsette abonnementet?' : 'Si opp abonnementet ved slutten av perioden?'}>
                  <input type="hidden" name="cancel" value={b.cancelAtPeriodEnd ? '0' : '1'} />
                  <Button variant={b.cancelAtPeriodEnd ? 'secondary' : 'danger'} size="sm">
                    {b.cancelAtPeriodEnd ? 'Fortsett abonnementet' : 'Si opp'}
                  </Button>
                </PostForm>
              ) : null}
            </div>
          ) : null}
        </Panel>
        <Panel>
          <PanelHeader title="Forbruk" description="Søk telles per dag, AI per måned." />
          <dl className="space-y-3.5 p-5 text-[14px]">
            {!p.searchQuota.unlimited ? <UsageRow label="Søk i dag" used={p.searchQuota.used} limit={p.searchQuota.limit} /> : null}
            <UsageRow label="AI-analyser" used={p.usage.analyses} limit={p.usage.analysesLimit} />
            {p.usage.draftsLimit > 0 ? <UsageRow label="AI-utkast" used={p.usage.drafts} limit={p.usage.draftsLimit} /> : null}
            <UsageRow label="Lagrede anbud" used={p.bookmarkCount} limit={org!.entitlements.maxBookmarks} />
            <UsageRow label="Brukere" used={p.memberCount} limit={org!.entitlements.maxMembers} />
          </dl>
          {org!.plan === 'free' ? (
            <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
              Gratisplanen har ekte anbud fra Doffin og TED, men ingen automatiske varsler, Profit Intelligence eller Future Opportunities.
            </p>
          ) : null}
        </Panel>
      </div>

      <h2 className="mb-3 font-serif text-[20px] font-semibold text-navy-900">Planer</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PAID_PLANS.map((id: PaidPlanId) => {
          const plan = PLANS[id];
          const current = org!.plan === id && b.status !== 'trial';
          return (
            <Panel key={id} className={cn('flex flex-col p-5', current && 'border-navy-900')}>
              <div className="flex items-center justify-between">
                <h3 className="text-[16px] font-semibold text-navy-900">{plan.name}</h3>
                {current ? <Badge tone="ok">Din plan</Badge> : null}
              </div>
              <p className="mt-2">
                <span className="num text-[30px] font-[780] tracking-[-0.03em] text-night">{formatInt(plan.priceNok)}</span>
                <span className="text-[14px] text-muted"> kr/mnd</span>
              </p>
              <p className="mt-1 text-[13px] text-muted">{plan.tagline}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-[14px]">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-ok" aria-hidden>
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              {canManage ? (
                current ? null : (
                  <PostForm action="/app/abonnement/velg" className="mt-5">
                    <input type="hidden" name="plan" value={id} />
                    <Button className="w-full" variant={id === 'professional' ? 'primary' : 'secondary'} disabled={!p.stripeConfigured}>
                      {p.hasStripeSubscription ? `Bytt til ${plan.name}` : `Velg ${plan.name}`}
                    </Button>
                  </PostForm>
                )
              ) : (
                <p className="mt-5 text-[13px] text-muted">Eier eller administrator må endre planen.</p>
              )}
            </Panel>
          );
        })}
        <Panel className={cn('flex flex-col border-dashed p-5', org!.plan === 'enterprise' && 'border-solid border-navy-900')}>
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-semibold text-navy-900">{PLANS.enterprise.name}</h3>
            {org!.plan === 'enterprise' ? <Badge tone="ok">Din plan</Badge> : null}
          </div>
          <p className="mt-2 text-[20px] font-semibold text-navy-900">
            <span className="num">{formatInt(PLANS.enterprise.priceNok)}</span> <span className="text-[14px] font-normal text-muted">kr/mnd</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">{PLANS.enterprise.tagline}</p>
          <ul className="mt-4 flex-1 space-y-1.5 text-[14px]">
            {PLANS.enterprise.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-ok" aria-hidden>
                  ✓
                </span>
                {f}
              </li>
            ))}
          </ul>
          {org!.plan === 'enterprise' ? null : (
            <a href="/kontakt" className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-md border border-line-strong text-[14px] font-semibold text-navy-900 no-underline hover:bg-paper">
              Kontakt oss
            </a>
          )}
        </Panel>
      </div>

      {p.payments.length ? (
        <Panel className="mt-6">
          <PanelHeader title="Betalinger" />
          <ul className="divide-y divide-line text-[14px]">
            {p.payments.map((pay, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <span className="num">{formatDate(pay.createdAt)}</span>
                <span className="num">{formatMoney(pay.amountCents / 100, pay.currency, false)}</span>
                <Badge tone={pay.status === 'paid' ? 'ok' : 'danger'}>{pay.status === 'paid' ? 'Betalt' : 'Feilet'}</Badge>
                {pay.hostedInvoiceUrl ? (
                  <a href={pay.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                    Faktura
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </AppShell>
  );
}
