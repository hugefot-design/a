import { CPV_DIVISIONS } from '@/domain/reference';
import type { SupplierSummary } from '@/domain/competitors/competitors';
import { Alert, Badge, Button, EmptyState, Input, PageHeader, Panel, PanelHeader, PostForm, SampleBadge, Stat } from '../../components';
import { AppShell } from '../../layouts';
import { StatusBadge } from '../../tender';
import { formatDate, formatInt, formatMoney } from '../../format';

interface Coverage {
  awards: number;
  suppliers: number;
  firstDate: Date | null;
  lastDate: Date | null;
  withValue: number;
  sources: string[];
}

function CoverageNote({ c }: { c: Coverage }) {
  return (
    <Alert tone="info" title="Om dataene" className="mb-6">
      Basert på {formatInt(c.awards)} tildelinger fra {c.sources.map((s) => ({ ted: 'TED', doffin: 'Doffin', manual: 'manuell import', sample: 'eksempeldata' })[s] ?? s).join(' og ') || 'ingen kilder ennå'}
      {c.firstDate ? `, ${formatDate(c.firstDate)} – ${formatDate(c.lastDate)}` : ''}.{' '}
      {c.awards === 0 ? '' : c.withValue === c.awards ? 'Alle oppgir kontraktsverdi. ' : `${formatInt(c.withValue)} av dem oppgir kontraktsverdi. `}
      Mange anskaffelser
      publiseres uten tildelingsinformasjon, så oversikten er ufullstendig. Vi viser aldri anslåtte priser eller deltakere som ikke er offentliggjort.
    </Alert>
  );
}

