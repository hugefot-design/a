import type { ReactNode } from 'react';
import { INDUSTRY_BY_ID } from '@/domain/reference';
import { PLANS } from '@/domain/billing/plans';
import type { platformMetrics, organizationDetail, systemHealth, listOrganizations, listUsers } from '@/domain/admin/admin';
import type { EnrichmentOverview } from '@/connectors/doffin-enrich';
import { Alert, Badge, Button, Field, Input, PageHeader, Panel, PanelHeader, PostForm, Select, Stat, Textarea } from '../components';
import { AdminShell } from '../layouts';
import { formatDate, formatDateTime, formatInt, formatMoney, relativeTime } from '../format';

type Awaited2<T> = T extends Promise<infer U> ? U : T;

/** Lesbar status for integrasjonene (i stedet for rå true/false). */
function integrationRows(raw: Record<string, unknown>): ReactNode[][] {
  const i = raw as {
    ai: boolean; aiProvider: string; aiIsMock: boolean; email: boolean; stripe: boolean; stripeTestMode: boolean;
    storage: boolean; storageDriver: string; doffin: boolean; cron: boolean;
  };
  const ok = (text: string) => <Badge tone="ok">{text}</Badge>;
  const warn = (text: string) => <Badge tone="urgent">{text}</Badge>;
  return [
    ['AI', i.aiIsMock ? warn('Testmodus – simulerte svar') : i.ai ? ok(`På (${i.aiProvider})`) : warn('Av – mangler nøkkel eller modell')],
    ['E-post', i.email ? ok('Resend') : warn('Ikke satt opp – e-post logges bare')],
    ['Betaling (Stripe)', i.stripe ? (i.stripeTestMode ? warn('Testmodus') : ok('Live')) : warn('Ikke satt opp')],
    ['Fillagring', i.storageDriver === 'supabase' ? (i.storage ? ok('Supabase Storage') : warn('Supabase – mangler nøkler')) : warn('Lokal disk')],
    ['Doffin', i.doffin ? ok('Nøkkel satt') : warn('Mangler DOFFIN_API_KEY')],
    ['TED', ok('Åpent API (ingen nøkkel)')],
    ['Planlagte oppgaver (CRON_SECRET)', i.cron ? ok('Satt') : warn('Mangler')],
  ];
}

