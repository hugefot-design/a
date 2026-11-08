import type { AppErrorRow } from '@/domain/ops/errors';
import { errorTitle } from '@/domain/ops/errors';
import { Alert, Badge, Button, PageHeader, Panel, PanelHeader, PostForm, Stat } from '../components';
import { AdminShell } from '../layouts';
import { formatDateTime, formatInt, relativeTime } from '../format';

/** Én feil som kort: lesbart på telefon (varselet på e-post åpnes ofte der). */
function ErrorItem({ e, open }: { e: AppErrorRow; open: boolean }) {
  return (
    <li className="flex flex-col gap-3 border-b border-line px-5 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold text-strong">
          {errorTitle(e.source)}
          {open && !e.notifiedAt ? <Badge tone="danger">Ny</Badge> : null}
        </p>
        <p className="mt-0.5 break-words text-[13.5px] text-ink">
          <span className="font-mono text-[12px] text-muted">{e.name}</span>: {e.message}
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          <span className="num">{formatInt(e.count)}</span> {e.count === 1 ? 'gang' : 'ganger'} ·{' '}
          {open ? (
            <span title={formatDateTime(e.lastSeenAt)}>sist {relativeTime(e.lastSeenAt)}</span>
          ) : (
            <span>løst {formatDateTime(e.resolvedAt!)}</span>
          )}{' '}
          · først {formatDateTime(e.firstSeenAt)}
        </p>
        {e.context || e.location ? (
          <p className="mt-1 break-all font-mono text-[12px] text-muted">{[e.context, e.location].filter(Boolean).join(' · ')}</p>
        ) : null}
        {e.stack ? (
          <details className="mt-1">
            <summary className="cursor-pointer py-1 text-[12.5px] text-navy-700">Hvor i koden</summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre rounded-lg bg-paper p-2 text-[11.5px] leading-5 text-ink">{e.stack}</pre>
          </details>
        ) : null}
      </div>
      {open ? (
        <PostForm action={`/admin/feil/${e.fingerprint}/lost`} className="shrink-0">
          <Button size="sm" variant="secondary">
            Merk som løst
          </Button>
        </PostForm>
      ) : null}
    </li>
  );
}

export function AdminErrorsPage({ open, resolved, emailOn }: { open: AppErrorRow[]; resolved: AppErrorRow[]; emailOn: boolean }) {
  const lastDay = open.filter((e) => Date.now() - new Date(e.lastSeenAt).getTime() < 86_400_000).length;
  return (
    <AdminShell>
      <PageHeader
        title="Feil i appen"
        description="Alt som er logget som feil, gruppert per type. E-postadresser, lange tall og nøkler er fjernet før lagring."
        actions={
          open.length > 0 ? (
            <PostForm action="/admin/feil/lost-alle" confirm="Merke alle åpne feil som løst?">
              <Button size="sm" variant="secondary">
                Merk alle som løst
              </Button>
            </PostForm>
          ) : null
        }
      />
      {emailOn ? null : (
        <Alert tone="warning" title="E-postvarsel er av" className="mb-6">
          Legg inn ADMIN_NOTIFICATION_EMAIL i miljøvariablene hos Render for å få én e-post i timen når nye feil oppstår.
        </Alert>
      )}
      <Panel className="mb-6 grid grid-cols-2 gap-6 p-5 md:grid-cols-4">
        <Stat label="Åpne feil" value={formatInt(open.length)} />
        <Stat label="Skjedd siste døgn" value={formatInt(lastDay)} />
        <Stat label="Løst siste 30 dager" value={formatInt(resolved.length)} />
        <Stat label="E-postvarsel" value={emailOn ? 'På' : 'Av'} hint={emailOn ? 'Høyst én e-post i timen' : undefined} />
      </Panel>
      <Panel className="mb-6">
        <PanelHeader title="Åpne feil" description="En løst feil som skjer igjen, dukker opp her på nytt og varsles igjen." />
        {open.length ? (
          <ul>
            {open.map((e) => (
              <ErrorItem key={e.fingerprint} e={e} open />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-[14px] text-muted">Ingen åpne feil.</p>
        )}
      </Panel>
      <Panel>
        <PanelHeader title="Løst siste 30 dager" />
        {resolved.length ? (
          <ul>
            {resolved.map((e) => (
              <ErrorItem key={e.fingerprint} e={e} open={false} />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-4 text-[14px] text-muted">Ingen løste feil.</p>
        )}
      </Panel>
    </AdminShell>
  );
}
