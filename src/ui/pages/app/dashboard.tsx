import { INDUSTRY_BY_ID } from '@/domain/reference';
import type { ReactNode } from 'react';
import { LuClock, LuMapPin, LuMessageCircleQuestion, LuSend, LuSparkle, LuTrophy, LuUserCheck } from 'react-icons/lu';
import type { DashboardData } from '@/domain/dashboard';
import type { ActionItem, ActionKind, Urgency } from '@/domain/actions';
import { useUi } from '../../context';
import { Alert, Badge, Button, buttonVariants, DeadlineChip, EmptyState, Panel, PanelHeader, PostForm, Stat } from '../../components';
import { AppShell } from '../../layouts';
import { TenderRow } from '../../tender';
import { formatDate, formatInt, formatMoney, relativeTime } from '../../format';

export interface FreeUsage {
  searchesUsed: number;
  searchesLimit: number;
  bookmarksUsed: number;
  bookmarksLimit: number;
  aiUsed: number;
  aiLimit: number;
}

/** Gratisplanen: hva som er brukt av grensene, og én rolig vei til oppgradering. */
function FreeUsagePanel({ u }: { u: FreeUsage }) {
  const rows: [string, number, number, string][] = [
    ['Søk i dag', u.searchesUsed, u.searchesLimit, 'nullstilles ved midnatt'],
    ['Lagrede anbud', u.bookmarksUsed, u.bookmarksLimit, ''],
    ['AI-sammendrag', u.aiUsed, u.aiLimit, 'per måned'],
  ];
  return (
    <Panel className="mb-6">
      <PanelHeader
        title="Gratisplanen"
        description="Ekte anbud fra Doffin og TED. Automatiske varsler, Profit Intelligence og Future Opportunities følger med betalte planer."
        action={
          <a href="/app/abonnement" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Se planer
          </a>
        }
      />
      <dl className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-3">
        {rows.map(([label, used, limit, hint]) => (
          <div key={label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-[14px]">
              <dt className="text-muted">{label}</dt>
              <dd className="font-mono text-[13px] text-ink">
                {formatInt(used)} av {formatInt(limit)}
              </dd>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-navy-100" aria-hidden>
              <div className={used >= limit ? 'h-1.5 rounded-full bg-urgent' : 'h-1.5 rounded-full bg-navy-600'} style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} />
            </div>
            {hint ? <p className="mt-1 text-[12px] text-muted">{hint}</p> : null}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const ACTION_ICON: Record<ActionKind, ReactNode> = {
  frist: <LuClock className="size-4" aria-hidden />,
  sporsmalsfrist: <LuMessageCircleQuestion className="size-4" aria-hidden />,
  befaring: <LuMapPin className="size-4" aria-hidden />,
  godkjenning: <LuUserCheck className="size-4" aria-hidden />,
  levere: <LuSend className="size-4" aria-hidden />,
  resultat: <LuTrophy className="size-4" aria-hidden />,
  treff: <LuSparkle className="size-4" aria-hidden />,
};
const URGENCY_STYLE: Record<Urgency, { chip: string; label: string }> = {
  haster: { chip: 'bg-danger-soft text-danger', label: 'Haster' },
  snart: { chip: 'bg-urgent-soft text-urgent', label: 'Snart' },
  info: { chip: 'bg-navy-50 text-navy-800', label: 'Når dere har tid' },
};

/** «Til handling»: én arbeidsliste fra egne data – lenke dit hvert punkt løses. */
function ActionPanel({ items }: { items: ActionItem[] }) {
  return (
    <Panel>
      <PanelHeader title="Til handling" description="Frister, godkjenninger og resultater som venter på dere – det som haster står først." />
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((a, i) => (
            <li key={`${a.kind}-${a.href}-${i}`}>
              <a href={a.href} className="flex items-start gap-3 px-5 py-3 no-underline hover:bg-navy-50/40">
                <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${URGENCY_STYLE[a.urgency].chip}`}>{ACTION_ICON[a.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-navy-900">{a.title}</span>
                  <span className="block truncate text-[13px] text-muted">{a.detail}</span>
                </span>
                <span className="shrink-0 text-right text-[12px] text-muted">
                  <span className="sr-only">{URGENCY_STYLE[a.urgency].label}. </span>
                  {a.due ? formatDate(a.due) : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-[14px] text-muted">Ingenting haster akkurat nå. Lagrede anbud med frister, tilbud som venter på godkjenning og resultater som mangler, dukker opp her.</p>
      )}
    </Panel>
  );
}

export function DashboardPage({
  data,
  aiAvailable,
  firstVisit,
  freeUsage,
}: {
  data: DashboardData;
  aiAvailable: boolean;
  firstVisit: boolean;
  freeUsage?: FreeUsage | null;
}) {
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

      {freeUsage ? <FreeUsagePanel u={freeUsage} /> : null}

      <Panel className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
        <Stat label={ent.matching ? 'Nye treff siste 7 dager' : 'Åpne anbud i deres bransjer'} value={formatInt(ent.matching ? data.newMatches : data.openInIndustries)} />
        <Stat label="Lagrede anbud" value={formatInt(data.savedCount)} />
        <Stat label="Frister neste 14 dager" value={formatInt(data.upcomingDeadlines)} hint="Blant lagrede anbud" />
        <Stat label="Åpne i deres bransjer" value={formatInt(data.openInIndustries)} />
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <ActionPanel items={data.actions} />
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
