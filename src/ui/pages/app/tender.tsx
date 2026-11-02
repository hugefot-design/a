import { LuArrowLeft, LuExternalLink, LuFileText, LuTrash2, LuUpload } from 'react-icons/lu';
import type { ReactNode } from 'react';
import { CONTRACT_NATURES, cpvLabel, INDUSTRY_BY_ID, procedureLabel, REGION_BY_CODE } from '@/domain/reference';
import type { TenderDetail, TenderSourceRow } from '@/domain/tenders/queries';
import type { StoredFitAssessment, StoredTenderAnalysis } from '@/domain/ai/analysis';
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
import { TenderProfitTeaser } from './profit';
import type { Recommendation } from '@/domain/profit/recommendation';

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
  fit: StoredFitAssessment | null;
  canAssessFit: boolean;
  aiQuota: { used: number; limit: number };
  profit?: { recommendation: Recommendation; marginPct: number | null; updatedAt: Date } | null;
}

const SOURCE_NAMES: Record<string, string> = { ted: 'TED', doffin: 'Doffin', manual: 'Manuell import', sample: 'Eksempeldata' };

function DeadlineBlock({ tender }: { tender: TenderDetail }) {
  const days = daysUntil(tender.deadlineAt);
  const label = tender.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist';
  if (!tender.deadlineAt) {
    return (
      <div>
        <p className="text-[13px] text-muted">{label}</p>
        <p className="mt-1 text-[15px] font-semibold text-navy-900">Ikke oppgitt i kunngjøringen</p>
        <p className="mt-1 text-[12px] text-muted">Sjekk konkurransegrunnlaget hos kilden.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-[13px] text-muted">{label}</p>
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
      {tender.lotDeadlinesDiffer ? <p className="mt-0.5 text-[12px] text-muted">Delkontraktene har ulike frister – dette er den tidligste.</p> : null}
      {tender.deadlineKind === 'participation' ? (
        <p className="mt-1 text-[12px] text-muted">Begrenset konkurranse: tilbudsfristen settes i invitasjonen til de som kvalifiserer.</p>
      ) : null}
      {tender.questionsDeadlineAt ? (
        <p className="mt-3 text-[13px] text-ink">
          Spørsmålsfrist: <span className="num font-semibold">{formatDateTime(tender.questionsDeadlineAt, true)}</span>
        </p>
      ) : null}
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
      term: t.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist',
      detail: t.deadlineAt ? <span className="hl num">{formatDateTime(t.deadlineAt, t.deadlineTimeKnown)}</span> : 'Ikke oppgitt',
    },
    ...(t.questionsDeadlineAt ? [{ term: 'Frist for spørsmål', detail: <span className="num">{formatDateTime(t.questionsDeadlineAt, true)}</span> }] : []),
    { term: 'Publisert', detail: formatDate(t.publishedAt) },
    ...(t.durationText ? [{ term: 'Varighet', detail: t.durationText }] : []),
    ...(t.contractStart || t.contractEnd
      ? [{ term: 'Kontraktsperiode', detail: `${t.contractStart ? formatDate(t.contractStart) : '?'} – ${t.contractEnd ? formatDate(t.contractEnd) : '?'}` }]
      : []),
    ...(t.isFramework === true ? [{ term: 'Rammeavtale', detail: 'Ja' }] : []),
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

          {t.textLanguage === 'en' ? (
            <p className="-mt-3 text-[12px] text-muted">Kunngjøringen er publisert på engelsk i TED. AI-analysen oppsummerer den på norsk.</p>
          ) : null}

          <DocumentsLinkPanel tender={t} />

          <NoticeRequirementsPanel tender={t} />

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
          <FitPanel tenderId={t.id} fit={p.fit} canAssess={p.canAssessFit} aiConfigured={aiConfigured} quota={p.aiQuota} />
          <TenderProfitTeaser tenderId={t.id} badge={p.profit ?? null} enabled={ent.profitCalculator} />
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

function DocumentsLinkPanel({ tender }: { tender: TenderDetail }) {
  const docsHost = hostOf(tender.documentsUrl);
  const submitHost = hostOf(tender.submissionUrl);
  return (
    <Panel>
      <PanelHeader title="Konkurransedokumenter" description="Konkurransegrunnlaget ligger hos oppdragsgivers system. AnbudRadar laster det ikke ned automatisk." />
      <div className="space-y-3 px-5 py-4 text-[14px]">
        {tender.documentsUrl ? (
          <p>
            <a href={tender.documentsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold">
              <LuFileText className="size-4" aria-hidden /> Åpne konkurransedokumentene{docsHost ? ` hos ${docsHost}` : ''}
              <LuExternalLink className="size-3.5" aria-hidden />
            </a>
          </p>
        ) : (
          <p className="text-muted">Lenken til dokumentene er ikke oppgitt i dataene vi har. Bruk «Åpne hos kilden».</p>
        )}
        {tender.submissionUrl && tender.submissionUrl !== tender.documentsUrl ? (
          <p>
            Tilbudet leveres{submitHost ? ` i ${submitHost}` : ''}:{' '}
            <a href={tender.submissionUrl} target="_blank" rel="noopener noreferrer">
              åpne innlevering
            </a>
          </p>
        ) : null}
        <p className="text-[13px] text-muted">
          Vil du at AI-en skal lese kravene i dokumentene? Last ned konkurransegrunnlaget og last det opp under «Dokumenter» nedenfor.
        </p>
      </div>
    </Panel>
  );
}

function NoticeRequirementsPanel({ tender }: { tender: TenderDetail }) {
  if (!tender.selectionCriteria?.length && !tender.awardCriteria?.length && !tender.lots?.length) return null;
  return (
    <Panel>
      <PanelHeader title="Krav og kriterier i kunngjøringen" description="Ordrett fra kilden. Ingen AI er brukt i denne delen." />
      <div className="space-y-5 px-5 py-4">
        {tender.selectionCriteria?.length ? (
          <section>
            <h3 className="text-[14px] font-semibold text-navy-900">Kvalifikasjonskrav</h3>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[14px] leading-relaxed">
              {tender.selectionCriteria.map((c, i) => (
                <li key={i} className="whitespace-pre-line">
                  {c}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {tender.awardCriteria?.length ? (
          <section>
            <h3 className="text-[14px] font-semibold text-navy-900">Tildelingskriterier</h3>
            <ul className="mt-2 space-y-1 text-[14px]">
              {tender.awardCriteria.map((c, i) => (
                <li key={i}>
                  {c.name}
                  {c.weight ? <span className="num font-semibold"> – {c.weight}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {tender.lots?.length ? (
          <section>
            <h3 className="text-[14px] font-semibold text-navy-900">Delkontrakter ({tender.lots.length})</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[14px]">
              {tender.lots.map((l, i) => (
                <li key={i}>
                  {l.title ?? l.id ?? 'Uten tittel'}
                  {l.estimatedValue !== null ? <span className="num text-muted"> – {formatMoney(l.estimatedValue, tender.currency, false)}</span> : null}
                  {l.durationText ? <span className="text-muted">, {l.durationText}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </Panel>
  );
}

const FIT_LABEL: Record<string, { label: string; tone: 'ok' | 'urgent' | 'danger' | 'neutral' }> = {
  god: { label: 'God match', tone: 'ok' },
  middels: { label: 'Delvis match', tone: 'urgent' },
  svak: { label: 'Svak match', tone: 'danger' },
  uklar: { label: 'Uklart', tone: 'neutral' },
};
const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'danger' | 'neutral' }> = {
  oppfylt: { label: 'Oppfylt', tone: 'ok' },
  ikke_oppfylt: { label: 'Ikke oppfylt', tone: 'danger' },
  uklart: { label: 'Uklart', tone: 'neutral' },
};

function FitPanel({
  tenderId,
  fit,
  canAssess,
  aiConfigured,
  quota,
}: {
  tenderId: string;
  fit: StoredFitAssessment | null;
  canAssess: boolean;
  aiConfigured: boolean;
  quota: { used: number; limit: number };
}) {
  const label = fit ? (FIT_LABEL[fit.data.fit] ?? FIT_LABEL.uklar!) : null;
  return (
    <Panel>
      <div id="egnethet" className="flex flex-wrap items-center justify-between gap-2 border-b border-ai/20 bg-ai-soft px-5 py-4">
        <h2 className="text-[15px] font-semibold text-navy-900">Kan vi delta? (AI-vurdering)</h2>
        {label ? <Badge tone={label.tone}>{label.label}</Badge> : null}
      </div>
      <div className="space-y-4 p-5">
        {!canAssess ? (
          <p className="text-[14px] text-muted">
            AI-vurdering av kravene mot bedriftsprofilen er med i Profesjonell og Bedrift. <a href="/app/abonnement">Se planer</a>
          </p>
        ) : !aiConfigured ? (
          <p className="text-[14px] text-muted">AI er ikke slått på ennå.</p>
        ) : fit ? (
          <div className="space-y-4">
            {fit.isMock ? <Alert tone="warning">Simulert svar fra testmodus – ikke en ekte vurdering.</Alert> : null}
            <p className="text-[14px] leading-relaxed text-ink">{fit.data.overall}</p>
            <ul className="space-y-2">
              {fit.data.requirements.map((r, i) => {
                const st = STATUS_LABEL[r.status] ?? STATUS_LABEL.uklart!;
                return (
                  <li key={i} className="rounded-md border border-line px-3 py-2 text-[13px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <BasisBadge basis={r.basis} check={fit.verification[`requirements[${i}]`]} />
                    </div>
                    <p className="mt-1.5 font-semibold text-navy-900">{r.requirement}</p>
                    <p className="mt-0.5 text-muted">{r.explanation}</p>
                  </li>
                );
              })}
            </ul>
            {fit.data.missing_company_info.length ? (
              <div>
                <p className="text-[13px] font-semibold text-navy-900">Opplysninger dere bør legge inn eller avklare</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
                  {fit.data.missing_company_info.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                <a href="/app/profil" className="mt-1 inline-block text-[13px]">
                  Oppdater bedriftsprofilen
                </a>
              </div>
            ) : null}
            <div>
              <p className="text-[13px] font-semibold text-navy-900">Usikkerhet: {fit.data.uncertainty}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] text-muted">
                {fit.data.uncertainty_reasons.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
            <p className="text-[12px] text-muted">
              Laget {relativeTime(fit.createdAt)}. Bygger bare på kildene og profilen – ikke en garanti for at dere kvalifiserer.
            </p>
          </div>
        ) : (
          <p className="text-[14px] text-muted">
            AI-en går gjennom kravene og sammenligner dem med bedriftsprofilen: hva dere oppfyller, hva som mangler, og hva som er uklart.
          </p>
        )}
        {canAssess && aiConfigured ? (
          <PostForm action={`/app/anbud/${tenderId}/egnethet`} className="flex flex-wrap items-center gap-3">
            {fit ? <input type="hidden" name="force" value="1" /> : null}
            <Button size="sm" variant={fit ? 'secondary' : 'primary'} busyLabel="Vurderer …">
              {fit ? 'Vurder på nytt' : 'Vurder egnethet'}
            </Button>
            <span className="num text-[12px] text-muted">
              AI-analyser: {quota.used} av {quota.limit} brukt
            </span>
          </PostForm>
        ) : null}
      </div>
    </Panel>
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
            AI-sammendrag er med fra Start. <a href="/app/abonnement">Se planer</a>
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

type Claim = { text: string; basis?: 'kilde' | 'tolkning'; source: { source_id: string; page: number | null; quote: string | null } | null };
type RequirementView = Claim & { category: string; path: string };

const CATEGORY_TITLES: Record<string, string> = {
  kvalifikasjon: 'Kvalifikasjonskrav',
  sertifisering: 'Sertifiseringer og godkjenninger',
  økonomi: 'Økonomiske krav',
  dokumentasjon: 'Dokumentasjon som skal leveres',
  leveranse: 'Krav til leveransen',
  geografi: 'Geografi og leveringssted',
  annet: 'Andre krav',
};
const CATEGORY_ORDER = ['kvalifikasjon', 'sertifisering', 'økonomi', 'dokumentasjon', 'leveranse', 'geografi', 'annet'];

/** Krav fra analysen – v2 har én liste med kategori; eldre analyser (v1) hadde egne lister. */
function requirementsOf(d: Record<string, unknown>): RequirementView[] {
  if (Array.isArray(d.requirements)) {
    return (d.requirements as (Claim & { category: string })[]).map((r, i) => ({ ...r, path: `requirements[${i}]` }));
  }
  const v1: [string, string][] = [
    ['key_requirements', 'leveranse'],
    ['qualification_criteria', 'kvalifikasjon'],
    ['certifications', 'sertifisering'],
    ['financial_requirements', 'økonomi'],
    ['geographic_requirements', 'geografi'],
    ['required_documentation', 'dokumentasjon'],
  ];
  return v1.flatMap(([key, category]) =>
    (Array.isArray(d[key]) ? (d[key] as Claim[]) : []).map((r, i) => ({ ...r, basis: 'kilde' as const, category, path: `${key}[${i}]` })),
  );
}

function BasisBadge({ basis, check }: { basis: Claim['basis']; check: RefCheck | undefined }) {
  if (basis === 'tolkning') return <Badge tone="ai">AI-tolkning</Badge>;
  if (check?.quoteVerified) return <Badge tone="ok">Står i kilden</Badge>;
  return <Badge tone="urgent">Oppgitt fra kilden – sitatet ble ikke funnet, sjekk selv</Badge>;
}

function ClaimItem({ item, check }: { item: Claim; check: RefCheck | undefined }) {
  return (
    <li className="rounded-md border border-line bg-white px-4 py-3">
      <p className="text-[14px] text-ink">{item.text}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
        <BasisBadge basis={item.basis} check={check} />
        {check ? <RefChip check={check} /> : null}
      </div>
      {check?.quote ? <p className="mt-1.5 border-l-2 border-line pl-2 text-[12px] italic text-muted">«{check.quote}»</p> : null}
    </li>
  );
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function AnalysisPage({ tender, analysis }: { tender: TenderDetail; analysis: StoredTenderAnalysis }) {
  const d = analysis.data as Record<string, unknown>;
  const v = analysis.verification;
  const claims = (k: string) => (Array.isArray(d[k]) ? (d[k] as Claim[]) : []);
  const strings = (k: string) => (Array.isArray(d[k]) ? (d[k] as string[]) : []);
  const deadlineAi = d.deadline as { value: string | null } | undefined;
  const durationAi = d.contract_duration as { value: string | null } | undefined;
  const requirements = requirementsOf(d);
  const documentsRead = analysis.coverage.filter((c) => c.kind === 'document');
  const notRead = strings('documents_not_read');
  const docsHost = hostOf(tender.documentsUrl);
  return (
    <AppShell>
      <a href={`/app/anbud/${tender.id}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
        <LuArrowLeft className="size-4" aria-hidden /> Tilbake til kunngjøringen
      </a>
      <header className="mb-6">
        <p className="text-[13px] font-semibold text-ai">AI-analyse</p>
        <h1 className="mt-1 max-w-3xl font-serif text-[26px] font-semibold leading-tight text-navy-900">{tender.title}</h1>
      </header>
      <div className="space-y-4">
        {analysis.isMock ? <Alert tone="warning">Simulert svar fra testmodus (AI_PROVIDER=mock). Ikke en ekte AI-analyse.</Alert> : null}
        <Alert tone="info" title="Slik leser du analysen">
          Analysen er laget av AI og kan inneholde feil. «Står i kilden» betyr at det ordrette sitatet faktisk finnes i dokumentet. «AI-tolkning» er
          AI-ens vurdering. Frister og krav du skal handle på, må alltid sjekkes i originaldokumentene.
        </Alert>
        <Panel className="p-5">
          <h2 className="text-[13px] font-semibold text-muted">AI-en har lest</h2>
          <ul className="mt-2 space-y-1 text-[14px]">
            {analysis.coverage.map((c) => (
              <li key={c.sourceId}>
                {c.title}
                {c.kind === 'document'
                  ? ` – ${c.includedPages.length} av ${c.totalPages ?? c.includedPages.length} sider${c.truncated ? ' (for langt til å tas med i sin helhet)' : ''}`
                  : ''}
              </li>
            ))}
          </ul>
          {!documentsRead.length || notRead.length ? (
            <div className="mt-3 rounded-md bg-marker-soft px-3 py-2 text-[13px] text-ink">
              <p className="font-semibold">Ikke lest av AI</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {!documentsRead.length ? (
                  <li>
                    Konkurransegrunnlaget og vedleggene{docsHost ? ` (hos ${docsHost})` : ''}. Last dem opp under kunngjøringen for å få dem med i analysen.
                  </li>
                ) : null}
                {notRead.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-3 text-[12px] text-muted">
            Laget {formatDateTime(analysis.createdAt)} med {analysis.provider === 'mock' ? 'testmodus' : `${analysis.provider} / ${analysis.model}`}.
          </p>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="font-serif text-[20px] font-semibold text-navy-900">Sammendrag</h2>
            <p className="mt-2 text-[15px] leading-relaxed">{String(d.summary ?? '')}</p>
            <h3 className="mt-5 text-[15px] font-semibold text-navy-900">Hva oppdragsgiver ønsker</h3>
            <p className="mt-1 text-[15px] leading-relaxed">{String(d.purchase_description ?? '')}</p>
          </section>
          {analysis.level === 'full' ? (
            <>
              {claims('scope_items').length ? (
                <section className="space-y-2">
                  <h3 className="text-[15px] font-semibold text-navy-900">Dette etterspørres</h3>
                  <ul className="space-y-3">
                    {claims('scope_items').map((item, i) => (
                      <ClaimItem key={i} item={item} check={v[`scope_items[${i}]`]} />
                    ))}
                  </ul>
                </section>
              ) : null}
              {CATEGORY_ORDER.map((cat) => {
                const items = requirements.filter((r) => r.category === cat);
                if (!items.length) return null;
                return (
                  <section key={cat} className="space-y-2">
                    <h3 className="text-[15px] font-semibold text-navy-900">{CATEGORY_TITLES[cat]}</h3>
                    <ul className="space-y-3">
                      {items.map((item) => (
                        <ClaimItem key={item.path} item={item} check={v[item.path]} />
                      ))}
                    </ul>
                  </section>
                );
              })}
              {!requirements.length ? <p className="text-[14px] text-muted">AI-en fant ingen konkrete krav i kildene den har lest.</p> : null}
              {claims('rejection_risks').length ? (
                <section className="space-y-2 rounded-lg border border-danger/30 bg-danger-soft/40 p-4">
                  <h3 className="text-[15px] font-semibold text-navy-900">Kan føre til avvisning</h3>
                  <ul className="space-y-3">
                    {claims('rejection_risks').map((item, i) => (
                      <ClaimItem key={i} item={item} check={v[`rejection_risks[${i}]`]} />
                    ))}
                  </ul>
                </section>
              ) : null}
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
              {strings('how_to_participate').length ? (
                <section className="space-y-2">
                  <h3 className="text-[15px] font-semibold text-navy-900">Slik deltar dere</h3>
                  <ol className="list-decimal space-y-1 pl-5 text-[14px]">
                    {strings('how_to_participate').map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </section>
              ) : null}
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
            {strings('missing_information').length ? (
              <ul className="list-disc space-y-1 pl-5 text-[14px]">
                {strings('missing_information').map((m, i) => (
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
            <p className="text-[13px] font-semibold text-muted">{tender.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist'} i kunngjøringen</p>
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
                <p className="mt-1 text-[14px]">{durationAi?.value ?? tender.durationText ?? 'Ikke funnet i kildene'}</p>
              </>
            ) : null}
          </Panel>
          {Array.isArray(d.important_dates) && (d.important_dates as unknown[]).length ? (
            <Panel className="p-5">
              <p className="text-[14px] font-semibold text-navy-900">Viktige datoer</p>
              <dl className="mt-2 space-y-2 text-[14px]">
                {(d.important_dates as { label: string; value: string }[]).map((x, i) => (
                  <div key={i}>
                    <dt className="text-[12px] text-muted">{x.label}</dt>
                    <dd className="num">{x.value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
          {analysis.level === 'full' && strings('questions_to_investigate').length ? (
            <Panel className="p-5">
              <p className="text-[14px] font-semibold text-navy-900">Spørsmål å avklare</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
                {strings('questions_to_investigate').map((q, i) => (
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
