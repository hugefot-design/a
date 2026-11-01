import { INDUSTRY_BY_ID } from '@/domain/reference';
import type { DashboardData } from '@/domain/dashboard';
import { useUi } from '../../context';
import { Alert, Badge, Button, buttonVariants, DeadlineChip, EmptyState, Panel, PanelHeader, PostForm, Stat } from '../../components';
import { AppShell } from '../../layouts';
import { TenderRow } from '../../tender';
import { formatDate, formatInt, formatMoney, relativeTime } from '../../format';

export function DashboardPage({ data, aiAvailable, firstVisit }: { data: DashboardData; aiAvailable: boolean; firstVisit: boolean }) {
  const { org, user } = useUi();
  const ent = org!.entitlements;
  const firstName = user?.name.split(' ')[0] ?? '';
  return (
    <AppShell wide>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-[28px] font-semibold text-navy-900">Hei, {firstName}</h1>
          <p className="mt-1 text-[15px] text-muted">Dette har skjedd for {org!.name} siden sist.</p>
        </div>
        <a href="/app/anbud" className={buttonVariants({ variant: 'primary' })}>
          Finn anbud
        </a>
      </header>

      {firstVisit ? (
        <Alert tone="ok" title="Profilen er klar" className="mb-6">
          Anbudene under er rangert etter profilen dere fylte ut. Lagre anbud dere vil følge med på, så minner vi dere på fristene.
        </Alert>
      ) : null}

      <Panel className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
        <Stat label={ent.matching ? 'Nye treff siste 7 dager' : 'Åpne anbud i deres bransjer'} value={formatInt(ent.matching ? data.newMatches : data.openInIndustries)} />
        <Stat label="Lagrede anbud" value={formatInt(data.savedCount)} />
        <Stat label="Frister neste 14 dager" value={formatInt(data.upcomingDeadlines)} hint="Blant lagrede anbud" />
        <Stat label="Åpne i deres bransjer" value={formatInt(data.openInIndustries)} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader
              title={ent.matching ? 'Anbefalt for dere' : 'Nye anbud i deres bransjer'}
              description={ent.matching ? 'Rangert etter samsvar med bedriftsprofilen – ikke sjansen for å vinne.' : undefined}
              action={
                <a href={ent.matching ? '/app/anbud?sorter=match' : '/app/anbud'} className="text-[13px] font-semibold">
                  Se alle
                </a>
              }
            />
            {(ent.matching ? data.topMatches : data.recent).length ? (
              <ul className="divide-y divide-line">
                {(ent.matching ? data.topMatches : data.recent).map((t) => (
                  <TenderRow key={t.id} item={t} showScore={ent.matching} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Ingen anbud å vise ennå">
                {data.profileIndustries.length
                  ? 'Vi fant ingen åpne anbud som passer profilen akkurat nå. Nye kunngjøringer hentes flere ganger i døgnet.'
                  : 'Fyll ut bedriftsprofilen for å få anbefalinger.'}
              </EmptyState>
            )}
            {!ent.matching ? (
              <div className="border-t border-line px-5 py-3 text-[13px] text-muted">
                Personlig rangering med begrunnelser er med i Profesjonell. <a href="/app/abonnement">Se planer</a>
              </div>
            ) : null}
          </Panel>

          {ent.matching ? (
            <Panel>
              <PanelHeader title="Nylig lagt til i deres bransjer" action={<a href="/app/anbud?sorter=published" className="text-[13px] font-semibold">Se alle</a>} />
              {data.recent.length ? (
                <ul className="divide-y divide-line">
                  {data.recent.map((t) => (
                    <TenderRow key={t.id} item={t} showScore={false} />
                  ))}
                </ul>
              ) : (
                <EmptyState title="Ingen nye kunngjøringer i bransjene deres." />
              )}
            </Panel>
          ) : null}
        </div>

        <aside className="space-y-6">
          <WeeklyOverview data={data} aiAvailable={aiAvailable} />

          <Panel>
            <PanelHeader title="Kommende frister" action={<a href="/app/lagret" className="text-[13px] font-semibold">Lagrede</a>} />
            {data.deadlines.length ? (
              <ul className="divide-y divide-line">
                {data.deadlines.map((d) => (
                  <li key={d.tenderId} className="space-y-1.5 px-5 py-3">
                    <a href={`/app/anbud/${d.tenderId}`} className="block text-[14px] font-semibold leading-snug text-navy-900 no-underline hover:underline">
                      {d.title}
                    </a>
                    <DeadlineChip deadline={d.deadlineAt} timeKnown={d.deadlineTimeKnown} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Ingen frister å passe på">Lagre anbud dere vurderer, så samles fristene her.</EmptyState>
            )}
          </Panel>

          {data.industryStats.length ? (
            <Panel>
              <PanelHeader title="Statistikk for deres bransjer" description="Åpne kunngjøringer akkurat nå." />
              <div className="scroll-x">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-muted">
                      <th className="px-5 py-2 font-semibold">Bransje</th>
                      <th className="px-2 py-2 text-right font-semibold">Åpne</th>
                      <th className="px-2 py-2 text-right font-semibold">Nye</th>
                      <th className="px-5 py-2 text-right font-semibold">Samlet verdi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.industryStats.map((s) => (
                      <tr key={s.industryId} className="border-b border-line last:border-0">
                        <td className="px-5 py-2">
                          <a href={`/app/anbud?bransje=${s.industryId}`}>{INDUSTRY_BY_ID.get(s.industryId)?.name ?? s.industryId}</a>
                        </td>
                        <td className="num px-2 py-2 text-right">{formatInt(s.open)}</td>
                        <td className="num px-2 py-2 text-right">{formatInt(s.newThisWeek)}</td>
                        <td className="num px-5 py-2 text-right">{s.totalValue ? formatMoney(s.totalValue) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-5 py-2 text-[12px] text-muted">Samlet verdi gjelder bare kunngjøringer som oppgir verdi i kroner.</p>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Siste tildelinger i bransjene" />
            {data.awards.length ? (
              <ul className="divide-y divide-line">
                {data.awards.map((a, i) => (
                  <li key={`${a.tenderId}-${i}`} className="px-5 py-3 text-[13px]">
                    <p className="font-semibold text-navy-900">
                      {ent.competitorIntel && a.supplierId ? <a href={`/app/konkurrenter/leverandor/${a.supplierId}`}>{a.supplierName}</a> : a.supplierName}
                    </p>
                    <p className="text-muted">
                      <a href={`/app/anbud/${a.tenderId}`} className="text-muted">
                        {a.title}
                      </a>
                    </p>
                    <p className="num mt-0.5 text-muted">
                      {a.awardedValue !== null ? formatMoney(a.awardedValue, a.currency) : 'Verdi ikke oppgitt'}, {formatDate(a.awardDate)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Ingen tildelinger registrert ennå." />
            )}
          </Panel>
        </aside>
      </div>
    </AppShell>
  );
}

function WeeklyOverview({ data, aiAvailable }: { data: DashboardData; aiAvailable: boolean }) {
  const w = data.weeklyOverview;
  return (
    <Panel>
      <PanelHeader
        title="Ukens oversikt"
        action={w ? <Badge tone="ai">{w.isMock ? 'Testmodus' : 'AI-generert'}</Badge> : <Badge tone="outline">Automatisk</Badge>}
      />
      <div className="space-y-3 px-5 py-4 text-[14px]">
        {w ? (
          <>
            <p className="font-semibold text-navy-900">{w.headline}</p>
            <ul className="list-disc space-y-1 pl-5">
              {w.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <p className="text-[12px] text-muted">Laget {relativeTime(w.createdAt)} fra anbudene i AnbudRadar. Sjekk detaljene i hver kunngjøring.</p>
          </>
        ) : (
          <ul className="space-y-1.5">
            <li>
              <strong className="num">{formatInt(data.newMatches)}</strong> nye relevante anbud siste 7 dager
            </li>
            <li>
              <strong className="num">{formatInt(data.upcomingDeadlines)}</strong> frister de neste 14 dagene blant lagrede anbud
            </li>
            <li>
              <strong className="num">{formatInt(data.openInIndustries)}</strong> åpne anbud i bransjene deres
            </li>
          </ul>
        )}
        {aiAvailable && !w ? (
          <PostForm action="/app/ukesoversikt">
            <Button size="sm" variant="secondary" busyLabel="Skriver oversikt …">
              Lag AI-oppsummering av uken
            </Button>
          </PostForm>
        ) : null}
      </div>
    </Panel>
  );
}
