import { LuArrowLeft, LuExternalLink, LuFileText, LuTrash2, LuUpload } from 'react-icons/lu';
import type { ReactNode } from 'react';
import { CONTRACT_NATURES, cpvLabel, INDUSTRY_BY_ID, procedureLabel, REGION_BY_CODE } from '@/domain/reference';
import type { TenderDetail, TenderSourceRow } from '@/domain/tenders/queries';
import type { StoredTenderAnalysis } from '@/domain/ai/analysis';
import type { MatchBreakdown } from '@/domain/matching/engine';
import type { RefCheck } from '@/domain/ai/sources';
import { BOOKMARK_STATUSES } from '@/domain/tenders/bookmarks';
import { useUi } from '../../context';
import {
  Alert,
  Badge,
  Button,
  buttonVariants,
  DefinitionList,
  Field,
  Panel,
  PanelHeader,
  PostForm,
  SampleBadge,
  Select,
  SourceTag,
  Textarea,
} from '../../components';
import { AppShell } from '../../layouts';
import { BookmarkButton, MatchExplanation, StatusBadge } from '../../tender';
import { daysUntil, formatDate, formatDateTime, formatInt, formatMoney, relativeTime } from '../../format';

export interface TenderPageProps {
  tender: TenderDetail;
  cpvLabels: Map<string, string>;
  sources: TenderSourceRow[];
  updates: { id: string; changeType: string; summary: string; detectedAt: Date }[];
  awards: { id: string; supplierId: string | null; supplierName: string; lotTitle: string | null; awardedValue: number | null; currency: string | null; awardDate: Date | null }[];
  bookmark: { id: string; status: string; note: string | null } | null;
  match: { score: number; breakdown: MatchBreakdown; excluded: boolean; computedAt: Date } | null;
  documents: { id: string; title: string; pageCount: number | null; textStatus: string; textError: string | null; orgId: string | null; createdAt: Date; sizeBytes: number | null }[];
  workspace: { id: string; status: string } | null;
  analysis: StoredTenderAnalysis | null;
  aiQuota: { used: number; limit: number };
}

const SOURCE_NAMES: Record<string, string> = { ted: 'TED', doffin: 'Doffin', manual: 'Manuell import', sample: 'Eksempeldata' };