export function Table({ head, rows, empty = 'Ingen rader.' }: { head: ReactNode[]; rows: ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="px-5 py-6 text-[14px] text-muted">{empty}</p>;
  return (
    <div className="scroll-x">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminDashboardPage({ m, integrations }: { m: Awaited2<ReturnType<typeof platformMetrics>>; integrations: Record<string, unknown> }) {
  const pct = (v: number) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
  return (
    <AdminShell>
      <PageHeader title="Nøkkeltall" description="Interne tall. Personopplysninger vises ikke her." />
      <Panel className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Brukere" value={formatInt(m.users.total)} hint={`${m.users.new7d} nye siste 7 d`} />
        <Stat label="Aktive 7 d / 30 d" value={`${m.users.active7d} / ${m.users.active30d}`} />
        <Stat label="Organisasjoner" value={formatInt(m.orgs)} hint={`${m.onboarded} med fullført profil`} />
        <Stat label="Betalende" value={formatInt(m.paying)} hint={`Konvertering ${pct(m.conversion)}`} />
        <Stat label="MRR (estimat)" value={formatMoney(m.mrr)} hint="Listepris eks. mva." />
        <Stat label="Churn 30 d" value={pct(m.churn)} hint={`${m.canceled30d} avsluttet`} />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Planer (effektiv)" />
          <Table head={['Plan', 'Organisasjoner']} rows={Object.entries(m.byPlan).map(([k, v]) => [PLANS[k as keyof typeof PLANS]?.name ?? k, formatInt(v)])} />
          <p className="px-4 py-2 text-[12px] text-muted">Aktive prøveperioder: {m.trials}</p>
        </Panel>
        <Panel>
          <PanelHeader title="AI denne måneden" />
          <Table
            head={['Fullført', 'Feilet', 'Tokens inn', 'Tokens ut', 'Kostnad (USD)']}
            rows={[[m.ai.completed, m.ai.failed, formatInt(m.ai.inputTokens), formatInt(m.ai.outputTokens), m.ai.costUsd.toFixed(4)]]}
          />
          <p className="px-4 py-2 text-[12px] text-muted">Kostnad beregnes fra AI_INPUT/OUTPUT_PRICE_PER_MTOK_USD. 0 betyr at prisene ikke er satt.</p>
        </Panel>
        <Panel className="lg:col-span-2">
          <PanelHeader title="Datakilder og ferskhet" />
          <Table
            head={['Kilde', 'Påslått', 'Verifisert live', 'Kunngjøringer', 'Sist vellykket', 'Siste feil']}
            rows={m.freshness.map((f) => [
              f.name,
              f.enabled ? 'Ja' : 'Nei',
              f.verifiedLive ? <Badge tone="ok">Ja</Badge> : <Badge tone="urgent">Nei</Badge>,
              formatInt(f.notices),
              f.lastSuccessAt ? relativeTime(f.lastSuccessAt) : 'Aldri',
              f.lastError ? <span className="text-danger">{f.lastError.slice(0, 80)}</span> : '–',
            ])}
          />
          <p className="px-4 py-2 text-[12px] text-muted">
            {formatInt(m.tenders.total)} kunngjøringer ({formatInt(m.tenders.open)} åpne, {formatInt(m.tenders.sample)} eksempeldata). Importfeil siste 7 d:{' '}
            {m.imports.errors} ({m.imports.failedRuns} feilede kjøringer).
          </p>
        </Panel>
        <Panel>
          <PanelHeader title="Nye brukere per uke" />
          <Table head={['Uke', 'Registreringer']} rows={m.registrations.map((r) => [r.week, formatInt(r.n)])} empty="Ingen registreringer siste 8 uker." />
        </Panel>
        <Panel>
          <PanelHeader title="Mest søkte bransjer (30 d)" />
          <Table head={['Bransje', 'Søk']} rows={m.searchedIndustries.map((s) => [INDUSTRY_BY_ID.get(s.industry)?.name ?? s.industry, formatInt(s.n)])} />
        </Panel>
        <Panel>
          <PanelHeader title="Mest lagrede anbud" />
          <Table head={['Anbud', 'Lagret']} rows={m.savedTenders.map((s) => [s.title, formatInt(s.n)])} />
        </Panel>
        <Panel>
          <PanelHeader title="Integrasjoner" />
          <Table head={['Integrasjon', 'Status']} rows={integrationRows(integrations)} />
        </Panel>
      </div>
    </AdminShell>
  );
}

export function AdminUsersPage({ rows, q }: { rows: Awaited2<ReturnType<typeof listUsers>>; q: string }) {
  return (
    <AdminShell>
      <PageHeader title="Brukere" />
      <form method="get" className="mb-4 flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder="Søk e-post eller navn" />
        <Button variant="secondary">Søk</Button>
      </form>
      <Panel>
        <Table
          head={['E-post', 'Navn', 'Bekreftet', 'Org.', 'Opprettet', 'Sist innlogget', '']}
          rows={rows.map((u) => [
            <>
              {u.email} {u.isPlatformAdmin ? <Badge tone="marker">Admin</Badge> : null} {u.lockedUntil && u.lockedUntil > new Date() ? <Badge tone="danger">Låst</Badge> : null}
            </>,
            u.name,
            u.emailVerifiedAt ? 'Ja' : 'Nei',
            u.orgs,
            formatDate(u.createdAt),
            u.lastLoginAt ? relativeTime(u.lastLoginAt) : '–',
            <PostForm action={`/admin/brukere/${u.id}/admin`} confirm={u.isPlatformAdmin ? 'Fjerne admin-tilgang?' : 'Gi plattform-admin-tilgang?'}>
              <Button size="sm" variant="ghost">
                {u.isPlatformAdmin ? 'Fjern admin' : 'Gjør til admin'}
              </Button>
            </PostForm>,
          ])}
        />
      </Panel>
    </AdminShell>
  );
}

export function AdminOrgsPage({ rows, q }: { rows: Awaited2<ReturnType<typeof listOrganizations>>; q: string }) {
  return (
    <AdminShell>
      <PageHeader title="Organisasjoner" />
      <form method="get" className="mb-4 flex max-w-md gap-2">
        <Input name="q" defaultValue={q} placeholder="Søk navn" />
        <Button variant="secondary">Søk</Button>
      </form>
      <Panel>
        <Table
          head={['Navn', 'Plan', 'Kilde', 'Status', 'Medlemmer', 'Profil', 'Opprettet']}
          rows={rows.map((o) => [
            <a href={`/admin/organisasjoner/${o.id}`}>{o.name}</a>,
            o.billing.label,
            o.source ?? '–',
            o.status ?? '–',
            o.members,
            o.onboardedAt ? 'Fullført' : 'Ikke fullført',
            formatDate(o.createdAt),
          ])}
        />
      </Panel>
    </AdminShell>
  );
}

export function AdminOrgPage({ d }: { d: NonNullable<Awaited2<ReturnType<typeof organizationDetail>>> }) {
  return (
    <AdminShell>
      <PageHeader title={d.org.name} description={`Opprettet ${formatDate(d.org.createdAt)}${d.org.orgNumber ? `, org.nr. ${d.org.orgNumber}` : ''}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Abonnement" />
          <div className="space-y-1 p-5 text-[14px]">
            <p>Effektiv plan: <strong>{d.billing.label}</strong></p>
            <p>Kilde: {d.sub?.source ?? 'ingen'}; status: {d.sub?.status ?? '–'}</p>
            {d.sub?.stripeCustomerId ? <p>Stripe-kunde: <span className="num">{d.sub.stripeCustomerId}</span></p> : null}
            {d.sub?.manualNote ? <p>Notat: {d.sub.manualNote}</p> : null}
          </div>
          <PostForm action={`/admin/organisasjoner/${d.org.id}/plan`} className="space-y-3 border-t border-line p-5">
            <Alert tone="warning">Manuell plan overstyrer Stripe for denne organisasjonen. Bruk for avtalekunder (Enterprise) eller support. Endringen logges.</Alert>
            <Field label="Plan" htmlFor="plan">
              <Select id="plan" name="plan" defaultValue={d.billing.effectivePlan}>
                {Object.values(PLANS).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Gjelder til (valgfritt)" htmlFor="until">
              <Input id="until" name="until" type="date" />
            </Field>
            <Field label="Begrunnelse" htmlFor="note">
              <Textarea id="note" name="note" rows={2} required maxLength={500} />
            </Field>
            <Button size="sm">Sett manuell plan</Button>
          </PostForm>
        </Panel>
        <Panel>
          <PanelHeader title="Medlemmer" />
          <Table head={['Navn', 'E-post', 'Rolle']} rows={d.members.map((m) => [m.name, m.email, m.role])} />
          <PanelHeader title="Bruk denne måneden" />
          <Table head={['Type', 'Antall', 'Kostnad (USD)']} rows={d.usage.map((u) => [u.kind, u.n, u.cost.toFixed(4)])} empty="Ingen AI-bruk denne måneden." />
        </Panel>
      </div>
    </AdminShell>
  );
}

export function AdminImportsPage({
  runs,
  errors,
  sources,
  result,
}: {
  runs: { id: string; source: string; status: string; trigger: string; fetchedCount: number; createdCount: number; updatedCount: number; unchangedCount: number; duplicateCount: number; errorCount: number; errorSummary: string | null; startedAt: Date; finishedAt: Date | null }[];
  errors: { id: string; source: string | null; sourceNoticeId: string | null; stage: string; error: string; createdAt: Date }[];
  sources: { id: string; name: string; enabled: boolean; configured: boolean; message: string }[];
  result?: string;
}) {
  return (
    <AdminShell>
      <PageHeader title="Importer" description="Henting fra TED og Doffin, og manuell import av JSON/CSV." />
      {result ? <Alert tone="info" className="mb-4">{result}</Alert> : null}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Kjør henting nå" description="Legges i køen og kjøres av arbeideren (npm run worker)." />
          <div className="space-y-3 p-5">
            {sources.map((s) => (
              <PostForm key={s.id} action="/admin/importer/kjor" className="flex flex-wrap items-center justify-between gap-3">
                <input type="hidden" name="source" value={s.id} />
                <span className="text-[14px]">
                  <strong>{s.name}</strong> <span className="text-muted">– {s.message}</span>
                </span>
                <Button size="sm" variant="secondary" disabled={!s.configured}>
                  Kjør
                </Button>
              </PostForm>
            ))}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Manuell import" description="JSON/CSV i AnbudRadar-formatet, eller lagrede svar fra TED- eller Doffin-API-et. Se docs/IMPORTFORMAT.md." />
          <PostForm action="/admin/importer/fil" multipart className="space-y-3 p-5">
            <input type="file" name="file" required accept=".json,.csv,application/json,text/csv" className="block w-full text-[13px]" />
            <Button size="sm" busyLabel="Importerer …">
              Importer fil
            </Button>
          </PostForm>
        </Panel>
      </div>
      <Panel className="mb-6">
        <PanelHeader title="Siste kjøringer" />
        <Table
          head={['Startet', 'Kilde', 'Utløser', 'Status', 'Hentet', 'Nye', 'Oppdatert', 'Uendret', 'Duplikater', 'Feil', 'Melding']}
          rows={runs.map((r) => [
            formatDateTime(r.startedAt),
            r.source,
            r.trigger,
            <Badge tone={r.status === 'success' ? 'ok' : r.status === 'failed' ? 'danger' : r.status === 'partial' ? 'urgent' : 'neutral'}>{r.status}</Badge>,
            r.fetchedCount,
            r.createdCount,
            r.updatedCount,
            r.unchangedCount,
            r.duplicateCount,
            r.errorCount,
            r.errorSummary ? <span className="text-danger">{r.errorSummary.slice(0, 160)}</span> : '',
          ])}
        />
      </Panel>
      <Panel>
        <PanelHeader title="Feilede kunngjøringer (siste 50)" />
        <Table
          head={['Tid', 'Kilde', 'ID', 'Steg', 'Feil']}
          rows={errors.map((e) => [formatDateTime(e.createdAt), e.source ?? '–', e.sourceNoticeId ?? '–', e.stage, <span className="break-all">{e.error.slice(0, 300)}</span>])}
        />
      </Panel>
    </AdminShell>
  );
}

const ENRICH_OUTCOME_LABEL: Record<string, string> = {
  not_found: 'Ikke funnet (404)',
  error: 'Feil hos Doffin eller nettverk',
  too_large: 'For stor fil',
  unsupported_format: 'Uventet format',
  parse_error: 'Kunne ikke leses',
  not_stored: 'Ikke lagret',
  invalid_id: 'Ugyldig ID',
};

function EnrichmentPanel({ e }: { e: EnrichmentOverview }) {
  const perDay = Math.floor((24 * 60) / e.intervalMinutes) * e.maxPerRun;
  return (
    <Panel className="mt-6">
      <PanelHeader
        title="Doffin: full kunngjøring (eForms-XML)"
        description="Søket gir bare et sammendrag. Arbeideren henter full kunngjøring for nye treff – åpne konkurranser først – med høyst 10 nedlastinger per minutt."
      />
      <div className="space-y-4 px-5 py-4">
        {!e.configured ? (
          <Alert tone="warning" title="Mangler DOFFIN_API_KEY">
            Legg nøkkelen inn som miljøvariabel (aldri i koden).
          </Alert>
        ) : !e.enabled ? (
          <Alert tone="info" title="Automatisk henting er av">
            Test først én kunngjøring: <code>npm run ingest -- --source doffin --id ÅÅÅÅ-NNNNNN --dry-run --save-raw ./storage/doffin-xml</code>. Sett deretter{' '}
            <code>DOFFIN_ENRICH_XML=true</code> på både webtjenesten og arbeideren.
          </Alert>
        ) : (
          <p className="text-[13px] text-muted">
            På: hvert {e.intervalMinutes}. minutt, høyst {e.maxPerRun} per kjøring (inntil {formatInt(perDay)} per døgn).
          </p>
        )}
        <p className="text-[13px] text-muted">Siste forsøk: {e.lastAttemptAt ? relativeTime(e.lastAttemptAt) : 'aldri'}.</p>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="Lagret som XML" value={formatInt(e.enriched)} />
          <Stat label="Hentet siste døgn" value={formatInt(e.okLast24h)} />
          <Stat label="Venter nå" value={formatInt(e.waiting)} />
          <Stat label="Prøves igjen" value={formatInt(e.retry)} />
          <Stat label="Ga opp" value={formatInt(e.gaveUp)} />
        </div>
        {e.recentProblems.length ? (
          <Table
            head={['Doffin-ID', 'Status', 'Siste resultat', 'Forsøk', 'Sist forsøkt', 'Neste forsøk']}
            rows={e.recentProblems.map((p) => [
              <a href={`https://doffin.no/notices/${encodeURIComponent(p.doffinId)}`} target="_blank" rel="noopener noreferrer">
                {p.doffinId}
              </a>,
              p.status === 'gave_up' ? <Badge tone="urgent">Ga opp</Badge> : <Badge tone="outline">Prøves igjen</Badge>,
              <span title={p.lastMessage ?? undefined}>{ENRICH_OUTCOME_LABEL[p.lastOutcome] ?? p.lastOutcome}</span>,
              p.attempts,
              relativeTime(p.lastAttemptAt),
              p.status === 'retry' && p.nextAttemptAt ? formatDateTime(p.nextAttemptAt) : '–',
            ])}
          />
        ) : null}
      </div>
    </Panel>
  );
}

