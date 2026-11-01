import { LuBell, LuBookmark, LuSave } from 'react-icons/lu';
import { INDUSTRY_BY_ID, REGION_BY_CODE } from '@/domain/reference';
import { BOOKMARK_STATUSES, type BookmarkRow } from '@/domain/tenders/bookmarks';
import { queryToParams, type TenderQuery } from '@/domain/search/filters';
import type { SavedSearchRow } from '@/domain/search/saved';
import { useUi } from '../../context';
import {
  Badge,
  Button,
  buttonVariants,
  Checkbox,
  cn,
  DeadlineChip,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Panel,
  PanelHeader,
  PostForm,
  SampleBadge,
  ScoreBar,
  Select,
  Tabs,
} from '../../components';
import { AppShell } from '../../layouts';
import { StatusBadge } from '../../tender';
import { formatMoney, relativeTime } from '../../format';

// ---------------------------------------------------------------------------
// Lagrede anbud
// ---------------------------------------------------------------------------
export function SavedTendersPage({ rows, status, counts, limit }: { rows: BookmarkRow[]; status: string | null; counts: Record<string, number>; limit: number }) {
  const { org } = useUi();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <AppShell wide>
      <PageHeader
        title="Lagrede anbud"
        description={`Anbud teamet følger med på. Lagrede anbud deles i organisasjonen.${limit < 1_000_000 ? ` Brukt ${total} av ${limit}.` : ''}`}
      />
      <Tabs
        items={[
          { href: '/app/lagret', label: 'Alle', active: !status, count: total },
          ...Object.entries(BOOKMARK_STATUSES).map(([k, v]) => ({ href: `/app/lagret?status=${k}`, label: v, active: status === k, count: counts[k] ?? 0 })),
        ]}
      />
      <Panel>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_420px]">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/app/anbud/${r.tenderId}`} className="text-[15px] font-semibold text-navy-900 no-underline hover:underline">
                      {r.title}
                    </a>
                    <StatusBadge status={r.tenderStatus} />
                    {r.isSample ? <SampleBadge /> : null}
                  </div>
                  <p className="text-[13px] text-muted">{r.buyerName}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <DeadlineChip deadline={r.deadlineAt} timeKnown={r.deadlineTimeKnown} />
                    <span className="num text-[13px]">{formatMoney(r.estimatedValue, r.currency)}</span>
                    {org?.entitlements.matching && r.score !== null ? <ScoreBar score={r.score} /> : null}
                  </div>
                  <p className="text-[12px] text-muted">
                    Lagret {relativeTime(r.createdAt)}
                    {r.createdByName ? ` av ${r.createdByName}` : ''}
                  </p>
                  {r.workspaceId ? (
                    <a href={`/app/tilbud/${r.workspaceId}`} className="text-[13px] font-semibold">
                      Åpne tilbudsarbeid
                    </a>
                  ) : null}
                </div>
                <PostForm action={`/app/lagret/${r.id}`} className="grid gap-2 sm:grid-cols-[160px_minmax(0,1fr)_auto] sm:items-end">
                  <input type="hidden" name="back" value={`/app/lagret${status ? `?status=${status}` : ''}`} />
                  <Field label="Status" htmlFor={`st-${r.id}`}>
                    <Select id={`st-${r.id}`} name="status" defaultValue={r.status}>
                      {Object.entries(BOOKMARK_STATUSES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Notat" htmlFor={`nt-${r.id}`}>
                    <Input id={`nt-${r.id}`} name="note" maxLength={2000} defaultValue={r.note ?? ''} />
                  </Field>
                  <Button size="sm" variant="secondary" className="h-10">
                    Lagre
                  </Button>
                </PostForm>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Ingen lagrede anbud her" icon={<LuBookmark className="size-6" />} action={<a href="/app/anbud" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>Finn anbud</a>}>
            Trykk «Lagre» på et anbud for å følge med på det. Dere får påminnelser før fristen.
          </EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Lagrede søk
// ---------------------------------------------------------------------------
export function filterSummary(q: TenderQuery): string[] {
  const out: string[] = [];
  if (q.q) out.push(`«${q.q}»`);
  if (q.industries.length) out.push(q.industries.map((i) => INDUSTRY_BY_ID.get(i)?.name ?? i).join(', '));
  if (q.regions.length) out.push(q.regions.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', '));
  if (q.place) out.push(q.place);
  if (q.valueMin !== null) out.push(`over ${formatMoney(q.valueMin)}`);
  if (q.valueMax !== null) out.push(`under ${formatMoney(q.valueMax)}`);
  if (q.deadlineMinDays !== null) out.push(`frist om minst ${q.deadlineMinDays} dager`);
  if (q.deadlineMaxDays !== null) out.push(`frist innen ${q.deadlineMaxDays} dager`);
  if (q.cpv.length) out.push(`CPV ${q.cpv.join(', ')}`);
  if (q.authority) out.push(`oppdragsgiver: ${q.authority}`);
  if (q.excludeKeywords.length) out.push(`uten ${q.excludeKeywords.join(', ')}`);
  return out.length ? out : ['Alle åpne anbud'];
}

export function SavedSearchesPage({ rows, limit, alertsLevel }: { rows: SavedSearchRow[]; limit: number; alertsLevel: 'none' | 'basic' | 'full' }) {
  return (
    <AppShell>
      <PageHeader
        title="Lagrede søk"
        description={`Få e-post når nye anbud passer søket. ${limit > 0 ? `Brukt ${rows.length} av ${limit}.` : 'Lagrede søk er ikke med i planen din.'}`}
        actions={
          <a href="/app/anbud" className={buttonVariants({ variant: 'secondary' })}>
            Nytt søk
          </a>
        }
      />
      <Panel>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={`/app/anbud?${queryToParams(s.filters).toString()}`} className="text-[15px] font-semibold text-navy-900">
                      {s.name}
                    </a>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {filterSummary(s.filters).map((f) => (
                        <Badge key={f} tone="neutral">
                          {f}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[12px] text-muted">
                      {s.ownerName ? `Laget av ${s.ownerName}. ` : ''}
                      {s.alertEnabled ? `Varsel ${s.alertFrequency === 'instant' ? 'med en gang' : s.alertFrequency === 'daily' ? 'daglig' : 'ukentlig'}.` : 'Ingen varsel.'}
                    </p>
                  </div>
                  <PostForm action={`/app/sok/${s.id}/slett`} confirm={`Slette søket «${s.name}»?`}>
                    <Button size="sm" variant="danger">
                      Slett
                    </Button>
                  </PostForm>
                </div>
                <PostForm action={`/app/sok/${s.id}`} className="flex flex-wrap items-end gap-3">
                  <Field label="Navn" htmlFor={`n-${s.id}`}>
                    <Input id={`n-${s.id}`} name="name" defaultValue={s.name} maxLength={120} required />
                  </Field>
                  <Field label="E-postvarsel" htmlFor={`a-${s.id}`}>
                    <Select id={`a-${s.id}`} name="alert" defaultValue={s.alertEnabled ? s.alertFrequency : 'off'} disabled={alertsLevel === 'none'}>
                      <option value="off">Ingen varsel</option>
                      {alertsLevel === 'full' ? <option value="instant">Med en gang</option> : null}
                      <option value="daily">Daglig</option>
                      <option value="weekly">Ukentlig</option>
                    </Select>
                  </Field>
                  <Button size="sm" variant="secondary" className="h-10">
                    Oppdater
                  </Button>
                </PostForm>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Ingen lagrede søk ennå" icon={<LuSave className="size-6" />}>
            Søk etter anbud og trykk «Lagre søk» nederst i resultatlisten.
          </EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Varsler
// ---------------------------------------------------------------------------
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  url: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export interface Prefs {
  emailFrequency: string;
  newMatches: boolean;
  matchThreshold: number;
  savedSearchAlerts: boolean;
  deadlineReminders: boolean;
  tenderChanges: boolean;
  weeklySummary: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  new_match: 'Nytt treff',
  saved_search: 'Lagret søk',
  deadline: 'Frist',
  tender_update: 'Endring',
  cancellation: 'Avlyst',
  weekly_summary: 'Ukesoversikt',
  payment_failed: 'Betaling',
  competitor_award: 'Konkurrent',
  system: 'Info',
};

export function NotificationsPage({ rows, prefs, alertsLevel }: { rows: NotificationRow[]; prefs: Prefs; alertsLevel: 'none' | 'basic' | 'full' }) {
  const { user } = useUi();
  return (
    <AppShell>
      <PageHeader
        title="Varsler"
        actions={
          rows.some((r) => !r.readAt) ? (
            <PostForm action="/app/varsler/lest">
              <Button variant="secondary" size="sm">
                Merk alle som lest
              </Button>
            </PostForm>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          {rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((n) => (
                <li key={n.id} className={cn('flex gap-3 px-5 py-3.5', !n.readAt && 'bg-marker-soft/40')}>
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-navy-900')} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={n.type === 'cancellation' || n.type === 'payment_failed' ? 'danger' : n.type === 'deadline' ? 'urgent' : 'neutral'}>
                        {TYPE_LABELS[n.type] ?? n.type}
                      </Badge>
                      <span className="text-[12px] text-muted">{relativeTime(n.createdAt)}</span>
                    </div>
                    {n.url ? (
                      <a href={`/app/varsler/${n.id}`} className="mt-1 block text-[14px] font-semibold text-navy-900 no-underline hover:underline">
                        {n.title}
                      </a>
                    ) : (
                      <p className="mt-1 text-[14px] font-semibold text-navy-900">{n.title}</p>
                    )}
                    {n.body ? <p className="text-[13px] text-muted">{n.body}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Ingen varsler ennå" icon={<LuBell className="size-6" />}>
              Her dukker det opp nye treff, påminnelser om frister og endringer i anbud dere har lagret.
            </EmptyState>
          )}
        </Panel>
        <Panel>
          <PanelHeader title="Varselinnstillinger" description={user?.emailVerified ? `E-post sendes til ${user.email}.` : 'Bekreft e-postadressen for å få e-post.'} />
          <PostForm action="/app/varsler/innstillinger" className="space-y-4 p-5">
            <Field label="Hvor ofte vil du ha e-post?" htmlFor="freq">
              <Select id="freq" name="emailFrequency" defaultValue={prefs.emailFrequency}>
                <option value="instant">Med en gang</option>
                <option value="daily">Daglig sammendrag</option>
                <option value="weekly">Ukentlig sammendrag</option>
                <option value="off">Ingen e-post (bare i appen)</option>
              </Select>
            </Field>
            {alertsLevel === 'none' ? <p className="text-[13px] text-muted">Varsler er ikke med i planen din. <a href="/app/abonnement">Se planer</a></p> : null}
            <fieldset className="space-y-2.5" disabled={alertsLevel === 'none'}>
              <legend className="mb-1 text-[13px] font-semibold">Varsle meg om</legend>
              <Checkbox name="savedSearchAlerts" defaultChecked={prefs.savedSearchAlerts} label="Nye treff i lagrede søk" />
              <Checkbox name="newMatches" defaultChecked={prefs.newMatches} disabled={alertsLevel !== 'full'} label="Nye anbud som passer profilen" />
              <Checkbox name="deadlineReminders" defaultChecked={prefs.deadlineReminders} disabled={alertsLevel !== 'full'} label="Frister for lagrede anbud (7, 3 og 1 dag før)" />
              <Checkbox name="tenderChanges" defaultChecked={prefs.tenderChanges} disabled={alertsLevel !== 'full'} label="Endringer og avlysninger i lagrede anbud" />
              <Checkbox name="weeklySummary" defaultChecked={prefs.weeklySummary} label="Ukesoversikt på mandager" />
            </fieldset>
            <Field label="Minste relevans for treffvarsler (%)" htmlFor="thr">
              <Input id="thr" name="matchThreshold" type="number" min={0} max={100} defaultValue={prefs.matchThreshold} />
            </Field>
            {alertsLevel === 'basic' ? <p className="text-[12px] text-muted">Starter-planen har varsler for lagrede søk. Fristvarsler og treffvarsler er med i Profesjonell.</p> : null}
            <Button size="sm" type="submit">
              Lagre innstillinger
            </Button>
          </PostForm>
        </Panel>
      </div>
    </AppShell>
  );
}
