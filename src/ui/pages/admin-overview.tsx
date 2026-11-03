/**
 * Admin-oversikten: det du trenger å vite når du logger inn. Rekkefølgen er bevisst:
 * nøkkeltall → det som trenger oppmerksomhet og hva som mangler før lansering → datakildene →
 * trender → siste hendelser og bruk. Bare tall og handlinger, ingen personopplysninger.
 */
import type { ReactNode } from 'react';
import type { IconType } from 'react-icons';
import { LuChevronRight, LuCircleAlert, LuCircleCheck, LuCircleDashed, LuClock, LuInfo, LuRefreshCw, LuTriangleAlert } from 'react-icons/lu';
import type { AdminOverview, AttentionTone, LaunchState, SourceState } from '@/domain/admin/overview';
import { INDUSTRY_BY_ID } from '@/domain/reference';
import { PLANS } from '@/domain/billing/plans';
import { Button, cn, PageHeader, Panel, PanelHeader, PostForm } from '../components';
import { ColumnChart, RankedBars, Sparkline } from '../charts';
import { AdminShell } from '../layouts';
import { formatDateTime, formatInt, formatMoney, relativeTime } from '../format';

const TONE: Record<AttentionTone, { label: string; icon: IconType; className: string }> = {
  feil: { label: 'Feil', icon: LuCircleAlert, className: 'bg-danger-soft text-danger' },
  advarsel: { label: 'Advarsel', icon: LuTriangleAlert, className: 'bg-urgent-soft text-urgent' },
  info: { label: 'Info', icon: LuInfo, className: 'bg-info-soft text-info' },
};

const LAUNCH: Record<LaunchState, { label: string; icon: IconType; className: string }> = {
  klar: { label: 'Klar', icon: LuCircleCheck, className: 'text-ok' },
  delvis: { label: 'Delvis', icon: LuCircleDashed, className: 'text-urgent' },
  mangler: { label: 'Mangler', icon: LuCircleDashed, className: 'text-muted' },
  venter: { label: 'Venter', icon: LuClock, className: 'text-info' },
};

const SOURCE: Record<SourceState, { label: string; icon: IconType; className: string }> = {
  ok: { label: 'Henter', icon: LuCircleCheck, className: 'bg-ok-soft text-ok' },
  feil: { label: 'Feil', icon: LuCircleAlert, className: 'bg-danger-soft text-danger' },
  gammel: { label: 'Ikke hentet nylig', icon: LuTriangleAlert, className: 'bg-urgent-soft text-urgent' },
  'mangler-nokkel': { label: 'Mangler nøkkel', icon: LuTriangleAlert, className: 'bg-urgent-soft text-urgent' },
  av: { label: 'Av', icon: LuCircleDashed, className: 'bg-navy-50 text-navy-800' },
};