export function AdminSourcesPage({
  sources,
  enrichment = null,
}: {
  sources: { id: string; name: string; enabled: boolean; verifiedLive: boolean; lastSuccessAt: Date | null; lastError: string | null; notes: string | null; configured: boolean; message: string }[];
  enrichment?: EnrichmentOverview | null;
}) {
  return (
    <AdminShell>
      <PageHeader title="Datakilder" description="«Verifisert live» settes automatisk først etter en vellykket henting fra kildens API." />
      <Panel>
        <Table
          head={['Kilde', 'Konfigurasjon', 'Verifisert live', 'Sist vellykket', 'Merknad', '']}
          rows={sources.map((s) => [
            <strong>{s.name}</strong>,
            s.configured ? <Badge tone="ok">{s.message}</Badge> : <Badge tone="urgent">{s.message}</Badge>,
            s.verifiedLive ? 'Ja' : 'Nei – ikke testet mot live API ennå',
            s.lastSuccessAt ? relativeTime(s.lastSuccessAt) : 'Aldri',
            <span className="text-muted">{s.lastError ?? s.notes ?? ''}</span>,
            <PostForm action={`/admin/kilder/${s.id}`}>
              <input type="hidden" name="enabled" value={s.enabled ? '0' : '1'} />
              <Button size="sm" variant={s.enabled ? 'secondary' : 'primary'}>
                {s.enabled ? 'Slå av' : 'Slå på'}
              </Button>
            </PostForm>,
          ])}
        />
      </Panel>
      {enrichment ? <EnrichmentPanel e={enrichment} /> : null}
    </AdminShell>
  );
}

