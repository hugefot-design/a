/**
 * Admin → Besøk: hvor mange som besøker nettsiden, hvor de kommer fra, hvilke sider de ser,
 * og hvor mange som registrerer seg eller melder seg på ukesbrevet. Ingen personopplysninger.
 */
import type { ReactNode } from 'react';
import type { VisitStats } from '@/domain/admin/visits';
import { PageHeader, Panel, PanelHeader } from '../components';
import { ColumnChart, RankedBars, Sparkline } from '../charts';
import { AdminShell } from '../layouts';
import { formatInt } from '../format';

function Kpi({ label, value, hint, trend }: { label: string; value: string; hint: ReactNode; trend?: { values: number[]; label: string } }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.01em] text-navy-900">{value}</p>
      <p className="mt-1.5 text-[12px] text-muted">{hint}</p>
      {trend ? <Sparkline values={trend.values} label={trend.label} /> : null}
    </div>
  );
}

export function AdminVisitsPage({ v }: { v: VisitStats }) {
  const t = v.totals;
  const last14 = v.days.slice(-14);
  const perHundred = t.entries30 ? (t.signups30 / t.entries30) * 100 : null;
  return (
    <AdminShell>
      <PageHeader
        title="Besøk"
        description="Besøk på nettsiden uten informasjonskapsler og uten IP-adresser. Innloggede brukere (også du) og roboter telles ikke."
      />

      <Panel className="mb-6 grid grid-cols-2 gap-x-6 gap-y-6 p-5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Besøk siste 7 dager"
          value={formatInt(t.entries7)}
          hint={`${formatInt(t.views7)} sidevisninger i alt`}
          trend={{ values: last14.map((d) => d.entries), label: `Besøk per dag siste 14 dager: ${last14.map((d) => d.entries).join(', ')}` }}
        />
        <Kpi label="Fra Google" value={formatInt(t.google7)} hint="sidevisninger siste 7 dager" />
        <Kpi
          label="Nye kontoer"
          value={formatInt(t.signups7)}
          hint="siste 7 dager"
          trend={{ values: last14.map((d) => d.signups), label: `Nye kontoer per dag siste 14 dager: ${last14.map((d) => d.signups).join(', ')}` }}
        />
        <Kpi label="Nye på ukesbrevet" value={formatInt(t.subscribers7)} hint="bekreftet siste 7 dager" />
        <Kpi
          label="Kontoer per 100 besøk"
          value={perHundred === null ? '–' : perHundred.toLocaleString('nb-NO', { maximumFractionDigits: 1 })}
          hint="siste 30 dager"
        />
      </Panel>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel className="min-w-0">
          <PanelHeader title="Besøk per dag" description="Siste 30 dager, norsk tid. Et besøk er en side åpnet fra utsiden (søk, lenke eller adressefeltet)." />
          <div className="p-5">
            <ColumnChart data={v.days.map((d) => ({ day: d.day, n: d.entries }))} title="Besøk per dag" noun={['besøk', 'besøk']} empty="Ingen besøk registrert ennå. Tellingen startet 6. november 2026." />
          </div>
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="Nye kontoer per dag" description="Siste 30 dager, norsk tid." />
          <div className="p-5">
            <ColumnChart data={v.days.map((d) => ({ day: d.day, n: d.signups }))} title="Nye kontoer per dag" noun={['ny konto', 'nye kontoer']} empty="Ingen nye kontoer de siste 30 dagene." />
          </div>
        </Panel>
      </div>

      <div className="mb-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel className="min-w-0">
          <PanelHeader title="Hvor besøkene kommer fra" description="Siste 30 dager. Lenker med utm_source (f.eks. fra LinkedIn-innleggene) vises med det navnet." />
          <div className="p-5">
            <RankedBars rows={v.sources} noun={['besøk', 'besøk']} />
          </div>
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="Mest besøkte sider" description="Siste 30 dager, alle sidevisninger." />
          <div className="p-5">
            <RankedBars rows={v.pages} noun={['sidevisning', 'sidevisninger']} />
          </div>
        </Panel>
      </div>
    </AdminShell>
  );
}