function SupplierTable({ rows }: { rows: SupplierSummary[] }) {
  if (!rows.length) return <EmptyState title="Ingen tildelinger funnet" />;
  return (
    <div className="scroll-x">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-line text-left text-[13px] text-muted">
            <th className="px-5 py-2 font-semibold">Leverandør</th>
            <th className="px-3 py-2 text-right font-semibold">Tildelinger</th>
            <th className="px-3 py-2 text-right font-semibold">Samlet oppgitt verdi</th>
            <th className="px-3 py-2 text-right font-semibold">Oppdragsgivere</th>
            <th className="px-5 py-2 text-right font-semibold">Siste</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.supplierId} className="border-b border-line last:border-0">
              <td className="px-5 py-2.5">
                <a href={`/app/konkurrenter/leverandor/${r.supplierId}`} className="font-semibold">
                  {r.name}
                </a>
              </td>
              <td className="num px-3 py-2.5 text-right">{formatInt(r.wins)}</td>
              <td className="num whitespace-nowrap px-3 py-2.5 text-right">{r.totalValue ? formatMoney(r.totalValue) : '–'}</td>
              <td className="num px-3 py-2.5 text-right">{formatInt(r.authorities)}</td>
              <td className="num whitespace-nowrap px-5 py-2.5 text-right">{formatDate(r.lastWin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompetitorsPage({
  coverage,
  top,
  watched,
  authorities,
  q,
  results,
}: {
  coverage: Coverage;
  top: SupplierSummary[];
  watched: { supplierId: string; name: string; wins: number; lastWin: Date | null }[];
  authorities: { id: string; name: string; tenders: number; lastYear: number }[];
  q: string;
  results: SupplierSummary[] | null;
}) {
  return (
    <AppShell wide>
      <PageHeader title="Konkurrenter og tildelinger" description="Hvem vinner kontraktene i bransjene deres, og hvem kjøper mest." />
      <CoverageNote c={coverage} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader title="Søk etter leverandør" />
            <form method="get" action="/app/konkurrenter" className="flex gap-2 px-5 py-4">
              <label htmlFor="sq" className="sr-only">
                Leverandørnavn
              </label>
              <Input id="sq" name="q" defaultValue={q} placeholder="Navn på leverandør" />
              <Button variant="secondary">Søk</Button>
            </form>
            {results ? <SupplierTable rows={results} /> : null}
          </Panel>
          <Panel>
            <PanelHeader title="Flest tildelinger i deres bransjer" />
            <SupplierTable rows={top} />
          </Panel>
        </div>
        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Følger med på" description="Dere får varsel når disse vinner nye kontrakter." />
            {watched.length ? (
              <ul className="divide-y divide-line">
                {watched.map((w) => (
                  <li key={w.supplierId} className="px-5 py-2.5 text-[14px]">
                    <a href={`/app/konkurrenter/leverandor/${w.supplierId}`} className="font-semibold">
                      {w.name}
                    </a>
                    <p className="text-[12px] text-muted">
                      {w.wins} tildelinger, siste {formatDate(w.lastWin)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Ingen leverandører fulgt ennå">Åpne en leverandør og trykk «Følg med».</EmptyState>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Største innkjøpere i bransjene" />
            <ul className="divide-y divide-line">
              {authorities.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[14px]">
                  <a href={`/app/konkurrenter/oppdragsgiver/${a.id}`}>{a.name}</a>
                  <span className="num text-[13px] text-muted">{a.tenders}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}

export function SupplierPage({
  data,
}: {
  data: {
    supplier: { id: string; name: string; orgNumber: string | null };
    awards: { id: string; tenderId: string; title: string; buyerName: string | null; authorityId: string | null; lotTitle: string | null; awardedValue: number | null; currency: string | null; awardDate: Date | null; receivedTenders: number | null; isSample: boolean }[];
    byYear: { year: number; wins: number; value: number | null }[];
    watched: boolean;
  };
}) {
  const total = data.awards.reduce((s, a) => s + (a.awardedValue ?? 0), 0);
  return (
    <AppShell wide>
      <a href="/app/konkurrenter" className="text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
        Konkurrenter
      </a>
      <PageHeader
        title={data.supplier.name}
        description={data.supplier.orgNumber ? `Org.nr. ${data.supplier.orgNumber}` : undefined}
        actions={
          <PostForm action={`/app/konkurrenter/leverandor/${data.supplier.id}/folg`}>
            <Button variant={data.watched ? 'secondary' : 'primary'} size="sm">
              {data.watched ? 'Slutt å følge' : 'Følg med'}
            </Button>
          </PostForm>
        }
      />
      <Panel className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-3">
        <Stat label="Registrerte tildelinger" value={formatInt(data.awards.length)} />
        <Stat label="Samlet oppgitt verdi" value={total ? formatMoney(total) : '–'} hint="Kun tildelinger med oppgitt verdi" />
        <Stat label="Siste tildeling" value={formatDate(data.awards[0]?.awardDate ?? null)} />
      </Panel>
      <Panel>
        <PanelHeader title="Tildelinger" />
        <ul className="divide-y divide-line">
          {data.awards.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[14px]">
              <div className="min-w-0">
                <a href={`/app/anbud/${a.tenderId}`} className="font-semibold">
                  {a.title}
                </a>{' '}
                {a.isSample ? <SampleBadge /> : null}
                <p className="text-[13px] text-muted">
                  {a.authorityId ? <a href={`/app/konkurrenter/oppdragsgiver/${a.authorityId}`} className="text-muted">{a.buyerName}</a> : a.buyerName}
                  {a.lotTitle ? `, ${a.lotTitle}` : ''}
                  {a.receivedTenders ? `. ${a.receivedTenders} tilbud mottatt.` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="num">{a.awardedValue !== null ? formatMoney(a.awardedValue, a.currency) : 'Verdi ikke oppgitt'}</p>
                <p className="num text-[12px] text-muted">{formatDate(a.awardDate)}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </AppShell>
  );
}

export function AuthorityPage({
  data,
}: {
  data: {
    authority: { id: string; name: string; orgNumber: string | null; city: string | null };
    stats: { tenders: number; awarded: number; avgValue: number | null; avgReceived: number | null };
    divisions: { division: string; n: number }[];
    winners: { supplierId: string; name: string; wins: number; totalValue: number | null }[];
    tenders: { id: string; title: string; publishedAt: Date | null; status: string; estimatedValue: number | null; currency: string | null }[];
  };
}) {
  return (
    <AppShell wide>
      <a href="/app/konkurrenter" className="text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
        Konkurrenter
      </a>
      <PageHeader title={data.authority.name} description={[data.authority.city, data.authority.orgNumber ? `Org.nr. ${data.authority.orgNumber}` : null].filter(Boolean).join(', ')} />
      <Panel className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
        <Stat label="Kunngjøringer i databasen" value={formatInt(data.stats.tenders)} />
        <Stat label="Med tildeling" value={formatInt(data.stats.awarded)} />
        <Stat label="Snittverdi (oppgitt)" value={data.stats.avgValue ? formatMoney(data.stats.avgValue) : '–'} />
        <Stat label="Snitt tilbud mottatt" value={data.stats.avgReceived ? data.stats.avgReceived.toFixed(1).replace('.', ',') : '–'} />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Kjøper oftest" description="CPV-hovedgrupper i kunngjøringene." />
          <ul className="divide-y divide-line">
            {data.divisions.map((d) => (
              <li key={d.division} className="flex justify-between gap-3 px-5 py-2.5 text-[14px]">
                <span>
                  <span className="num font-semibold">{d.division}</span> {CPV_DIVISIONS[d.division] ?? ''}
                </span>
                <span className="num text-muted">{d.n}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <PanelHeader title="Har vunnet her" />
          {data.winners.length ? (
            <ul className="divide-y divide-line">
              {data.winners.map((w) => (
                <li key={w.supplierId} className="flex justify-between gap-3 px-5 py-2.5 text-[14px]">
                  <a href={`/app/konkurrenter/leverandor/${w.supplierId}`}>{w.name}</a>
                  <span className="num text-muted">{w.wins}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Ingen tildelinger registrert" />
          )}
        </Panel>
      </div>
      <Panel className="mt-6">
        <PanelHeader title="Siste kunngjøringer" />
        <ul className="divide-y divide-line">
          {data.tenders.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
              <span className="flex flex-wrap items-center gap-2">
                <a href={`/app/anbud/${t.id}`}>{t.title}</a> <StatusBadge status={t.status} />
              </span>
              <span className="num text-[13px] text-muted">{formatDate(t.publishedAt)}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <p className="mt-4 text-[12px] text-muted">
        <Badge tone="outline">Merk</Badge> Tallene gjelder kunngjøringer som finnes i AnbudRadar, ikke alle oppdragsgiverens innkjøp.
      </p>
    </AppShell>
  );
}