export function AdminListPage({ title, description, head, rows, children }: { title: string; description?: string; head: ReactNode[]; rows: ReactNode[][]; children?: ReactNode }) {
  return (
    <AdminShell>
      <PageHeader title={title} description={description} />
      {children}
      <Panel>
        <Table head={head} rows={rows} />
      </Panel>
    </AdminShell>
  );
}

export function AdminHealthPage({
  h,
  integrations,
  prices = null,
  stripeConfigured = false,
}: {
  h: Awaited2<ReturnType<typeof systemHealth>>;
  integrations: Record<string, unknown>;
  prices?: { plan: string; priceId: string | null; ok: boolean; problems: string[] }[] | null;
  stripeConfigured?: boolean;
}) {
  const workerOk = h.workers[0] && Date.now() - new Date(h.workers[0].lastSeenAt).getTime() < 5 * 60_000;
  return (
    <AdminShell>
      <PageHeader title="Systemhelse" />
      <Panel className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
        <Stat label="Database" value={`${h.dbMs} ms`} hint={h.dbSize} />
        <Stat label="Arbeider" value={workerOk ? 'Kjører' : 'Ikke sett'} hint={h.workers[0] ? `Sist sett ${relativeTime(h.workers[0].lastSeenAt)}` : 'Start med npm run worker'} />
        <Stat label="Node.js" value={h.node} hint={`Oppetid ${Math.round(h.uptimeSec / 60)} min`} />
        <Stat label="Migreringer" value={h.migrations.length} hint={h.migrations.at(-1)?.version} />
      </Panel>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Jobbkø" />
          <Table head={['Status', 'Antall']} rows={h.jobs.map((j) => [j.status, j.n])} empty="Køen er tom." />
          <Table head={['Feilet jobb', 'Feil', 'Tid']} rows={h.failedJobs.map((j) => [j.kind, j.lastError?.slice(0, 120) ?? '', formatDateTime(j.finishedAt)])} empty="Ingen feilede jobber." />
        </Panel>
        <Panel>
          <PanelHeader title="E-post siste 7 dager" />
          <Table head={['Status', 'Antall']} rows={h.emails.map((e) => [e.status, e.n])} empty="Ingen e-post." />
          <PanelHeader title="Integrasjoner" />
          <Table head={['Integrasjon', 'Status']} rows={integrationRows(integrations)} />
        </Panel>
        <Panel>
          <PanelHeader
            title="Priser i Stripe"
            description="Kontrollerer at pris-ID-ene i miljøet er aktive, i NOK, månedlige og har riktig beløp. Leser bare – endrer ingenting i Stripe."
            action={
              stripeConfigured ? (
                <a href="/admin/helse?stripe=1" className="text-[13px] font-semibold">
                  Kontroller nå
                </a>
              ) : null
            }
          />
          {!stripeConfigured ? (
            <p className="px-5 py-4 text-[14px] text-muted">Stripe er ikke satt opp (STRIPE_SECRET_KEY mangler).</p>
          ) : prices ? (
            <Table head={['Plan', 'Pris-ID', 'Resultat']} rows={prices.map((p) => [p.plan, p.priceId ?? '–', p.ok ? 'OK' : p.problems.join(' ')])} />
          ) : (
            <p className="px-5 py-4 text-[14px] text-muted">Trykk «Kontroller nå» etter at pris-ID-ene er satt.</p>
          )}
        </Panel>
      </div>
    </AdminShell>
  );
}
