import { LuDownload, LuExternalLink, LuFileText, LuTrash2 } from 'react-icons/lu';
import { allowedActions, BID_STATUSES, missingInfo, type BidDocument, type ChecklistItem, type Section, type Workspace } from '@/domain/bids/bids';
import { useUi } from '../../context';
import {
  Alert,
  Badge,
  Button,
  buttonVariants,
  Checkbox,
  cn,
  CsrfField,
  DeadlineChip,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Panel,
  PanelHeader,
  PostForm,
  SampleBadge,
  Textarea,
} from '../../components';
import { AppShell } from '../../layouts';
import { formatDateTime, relativeTime } from '../../format';

export function BidsListPage({
  rows,
}: {
  rows: { id: string; title: string; status: string; updatedAt: Date; deadlineAt: Date | null; deadlineTimeKnown: boolean; buyerName: string | null; isSample: boolean; itemsTotal: number; itemsDone: number }[];
}) {
  return (
    <AppShell>
      <PageHeader title="Tilbudsarbeid" description="Forbered tilbud sammen: sjekkliste, tekst, dokumenter og godkjenning. Selve innsendingen gjøres i oppdragsgivers system." />
      <Panel>
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={`/app/tilbud/${r.id}`} className="text-[15px] font-semibold text-navy-900">
                      {r.title}
                    </a>
                    <Badge tone={r.status === 'approved' || r.status === 'submitted' ? 'ok' : r.status === 'in_review' ? 'info' : 'neutral'}>{BID_STATUSES[r.status]}</Badge>
                    {r.isSample ? <SampleBadge /> : null}
                  </div>
                  <p className="text-[13px] text-muted">
                    {r.buyerName}. Sjekkliste {r.itemsDone} av {r.itemsTotal}. Endret {relativeTime(r.updatedAt)}.
                  </p>
                </div>
                <DeadlineChip deadline={r.deadlineAt} timeKnown={r.deadlineTimeKnown} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Ingen tilbud under arbeid">Åpne et anbud og trykk «Start tilbudsarbeid».</EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}

const ACTION_LABELS: Record<string, string> = {
  request_review: 'Send til gjennomgang',
  approve: 'Godkjenn tilbudet',
  reopen: 'Tilbake til utkast',
  mark_submitted: 'Merk som levert',
  archive: 'Arkiver',
};

function StatusSteps({ status }: { status: string }) {
  const steps = ['draft', 'in_review', 'approved', 'submitted'];
  const idx = steps.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[13px]">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold',
              i < idx ? 'bg-ok-soft text-ok' : i === idx ? 'bg-navy-900 text-surface' : 'bg-navy-50 text-muted',
            )}
            aria-current={i === idx ? 'step' : undefined}
          >
            <span className="num">{i + 1}</span> {BID_STATUSES[s]}
          </span>
        </li>
      ))}
    </ol>
  );
}

export interface WorkspaceProps {
  ws: Workspace;
  checklist: ChecklistItem[];
  sections: Section[];
  documents: BidDocument[];
  review: { result: Record<string, unknown>; createdAt: Date } | null;
  aiConfigured: boolean;
  draftQuota: { used: number; limit: number };
}

/** Merkelapp for hvor et punkt i sjekklisten kommer fra. */
function checklistBadge(c: { source: string; category: string }): string {
  if (c.source === 'ai') return 'AI';
  if (c.source === 'standard') return 'Standard';
  if (c.source === 'krav') return CHECKLIST_KRAV_LABELS[c.category] ?? 'Krav';
  return 'Lagt til';
}
const CHECKLIST_KRAV_LABELS: Record<string, string> = {
  avvisning: 'Avvisningsgrunn',
  minstekrav: 'Minstekrav',
  befaring: 'Frist / befaring',
  kvalifikasjon: 'Kvalifikasjon',
  innlevering: 'Krav til tilbudet',
};

