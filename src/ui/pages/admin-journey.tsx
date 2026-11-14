import type { Journey } from '@/domain/admin/journey';
import { cn, PageHeader, Panel, PanelHeader } from '../components';
import { AdminShell } from '../layouts';
import { FunnelBars } from '../charts';
import { formatInt } from '../format';

const PERIODS: { days: number | null; label: string; param: string }[] = [
  { days: 30, label: 'Siste 30 dager', param: '30' },
  { days: 90, label: 'Siste 90 dager', param: '90' },
  { days: null, label: 'Alle', param: 'alle' },
];

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="num mt-1 text-[22px] font-[760] leading-none tracking-[-0.02em] text-strong">{value}</dd>
      {hint ? <dd className="mt-1 text-[12.5px] text-muted">{hint}</dd> : null}
    </div>
  );
}

function OriginList({ title, rows }: { title: string; rows: { key: string; n: number }[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</p>
      {rows.length ? (
        <ul className="mt-2 space-y-1.5 text-[14px]">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-[13px] text-ink">{r.key}</span>
              <span className="num shrink-0 font-semibold text-strong">{formatInt(r.n)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[13.5px] text-muted">Ingen registreringer i perioden.</p>
      )}
    </div>
  );
}

export function AdminJourneyPage({ j }: { j: Journey }) {
  const first = j.steps[0]!.n;
  const drop = j.biggestDrop;
  const from = drop !== null ? j.steps[drop - 1]! : null;
  const to = drop !== null ? j.steps[drop]! : null;
  return (
    <AdminShell>
      <PageHeader
        title="Kundereisen"
        description="Hvor mange av dem som registrerte seg, kom videre til hvert steg – og hvor de faller fra. Bare antall, ingen personopplysninger."
      />
      <nav aria-label="Periode" className="mb-5 flex flex-wrap gap-2">
        {PERIODS.map((p) => {
          const active = p.days === j.days;
          return (
            <a
              key={p.param}
              href={`/admin/kundereise?periode=${p.param}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold no-underline',
                active ? 'border-strong bg-strong text-surface' : 'border-line-strong bg-surface text-strong hover:border-strong',
              )}
            >
              {p.label}
            </a>
          );
        })}
      </nav>
      <Panel className="mb-6">
        <PanelHeader
          title={first ? `${formatInt(first)} registrerte seg` : 'Ingen registrerte seg i perioden'}
          description="Hvert steg telles for seg. «Av første» er andelen av dem som registrerte seg."
        />
        {first && from && to ? (
          <p className="border-b border-line px-5 py-3 text-[14px] text-ink">
            <strong>Største frafall:</strong> fra «{from.label}» til «{to.label}» – {formatInt(from.n - to.n)} av {formatInt(from.n)} kom ikke videre.
          </p>
        ) : null}
        <FunnelBars steps={j.steps} emphasize={drop} caption="Kundereisen: antall per steg" />
      </Panel>
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Fra besøk til konto" description="Sidevisninger på de offentlige sidene i perioden. Ikke unike besøkende – vi bruker ikke informasjonskapsler." />
          <dl className="grid grid-cols-1 gap-4 p-5 text-[14px] sm:grid-cols-3">
            <Figure label="Sidevisninger" value={formatInt(j.pageViews)} />
            <Figure label="Registreringer" value={formatInt(first)} />
            <Figure label="Per 1 000 visninger" value={j.pageViews ? (Math.round((first / j.pageViews) * 10_000) / 10).toLocaleString('nb-NO') : '–'} />
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="Kom tilbake" description="Brukt appen minst 7 eller 30 dager etter registreringen – av dem som registrerte seg for så lenge siden." />
          <dl className="grid grid-cols-1 gap-4 p-5 text-[14px] sm:grid-cols-2">
            {j.retention.map((r) => (
              <Figure
                key={r.days}
                label={`Etter ${r.days} dager`}
                value={r.eligible ? `${formatInt(r.returned)} av ${formatInt(r.eligible)}` : 'Ingen ennå'}
                hint={r.eligible ? `${Math.round((r.returned / r.eligible) * 100)} %` : `Ingen registrerte seg for ${r.days}+ dager siden i perioden`}
              />
            ))}
          </dl>
          <p className="border-t border-line px-5 py-3 text-[12.5px] text-muted">Målt fra 14.11.2026 (bare datoen lagres, i 13 måneder).</p>
        </Panel>
        <Panel>
          <PanelHeader title="Fra gratis til betalende" description="Antall brukere i perioden. Kortbetaling er ikke åpnet før Stripe er satt opp." />
          <dl className="grid grid-cols-2 gap-4 p-5 text-[14px] sm:grid-cols-4">
            <Figure label="Prøveperioden over, på gratis" value={formatInt(j.money.trialOverFree)} />
            <Figure label="Meldte interesse for en plan" value={formatInt(j.money.interested)} />
            <Figure label="Betaler" value={formatInt(j.money.paying)} hint={j.money.paying + j.money.trialOverFree ? `${Math.round((j.money.paying / (j.money.paying + j.money.trialOverFree)) * 100)} % av dem med avsluttet prøveperiode` : undefined} />
            <Figure label="Sa opp" value={formatInt(j.money.cancelled)} />
          </dl>
        </Panel>
        <Panel>
          <PanelHeader title="Hvor registreringene kom fra" description="Siden som lenket til registreringen, og kilden (søk, ukesbrev, LinkedIn …). Målt fra 14.11.2026." />
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
            <OriginList title="Side" rows={j.origins.pages} />
            <OriginList title="Kilde" rows={j.origins.sources} />
          </div>
        </Panel>
      </div>
      <p className="text-[13px] text-muted">
        Ikke med: administratorer og alle i organisasjoner som eies av en administrator (egne tester). En kunde kan lagre et anbud
        uten å ha fått treff, så stegene telles hver for seg.
      </p>
    </AdminShell>
  );
}