function DeadlineBlock({ tender }: { tender: TenderDetail }) {
  const days = daysUntil(tender.deadlineAt);
  if (!tender.deadlineAt) {
    return (
      <div>
        <p className="text-[13px] text-muted">Tilbudsfrist</p>
        <p className="mt-1 text-[15px] font-semibold text-navy-900">Ikke oppgitt i kunngjøringen</p>
        <p className="mt-1 text-[12px] text-muted">Sjekk konkurransegrunnlaget hos kilden.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[13px] text-muted">Tilbudsfrist</p>
      <p className="mt-1 font-serif text-[30px] font-semibold leading-none text-navy-900">
        {days !== null && days > 0 ? (
          <span className="hl">
            {days} {days === 1 ? 'dag' : 'dager'}
          </span>
        ) : (
          'Utløpt'
        )}
      </p>
      <p className="num mt-2 text-[14px] text-ink">{formatDateTime(tender.deadlineAt, tender.deadlineTimeKnown)}</p>
      {!tender.deadlineTimeKnown ? <p className="mt-0.5 text-[12px] text-muted">Klokkeslett er ikke oppgitt i dataene.</p> : null}
    </div>
  );
}

export function TenderPage(p: TenderPageProps) {
  const { org, aiConfigured, aiIsMock } = useUi();
  const t = p.tender;
  const ent = org!.entitlements;
  const regionNames = t.regionCodes.map((r) => REGION_BY_CODE.get(r)?.name ?? r);
  const verified: { term: ReactNode; detail: ReactNode }[] = [
    { term: 'Oppdragsgiver', detail: t.buyerName ?? 'Ikke oppgitt' },
    ...(t.buyerOrgNumber ? [{ term: 'Org.nr. oppdragsgiver', detail: <span className="num">{t.buyerOrgNumber}</span> }] : []),
    { term: 'Sted', detail: [t.placeText, regionNames.join(', ')].filter(Boolean).join(' – ') || 'Ikke oppgitt' },
    {
      term: 'Tilbudsfrist',
      detail: t.deadlineAt ? <span className="hl num">{formatDateTime(t.deadlineAt, t.deadlineTimeKnown)}</span> : 'Ikke oppgitt',
    },
    { term: 'Publisert', detail: formatDate(t.publishedAt) },
    { term: 'Estimert verdi', detail: t.estimatedValue !== null ? <span className="num">{formatMoney(t.estimatedValue, t.currency, false)}</span> : 'Ikke oppgitt' },
    { term: 'Kontraktstype', detail: t.contractNature ? (CONTRACT_NATURES[t.contractNature] ?? t.contractNature) : 'Ikke oppgitt' },
    ...(t.procedureType ? [{ term: 'Prosedyre', detail: procedureLabel(t.procedureType) }] : []),
    ...(t.buyerReference ? [{ term: 'Referanse', detail: t.buyerReference }] : []),
    {
      term: 'CPV-koder',
      detail: t.cpvCodes.length ? (
        <ul className="space-y-0.5">
          {t.cpvCodes.map((c) => (
            <li key={c}>
              <span className="num font-semibold">{c}</span> <span className="text-muted">{cpvLabel(c, p.cpvLabels)}</span>
            </li>
          ))}
        </ul>
      ) : (
        'Ikke oppgitt'
      ),
    },
    ...(t.receivedTenders !== null ? [{ term: 'Antall tilbud mottatt', detail: <span className="num">{formatInt(t.receivedTenders)}</span> }] : []),
  ];

  return (
    <AppShell wide>
      <a href="/app/anbud" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
        <LuArrowLeft className="size-4" aria-hidden /> Tilbake til søket
      </a>
      <header className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          {t.isSample ? <SampleBadge /> : null}
          {p.sources
            .filter((s) => s.source !== 'sample')
            .map((s) => (
              <SourceTag key={`${s.source}-${s.sourceNoticeId}`} source={s.source} />
            ))}
          {t.industryIds.map((i) => (
            <Badge key={i} tone="neutral">
              {INDUSTRY_BY_ID.get(i)?.name ?? i}
            </Badge>
          ))}
        </div>
        <h1 className="max-w-4xl font-serif text-[26px] font-semibold leading-tight text-navy-900 sm:text-[32px]">{t.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <BookmarkButton tenderId={t.id} bookmarked={Boolean(p.bookmark)} />
          {t.sourceUrl ? (
            <a href={t.sourceUrl} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'h-9' })}>
              <LuExternalLink className="size-4" aria-hidden /> Åpne hos kilden
            </a>
          ) : (
            <span className="text-[13px] text-muted">{t.isSample ? 'Eksempeldata har ingen kildelenke.' : 'Kildelenke mangler.'}</span>
          )}
          {ent.bidAssistant ? (
            p.workspace ? (
              <a href={`/app/tilbud/${p.workspace.id}`} className={buttonVariants({ variant: 'primary', size: 'sm', className: 'h-9' })}>
                Gå til tilbudsarbeid
              </a>
            ) : t.status === 'open' ? (
              <PostForm action="/app/tilbud">
                <input type="hidden" name="tenderId" value={t.id} />
                <Button size="sm" className="h-9">
                  Start tilbudsarbeid
                </Button>
              </PostForm>
            ) : null
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Panel>
            <PanelHeader title="Fra kunngjøringen" description="Hentet direkte fra kilden. Ingen AI er brukt i denne delen." />
            <div className="px-5 py-2">
              <DefinitionList items={verified} />
            </div>
            <div className="border-t border-line px-5 py-3 text-[12px] text-muted">
              {p.sources.map((s) => (
                <p key={`${s.source}-${s.sourceNoticeId}`}>
                  {SOURCE_NAMES[s.source] ?? s.source} {s.sourceNoticeId}
                  {s.publishedAt ? `, publisert ${formatDate(s.publishedAt)}` : ''}
                  {s.removedAt ? ' (fjernet fra kilden)' : ''}
                  {s.sourceUrl ? (
                    <>
                      {' – '}
                      <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                        åpne
                      </a>
                    </>
                  ) : null}
                </p>
              ))}
              <p>Sist kontrollert mot kilden {relativeTime(t.lastCheckedAt)}.</p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Beskrivelse" />
            <div className="px-5 py-4">
              {t.description ? (
                <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{t.description}</p>
              ) : (
                <p className="text-[14px] text-muted">Kunngjøringen har ingen beskrivelse. Les konkurransegrunnlaget hos kilden.</p>
              )}
            </div>
          </Panel>

          <AnalysisTeaser
            tenderId={t.id}
            analysis={p.analysis}
            aiConfigured={aiConfigured}
            aiIsMock={aiIsMock}
            canAnalyze={ent.aiAnalysesPerMonth > 0}
            full={ent.aiFullAnalysis}
            quota={p.aiQuota}
          />

          <DocumentsPanel tenderId={t.id} documents={p.documents} canUpload={ent.documentUpload} />

          {p.awards.length ? (
            <Panel>
              <PanelHeader title="Tildeling" description="Fra tildelingskunngjøringen hos kilden." />
              <ul className="divide-y divide-line">
                {p.awards.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[14px]">
                    <div>
                      <p className="font-semibold text-navy-900">
                        {ent.competitorIntel && a.supplierId ? <a href={`/app/konkurrenter/leverandor/${a.supplierId}`}>{a.supplierName}</a> : a.supplierName}
                      </p>
                      {a.lotTitle ? <p className="text-[13px] text-muted">{a.lotTitle}</p> : null}
                    </div>
                    <div className="text-right">
                      <p className="num">{a.awardedValue !== null ? formatMoney(a.awardedValue, a.currency, false) : 'Verdi ikke oppgitt'}</p>
                      <p className="text-[12px] text-muted">{a.awardDate ? formatDate(a.awardDate) : ''}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {p.updates.length ? (
            <Panel>
              <PanelHeader title="Endringer" />
              <ol className="divide-y divide-line">
                {p.updates.map((u) => (
                  <li key={u.id} className="flex gap-4 px-5 py-3 text-[14px]">
                    <span className="num w-24 shrink-0 text-[13px] text-muted">{formatDate(u.detectedAt)}</span>
                    <span>{u.summary}</span>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : null}
        </div>

        <aside className="space-y-6">
          <Panel className="p-5">
            <DeadlineBlock tender={t} />
          </Panel>
          <Panel>
            <PanelHeader title="Passer det for oss?" />
            <div className="p-5">
              {!ent.matching ? (
                <p className="text-[14px] text-muted">
                  Personlig rangering med begrunnelser er med i Profesjonell. <a href="/app/abonnement">Se planer</a>
                </p>
              ) : p.match ? (
                <MatchExplanation score={p.match.score} breakdown={p.match.breakdown} excluded={p.match.excluded} />
              ) : (
                <p className="text-[14px] text-muted">
                  Anbudet har lav eller ingen relevans for profilen, eller er ikke åpent. <a href="/app/profil">Juster profilen</a>
                </p>
              )}
            </div>
          </Panel>
          {p.bookmark ? (
            <Panel>
              <PanelHeader title="Status for dere" />
              <PostForm action={`/app/lagret/${p.bookmark.id}`} className="space-y-3 p-5">
                <input type="hidden" name="back" value={`/app/anbud/${t.id}`} />
                <Field label="Status" htmlFor="bm-status">
                  <Select id="bm-status" name="status" defaultValue={p.bookmark.status}>
                    {Object.entries(BOOKMARK_STATUSES).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Notat til teamet" htmlFor="bm-note">
                  <Textarea id="bm-note" name="note" rows={3} maxLength={2000} defaultValue={p.bookmark.note ?? ''} />
                </Field>
                <Button size="sm" variant="secondary" type="submit">
                  Lagre
                </Button>
              </PostForm>
            </Panel>
          ) : null}
          <details className="rounded-lg border border-line bg-white">
            <summary className="cursor-pointer px-5 py-3 text-[14px] font-semibold text-navy-900">Rapporter feil i kunngjøringen</summary>
            <PostForm action={`/app/anbud/${t.id}/rapporter`} className="space-y-3 px-5 pb-5">
              <Field label="Hva er feil?" htmlFor="report-msg">
                <Textarea id="report-msg" name="message" rows={3} required maxLength={2000} />
              </Field>
              <Button size="sm" variant="secondary" type="submit">
                Send
              </Button>
            </PostForm>
          </details>
        </aside>
      </div>
    </AppShell>
  );
}

function AnalysisTeaser({
  tenderId,
  analysis,
  aiConfigured,
  aiIsMock,
  canAnalyze,
  full,
  quota,
}: {
  tenderId: string;
  analysis: StoredTenderAnalysis | null;
  aiConfigured: boolean;
  aiIsMock: boolean;
  canAnalyze: boolean;
  full: boolean;
  quota: { used: number; limit: number };
}) {
  const summary = analysis ? String((analysis.data as { summary?: string }).summary ?? '') : '';
  return (
    <Panel className="border-ai/30">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-ai/20 bg-ai-soft px-5 py-4">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-navy-900">
            AI-tolkning <Badge tone="ai">Ikke verifisert</Badge>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Laget av AI fra kunngjøringen{full ? ' og opplastede dokumenter' : ''}. Kontroller mot kilden.</p>
        </div>
        {analysis ? (
          <a href={`/app/anbud/${tenderId}/analyse`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Se full analyse
          </a>
        ) : null}
      </div>
      <div className="space-y-3 px-5 py-4">
        {analysis?.isMock ? <Alert tone="warning">Dette er et simulert svar fra testmodus (AI_PROVIDER=mock), ikke en ekte AI-analyse.</Alert> : null}
        {analysis ? (
          <>
            <p className="text-[15px] leading-relaxed text-ink">{summary}</p>
            <p className="text-[12px] text-muted">
              Laget {relativeTime(analysis.createdAt)} med {analysis.provider === 'mock' ? 'testmodus' : analysis.model}.
              {analysis.orgId ? ' Inkluderer dine opplastede dokumenter.' : ''}
            </p>
          </>
        ) : !aiConfigured ? (
          <p className="text-[14px] text-muted">AI-analyse er ikke slått på ennå. Administrator må legge inn en API-nøkkel.</p>
        ) : !canAnalyze ? (
          <p className="text-[14px] text-muted">
            AI-sammendrag er med fra Starter. <a href="/app/abonnement">Se planer</a>
          </p>
        ) : (
          <p className="text-[14px] text-muted">
            Få sammendrag, krav, kvalifikasjoner, tildelingskriterier og risikoer med kildehenvisning.
            {aiIsMock ? ' (Testmodus: svarene simuleres.)' : ''}
          </p>
        )}
        {aiConfigured && canAnalyze ? (
          <PostForm action={`/app/anbud/${tenderId}/analyse`} className="flex flex-wrap items-center gap-3">
            {analysis ? <input type="hidden" name="force" value="1" /> : null}
            <Button size="sm" variant={analysis ? 'secondary' : 'primary'} busyLabel="Analyserer … (kan ta opptil ett minutt)">
              {analysis ? 'Analyser på nytt' : full ? 'Analyser med AI' : 'Lag AI-sammendrag'}
            </Button>
            <span className="num text-[12px] text-muted">
              Brukt {quota.used} av {quota.limit} denne måneden
            </span>
          </PostForm>
        ) : null}
      </div>
    </Panel>
  );
}

function DocumentsPanel({ tenderId, documents, canUpload }: { tenderId: string; documents: TenderPageProps['documents']; canUpload: boolean }) {
  return (
    <Panel>
      <PanelHeader
        title="Dokumenter for analyse"
        description="Last opp konkurransegrunnlaget for en grundigere analyse med sidehenvisninger. Dokumentene er private for organisasjonen."
      />
      {documents.length ? (
        <ul className="divide-y divide-line">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
              <div className="flex min-w-0 items-center gap-2.5">
                <LuFileText className="size-4 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-navy-900">{d.title}</p>
                  <p className="text-[12px] text-muted">
                    {d.textStatus === 'extracted'
                      ? `${d.pageCount ?? '?'} sider lest`
                      : d.textStatus === 'failed'
                        ? (d.textError ?? 'Kunne ikke lese teksten')
                        : 'Venter'}
                  </p>
                </div>
              </div>
              {d.orgId ? (
                <PostForm action={`/app/anbud/${tenderId}/dokumenter/${d.id}/slett`} confirm="Slette dokumentet?">
                  <button type="submit" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-danger-soft hover:text-danger" title="Slett">
                    <LuTrash2 className="size-4" aria-hidden />
                    <span className="sr-only">Slett {d.title}</span>
                  </button>
                </PostForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="border-t border-line px-5 py-4">
        {canUpload ? (
          <PostForm action={`/app/anbud/${tenderId}/dokumenter`} multipart className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="file"
              name="file"
              required
              accept=".pdf,.docx,.txt,application/pdf"
              className="block w-full text-[13px] file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-white file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-navy-900"
            />
            <Button size="sm" variant="secondary" busyLabel="Leser dokumentet …">
              <LuUpload className="size-4" aria-hidden /> Last opp
            </Button>
          </PostForm>
        ) : (
          <p className="text-[13px] text-muted">
            Opplasting av dokumenter er med i Profesjonell. <a href="/app/abonnement">Se planer</a>
          </p>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Full AI-analyse
// ---------------------------------------------------------------------------
type Sourced = { text: string; source: { source_id: string; page: number | null; quote: string | null } | null };

function RefChip({ check }: { check: RefCheck | undefined }) {
  if (!check) return <Badge tone="outline">Uten kilde</Badge>;
  if (!check.sourceExists) return <Badge tone="danger">Ukjent kilde – ikke stol på dette</Badge>;
  const label = `${check.sourceTitle}${check.page ? `, s. ${check.page}` : ''}`;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone="outline">{label}</Badge>
      {check.quote ? (
        check.quoteVerified ? (
          <Badge tone="ok" title={check.quote}>
            Sitat funnet i kilden
          </Badge>
        ) : (
          <Badge tone="urgent" title={check.quote}>
            Sitat ikke funnet – sjekk selv
          </Badge>
        )
      ) : null}
    </span>
  );
}

function SourcedList({ title, items, path, verification, empty }: { title: string; items: Sourced[]; path: string; verification: Record<string, RefCheck>; empty: string }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[15px] font-semibold text-navy-900">{title}</h3>
      {items.length ? (
        <ul className="space-y-3">
          {items.map((item, i) => {
            const check = verification[`${path}[${i}]`];
            return (
              <li key={i} className="rounded-md border border-line bg-white px-4 py-3">
                <p className="text-[14px] text-ink">{item.text}</p>
                <div className="mt-2 text-[12px]">
                  <RefChip check={check} />
                </div>
                {check?.quote ? <p className="mt-1.5 border-l-2 border-line pl-2 text-[12px] italic text-muted">«{check.quote}»</p> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[14px] text-muted">{empty}</p>
      )}
    </section>
  );
}

export function AnalysisPage({ tender, analysis }: { tender: TenderDetail; analysis: StoredTenderAnalysis }) {
  const d = analysis.data as Record<string, unknown>;
  const v = analysis.verification;
  const list = (k: string) => (Array.isArray(d[k]) ? (d[k] as Sourced[]) : []);
  const deadlineAi = d.deadline as { value: string | null } | undefined;
  const durationAi = d.contract_duration as { value: string | null } | undefined;
  return (
    <AppShell>
      <a href={`/app/anbud/${tender.id}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
        <LuArrowLeft className="size-4" aria-hidden /> Tilbake til kunngjøringen
      </a>
      <header className="mb-6">
        <p className="text-[13px] font-semibold text-ai">AI-tolkning</p>
        <h1 className="mt-1 max-w-3xl font-serif text-[26px] font-semibold leading-tight text-navy-900">{tender.title}</h1>
      </header>
      <div className="space-y-4">
        {analysis.isMock ? <Alert tone="warning">Simulert svar fra testmodus (AI_PROVIDER=mock). Ikke en ekte AI-analyse.</Alert> : null}
        <Alert tone="info" title="Slik leser du analysen">
          Teksten er laget av AI og kan inneholde feil. Hver opplysning viser kilden. «Sitat funnet i kilden» betyr at det ordrette sitatet faktisk står i
          dokumentet. Fakta du skal handle på – særlig frister og krav – må alltid sjekkes i originaldokumentene.
        </Alert>
        <Panel className="p-5">
          <h2 className="text-[13px] font-semibold text-muted">Analysen bygger på</h2>
          <ul className="mt-2 space-y-1 text-[14px]">
            {analysis.coverage.map((c) => (
              <li key={c.sourceId}>
                {c.title}
                {c.kind === 'document'
                  ? ` – ${c.includedPages.length} av ${c.totalPages ?? c.includedPages.length} sider${c.truncated ? ' (dokumentet var for langt til å tas med i sin helhet)' : ''}`
                  : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted">
            Laget {formatDateTime(analysis.createdAt)} med {analysis.provider === 'mock' ? 'testmodus' : `${analysis.provider} / ${analysis.model}`}.
          </p>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="font-serif text-[20px] font-semibold text-navy-900">Sammendrag</h2>
            <p className="mt-2 text-[15px] leading-relaxed">{String(d.summary ?? '')}</p>
            <h3 className="mt-5 text-[15px] font-semibold text-navy-900">Hva oppdragsgiver vil kjøpe</h3>
            <p className="mt-1 text-[15px] leading-relaxed">{String(d.purchase_description ?? '')}</p>
          </section>
          {analysis.level === 'full' ? (
            <>
              <SourcedList title="Viktige krav" items={list('key_requirements')} path="key_requirements" verification={v} empty="Ingen krav funnet i kildene." />
              <SourcedList title="Kvalifikasjonskrav" items={list('qualification_criteria')} path="qualification_criteria" verification={v} empty="Ikke beskrevet i kildene." />
              <SourcedList title="Sertifiseringer og godkjenninger" items={list('certifications')} path="certifications" verification={v} empty="Ingen nevnt i kildene." />
              <SourcedList title="Økonomiske krav" items={list('financial_requirements')} path="financial_requirements" verification={v} empty="Ingen nevnt i kildene." />
              <SourcedList title="Geografiske krav" items={list('geographic_requirements')} path="geographic_requirements" verification={v} empty="Ingen nevnt i kildene." />
              <section className="space-y-2">
                <h3 className="text-[15px] font-semibold text-navy-900">Tildelingskriterier</h3>
                {Array.isArray(d.evaluation_criteria) && (d.evaluation_criteria as unknown[]).length ? (
                  <ul className="space-y-3">
                    {(d.evaluation_criteria as { criterion: string; weight: string | null }[]).map((c, i) => (
                      <li key={i} className="rounded-md border border-line bg-white px-4 py-3">
                        <p className="text-[14px]">
                          {c.criterion}
                          {c.weight ? <strong className="num"> – {c.weight}</strong> : null}
                        </p>
                        <div className="mt-2 text-[12px]">
                          <RefChip check={v[`evaluation_criteria[${i}]`]} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-muted">Ikke beskrevet i kildene.</p>
                )}
              </section>
              <SourcedList title="Dokumentasjon som skal leveres" items={list('required_documentation')} path="required_documentation" verification={v} empty="Ikke beskrevet i kildene." />
              <section className="space-y-2 rounded-lg border border-dashed border-ai/40 bg-ai-soft/60 p-4">
                <h3 className="text-[15px] font-semibold text-navy-900">Risikoer (AI-vurdering)</h3>
                <ul className="list-disc space-y-1 pl-5 text-[14px]">
                  {(Array.isArray(d.risks) ? (d.risks as { text: string }[]) : []).map((r, i) => (
                    <li key={i}>{r.text}</li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <Alert tone="info">Full analyse med krav, kvalifikasjoner og kildehenvisninger er med i Profesjonell.</Alert>
          )}
          <section className="space-y-2">
            <h3 className="text-[15px] font-semibold text-navy-900">Dette mangler i kildene</h3>
            {Array.isArray(d.missing_information) && d.missing_information.length ? (
              <ul className="list-disc space-y-1 pl-5 text-[14px]">
                {(d.missing_information as string[]).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">AI-en fant ikke at noe vesentlig mangler. Sjekk likevel konkurransegrunnlaget.</p>
            )}
          </section>
        </div>
        <aside className="space-y-4">
          <Panel className="p-5">
            <p className="text-[13px] font-semibold text-muted">Frist i kunngjøringen</p>
            <p className="num mt-1 font-semibold">{tender.deadlineAt ? formatDateTime(tender.deadlineAt, tender.deadlineTimeKnown) : 'Ikke oppgitt'}</p>
            {analysis.level === 'full' ? (
              <>
                <p className="mt-3 text-[13px] font-semibold text-muted">Frist lest av AI</p>
                <p className="mt-1 text-[14px]">{deadlineAi?.value ?? 'Ikke funnet'}</p>
                <div className="mt-1 text-[12px]">
                  <RefChip check={v.deadline} />
                </div>
                <p className="mt-2 text-[12px] text-muted">Avviker de? Da gjelder kilden – sjekk konkurransegrunnlaget.</p>
                <p className="mt-4 text-[13px] font-semibold text-muted">Kontraktens varighet</p>
                <p className="mt-1 text-[14px]">{durationAi?.value ?? 'Ikke funnet i kildene'}</p>
              </>
            ) : null}
          </Panel>
          {analysis.level === 'full' && Array.isArray(d.questions_to_investigate) ? (
            <Panel className="p-5">
              <p className="text-[14px] font-semibold text-navy-900">Spørsmål å avklare</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
                {(d.questions_to_investigate as string[]).map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