export function BidWorkspacePage(p: WorkspaceProps) {
  const { org } = useUi();
  const actions = allowedActions(p.ws.status, org!.role);
  const missing = missingInfo(p.sections, p.checklist);
  const done = p.checklist.filter((c) => c.isDone).length;
  const locked = p.ws.status === 'submitted' || p.ws.status === 'archived';
  const review = p.review?.result as { data?: { overall: string; items: { requirement: string; coverage: string; comment: string }[] }; isMock?: boolean } | undefined;
  const base = `/app/tilbud/${p.ws.id}`;
  return (
    <AppShell wide>
      <div className="mb-6 space-y-3">
        <a href="/app/tilbud" className="text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
          Alle tilbud
        </a>
        <div className="flex flex-wrap items-center gap-2">
          {p.ws.isSample ? <SampleBadge /> : null}
          <DeadlineChip deadline={p.ws.deadlineAt} timeKnown={p.ws.deadlineTimeKnown} />
        </div>
        <h1 className="max-w-4xl font-serif text-[26px] font-semibold leading-tight text-navy-900">{p.ws.tenderTitle}</h1>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <a href={`/app/anbud/${p.ws.tenderId}`}>Se kunngjøringen</a>
          {p.ws.sourceUrl ? (
            <a href={p.ws.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
              Åpne hos kilden <LuExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>

      <Panel className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <StatusSteps status={p.ws.status} />
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((a) =>
              a === 'mark_submitted' ? (
                <PostForm key={a} action={`${base}/status`} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="action" value={a} />
                  <Checkbox name="confirmed" required label="Tilbudet er lastet opp i oppdragsgivers system" />
                  <Button size="sm">{ACTION_LABELS[a]}</Button>
                </PostForm>
              ) : (
                <PostForm key={a} action={`${base}/status`}>
                  <input type="hidden" name="action" value={a} />
                  <Button size="sm" variant={a === 'approve' || a === 'request_review' ? 'primary' : 'secondary'}>
                    {ACTION_LABELS[a]}
                  </Button>
                </PostForm>
              ),
            )}
          </div>
        </div>
        {p.ws.status === 'in_review' && org!.role === 'member' ? (
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">En eier eller administrator må godkjenne tilbudet.</p>
        ) : null}
        {p.ws.status === 'approved' ? (
          <p className="border-t border-line px-5 py-3 text-[13px] text-muted">
            Godkjent av {p.ws.approvedByName ?? 'ukjent'} {p.ws.approvedAt ? formatDateTime(p.ws.approvedAt) : ''}. Endringer i tekst eller dokumenter
            setter tilbudet tilbake til utkast.
          </p>
        ) : null}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader
              title="Sjekkliste"
              description={`${done} av ${p.checklist.length} gjort. Standardpunkter er vanlige i norske anbud – bekreft dem mot konkurransegrunnlaget.`}
              action={
                !locked ? (
                  <div className="flex flex-wrap gap-2">
                    <PostForm action={`${base}/sjekkliste/krav`}>
                      <Button size="sm" variant="secondary" busyLabel="Leser dokumentene …" title="Ordsøk i kunngjøringen og dokumentene – ingen AI">
                        Hent krav fra dokumentene
                      </Button>
                    </PostForm>
                    {p.aiConfigured ? (
                      <PostForm action={`${base}/sjekkliste/ai`}>
                        <Button size="sm" variant="secondary" busyLabel="Leser kravene …">
                          Hent krav med AI
                        </Button>
                      </PostForm>
                    ) : null}
                  </div>
                ) : null
              }
            />
            <ul className="divide-y divide-line">
              {p.checklist.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-5 py-2.5">
                  <PostForm action={`${base}/sjekkliste/${c.id}`} className="pt-0.5">
                    <input type="hidden" name="done" value={c.isDone ? '0' : '1'} />
                    {/* Trykkflaten er 32 px (mobil), selve boksen 20 px. */}
                    <button
                      type="submit"
                      disabled={locked}
                      className="-m-1.5 flex size-8 items-center justify-center rounded-md"
                      aria-label={c.isDone ? `Marker «${c.label}» som ikke gjort` : `Marker «${c.label}» som gjort`}
                    >
                      <span className={cn('flex size-5 items-center justify-center rounded border text-[12px] font-bold', c.isDone ? 'border-ok bg-ok text-surface' : 'border-line-strong bg-surface')}>
                        {c.isDone ? '✓' : ''}
                      </span>
                    </button>
                  </PostForm>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[14px]', c.isDone && 'text-muted line-through')}>{c.label}</p>
                    <div className="mt-0.5 flex flex-wrap gap-1.5">
                      <Badge tone={c.source === 'ai' ? 'ai' : c.source === 'krav' && c.category === 'avvisning' ? 'danger' : 'outline'}>{checklistBadge(c)}</Badge>
                      {c.sourceRef ? <span className="text-[12px] text-muted">{c.sourceRef}</span> : null}
                    </div>
                  </div>
                  {!locked ? (
                    <PostForm action={`${base}/sjekkliste/${c.id}/slett`}>
                      <button type="submit" className="-m-1.5 flex size-8 items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" title="Fjern punkt">
                        <LuTrash2 className="size-4" aria-hidden />
                        <span className="sr-only">Fjern {c.label}</span>
                      </button>
                    </PostForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {!locked ? (
              <PostForm action={`${base}/sjekkliste`} className="flex gap-2 border-t border-line px-5 py-3">
                <label htmlFor="new-item" className="sr-only">
                  Nytt punkt
                </label>
                <Input id="new-item" name="label" placeholder="Legg til punkt" maxLength={500} required />
                <Button size="sm" variant="secondary" className="h-10">
                  Legg til
                </Button>
              </PostForm>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader
              title="Tilbudstekst"
              description="Skrives av dere. AI kan lage utkast fra bedriftsprofilen, men finner aldri på erfaring, sertifiseringer eller tall. Mangler vises som [FYLL INN: …]."
              action={
                !locked && p.aiConfigured ? (
                  <PostForm action={`${base}/struktur/ai`}>
                    <Button size="sm" variant="secondary" busyLabel="Foreslår …">
                      Foreslå disposisjon med AI
                    </Button>
                  </PostForm>
                ) : undefined
              }
            />
            <p className="border-b border-line bg-marker-soft px-5 py-2 text-[12px] text-ink">
              AI-utkast er forslag. AnbudRadar kan ikke garantere at tilbudet er komplett eller at dere kvalifiserer – kontroller alt mot
              konkurransegrunnlaget før innsending.
            </p>
            <div className="divide-y divide-line">
              {p.sections.map((s) => (
                <section key={s.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-navy-900">
                      {s.title} {s.aiAssisted ? <Badge tone="ai">AI-assistert</Badge> : null}
                    </h3>
                    <div className="flex items-center gap-2">
                      <span id={`status-${s.id}`} className="text-[12px] text-muted" aria-live="polite">
                        {s.updatedByName ? `Endret av ${s.updatedByName} ${relativeTime(s.updatedAt)}` : ''}
                      </span>
                      {p.aiConfigured && !locked ? (
                        <PostForm action={`${base}/seksjoner/${s.id}/ai`}>
                          <Button size="sm" variant="ghost" busyLabel="Skriver …" disabled={p.draftQuota.used >= p.draftQuota.limit}>
                            Lag utkast med AI
                          </Button>
                        </PostForm>
                      ) : null}
                    </div>
                  </div>
                  <form method="post" action={`${base}/seksjoner/${s.id}`} className="space-y-2">
                    <CsrfField />
                    <label htmlFor={`sec-${s.id}`} className="sr-only">
                      {s.title}
                    </label>
                    <Textarea
                      id={`sec-${s.id}`}
                      name="content"
                      rows={Math.min(18, Math.max(5, s.content.split('\n').length + 2))}
                      defaultValue={s.content}
                      readOnly={locked}
                      data-autosave-url={locked ? undefined : `${base}/seksjoner/${s.id}`}
                      data-status-id={`status-${s.id}`}
                      maxLength={50_000}
                      className="font-[inherit] text-[14px] leading-relaxed"
                    />
                    {!locked ? (
                      <noscript>
                        <Button size="sm" variant="secondary">
                          Lagre
                        </Button>
                      </noscript>
                    ) : null}
                  </form>
                </section>
              ))}
            </div>
            {!locked ? (
              <PostForm action={`${base}/seksjoner`} className="flex gap-2 border-t border-line px-5 py-3">
                <label htmlFor="new-section" className="sr-only">
                  Ny seksjon
                </label>
                <Input id="new-section" name="title" placeholder="Ny seksjon, f.eks. «Svar på krav 3.2»" maxLength={200} required />
                <Button size="sm" variant="secondary" className="h-10">
                  Legg til
                </Button>
              </PostForm>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader
              title="Sammenlign med kravene"
              description="AI sjekker om teksten svarer på kravene fra kunngjøringen. Den vurderer ikke om påstandene er sanne."
              action={
                p.aiConfigured ? (
                  <PostForm action={`${base}/gjennomgang/ai`}>
                    <Button size="sm" variant="secondary" busyLabel="Sammenligner …" disabled={p.draftQuota.used >= p.draftQuota.limit}>
                      Kjør sammenligning
                    </Button>
                  </PostForm>
                ) : null
              }
            />
            <div className="px-5 py-4">
              {review?.data ? (
                <div className="space-y-3">
                  {review.isMock ? <Alert tone="warning">Simulert svar fra testmodus.</Alert> : null}
                  <p className="text-[14px]">{review.data.overall}</p>
                  <ul className="space-y-2">
                    {review.data.items.map((i, idx) => (
                      <li key={idx} className="flex gap-3 rounded-md border border-line px-3 py-2 text-[13px]">
                        <Badge tone={i.coverage === 'dekket' ? 'ok' : i.coverage === 'delvis' ? 'marker' : 'danger'}>{i.coverage}</Badge>
                        <div>
                          <p className="font-semibold">{i.requirement}</p>
                          <p className="text-muted">{i.comment}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[12px] text-muted">Kjørt {relativeTime(p.review!.createdAt)}.</p>
                </div>
              ) : (
                <p className="text-[14px] text-muted">{p.aiConfigured ? 'Ikke kjørt ennå.' : 'AI er ikke konfigurert.'}</p>
              )}
            </div>
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Dette mangler" />
            <div className="space-y-3 px-5 py-4 text-[14px]">
              {missing.ready ? (
                <p className="text-ok">Ingen åpne punkter, tomme seksjoner eller plassholdere.</p>
              ) : (
                <ul className="space-y-1.5">
                  {missing.placeholders.length ? (
                    <li>
                      <span className="hl">{missing.placeholders.length} plassholdere</span> må fylles inn
                    </li>
                  ) : null}
                  {missing.emptySections.length ? <li>{missing.emptySections.length} tomme seksjoner: {missing.emptySections.join(', ')}</li> : null}
                  {missing.openItems.length ? <li>{missing.openItems.length} punkter i sjekklisten er ikke gjort</li> : null}
                </ul>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Dokumenter" description="Vedlegg til tilbudet. Private for organisasjonen." />
            {p.documents.length ? (
              <ul className="divide-y divide-line">
                {p.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-[13px]">
                    <a href={`${base}/dokumenter/${d.id}`} className="flex min-w-0 items-center gap-2">
                      <LuFileText className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{d.name}</span>
                    </a>
                    {!locked ? (
                      <PostForm action={`${base}/dokumenter/${d.id}/slett`} confirm="Slette dokumentet?">
                        <button type="submit" className="text-muted hover:text-danger" title="Slett">
                          <LuTrash2 className="size-4" aria-hidden />
                          <span className="sr-only">Slett {d.name}</span>
                        </button>
                      </PostForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {!locked ? (
              <PostForm action={`${base}/dokumenter`} multipart className="space-y-2 border-t border-line px-5 py-3">
                <input type="file" name="file" required className="block w-full text-[13px] file:mr-3 file:min-h-9 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-navy-900" />
                <Field label="Type" htmlFor="doc-cat">
                  <select id="doc-cat" name="category" className="field-input">
                    <option value="vedlegg">Vedlegg</option>
                    <option value="attest">Attest</option>
                    <option value="sertifikat">Sertifikat</option>
                    <option value="referanse">Referanse</option>
                    <option value="pris">Prisskjema</option>
                  </select>
                </Field>
                <Button size="sm" variant="secondary" busyLabel="Laster opp …">
                  Last opp
                </Button>
              </PostForm>
            ) : null}
          </Panel>

          <Panel>
            <PanelHeader title="Eksporter" description={p.ws.status === 'approved' || p.ws.status === 'submitted' ? 'Godkjent versjon.' : 'Eksporten merkes som utkast til tilbudet er godkjent.'} />
            <div className="flex flex-col gap-2 px-5 py-4">
              <a href={`${base}/eksport?format=docx`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                <LuDownload className="size-4" aria-hidden /> Word (.docx)
              </a>
              <a href={`${base}/eksport?format=md`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                <LuDownload className="size-4" aria-hidden /> Markdown
              </a>
              <a href={`${base}/eksport?format=html`} target="_blank" rel="noopener" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                Utskriftsvennlig (lagre som PDF)
              </a>
            </div>
          </Panel>
          <Alert tone="info">AnbudRadar sender ikke inn tilbud. Når teamet har godkjent, laster dere opp i oppdragsgivers system før fristen.</Alert>
        </aside>
      </div>
    </AppShell>
  );
}