function Pill({ icon: Icon, label, className }: { icon: IconType; label: string; className: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold leading-5', className)}>
      <Icon className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

function Kpi({ label, value, hint, trend }: { label: string; value: string; hint: ReactNode; trend?: { values: number[]; label: string } }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      {/* Store enkeltstående tall bruker vanlige (proporsjonale) sifre, ikke tabellsifre. */}
      <p className="mt-1 text-[28px] font-semibold leading-none tracking-[-0.01em] text-navy-900">{value}</p>
      <p className="mt-1.5 text-[12px] text-muted">{hint}</p>
      {trend ? <Sparkline values={trend.values} label={trend.label} /> : null}
    </div>
  );
}

function AttentionList({ items }: { items: AdminOverview['attention'] }) {
  if (!items.length) {
    return (
      <div className="flex items-start gap-3 px-5 py-6">
        <LuCircleCheck className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
        <div>
          <p className="font-semibold text-navy-900">Alt ser bra ut</p>
          <p className="text-[13px] text-muted">Ingen feil eller advarsler akkurat nå.</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line">
      {items.map((item, i) => {
        const tone = TONE[item.tone];
        const body = (
          <div className="flex items-start gap-3 px-5 py-3.5">
            <Pill {...tone} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-snug text-navy-900">{item.title}</p>
              {item.detail ? <p className="mt-0.5 break-words text-[13px] text-muted">{item.detail}</p> : null}
            </div>
            {item.href ? <LuChevronRight className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : null}
          </div>
        );
        return (
          <li key={i}>
            {item.href ? (
              <a href={item.href} className="block text-inherit no-underline hover:bg-paper">
                {body}
              </a>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ul>
  );
}

function LaunchChecklist({ items }: { items: AdminOverview['launch'] }) {
  const ready = items.filter((i) => i.state === 'klar').length;
  const pct = Math.round((ready / items.length) * 100);
  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-semibold text-navy-900">
          {ready} av {items.length} klart
        </p>
        <p className="num text-[13px] text-muted">{pct} %</p>
      </div>
      <div
        className="mt-2 h-2 rounded-full bg-navy-50"
        role="meter"
        aria-label="Klar for lansering"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={ready}
      >
        <div className="h-2 rounded-full bg-navy-600" style={{ width: `${pct}%` }} />
      </div>
      <ul className="mt-4 space-y-3">
        {items.map((item) => {
          const s = LAUNCH[item.state];
          const Icon = s.icon;
          const content = (
            <>
              <Icon className={cn('mt-0.5 size-[18px] shrink-0', s.className)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold leading-snug text-navy-900">
                  {item.label} <span className="sr-only">– {s.label}</span>
                </span>
                <span className="block break-words text-[13px] text-muted">{item.detail}</span>
              </span>
              <span className={cn('shrink-0 text-[12px] font-semibold', s.className)} aria-hidden>
                {s.label}
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {item.href ? (
                <a href={item.href} className="flex items-start gap-3 rounded-md text-inherit no-underline hover:bg-paper">
                  {content}
                </a>
              ) : (
                <div className="flex items-start gap-3">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SourceCard({ s }: { s: AdminOverview['sources'][number] }) {
  const canFetch = s.id === 'ted' || s.id === 'doffin';
  // Manuell import og eksempeldata henter ingenting selv – vis ikke «Henter» for dem.
  const state = !canFetch && s.state === 'ok' ? { label: 'Manuell', icon: LuCircleDashed, className: 'bg-navy-50 text-navy-800' } : SOURCE[s.state];
  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-line p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-semibold text-navy-900">{s.name}</p>
        <Pill {...state} />
      </div>
      <p className="mt-3 text-[26px] font-semibold leading-none text-navy-900">{formatInt(s.notices)}</p>
      <p className="mt-1 text-[12px] text-muted">kunngjøringer · {formatInt(s.new24h)} nye siste døgn</p>
      <dl className="mt-3 space-y-1 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Sist vellykket</dt>
          <dd className="text-right text-ink">{s.lastSuccessAt ? relativeTime(s.lastSuccessAt) : 'Aldri'}</dd>
        </div>
        {s.lastRun ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Siste kjøring</dt>
            <dd className="text-right text-ink">
              {formatInt(s.lastRun.createdCount)} nye{s.lastRun.errorCount ? `, ${formatInt(s.lastRun.errorCount)} feil` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
      {s.state === 'feil' && s.lastError ? <p className="mt-2 break-words text-[12px] text-danger">{s.lastError.slice(0, 200)}</p> : null}
      {canFetch && s.state !== 'mangler-nokkel' && s.state !== 'av' ? (
        <PostForm action="/admin/importer/kjor" className="mt-auto pt-3">
          <input type="hidden" name="source" value={s.id} />
          <Button variant="secondary" size="sm" className="w-full" busyLabel="Starter …">
            <LuRefreshCw className="size-3.5" aria-hidden /> Hent nå
          </Button>
        </PostForm>
      ) : null}
    </div>
  );
}

export function AdminOverviewPage({ o }: { o: AdminOverview }) {
  const k = o.kpi;
  const last14 = o.days.slice(-14);
  const m = o.metrics;
  return (
    <AdminShell>
      <PageHeader title="Oversikt" description={`Status for AnbudRadar akkurat nå · oppdatert ${formatDateTime(o.generatedAt)}`} />

      <Panel className="mb-6 grid grid-cols-2 gap-x-6 gap-y-6 p-5 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi
          label="Åpne anbud"
          value={formatInt(k.openTenders)}
          hint={`${formatInt(k.newTenders24h)} nye siste døgn`}
          trend={{ values: last14.map((d) => d.tenders), label: `Nye anbud per dag siste 14 dager: ${last14.map((d) => d.tenders).join(', ')}` }}
        />
        <Kpi
          label="Brukere"
          value={formatInt(k.users)}
          hint={`${formatInt(k.newUsers7d)} nye siste 7 dager`}
          trend={{ values: last14.map((d) => d.users), label: `Nye brukere per dag siste 14 dager: ${last14.map((d) => d.users).join(', ')}` }}
        />
        <Kpi label="Aktive siste 7 dager" value={formatInt(k.active7d)} hint={`av ${formatInt(k.users)} brukere`} />
        <Kpi label="Betalende kunder" value={formatInt(k.paying)} hint={k.paying ? `${formatMoney(k.mrr)} i måneden (listepris)` : 'Ingen ennå'} />
        <Kpi label="I prøveperiode" value={formatInt(k.trials)} hint={k.trialsEnding ? `${formatInt(k.trialsEnding)} slutter innen 3 dager` : 'Ingen slutter de neste 3 dagene'} />
      </Panel>

      <div className="mb-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Panel className="min-w-0">
          <PanelHeader
            title={
              <>
                Trenger oppmerksomhet{' '}
                {o.attention.length ? <span className="num ml-1 rounded-full bg-navy-50 px-2 text-[12px] text-navy-800">{o.attention.length}</span> : null}
              </>
            }
            description="Feil først, så advarsler og ting du bør følge opp."
          />
          <AttentionList items={o.attention} />
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="Klar for lansering" description="Beregnet fra oppsettet akkurat nå." />
          <LaunchChecklist items={o.launch} />
        </Panel>
      </div>

      <Panel className="mb-6 min-w-0">
        <PanelHeader title="Datakilder" description="Henting av kunngjøringer. «Hent nå» starter en henting i bakgrunnen." />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {o.sources.map((s) => (
            <SourceCard key={s.id} s={s} />
          ))}
        </div>
      </Panel>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel className="min-w-0">
          <PanelHeader title="Nye anbud per dag" description="Siste 30 dager, norsk tid. Første gang anbudet ble sett, uansett kilde." />
          <div className="p-5">
            <ColumnChart
              data={o.days.map((d) => ({ day: d.day, n: d.tenders }))}
              title="Nye anbud per dag"
              noun={['nytt anbud', 'nye anbud']}
              empty="Ingen nye anbud de siste 30 dagene."
            />
          </div>
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="Nye brukere per dag" description="Siste 30 dager, norsk tid." />
          <div className="p-5">
            <ColumnChart
              data={o.days.map((d) => ({ day: d.day, n: d.users }))}
              title="Nye brukere per dag"
              noun={['ny bruker', 'nye brukere']}
              empty="Ingen nye brukere de siste 30 dagene."
            />
          </div>
        </Panel>
      </div>

      <div className="mb-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <Panel className="min-w-0">
          <PanelHeader title="Siste hendelser" description="Fra revisjonsloggen." action={<a href="/admin/logg" className="text-[13px] font-semibold">Alle</a>} />
          {o.activity.length ? (
            <ul className="divide-y divide-line">
              {o.activity.map((a, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-[13px]">
                  {a.href ? (
                    <a href={a.href} className="min-w-0 truncate font-medium">
                      {a.label}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate font-medium text-ink">{a.label}</span>
                  )}
                  <span className="shrink-0 text-muted">{relativeTime(a.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted">Ingen hendelser ennå.</p>
          )}
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="Organisasjoner per plan" description={`${formatInt(m.orgs)} organisasjoner, ${formatInt(m.onboarded)} med fullført profil.`} />
          <div className="p-5">
            <RankedBars
              rows={Object.entries(m.byPlan).map(([plan, n]) => ({ label: PLANS[plan as keyof typeof PLANS]?.name ?? plan, n }))}
              noun={['organisasjon', 'organisasjoner']}
            />
          </div>
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="AI denne måneden" action={<a href="/admin/ai" className="text-[13px] font-semibold">Detaljer</a>} />
          <dl className="divide-y divide-line text-[14px]">
            {[
              ['Fullførte analyser', formatInt(m.ai.completed)],
              ['Feilet', formatInt(m.ai.failed)],
              ['Kostnad', m.ai.costUsd > 0 ? `${m.ai.costUsd.toFixed(2).replace('.', ',')} USD` : '0 USD'],
              ['E-post sendt siste 7 dager', formatInt(k.sentEmails7d)],
            ].map(([term, value]) => (
              <div key={term} className="flex justify-between gap-3 px-5 py-2.5">
                <dt className="text-muted">{term}</dt>
                <dd className="num font-semibold text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel className="min-w-0">
          <PanelHeader title="Mest søkte bransjer" description="Siste 30 dager." />
          <div className="p-5">
            <RankedBars
              rows={m.searchedIndustries.map((s) => ({ label: INDUSTRY_BY_ID.get(s.industry)?.name ?? s.industry, n: s.n }))}
              noun={['søk', 'søk']}
            />
          </div>
        </Panel>
        <Panel className="min-w-0">
          <PanelHeader title="Mest lagrede anbud" />
          {m.savedTenders.length ? (
            <ul className="divide-y divide-line">
              {m.savedTenders.map((t) => (
                <li key={t.id} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate font-medium text-ink">{t.title}</span>
                  <span className="num shrink-0 text-muted">{formatInt(t.n)} lagret</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-6 text-[13px] text-muted">Ingen lagrede anbud ennå.</p>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
