/**
 * Profit Intelligence – sider: lønnsomhet per anbud, porteføljeoversikt, kapasitet og økonomi, anbudspartnere.
 *
 * Hvert tall vises med opphav: Dokument (står i kunngjøring/dokumenter), Deres tall (bedriftens egne),
 * AI-estimat (alltid merket og redigerbart), Beregnet (kalkulatoren) eller Mangler.
 */
import type { ReactNode } from 'react';
import { LuArrowLeft, LuCircleCheck, LuCircleHelp, LuCircleX, LuSparkles } from 'react-icons/lu';
import { CERTIFICATIONS, CERT_BY_ID, INDUSTRIES, INDUSTRY_BY_ID, REGIONS, REGION_BY_CODE } from '@/domain/reference';
import { COST_CATEGORIES, fmtKr, fmtNumber, PERIODS, type CostLine, type Provenance } from '@/domain/profit/calculator';
import { COST_HINTS, TERM_LABELS, type TermCategory } from '@/domain/profit/terms-scan';
import { RECOMMENDATION_LABEL, type Recommendation, type RiskLevel } from '@/domain/profit/recommendation';
import { MONTH_SHORT, monthsLabel, type CapacityResult, type MonthLoad } from '@/domain/profit/capacity';
import type { CapacityData, OrgEconomics, PortfolioSummary, ProfitWorkspace } from '@/domain/profit/service';
import type { MarketPrice } from '@/domain/profit/market';
import { MarketPanel, type CalcHistory } from './market';
import {
  COMPETITION_GUIDANCE_URL,
  PARTNER_CONSENT_TEXT,
  PARTNER_ROLE_LABEL,
  PARTNER_ROLES,
  SELF_ASSESSMENTS,
  type PartnerCard,
  type PartnerProfile,
  type PartnerRequestRow,
} from '@/domain/profit/partners';
import { useUi } from '../../context';
import {
  Alert,
  Badge,
  Button,
  buttonVariants,
  Checkbox,
  cn,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Panel,
  PanelHeader,
  PostForm,
  Select,
  Stat,
  Textarea,
} from '../../components';
import { AppShell } from '../../layouts';
import { formatDate, formatDateTime, formatMoney, relativeTime } from '../../format';

// ---------------------------------------------------------------------------
// Små byggesteiner
// ---------------------------------------------------------------------------
const PROVENANCE: Record<Provenance, { label: string; tone: 'info' | 'outline' | 'ai' | 'marker' | 'urgent'; title: string }> = {
  dokument: { label: 'Dokument', tone: 'info', title: 'Står i kunngjøringen eller i dokumentene' },
  bruker: { label: 'Deres tall', tone: 'outline', title: 'Bedriftens egne tall og forutsetninger' },
  ai: { label: 'AI-estimat', tone: 'ai', title: 'Anslått av AI ut fra dokumentene – kontroller før bruk' },
  beregnet: { label: 'Beregnet', tone: 'marker', title: 'Regnet ut av kalkulatoren fra tallene over' },
  mangler: { label: 'Mangler', tone: 'urgent', title: 'Opplysningen finnes ikke – den er ikke gjettet' },
};

export function ProvenanceBadge({ basis }: { basis: Provenance }) {
  const p = PROVENANCE[basis];
  return (
    <Badge tone={p.tone} title={p.title}>
      {p.label}
    </Badge>
  );
}

function ProvenanceLegend() {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-muted">
      <span>Opphav:</span>
      {(Object.keys(PROVENANCE) as Provenance[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <ProvenanceBadge basis={k} /> <span className="hidden sm:inline">{PROVENANCE[k].title.toLowerCase()}</span>
        </span>
      ))}
    </div>
  );
}

const REC_TONE: Record<Recommendation, 'ok' | 'info' | 'danger' | 'neutral'> = { bid: 'ok', investigate: 'info', high_risk: 'danger', insufficient_data: 'neutral' };
export function RecommendationBadge({ value }: { value: Recommendation }) {
  return <Badge tone={REC_TONE[value]}>{RECOMMENDATION_LABEL[value]}</Badge>;
}

const RISK_TONE: Record<RiskLevel, 'ok' | 'urgent' | 'danger' | 'neutral'> = { lav: 'ok', middels: 'urgent', høy: 'danger', ukjent: 'neutral' };
const RISK_LABEL: Record<RiskLevel, string> = { lav: 'Lav risiko', middels: 'Middels risiko', høy: 'Høy risiko', ukjent: 'Risiko ikke vurdert' };
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <Badge tone={RISK_TONE[level]}>{RISK_LABEL[level]}</Badge>;
}

const CAPACITY_LABEL: Record<CapacityResult['status'], { label: string; tone: 'ok' | 'urgent' | 'danger' | 'neutral' }> = {
  ok: { label: 'Nok kapasitet', tone: 'ok' },
  stram: { label: 'Stram kapasitet', tone: 'urgent' },
  mangler: { label: 'For lite kapasitet', tone: 'danger' },
  ukjent: { label: 'Kapasitet ukjent', tone: 'neutral' },
};
function CapacityBadge({ status }: { status: CapacityResult['status'] }) {
  const c = CAPACITY_LABEL[status];
  return <Badge tone={c.tone}>{c.label}</Badge>;
}

function CheckIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <LuCircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Oppfylt" />;
  if (ok === false) return <LuCircleX className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Ikke oppfylt" />;
  return <LuCircleHelp className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Ukjent" />;
}

/** Tall i skjemafelt: norsk desimalkomma, ingen tusenskille (enkelt å redigere). */
function numIn(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n).replace('.', ',');
}

function SourceLine({ source }: { source: { sourceId: string; title?: string | null; page: number | null; quote: string | null; verified?: boolean } | null | undefined }) {
  if (!source) return null;
  return (
    <div className="mt-1.5 rounded-md border-l-2 border-info/40 bg-navy-50/60 px-3 py-1.5 text-[12px] text-ink">
      <p className="text-muted">
        {source.title ?? source.sourceId}
        {source.page !== null ? `, side ${source.page}` : ''}
        {source.verified === true ? (
          <Badge tone="ok" className="ml-2">
            Sitat kontrollert
          </Badge>
        ) : source.verified === false ? (
          <Badge tone="urgent" className="ml-2" title="Sitatet ble ikke funnet ordrett i kilden">
            Kontroller sitatet
          </Badge>
        ) : null}
      </p>
      {source.quote ? <p className="mt-0.5 italic">«{source.quote}»</p> : null}
    </div>
  );
}

const DISCLAIMER =
  'Økonomisk vurdering ut fra deres egne kostnader og det som står i dokumentene – ikke en prognose for hvilken pris som vinner eller hva konkurrentene byr. Kontroller tallene før dere gir tilbud.';

// ---------------------------------------------------------------------------
// Lønnsomhet per anbud
// ---------------------------------------------------------------------------
export interface ProfitWorkspacePageProps {
  ws: ProfitWorkspace;
  errors?: string[];
  canRunAi: boolean;
  canSearchPartners: boolean;
  aiQuota: { used: number; limit: number };
  /** Markedspris fra tidligere tildelinger. */
  market?: MarketPrice | null;
  /** Hvor målprisen i tidligere kalkyler lå mot det som vant (fra Resultater). */
  calcHistory?: CalcHistory | null;
}

export function ProfitWorkspacePage({ ws, errors, canRunAi, canSearchPartners, aiQuota, market, calcHistory }: ProfitWorkspacePageProps) {
  const t = ws.tender;
  return (
    <AppShell wide>
      <a href={`/app/anbud/${t.id}`} className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
        <LuArrowLeft className="size-4" aria-hidden /> Tilbake til anbudet
      </a>
      <PageHeader
        title="Lønnsomhet og risiko"
        description={
          <>
            <span className="font-semibold text-ink">{t.title}</span>
            {t.buyerName ? ` · ${t.buyerName}` : ''}
            {t.deadlineAt ? ` · frist ${formatDateTime(t.deadlineAt, t.deadlineTimeKnown)}` : ' · frist ikke oppgitt'}
          </>
        }
        actions={
          <>
            <LinkButton href="/app/lonnsomhet" variant="secondary" size="sm">
              Alle kalkyler
            </LinkButton>
            <LinkButton href="/app/kapasitet" variant="secondary" size="sm">
              Kapasitet og økonomi
            </LinkButton>
          </>
        }
      />
      <Alert tone="info" className="mb-5">
        {DISCLAIMER}
      </Alert>
      {errors?.length ? (
        <Alert tone="danger" title="Kalkylen er ikke lagret – rett opp feilene under" className="mb-5">
          <ul className="list-disc pl-5">
            {errors.slice(0, 8).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <RecommendationPanel ws={ws} />
      <KpiRow ws={ws} />
      <ProvenanceLegend />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <CalcForm ws={ws} />
          <ResultsPanel ws={ws} />
          {market ? <MarketPanel ws={ws} market={market} calcHistory={calcHistory ?? null} /> : null}
          <RiskPanel ws={ws} />
        </div>
        <aside className="space-y-6">
          <AiPanel ws={ws} canRunAi={canRunAi} quota={aiQuota} />
          <QualificationsPanel ws={ws} />
          <CapacityPanel ws={ws} />
          <PartnerPanel ws={ws} canSearch={canSearchPartners} />
          {ws.saved ? (
            <PostForm action={`/app/anbud/${t.id}/lonnsomhet/slett`} confirm="Slette kalkylen for dette anbudet?" className="px-1">
              <Button variant="danger" size="sm">
                Slett kalkylen
              </Button>
            </PostForm>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}

function RecommendationPanel({ ws }: { ws: ProfitWorkspace }) {
  const r = ws.recommendation;
  const tone = { bid: 'border-ok/30 bg-ok-soft', investigate: 'border-info/25 bg-info-soft', high_risk: 'border-danger/30 bg-danger-soft', insufficient_data: 'border-line bg-surface' }[r.recommendation];
  return (
    <section className={cn('mb-6 rounded-lg border px-5 py-4', tone)} aria-labelledby="anbefaling">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-muted">Anbefaling (økonomi, risiko, kvalifikasjoner og kapasitet)</p>
          <h2 id="anbefaling" className="font-serif text-[26px] font-semibold leading-tight text-navy-900">
            {r.label}
          </h2>
        </div>
        <p className="text-[12px] text-muted">
          {ws.saved ? `Kalkylen er lagret ${relativeTime(ws.saved.at)}.` : 'Kalkylen er ikke lagret ennå.'}
          {ws.testPrice ? ` Viser testpris ${fmtKr(ws.testPrice)} (lagres ikke).` : ''}
        </p>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ul className="space-y-1 text-[14px]">
          {r.reasons.map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
        <ul className="space-y-1 text-[14px]">
          {r.checks.map((c) => (
            <li key={c.label} className="flex gap-2">
              <CheckIcon ok={c.ok} />
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function KpiRow({ ws }: { ws: ProfitWorkspace }) {
  const c = ws.calc;
  const at = c.atContractValue;
  return (
    <Panel className="mb-4 grid grid-cols-2 gap-5 px-5 py-4 md:grid-cols-3 xl:grid-cols-6">
      <Stat
        label="Fortjeneste ved kontraktsverdi"
        value={at ? <span className={at.profit < 0 ? 'text-danger' : ''}>{fmtKr(at.profit)}</span> : '–'}
        hint={at ? `Margin ${fmtNumber(at.marginPct)} %` : 'Kontraktsverdi mangler'}
      />
      <Stat label="Selvkost" value={c.directCost > 0 ? fmtKr(c.breakEven) : '–'} hint={c.directCost > 0 ? 'Pris uten tap (beregnet)' : 'Legg inn kostnader'} />
      <Stat
        label="Anbefalt prisintervall"
        value={c.recommendedRange ? <span className="text-[18px]">{`${fmtKr(c.recommendedRange.low)} – ${fmtKr(c.recommendedRange.high)}`}</span> : '–'}
        hint="Minstepris – målpris (beregnet)"
      />
      <div className="min-w-0">
        <p className="text-[13px] text-muted">Kontraktsrisiko</p>
        <p className="mt-1.5">
          <RiskBadge level={ws.risk.level} />
        </p>
        <p className="mt-1 text-[12px] text-muted">
          {ws.risk.levelSource === 'ai' ? 'Fra AI-analysen' : ws.risk.levelSource === 'bruker' ? 'Deres vurdering' : 'Ikke analysert'}
        </p>
      </div>
      <Stat
        label="Mangler i kvalifikasjoner"
        value={ws.qualifications.missing.length}
        hint={ws.qualifications.missing.length ? 'Se listen til høyre' : 'Ingen funnet i kildene'}
      />
      <div className="min-w-0">
        <p className="text-[13px] text-muted">Kapasitet</p>
        <p className="mt-1.5">
          <CapacityBadge status={ws.capacity.status} />
        </p>
        <p className="mt-1 text-[12px] text-muted">
          {ws.capacity.gapHoursPerYear !== null && ws.capacity.gapHoursPerYear > 0
            ? `Mangler ca. ${fmtNumber(ws.capacity.gapHoursPerYear)} t/år`
            : ws.capacity.requiredHoursPerYear
              ? `Behov ${fmtNumber(ws.capacity.requiredHoursPerYear)} t/år`
              : 'Timebehov ukjent'}
        </p>
      </div>
    </Panel>
  );
}

function CalcForm({ ws }: { ws: ProfitWorkspace }) {
  const i = ws.inputs;
  const t = ws.tender;
  const computed = new Map(ws.calc.lines.map((l) => [l.id, l]));
  const blanks = i.lines.length ? 2 : 3;
  const lineRows: (CostLine | null)[] = [...i.lines, ...Array.from({ length: blanks }, () => null)];
  return (
    <Panel>
      <PanelHeader
        title="Kalkyle"
        description="Legg inn deres egne kostnader. AI legger aldri inn priser eller kostnader – bare mengder fra dokumentene, merket med opphav."
      />
      <PostForm action={`/app/anbud/${t.id}/lonnsomhet`} className="space-y-6 px-5 py-5">
        <fieldset className="grid grid-cols-1 min-w-0 gap-4 md:grid-cols-3">
          <legend className="mb-2 text-[14px] font-semibold text-navy-900">Grunnlag</legend>
          <Field
            label={
              <span className="flex items-center gap-2">
                Kontraktsverdi (kr, eks. mva.) <ProvenanceBadge basis={i.contractValueBasis} />
              </span>
            }
            htmlFor="pi-cv"
            hint={
              ws.documented.contractValueNote ??
              (ws.documented.contractValue !== null ? `Kunngjøringen: ${fmtKr(ws.documented.contractValue)}` : 'Ikke oppgitt i kunngjøringen. Legg inn forventet omsetning hvis dere har grunnlag for det.')
            }
          >
            <Input id="pi-cv" name="contractValue" inputMode="decimal" defaultValue={numIn(i.contractValue)} />
          </Field>
          <Field
            label={
              <span className="flex items-center gap-2">
                Varighet (måneder) <ProvenanceBadge basis={i.durationBasis} />
              </span>
            }
            htmlFor="pi-dur"
            hint={t.durationText ? `Kunngjøringen: ${t.durationText}` : 'Ikke oppgitt i kunngjøringen.'}
          >
            <Input id="pi-dur" name="durationMonths" inputMode="decimal" defaultValue={numIn(i.durationMonths)} />
          </Field>
          <div className="space-y-2 pt-6">
            <Checkbox name="isFramework" defaultChecked={i.isFramework} label="Rammeavtale" hint="Verdien er da et anslag eller tak, ikke garantert omsetning." />
          </div>
          <div className="md:col-span-3">
            <MonthPicker
              legend="Sesong: måneder med arbeid"
              hint="Ingen avkrysning = hele året. Timene fordeles på månedene dere krysser av (f.eks. vinterdrift nov–mar), og kapasiteten sjekkes måned for måned."
              selected={i.activeMonths ?? null}
            />
          </div>
          {t.lots.some((l) => l.estimatedValue !== null) ? (
            <div className="text-[13px] text-muted md:col-span-3">
              Delkontrakter med oppgitt verdi:{' '}
              {t.lots
                .filter((l) => l.estimatedValue !== null)
                .slice(0, 8)
                .map((l) => `${l.title ?? l.id ?? 'uten navn'} (${formatMoney(l.estimatedValue, t.currency, false)})`)
                .join(' · ')}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-2 text-[14px] font-semibold text-navy-900">Kostnader</legend>
          <p className="mb-3 text-[13px] text-muted">
            Enhetskosten er alltid deres egen (lønn inkl. sosiale kostnader, innkjøpspris, leie). «Per måned» og «per år» ganges med varigheten. Endrer dere en mengde fra dokument eller AI, blir det deres tall.
          </p>
          <ol className="space-y-3">
            {lineRows.map((l, idx) => {
              const c = l ? computed.get(l.id) : undefined;
              const id = (field: string) => `l-${field}-${idx}`;
              return (
                <li key={l?.id ?? `blank-${idx}`} className={cn('rounded-md border px-3 py-3', l ? 'border-line' : 'border-dashed border-line')}>
                  <input type="hidden" name="l_id" value={l?.id ?? ''} />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[11rem_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <label htmlFor={id('cat')} className="text-[11px] font-semibold text-muted">
                        Kategori
                      </label>
                      <Select id={id('cat')} name="l_category" defaultValue={l?.category ?? 'arbeid'} className="h-9 py-1 text-[13px]">
                        {COST_CATEGORIES.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={id('desc')} className="text-[11px] font-semibold text-muted">
                        Beskrivelse {l ? null : <span className="font-normal">(ny linje)</span>}
                      </label>
                      <Input id={id('desc')} name="l_description" defaultValue={l?.description ?? ''} maxLength={200} className="h-9 py-1 text-[13px]" />
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_8rem]">
                    <div className="min-w-0">
                      <label htmlFor={id('qty')} className="text-[11px] font-semibold text-muted">
                        Mengde
                      </label>
                      <Input id={id('qty')} name="l_quantity" inputMode="decimal" defaultValue={numIn(l?.quantity)} className="h-9 py-1 text-[13px]" />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={id('unit')} className="text-[11px] font-semibold text-muted">
                        Enhet
                      </label>
                      <Input id={id('unit')} name="l_unit" defaultValue={l?.unit ?? ''} maxLength={30} placeholder="timer" className="h-9 py-1 text-[13px]" />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={id('cost')} className="text-[11px] font-semibold text-muted">
                        Enhetskost (kr)
                      </label>
                      <Input id={id('cost')} name="l_unitCost" inputMode="decimal" defaultValue={numIn(l?.unitCost)} className="h-9 py-1 text-[13px]" />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={id('period')} className="text-[11px] font-semibold text-muted">
                        Periode
                      </label>
                      <Select id={id('period')} name="l_period" defaultValue={l?.period ?? 'total'} className="h-9 py-1 text-[13px]">
                        {PERIODS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="col-span-2 min-w-0 text-right sm:col-span-1">
                      <p className="text-[11px] font-semibold text-muted">Sum</p>
                      <p className="num pt-2 text-[14px] font-semibold text-navy-900">{c?.total !== null && c?.total !== undefined ? fmtKr(c.total) : '–'}</p>
                    </div>
                  </div>
                  {l ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <ProvenanceBadge basis={l.basis} />
                      {l.basis === 'bruker' && l.sourceRef ? <span className="text-[11px] text-muted">endret av dere – opprinnelig fra kilde</span> : null}
                      {c?.problem ? <Badge tone="urgent">{c.problem}</Badge> : null}
                      {c?.included ? <span className="text-[11px] text-muted">{c.formula}</span> : null}
                    </div>
                  ) : null}
                  {l?.calculation ? <p className="mt-1 text-[12px] text-muted">Utregning (AI): {l.calculation}</p> : null}
                  {l?.sourceRef ? (
                    <details className="mt-1 text-[12px]">
                      <summary className="cursor-pointer py-1 text-muted">Kilde for mengden</summary>
                      <SourceLine source={l.sourceRef} />
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[12px] text-muted">Trenger dere flere linjer? Lagre, så kommer det nye tomme linjer. Tomme linjer lagres ikke.</p>
        </fieldset>

        <fieldset className="grid grid-cols-1 min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 text-[14px] font-semibold text-navy-900">Påslag og margin</legend>
          <Field label="Indirekte kostnader (% av direkte)" htmlFor="pi-oh" hint="Administrasjon, lokaler, forsikring …">
            <Input id="pi-oh" name="overheadPct" inputMode="decimal" defaultValue={numIn(i.overheadPct)} />
          </Field>
          <Field label="Risikopåslag (%)" htmlFor="pi-rb" hint="Buffer for usikre mengder og vilkår.">
            <Input id="pi-rb" name="riskBufferPct" inputMode="decimal" defaultValue={numIn(i.riskBufferPct)} />
          </Field>
          <Field label="Ønsket margin (%)" htmlFor="pi-tm">
            <Input id="pi-tm" name="targetMarginPct" inputMode="decimal" defaultValue={numIn(i.targetMarginPct)} />
          </Field>
          <Field label="Minstemargin (%)" htmlFor="pi-mm" hint="Laveste margin dere vil by på.">
            <Input id="pi-mm" name="minMarginPct" inputMode="decimal" defaultValue={numIn(i.minMarginPct)} />
          </Field>
          <Field label="Kostnad per arbeidstime (kr)" htmlFor="pi-hc" hint="Brukes som forslag på timelinjer fra AI.">
            <Input id="pi-hc" name="hourlyCost" inputMode="decimal" defaultValue={numIn(i.hourlyCost)} />
          </Field>
          <Field label="Timer brukt på å lage tilbudet" htmlFor="pi-bc">
            <Input id="pi-bc" name="bidCostHours" inputMode="decimal" defaultValue={numIn(i.bidCostHours)} />
          </Field>
        </fieldset>

        <fieldset className="grid grid-cols-1 min-w-0 gap-4 md:grid-cols-2">
          <legend className="mb-2 text-[14px] font-semibold text-navy-900">Deres vurdering</legend>
          <Field label="Kontraktsrisiko etter deres vurdering" htmlFor="pi-risk" hint="Overstyrer AI-vurderingen når den er satt.">
            <Select id="pi-risk" name="userRiskLevel" defaultValue={i.userRiskLevel ?? ''}>
              <option value="">Ikke vurdert / bruk AI-analysen</option>
              <option value="lav">Lav</option>
              <option value="middels">Middels</option>
              <option value="høy">Høy</option>
            </Select>
          </Field>
          <div className="pt-6">
            <Checkbox
              name="termsReviewedByUser"
              defaultChecked={i.termsReviewedByUser}
              label="Vi har lest kontraktsvilkårene"
              hint="Dagbøter, betalingsvilkår, prisregulering, garantier og ansvar."
            />
          </div>
          <Field label="Notater" htmlFor="pi-notes" className="md:col-span-2">
            <Textarea id="pi-notes" name="notes" rows={2} maxLength={2000} defaultValue={i.notes ?? ''} />
          </Field>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" busyLabel="Beregner …">
            Lagre og beregn
          </Button>
          <p className="text-[12px] text-muted">Alle i organisasjonen kan se og endre kalkylen. Den deles aldri med andre.</p>
        </div>
      </PostForm>
    </Panel>
  );
}

function ResultsPanel({ ws }: { ws: ProfitWorkspace }) {
  const c = ws.calc;
  const t = ws.tender;
  return (
    <Panel>
      <PanelHeader title="Pris og fortjeneste" description="Regnet ut av kalkulatoren. Samme tall gir alltid samme svar, og hver linje har en formel." />
      <div className="space-y-5 px-5 py-4">
        {c.warnings.length ? (
          <Alert tone="warning" title="Dette bør dere se på">
            <ul className="list-disc pl-5">
              {c.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {c.scenarios.length ? (
          <div className="scroll-x">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[13px] text-muted">
                  <th className="py-2 pr-3 font-semibold">Pris</th>
                  <th className="py-2 pr-3 text-right font-semibold">Beløp</th>
                  <th className="py-2 pr-3 text-right font-semibold">Fortjeneste</th>
                  <th className="py-2 pr-3 text-right font-semibold">Margin</th>
                  <th className="py-2 font-semibold">Opphav</th>
                </tr>
              </thead>
              <tbody>
                {c.scenarios.map((s) => (
                  <tr key={s.key} className="border-b border-line last:border-0">
                    <td className="py-2 pr-3">
                      {s.label}
                      {s.note ? <p className="text-[12px] text-muted">{s.note}</p> : null}
                    </td>
                    <td className="num whitespace-nowrap py-2 pr-3 text-right">{fmtKr(s.price)}</td>
                    <td className={cn('num whitespace-nowrap py-2 pr-3 text-right', s.profit < 0 && 'text-danger')}>{fmtKr(s.profit)}</td>
                    <td className={cn('num whitespace-nowrap py-2 pr-3 text-right', s.marginPct < 0 && 'text-danger')}>{fmtNumber(s.marginPct)} %</td>
                    <td className="py-2">
                      <ProvenanceBadge basis={s.basis} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Ingen beregning ennå">Legg inn minst én kostnadslinje med mengde og enhetskost.</EmptyState>
        )}

        <form method="get" action={`/app/anbud/${t.id}/lonnsomhet`} className="flex flex-wrap items-end gap-2">
          <Field label="Hva om vi byr …? (kr)" htmlFor="pi-test" hint="Viser fortjeneste og margin ved prisen. Lagres ikke.">
            <Input id="pi-test" name="pris" inputMode="decimal" defaultValue={numIn(ws.testPrice)} className="w-48" />
          </Field>
          <Button variant="secondary" size="md" type="submit">
            Regn ut
          </Button>
        </form>

        {c.directCost > 0 ? (
          <>
            <div>
              <h3 className="mb-2 text-[14px] font-semibold text-navy-900">Hvis kostnadene blir høyere</h3>
              <div className="scroll-x">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-line text-left text-muted">
                      <th className="py-1.5 pr-3 font-semibold">Kostnadsøkning</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Selvkost</th>
                      <th className="py-1.5 pr-3 text-right font-semibold">Margin ved målpris</th>
                      <th className="py-1.5 text-right font-semibold">Fortjeneste ved kontraktsverdi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.sensitivity.map((s) => (
                      <tr key={s.increasePct} className="border-b border-line last:border-0">
                        <td className="py-1.5 pr-3">{s.increasePct === 0 ? 'Som kalkulert' : `+${s.increasePct} %`}</td>
                        <td className="num py-1.5 pr-3 text-right">{fmtKr(s.cost)}</td>
                        <td className={cn('num py-1.5 pr-3 text-right', (s.marginAtTarget ?? 0) < 0 && 'text-danger')}>
                          {s.marginAtTarget !== null ? `${fmtNumber(s.marginAtTarget)} %` : '–'}
                        </td>
                        <td className={cn('num py-1.5 text-right', (s.profitAtContractValue ?? 0) < 0 && 'text-danger')}>
                          {s.profitAtContractValue !== null ? fmtKr(s.profitAtContractValue) : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-[12px] text-muted">Økningen gjelder direkte kostnader; påslaget for indirekte kostnader følger med.</p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[14px] font-semibold text-navy-900">Kostnader per kategori</h3>
                <ul className="space-y-1.5 text-[13px]">
                  {COST_CATEGORIES.filter((cat) => c.byCategory[cat.id] > 0).map((cat) => {
                    const share = c.directCost > 0 ? (c.byCategory[cat.id] / c.directCost) * 100 : 0;
                    return (
                      <li key={cat.id}>
                        <div className="flex justify-between gap-2">
                          <span>{cat.label}</span>
                          <span className="num">
                            {fmtKr(c.byCategory[cat.id])} <span className="text-muted">({fmtNumber(share)} %)</span>
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 rounded-full bg-navy-50" aria-hidden>
                          <div className="h-1.5 rounded-full bg-navy-700" style={{ width: `${Math.min(100, share)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[12px] text-muted">
                  Arbeidstimer i kalkylen: <span className="num">{fmtNumber(c.totalHours)}</span>
                  {c.hoursPerYear !== null ? ` (${fmtNumber(c.hoursPerYear)} per år)` : ''}
                  {c.bidCost !== null ? ` · Kostnad ved å lage tilbudet: ${fmtKr(c.bidCost)}` : ''}
                </p>
              </div>
              <div>
                <h3 className="mb-2 text-[14px] font-semibold text-navy-900">Slik er tallene regnet ut</h3>
                <dl className="space-y-1.5 text-[13px]">
                  {c.formulas.map((f) => (
                    <div key={f.label}>
                      <dt className="flex justify-between gap-2 font-semibold">
                        <span>{f.label}</span>
                        <span className="num">{fmtKr(f.value)}</span>
                      </dt>
                      <dd className="text-muted">{f.formula}</dd>
                    </div>
                  ))}
                </dl>
                <details className="mt-2 text-[12px] text-muted">
                  <summary className="cursor-pointer py-1">Linjene</summary>
                  <ul className="mt-1 space-y-0.5">
                    {c.lines.map((l) => (
                      <li key={l.id}>
                        {l.description}: {l.formula}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </Panel>
  );
}

function RiskPanel({ ws }: { ws: ProfitWorkspace }) {
  const a = ws.analysis;
  const scan = ws.risk.scan;
  const scanCategories = Object.keys(scan.byCategory) as TermCategory[];
  return (
    <Panel>
      <PanelHeader
        title="Kontraktsrisiko"
        description="Vilkår som påvirker lønnsomheten – med dokument, side og sitat, så dere kan kontrollere selv."
        action={<RiskBadge level={ws.risk.level} />}
      />
      <div className="space-y-5 px-5 py-4">
        {!ws.risk.contractTermsAnalyzed ? (
          <Alert tone="warning" title="Kontraktsvilkårene er ikke analysert">
            Dagbøter, betalingsvilkår, prisregulering og ansvar står som regel i konkurransegrunnlaget og kontraktsvilkårene.{' '}
            <a href={`/app/anbud/${ws.tender.id}#dokumenter`}>Last opp dokumentene</a>
            {ws.tender.documentsUrl ? (
              <>
                {' '}
                (hent dem hos{' '}
                <a href={ws.tender.documentsUrl} target="_blank" rel="noopener noreferrer">
                  kilden
                </a>
                )
              </>
            ) : null}
            , eller kryss av for at dere har lest dem selv.
          </Alert>
        ) : null}
        {ws.documents.notReadable.length ? (
          <Alert tone="warning">
            Disse dokumentene kunne ikke leses og er ikke med i analysen: {ws.documents.notReadable.join(', ')}.
          </Alert>
        ) : null}

        {a ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-navy-900">
              Funn fra AI-analysen{' '}
              {a.isMock ? (
                <Badge tone="sample" className="ml-1">
                  Testmodus
                </Badge>
              ) : null}
            </h3>
            <p className="text-[14px]">{a.data.summary}</p>
            {ws.risk.findings.length ? (
              <ul className="space-y-3">
                {ws.risk.findings.map((f, idx) => (
                  <li key={`${f.title}-${idx}`} className="rounded-md border border-line px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={f.severity === 'høy' ? 'danger' : f.severity === 'middels' ? 'urgent' : 'ok'}>{f.severity === 'høy' ? 'Høy' : f.severity === 'middels' ? 'Middels' : 'Lav'}</Badge>
                      <span className="text-[12px] text-muted">{f.categoryLabel}</span>
                      <Badge tone={f.basis === 'kilde' ? 'info' : 'ai'}>{f.basis === 'kilde' ? 'Står i kilden' : 'AI-tolkning'}</Badge>
                    </div>
                    <p className="mt-1.5 font-semibold text-navy-900">{f.title}</p>
                    <p className="text-[14px]">{f.finding}</p>
                    <p className="mt-1 text-[13px] text-muted">
                      <span className="font-semibold">Mulig økonomisk effekt (AI-vurdering):</span> {f.economicImpact}
                    </p>
                    {f.consequence ? (
                      <p className="mt-1 text-[13px]">
                        <ProvenanceBadge basis="beregnet" /> {f.consequence}
                      </p>
                    ) : null}
                    {f.unverifiedNumbers.length ? (
                      <p className="mt-1 text-[12px] text-urgent">
                        Tallene {f.unverifiedNumbers.join(', ')} ble ikke funnet i sitatet og er ikke brukt i beregninger.
                      </p>
                    ) : null}
                    <SourceLine source={f.source} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">AI-analysen fant ingen kontraktsvilkår med økonomisk risiko i kildene.</p>
            )}
            {a.data.stated_values.length ? (
              <div>
                <h4 className="text-[13px] font-semibold text-navy-900">Beløp som står i kildene</h4>
                <ul className="mt-1 space-y-2 text-[13px]">
                  {a.data.stated_values.map((v, idx) => (
                    <li key={`${v.label}-${idx}`}>
                      {v.label}: <span className="num font-semibold">{formatMoney(v.amount, v.currency, false)}</span>
                      {a.checks?.statedValues?.[idx] ? (
                        <Badge tone="ok" className="ml-2">
                          Kontrollert mot sitat
                        </Badge>
                      ) : (
                        <Badge tone="urgent" className="ml-2">
                          Ikke kontrollert – brukes ikke automatisk
                        </Badge>
                      )}
                      <SourceLine source={{ sourceId: v.source.source_id, page: v.source.page, quote: v.source.quote }} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {a.data.price_format.text || a.data.price_evaluation.text ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {a.data.price_format.text ? (
                  <div>
                    <h4 className="text-[13px] font-semibold text-navy-900">Slik skal prisen oppgis</h4>
                    <p className="text-[13px]">{a.data.price_format.text}</p>
                    <SourceLine source={a.data.price_format.source ? { sourceId: a.data.price_format.source.source_id, page: a.data.price_format.source.page, quote: a.data.price_format.source.quote } : null} />
                  </div>
                ) : null}
                {a.data.price_evaluation.text ? (
                  <div>
                    <h4 className="text-[13px] font-semibold text-navy-900">Slik vurderes prisen</h4>
                    <p className="text-[13px]">
                      {a.data.price_evaluation.text}
                      {a.data.price_evaluation.weight_pct !== null ? ` (vekt ${fmtNumber(a.data.price_evaluation.weight_pct)} %)` : ''}
                    </p>
                    <SourceLine
                      source={a.data.price_evaluation.source ? { sourceId: a.data.price_evaluation.source.source_id, page: a.data.price_evaluation.source.page, quote: a.data.price_evaluation.source.quote } : null}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            {a.data.economic_uncertainties.length ? (
              <div>
                <h4 className="text-[13px] font-semibold text-navy-900">Økonomiske usikkerheter</h4>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px]">
                  {a.data.economic_uncertainties.map((u, idx) => (
                    <li key={idx}>
                      {u.text} <span className="text-muted">({u.basis === 'kilde' ? 'står i kilden' : 'AI-tolkning'})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {a.data.missing_for_calculation.length || a.data.documents_not_read.length ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {a.data.missing_for_calculation.length ? (
                  <div>
                    <h4 className="text-[13px] font-semibold text-navy-900">Mangler for å kunne regne</h4>
                    <ul className="mt-1 list-disc pl-5 text-[13px]">
                      {a.data.missing_for_calculation.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {a.data.documents_not_read.length ? (
                  <div>
                    <h4 className="text-[13px] font-semibold text-navy-900">Dokumenter AI ikke har lest</h4>
                    <ul className="mt-1 list-disc pl-5 text-[13px]">
                      {a.data.documents_not_read.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <h3 className="text-[14px] font-semibold text-navy-900">Funnet ved ordsøk i dokumentene (uten AI)</h3>
          <p className="text-[12px] text-muted">
            {scan.noticeOnly ? 'Bare kunngjøringen er søkt i – ingen opplastede dokumenter.' : `Søkt i kunngjøringen og ${scan.documentsScanned} dokument(er).`} Et treff
            betyr at ordet står der – les teksten for å vurdere vilkåret.
          </p>
          {scanCategories.length ? (
            <ul className="mt-2 space-y-2">
              {scanCategories.map((cat) => (
                <li key={cat}>
                  <details>
                    <summary className="cursor-pointer py-1 text-[13px] font-semibold text-navy-900">
                      {TERM_LABELS[cat]} <span className="font-normal text-muted">({scan.byCategory[cat]!.length})</span>
                      {scan.negatedOnly.includes(cat) ? (
                        <Badge tone="outline" className="ml-2">
                          Ser ut til å ikke gjelde
                        </Badge>
                      ) : null}
                    </summary>
                    {COST_HINTS[cat] && !scan.negatedOnly.includes(cat) ? <p className="mt-1 text-[12.5px] text-ink">Til kalkylen: {COST_HINTS[cat]}</p> : null}
                    <ul className="mt-1 space-y-1">
                      {scan.byCategory[cat]!.map((h, idx) => (
                        <li key={idx}>
                          {h.negated ? <p className="text-[11px] font-semibold text-muted">Teksten ser ut til å si at dette ikke gjelder. Kontroller utdraget selv:</p> : null}
                          <SourceLine source={{ sourceId: h.sourceId, title: h.sourceTitle, page: h.page, quote: h.snippet }} />
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted">Ingen treff.</p>
          )}
          {scan.notFound.length ? (
            <p className="mt-2 text-[12px] text-muted">
              Ikke funnet: {scan.notFound.map((c) => TERM_LABELS[c].toLowerCase()).join(', ')}. Det betyr ikke at vilkårene mangler – de kan stå i dokumenter som ikke er lastet opp.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function AiPanel({ ws, canRunAi, quota }: { ws: ProfitWorkspace; canRunAi: boolean; quota: { used: number; limit: number } }) {
  const { aiConfigured, aiIsMock } = useUi();
  const a = ws.analysis;
  const t = ws.tender;
  return (
    <Panel>
      <PanelHeader title="Profit Intelligence med AI" />
      <div className="space-y-3 px-5 py-4 text-[14px]">
        {!canRunAi ? (
          <p className="text-muted">
            AI som finner kostnadsdrivere, mengder og kontraktsrisiko med kildehenvisning er med i Bedrift. <a href="/app/abonnement">Se planer</a>
          </p>
        ) : !aiConfigured ? (
          <p className="text-muted">AI er ikke satt opp på denne installasjonen.</p>
        ) : (
          <>
            <p className="text-muted">
              AI leser kunngjøringen og {ws.documents.analyzable ? `${ws.documents.analyzable} opplastet(e) dokument(er)` : 'ingen opplastede dokumenter'} og finner mengder, beløp og vilkår med økonomisk risiko. AI setter aldri priser.
            </p>
            {a ? (
              <p className="text-[12px] text-muted">
                Sist analysert {formatDateTime(a.createdAt, true)}
                {a.documentsAnalyzed ? `, med ${a.documentsAnalyzed} dokument(er)` : ', bare kunngjøringen'}.
              </p>
            ) : null}
            <PostForm action={`/app/anbud/${t.id}/lonnsomhet/ai`}>
              {a ? <input type="hidden" name="force" value="1" /> : null}
              <Button type="submit" size="sm" busyLabel="Analyserer …">
                <LuSparkles className="size-4" aria-hidden /> {a ? 'Analyser på nytt' : 'Analyser lønnsomhet og risiko'}
              </Button>
            </PostForm>
            {a && a.data.cost_drivers.length ? (
              <PostForm action={`/app/anbud/${t.id}/lonnsomhet/importer`}>
                <Button type="submit" size="sm" variant="secondary">
                  Hent {a.data.cost_drivers.length} mengder inn i kalkylen
                </Button>
                <p className="mt-1 text-[12px] text-muted">Linjer dere har endret, beholdes. Timelinjer får deres timekost; andre enhetskoster fyller dere inn.</p>
              </PostForm>
            ) : null}
            <p className="text-[12px] text-muted">
              Bruker 1 AI-analyse ({quota.used} av {quota.limit} brukt denne måneden).
              {aiIsMock ? ' Testmodus: svarene er simulerte.' : ''}
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function QualificationsPanel({ ws }: { ws: ProfitWorkspace }) {
  const q = ws.qualifications;
  return (
    <Panel>
      <PanelHeader title="Kvalifikasjoner" description="Krav som nevnes i kildene, sammenlignet med profilen og bemanningen deres." />
      <div className="space-y-3 px-5 py-4 text-[14px]">
        {q.required.length ? (
          <ul className="space-y-1.5">
            {q.required.map((r) => (
              <li key={r.id} className="flex gap-2">
                <CheckIcon ok={r.have} />
                <span>
                  {r.label}
                  {r.legal && !r.have ? <span className="text-danger"> – kan være et absolutt krav</span> : null}
                  {r.via ? <span className="text-[12px] text-muted"> ({r.via === 'profil' ? 'i profilen' : 'i bemanningen'})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Ingen kjente sertifiseringer eller godkjenninger er nevnt i kildene.</p>
        )}
        {q.turnover ? (
          <p className="flex gap-2">
            <CheckIcon ok={q.turnover.ok} />
            <span>
              Omsetning minst {fmtKr(q.turnover.required)}
              {q.turnover.have !== null ? ` – profilen oppgir ${fmtKr(q.turnover.have)}` : ' – omsetning mangler i profilen'}
            </span>
          </p>
        ) : null}
        {q.aiUnfulfilled.length ? (
          <div>
            <p className="text-[13px] font-semibold text-navy-900">Ikke oppfylt ifølge egnethetsvurderingen (AI)</p>
            <ul className="mt-1 list-disc pl-5 text-[13px]">
              {q.aiUnfulfilled.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-[12px] text-muted">
          Ordsøk finner bare kjente sertifiseringer. Les kvalifikasjonskravene i konkurransegrunnlaget. <a href="/app/profil">Oppdater profilen</a>
        </p>
      </div>
    </Panel>
  );
}

/** 12 avkrysningsbokser for måneder (name="activeMonths"). Ingen = hele året. */
function MonthPicker({ legend, hint, selected }: { legend: string; hint: string; selected: number[] | null }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold text-ink">{legend}</legend>
      <p className="mt-0.5 text-[12px] text-muted">{hint}</p>
      <div className="mt-2 grid max-w-xl grid-cols-4 gap-1.5 sm:grid-cols-6">
        {MONTH_SHORT.map((m, idx) => (
          <label key={m} className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-[13px] has-[:checked]:border-navy-600 has-[:checked]:bg-navy-50">
            <input type="checkbox" name="activeMonths" value={idx + 1} defaultChecked={selected?.includes(idx + 1) ?? false} className="size-3.5" />
            {m}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Belastning per måned: eksisterende kontrakter + dette oppdraget i prosent av kapasiteten, med tall som tekst. */
function MonthLoadGrid({ months }: { months: MonthLoad[] }) {
  return (
    <div className="text-[13px]">
      <p className="font-semibold text-navy-900">Måned for måned</p>
      <p className="text-[12px] text-muted">Belastning med dette oppdraget, i prosent av tilgjengelige timer.</p>
      <ul className="mt-2 grid grid-cols-6 gap-1">
        {months.map((m) => {
          const short = m.gap !== null && m.gap > 0.5;
          return (
            <li
              key={m.month}
              className={cn('rounded-md border px-1 py-1 text-center', short ? 'border-danger/40 bg-danger-soft' : m.required > 0 ? 'border-navy-200 bg-navy-50' : 'border-line')}
              title={`${MONTH_SHORT[m.month - 1]}: ${fmtNumber(m.committed)} t i andre kontrakter + ${fmtNumber(m.required)} t i dette oppdraget av ${fmtNumber(m.capacity)} t${short ? ` – mangler ${fmtNumber(m.gap!)} t` : ''}`}
            >
              <span className="block text-[11px] text-muted">{MONTH_SHORT[m.month - 1]}</span>
              <span className={cn('num block text-[12px] font-semibold', short ? 'text-danger' : 'text-ink')}>{m.loadPct !== null ? `${m.loadPct} %` : '–'}</span>
              {short ? <span className="sr-only">mangler {fmtNumber(m.gap!)} timer</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CapacityPanel({ ws }: { ws: ProfitWorkspace }) {
  const c = ws.capacity;
  return (
    <Panel>
      <PanelHeader title="Kapasitet" action={<CapacityBadge status={c.status} />} />
      <div className="space-y-3 px-5 py-4 text-[14px]">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Tilgjengelig per år</dt>
          <dd className="num text-right">{c.availableHoursPerYear !== null ? `${fmtNumber(c.availableHoursPerYear)} t` : 'Ikke registrert'}</dd>
          <dt className="text-muted">Bundet i kontrakter</dt>
          <dd className="num text-right">{fmtNumber(c.committedHoursPerYear)} t</dd>
          <dt className="text-muted">Ledig</dt>
          <dd className="num text-right">{c.freeHoursPerYear !== null ? `${fmtNumber(c.freeHoursPerYear)} t` : '–'}</dd>
          <dt className="text-muted">Dette oppdraget</dt>
          <dd className="num text-right">{c.requiredHoursPerYear !== null ? `${fmtNumber(c.requiredHoursPerYear)} t` : 'Ukjent'}</dd>
          {c.utilizationPct !== null ? (
            <>
              <dt className="text-muted">Utnyttelse med oppdraget</dt>
              <dd className={cn('num text-right', c.utilizationPct > 100 && 'text-danger')}>{fmtNumber(c.utilizationPct)} %</dd>
            </>
          ) : null}
        </dl>
        {c.gapHoursPerYear !== null && c.gapHoursPerYear > 0 ? (
          <Alert tone="danger">Mangler ca. {fmtNumber(c.gapHoursPerYear)} timer per år. Vurder underleverandør, partner eller å by på færre delkontrakter.</Alert>
        ) : null}
        {c.overlappingContracts.length ? (
          <div className="text-[13px]">
            <p className="font-semibold text-navy-900">Kontrakter i samme periode</p>
            <ul className="mt-1 space-y-0.5">
              {c.overlappingContracts.map((o) => (
                <li key={o.name}>
                  {o.name}: <span className="num">{fmtNumber(o.hoursPerYear)} t/år</span>{' '}
                  <span className="text-muted">
                    ({o.overlapPct} % overlapp{o.activeMonths ? `, ${monthsLabel(o.activeMonths)}` : ''})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {c.equipmentMatched.length || c.equipmentMissing.length ? (
          <div className="text-[13px]">
            <p className="font-semibold text-navy-900">Utstyr nevnt i dokumentene</p>
            <ul className="mt-1 space-y-1">
              {c.equipmentMatched.map((e) => (
                <li key={e.need} className="flex gap-2">
                  <CheckIcon ok /> <span>{e.need} <span className="text-muted">(har: {e.have})</span></span>
                </li>
              ))}
              {c.equipmentMissing.map((e) => (
                <li key={e} className="flex gap-2">
                  <CheckIcon ok={false} /> <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {c.months && (c.seasonalShortage || ws.inputs.activeMonths || c.overlappingContracts.some((o) => o.activeMonths)) ? (
          <MonthLoadGrid months={c.months} />
        ) : null}
        {[...(ws.capacityPeriodNote ? [ws.capacityPeriodNote] : []), ...c.notes].map((n) => (
          <p key={n} className="text-[12px] text-muted">
            {n}
          </p>
        ))}
        <a href="/app/kapasitet" className="text-[13px] font-semibold">
          Registrer bemanning, utstyr og kontrakter
        </a>
      </div>
    </Panel>
  );
}

function PartnerPanel({ ws, canSearch }: { ws: ProfitWorkspace; canSearch: boolean }) {
  const g = ws.partnerGaps;
  const anyGap = g.certifications.length > 0 || g.equipment.length > 0 || g.competencies.length > 0 || (g.capacityHours !== null && g.capacityHours > 0);
  return (
    <Panel>
      <PanelHeader title="Anbudspartnere" description="Bedrifter som kan dekke det dere mangler." />
      <div className="space-y-3 px-5 py-4 text-[14px]">
        {!canSearch ? (
          <p className="text-muted">
            Forslag og søk etter partnere er med i Bedrift. Alle planer kan publisere en partnerprofil og bli funnet. <a href="/app/partnere">Partnerprofil</a>
          </p>
        ) : !anyGap ? (
          <p className="text-muted">Ingen mangler funnet som krever partner. <a href="/app/partnere">Søk likevel</a></p>
        ) : ws.partnerSuggestions.length ? (
          <ul className="space-y-3">
            {ws.partnerSuggestions.map((s) => (
              <li key={s.partner.orgId} className="rounded-md border border-line px-3 py-2">
                <p className="font-semibold text-navy-900">{s.partner.displayName}</p>
                <ul className="mt-0.5 text-[12px] text-muted">
                  {s.reasons.map((r) => (
                    <li key={r}>• {r}</li>
                  ))}
                </ul>
                <a href={`/app/partnere?til=${s.partner.orgId}&anbud=${ws.tender.id}#foresporsel`} className="mt-1 inline-block text-[13px] font-semibold">
                  Send forespørsel
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">
            Ingen publiserte partnere dekker manglene ennå. <a href={`/app/partnere?anbud=${ws.tender.id}`}>Søk etter partnere</a>
          </p>
        )}
        <p className="text-[12px] text-muted">Samarbeid mellom bedrifter som kan levere alene, kan være ulovlig. Vi spør før forespørselen sendes.</p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Portefølje
// ---------------------------------------------------------------------------
export function PortfolioPage({ data }: { data: PortfolioSummary }) {
  const t = data.totals;
  return (
    <AppShell wide>
      <PageHeader
        title="Lønnsomhet"
        description="Anbudene dere har regnet på – med anbefaling, margin, risiko, kvalifikasjoner og kapasitet."
        actions={
          <LinkButton href="/app/kapasitet" variant="secondary" size="sm">
            Kapasitet og økonomi
          </LinkButton>
        }
      />
      <Alert tone="info" className="mb-5">
        {DISCLAIMER}
      </Alert>
      <Panel className="mb-6 grid grid-cols-2 gap-5 px-5 py-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Åpne anbud med kalkyle" value={t.open} hint={`${t.count} totalt`} />
        <Stat label="Vurder å by" value={t.byRecommendation.bid} />
        <Stat label="Undersøk nærmere" value={t.byRecommendation.investigate} />
        <Stat label="Høy risiko" value={t.byRecommendation.high_risk} />
        <Stat
          label="Fortjeneste ved kontraktsverdi"
          value={t.withContractValue ? fmtKr(t.profitAtContractValue) : '–'}
          hint={t.withContractValue ? `Sum for ${t.withContractValue} åpne anbud – dere vinner ikke alle` : 'Ingen åpne anbud med kjent verdi'}
        />
        <Stat label="Samlet selvkost (åpne)" value={t.open ? fmtKr(t.costTotal) : '–'} hint="Beregnet fra kalkylene" />
      </Panel>
      <Panel>
        <PanelHeader title="Kalkyler" />
        {data.rows.length ? (
          <div className="scroll-x">
            <table className="w-full min-w-[900px] text-[14px]">
              <thead>
                <tr className="border-b border-line text-left text-[13px] text-muted">
                  <th className="px-5 py-2 font-semibold">Anbud</th>
                  <th className="px-3 py-2 font-semibold">Frist</th>
                  <th className="px-3 py-2 font-semibold">Anbefaling</th>
                  <th className="px-3 py-2 text-right font-semibold">Fortjeneste / margin</th>
                  <th className="px-3 py-2 font-semibold">Risiko</th>
                  <th className="px-3 py-2 text-right font-semibold">Mangler</th>
                  <th className="px-3 py-2 font-semibold">Kapasitet</th>
                  <th className="px-5 py-2 text-right font-semibold">Oppdatert</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const at = r.snapshot.calc?.atContractValue;
                  return (
                    <tr key={r.tenderId} className="border-b border-line last:border-0">
                      <td className="px-5 py-2.5">
                        <a href={`/app/anbud/${r.tenderId}/lonnsomhet`} className="font-semibold">
                          {r.title}
                        </a>
                        {r.buyerName ? <p className="text-[12px] text-muted">{r.buyerName}</p> : null}
                      </td>
                      <td className="num whitespace-nowrap px-3 py-2.5">{r.deadlineAt ? formatDate(r.deadlineAt) : '–'}</td>
                      <td className="px-3 py-2.5">
                        <RecommendationBadge value={r.recommendation} />
                      </td>
                      <td className={cn('num whitespace-nowrap px-3 py-2.5 text-right', at && at.profit < 0 && 'text-danger')}>
                        {at ? `${fmtKr(at.profit)} · ${fmtNumber(at.marginPct)} %` : '–'}
                      </td>
                      <td className="px-3 py-2.5">
                        <RiskBadge level={r.snapshot.riskLevel ?? 'ukjent'} />
                      </td>
                      <td className="num px-3 py-2.5 text-right">{r.snapshot.missingQualifications?.length ?? 0}</td>
                      <td className="px-3 py-2.5">
                        <CapacityBadge status={r.snapshot.capacityStatus ?? 'ukjent'} />
                      </td>
                      <td className="num whitespace-nowrap px-5 py-2.5 text-right text-[13px] text-muted">{relativeTime(r.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Ingen kalkyler ennå" action={<LinkButton href="/app/anbud">Finn anbud</LinkButton>}>
            Åpne et anbud og trykk «Regn på lønnsomhet». Legg gjerne inn timekost og marginer under Kapasitet og økonomi først.
          </EmptyState>
        )}
      </Panel>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Kapasitet og økonomi
// ---------------------------------------------------------------------------
export function CapacityPage({ data, canManage, errors }: { data: CapacityData; canManage: boolean; errors?: string[] }) {
  const e: OrgEconomics = data.economics;
  return (
    <AppShell wide>
      <PageHeader
        title="Kapasitet og økonomi"
        description="Bedriftens egne tall. De brukes i alle kalkyler og i kapasitetsanalysen – og deles aldri med andre."
        actions={
          <LinkButton href="/app/lonnsomhet" variant="secondary" size="sm">
            Lønnsomhet
          </LinkButton>
        }
      />
      {!canManage ? (
        <Alert tone="info" className="mb-5">
          Bare eiere og administratorer kan endre disse tallene.
        </Alert>
      ) : null}
      {errors?.length ? (
        <Alert tone="danger" title="Ikke lagret" className="mb-5">
          <ul className="list-disc pl-5">
            {errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel>
          <PanelHeader title="Økonomiske forutsetninger" description="Standardverdier for nye kalkyler. Kan endres per anbud." />
          <PostForm action="/app/kapasitet/okonomi" className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Kostnad per arbeidstime (kr)" htmlFor="ec-hc" hint="Lønn + feriepenger + arbeidsgiveravgift + pensjon.">
              <Input id="ec-hc" name="hourlyCost" inputMode="decimal" defaultValue={numIn(e.hourlyCost)} disabled={!canManage} />
            </Field>
            <Field label="Indirekte kostnader (% av direkte)" htmlFor="ec-oh">
              <Input id="ec-oh" name="overheadPct" inputMode="decimal" defaultValue={numIn(e.overheadPct)} disabled={!canManage} />
            </Field>
            <Field label="Ønsket margin (%)" htmlFor="ec-tm">
              <Input id="ec-tm" name="targetMarginPct" inputMode="decimal" defaultValue={numIn(e.targetMarginPct)} disabled={!canManage} />
            </Field>
            <Field label="Minstemargin (%)" htmlFor="ec-mm">
              <Input id="ec-mm" name="minMarginPct" inputMode="decimal" defaultValue={numIn(e.minMarginPct)} disabled={!canManage} />
            </Field>
            <Field label="Risikopåslag (%)" htmlFor="ec-rb">
              <Input id="ec-rb" name="riskBufferPct" inputMode="decimal" defaultValue={numIn(e.riskBufferPct)} disabled={!canManage} />
            </Field>
            <Field label="Timer brukt på et typisk tilbud" htmlFor="ec-bc">
              <Input id="ec-bc" name="bidCostHours" inputMode="decimal" defaultValue={numIn(e.bidCostHours)} disabled={!canManage} />
            </Field>
            <Field label="Notater" htmlFor="ec-notes" className="sm:col-span-2">
              <Textarea id="ec-notes" name="notes" rows={2} maxLength={2000} defaultValue={e.notes ?? ''} disabled={!canManage} />
            </Field>
            {canManage ? (
              <div className="sm:col-span-2">
                <Button type="submit">Lagre</Button>
                {e.updatedAt ? <span className="ml-3 text-[12px] text-muted">Sist endret {relativeTime(e.updatedAt)}</span> : null}
              </div>
            ) : null}
          </PostForm>
        </Panel>

        <Panel>
          <PanelHeader
            title="Bemanning"
            description={
              data.availableHoursPerYear !== null
                ? `Tilgjengelig: ${fmtNumber(data.availableHoursPerYear)} timer per år. Registrer roller og antall – ikke navn.`
                : 'Registrer roller og antall – ikke navn på ansatte.'
            }
          />
          {data.staff.length ? (
            <ul className="divide-y divide-line">
              {data.staff.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-2.5 text-[14px]">
                  <div>
                    <p className="font-semibold text-navy-900">
                      {s.role} <span className="num font-normal text-muted">× {s.headcount}</span>
                    </p>
                    <p className="text-[12px] text-muted">
                      {s.hoursPerYearEach !== null ? `${fmtNumber(s.hoursPerYearEach)} t per person per år = ${fmtNumber(s.headcount * s.hoursPerYearEach)} t` : 'Timer ikke oppgitt'}
                      {s.certifications.length ? ` · ${s.certifications.join(', ')}` : ''}
                    </p>
                  </div>
                  {canManage ? <DeleteButton action={`/app/kapasitet/bemanning/${s.id}/slett`} label={`Slett ${s.role}`} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Ingen bemanning registrert">Uten bemanning kan vi ikke vurdere om dere har kapasitet til et oppdrag.</EmptyState>
          )}
          {canManage ? (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-3 text-[14px] font-semibold text-navy-900">Legg til rolle</summary>
              <PostForm action="/app/kapasitet/bemanning" className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
                <Field label="Rolle eller fag" htmlFor="st-role">
                  <Input id="st-role" name="role" required maxLength={160} placeholder="F.eks. Renholder" />
                </Field>
                <Field label="Antall personer" htmlFor="st-count">
                  <Input id="st-count" name="headcount" inputMode="numeric" required />
                </Field>
                <Field label="Timer per person per år" htmlFor="st-hours" hint="Tilgjengelige timer etter ferie og fravær.">
                  <Input id="st-hours" name="hoursPerYearEach" inputMode="decimal" />
                </Field>
                <Field label="Sertifikater og kompetanse" htmlFor="st-certs" hint="Kommaseparert, f.eks. «Vekterutdanning, Fagbrev».">
                  <Input id="st-certs" name="certifications" maxLength={3000} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Legg til
                  </Button>
                </div>
              </PostForm>
            </details>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader title="Maskiner og utstyr" />
          {data.equipment.length ? (
            <ul className="divide-y divide-line">
              {data.equipment.map((it) => (
                <li key={it.id} className="flex items-start justify-between gap-2 px-5 py-2.5 text-[14px]">
                  <div>
                    <p className="font-semibold text-navy-900">
                      {it.name} <span className="num font-normal text-muted">× {it.quantity}</span>
                    </p>
                    {it.category || it.notes ? <p className="text-[12px] text-muted">{[it.category, it.notes].filter(Boolean).join(' · ')}</p> : null}
                  </div>
                  {canManage ? <DeleteButton action={`/app/kapasitet/utstyr/${it.id}/slett`} label={`Slett ${it.name}`} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Ingen utstyr registrert" />
          )}
          {canManage ? (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-3 text-[14px] font-semibold text-navy-900">Legg til utstyr</summary>
              <PostForm action="/app/kapasitet/utstyr" className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-3">
                <Field label="Navn" htmlFor="eq-name" className="sm:col-span-2">
                  <Input id="eq-name" name="name" required maxLength={200} placeholder="F.eks. Gulvvaskemaskin" />
                </Field>
                <Field label="Antall" htmlFor="eq-q">
                  <Input id="eq-q" name="quantity" inputMode="numeric" defaultValue="1" />
                </Field>
                <Field label="Kategori" htmlFor="eq-cat">
                  <Input id="eq-cat" name="category" maxLength={60} />
                </Field>
                <Field label="Notat" htmlFor="eq-notes" className="sm:col-span-2">
                  <Input id="eq-notes" name="notes" maxLength={1000} />
                </Field>
                <div className="sm:col-span-3">
                  <Button type="submit" size="sm">
                    Legg til
                  </Button>
                </div>
              </PostForm>
            </details>
          ) : null}
        </Panel>

        <Panel>
          <PanelHeader title="Eksisterende kontrakter" description="Binder timer i perioden – brukes i kapasitetsanalysen." />
          {data.contracts.length ? (
            <ul className="divide-y divide-line">
              {data.contracts.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2 px-5 py-2.5 text-[14px]">
                  <div>
                    <p className="font-semibold text-navy-900">{c.name}</p>
                    <p className="text-[12px] text-muted">
                      {[
                        c.client,
                        `${c.startDate ? formatDate(c.startDate) : '?'} – ${c.endDate ? formatDate(c.endDate) : 'løpende'}`,
                        c.hoursPerMonth !== null ? `${fmtNumber(c.hoursPerMonth)} t/mnd` : 'timer ikke oppgitt',
                        c.activeMonths ? monthsLabel(c.activeMonths) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {canManage ? <DeleteButton action={`/app/kapasitet/kontrakter/${c.id}/slett`} label={`Slett ${c.name}`} /> : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Ingen kontrakter registrert" />
          )}
          {canManage ? (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-5 py-3 text-[14px] font-semibold text-navy-900">Legg til kontrakt</summary>
              <PostForm action="/app/kapasitet/kontrakter" className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
                <Field label="Navn" htmlFor="ct-name">
                  <Input id="ct-name" name="name" required maxLength={200} />
                </Field>
                <Field label="Kunde" htmlFor="ct-client">
                  <Input id="ct-client" name="client" maxLength={200} />
                </Field>
                <Field label="Start" htmlFor="ct-start">
                  <Input id="ct-start" name="startDate" type="date" />
                </Field>
                <Field label="Slutt" htmlFor="ct-end" hint="Tom = løpende.">
                  <Input id="ct-end" name="endDate" type="date" />
                </Field>
                <Field label="Timer per måned" htmlFor="ct-hours" hint="I månedene med arbeid.">
                  <Input id="ct-hours" name="hoursPerMonth" inputMode="decimal" />
                </Field>
                <div className="sm:col-span-2">
                  <MonthPicker legend="Måneder med arbeid" hint="Ingen avkrysning = hele året (f.eks. vinterdrift: nov–mar)." selected={null} />
                </div>
                <Field label="Notat" htmlFor="ct-notes">
                  <Input id="ct-notes" name="notes" maxLength={1000} />
                </Field>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm">
                    Legg til
                  </Button>
                </div>
              </PostForm>
            </details>
          ) : null}
        </Panel>
      </div>
    </AppShell>
  );
}

function DeleteButton({ action, label }: { action: string; label: string }) {
  return (
    <PostForm action={action} confirm={`${label}?`}>
      <Button variant="ghost" size="sm" aria-label={label}>
        Slett
      </Button>
    </PostForm>
  );
}

// ---------------------------------------------------------------------------
// Anbudspartnere
// ---------------------------------------------------------------------------
export interface PartnersPageProps {
  profile: PartnerProfile | null;
  defaults: Omit<PartnerProfile, 'orgId' | 'consentAt' | 'consentVersion' | 'updatedAt'>;
  requests: { incoming: PartnerRequestRow[]; outgoing: PartnerRequestRow[] };
  canManage: boolean;
  canSearch: boolean;
  search: { text: string; region: string; certification: string; industry: string; role: string } | null;
  results: PartnerCard[] | null;
  target: PartnerCard | null;
  tender: { id: string; title: string } | null;
  errors?: string[];
}

const STATUS_LABEL: Record<PartnerRequestRow['status'], { label: string; tone: 'urgent' | 'ok' | 'neutral' | 'outline' }> = {
  pending: { label: 'Venter på svar', tone: 'urgent' },
  accepted: { label: 'Godtatt', tone: 'ok' },
  declined: { label: 'Avslått', tone: 'neutral' },
  withdrawn: { label: 'Trukket tilbake', tone: 'outline' },
};

function CompetitionNote() {
  return (
    <Alert tone="warning" title="Konkurranseregler ved samarbeid om anbud">
      Bedrifter som hver for seg kan levere hele oppdraget, skal som hovedregel ikke samarbeide om et felles tilbud (konkurranseloven § 10). Samarbeid er normalt
      greit når dere ikke kan levere alene, men må vurderes konkret. Del aldri priser, marginer eller tilbudsstrategi med en konkurrent.{' '}
      <a href={COMPETITION_GUIDANCE_URL} target="_blank" rel="noopener noreferrer">
        Konkurransetilsynets veileder
      </a>
      . Dette er ikke juridisk rådgivning.
    </Alert>
  );
}

export function PartnersPage(p: PartnersPageProps) {
  const prof = p.profile ?? { ...p.defaults, consentAt: null };
  return (
    <AppShell wide>
      <PageHeader title="Anbudspartnere" description="Finn underleverandører og samarbeidspartnere som dekker det dere mangler – og bli funnet selv." />
      {p.errors?.length ? (
        <Alert tone="danger" title="Ikke lagret" className="mb-5">
          <ul className="list-disc pl-5">
            {p.errors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-6">
          {p.target && p.canSearch ? <RequestForm target={p.target} tender={p.tender} canManage={p.canManage} /> : null}
          {p.canSearch ? (
            <Panel>
              <PanelHeader title="Søk etter partnere" description="Bare bedrifter som selv har publisert en partnerprofil, vises." />
              <form method="get" action="/app/partnere" className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
                {p.tender ? <input type="hidden" name="anbud" value={p.tender.id} /> : null}
                <Field label="Fritekst" htmlFor="ps-q">
                  <Input id="ps-q" name="q" defaultValue={p.search?.text ?? ''} maxLength={100} placeholder="F.eks. lift, asfalt, vakthold" />
                </Field>
                <Field label="Område" htmlFor="ps-r">
                  <Select id="ps-r" name="omrade" defaultValue={p.search?.region ?? ''}>
                    <option value="">Alle</option>
                    {REGIONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sertifisering" htmlFor="ps-c">
                  <Select id="ps-c" name="sertifisering" defaultValue={p.search?.certification ?? ''}>
                    <option value="">Alle</option>
                    {CERTIFICATIONS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Bransje" htmlFor="ps-i">
                  <Select id="ps-i" name="bransje" defaultValue={p.search?.industry ?? ''}>
                    <option value="">Alle</option>
                    {INDUSTRIES.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rolle" htmlFor="ps-role">
                  <Select id="ps-role" name="rolle" defaultValue={p.search?.role ?? ''}>
                    <option value="">Alle</option>
                    {PARTNER_ROLES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end">
                  <Button variant="secondary" type="submit">
                    Søk
                  </Button>
                </div>
              </form>
              {p.results ? (
                p.results.length ? (
                  <ul className="divide-y divide-line border-t border-line">
                    {p.results.map((r) => (
                      <li key={r.orgId} className="px-5 py-3">
                        <PartnerSummary partner={r} />
                        <a href={`/app/partnere?til=${r.orgId}${p.tender ? `&anbud=${p.tender.id}` : ''}#foresporsel`} className="mt-1 inline-block text-[13px] font-semibold">
                          Send forespørsel
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="Ingen partnere funnet">Prøv færre filtre. Partnernettverket vokser etter hvert som flere kunder publiserer profilen sin.</EmptyState>
                )
              ) : null}
            </Panel>
          ) : (
            <Alert tone="info" title="Søk etter partnere er med i Bedrift">
              Med Start og Profesjonell kan dere publisere en partnerprofil, bli funnet og svare på forespørsler. <a href="/app/abonnement">Se planer</a>
            </Alert>
          )}

          <Panel>
            <PanelHeader title="Forespørsler til dere" description="Avsenderen har delt sin kontaktinfo. Deres kontaktinfo deles bare hvis dere godtar." />
            <div id="innkommende" />
            {p.requests.incoming.length ? (
              <ul className="divide-y divide-line">
                {p.requests.incoming.map((r) => (
                  <RequestItem key={r.id} r={r} incoming canManage={p.canManage} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Ingen forespørsler ennå" />
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Forespørsler fra dere" />
            <div id="sendte" />
            {p.requests.outgoing.length ? (
              <ul className="divide-y divide-line">
                {p.requests.outgoing.map((r) => (
                  <RequestItem key={r.id} r={r} incoming={false} canManage={p.canManage} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Dere har ikke sendt noen forespørsler" />
            )}
          </Panel>
        </div>

        <aside className="space-y-6">
          <Panel>
            <PanelHeader
              title="Deres partnerprofil"
              action={p.profile?.published ? <Badge tone="ok">Publisert</Badge> : <Badge tone="neutral">Ikke publisert</Badge>}
              description="Vises bare for andre AnbudRadar-kunder, og bare når dere publiserer den. Kalkyler, priser og dokumenter deles aldri."
            />
            <PostForm action="/app/partnere/profil" className="space-y-3 px-5 py-4">
              <Field label="Navn som vises" htmlFor="pp-name">
                <Input id="pp-name" name="displayName" required maxLength={160} defaultValue={prof.displayName} disabled={!p.canManage} />
              </Field>
              <Field label="Kort om bedriften" htmlFor="pp-sum">
                <Textarea id="pp-sum" name="summary" rows={3} maxLength={2000} defaultValue={prof.summary ?? ''} disabled={!p.canManage} />
              </Field>
              <Field label="Hva dere kan levere (kapasitet, utstyr, fag)" htmlFor="pp-cap">
                <Textarea id="pp-cap" name="capabilities" rows={4} maxLength={3000} defaultValue={prof.capabilities ?? ''} disabled={!p.canManage} />
              </Field>
              <Field label="Antall ansatte" htmlFor="pp-emp">
                <Input id="pp-emp" name="employeeCount" inputMode="numeric" defaultValue={prof.employeeCount ?? ''} disabled={!p.canManage} />
              </Field>
              <fieldset>
                <legend className="mb-1 text-[13px] font-semibold text-ink">Roller dere kan ha</legend>
                {PARTNER_ROLES.map((r) => (
                  <Checkbox key={r.id} name="partnerRoles" value={r.id} defaultChecked={prof.partnerRoles.includes(r.id)} label={r.label} disabled={!p.canManage} />
                ))}
              </fieldset>
              <details>
                <summary className="cursor-pointer py-1.5 text-[13px] font-semibold text-navy-900">Områder, bransjer og sertifiseringer</summary>
                <fieldset className="mt-2">
                  <legend className="mb-1 text-[13px] font-semibold text-ink">Områder</legend>
                  <Checkbox name="regions" value="ALL" defaultChecked={prof.regions.includes('ALL')} label="Hele landet" disabled={!p.canManage} />
                  <div className="grid grid-cols-2 gap-x-3">
                    {REGIONS.map((r) => (
                      <Checkbox key={r.code} name="regions" value={r.code} defaultChecked={prof.regions.includes(r.code)} label={r.name} disabled={!p.canManage} />
                    ))}
                  </div>
                </fieldset>
                <fieldset className="mt-3">
                  <legend className="mb-1 text-[13px] font-semibold text-ink">Bransjer</legend>
                  {INDUSTRIES.map((i) => (
                    <Checkbox key={i.id} name="industries" value={i.id} defaultChecked={prof.industries.includes(i.id)} label={i.name} disabled={!p.canManage} />
                  ))}
                </fieldset>
                <fieldset className="mt-3">
                  <legend className="mb-1 text-[13px] font-semibold text-ink">Sertifiseringer og godkjenninger</legend>
                  {CERTIFICATIONS.map((c) => (
                    <Checkbox key={c.id} name="certifications" value={c.id} defaultChecked={prof.certifications.includes(c.id)} label={c.label} disabled={!p.canManage} />
                  ))}
                </fieldset>
              </details>
              {p.canManage ? (
                <>
                  <Checkbox name="consent" label="Samtykke til visning" hint={PARTNER_CONSENT_TEXT} defaultChecked={Boolean(p.profile?.published)} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" name="published" value="1">
                      {p.profile?.published ? 'Lagre (publisert)' : 'Lagre og publiser'}
                    </Button>
                    <Button type="submit" name="published" value="0" variant="secondary">
                      {p.profile?.published ? 'Skjul profilen' : 'Lagre uten å publisere'}
                    </Button>
                  </div>
                  {p.profile?.consentAt ? <p className="text-[12px] text-muted">Samtykke gitt {formatDateTime(p.profile.consentAt, true)}.</p> : null}
                </>
              ) : (
                <p className="text-[12px] text-muted">Bare eiere og administratorer kan endre og publisere profilen.</p>
              )}
            </PostForm>
          </Panel>
          <CompetitionNote />
        </aside>
      </div>
    </AppShell>
  );
}

function PartnerSummary({ partner }: { partner: PartnerCard }) {
  return (
    <div>
      <p className="font-semibold text-navy-900">
        {partner.displayName}
        {partner.employeeCount !== null ? <span className="ml-2 text-[12px] font-normal text-muted">{partner.employeeCount} ansatte</span> : null}
      </p>
      {partner.summary ? <p className="text-[13px]">{partner.summary}</p> : null}
      {partner.capabilities ? <p className="mt-0.5 line-clamp-3 text-[13px] text-muted">{partner.capabilities}</p> : null}
      <div className="mt-1 flex flex-wrap gap-1">
        {partner.partnerRoles.map((r) => (
          <Badge key={r} tone="outline">
            {PARTNER_ROLE_LABEL.get(r) ?? r}
          </Badge>
        ))}
        {partner.certifications.map((c) => (
          <Badge key={c} tone="info">
            {CERT_BY_ID.get(c)?.label ?? c}
          </Badge>
        ))}
        {partner.industries.map((i) => (
          <Badge key={i} tone="neutral">
            {INDUSTRY_BY_ID.get(i)?.name ?? i}
          </Badge>
        ))}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        {partner.regions.includes('ALL') ? 'Hele landet' : partner.regions.map((r) => REGION_BY_CODE.get(r)?.name ?? r).join(', ') || 'Område ikke oppgitt'}
      </p>
    </div>
  );
}

function RequestForm({ target, tender, canManage }: { target: PartnerCard; tender: { id: string; title: string } | null; canManage: boolean }) {
  const { user } = useUi();
  return (
    <Panel>
      <div id="foresporsel" />
      <PanelHeader title={`Send forespørsel til ${target.displayName}`} description={tender ? `Om «${tender.title}»` : 'Generell forespørsel om samarbeid'} />
      <div className="space-y-4 px-5 py-4">
        <PartnerSummary partner={target} />
        {!canManage ? (
          <p className="text-[14px] text-muted">Bare eiere og administratorer kan sende forespørsler på vegne av bedriften.</p>
        ) : (
          <PostForm action="/app/partnere/foresporsel" className="space-y-3">
            <input type="hidden" name="toOrgId" value={target.orgId} />
            <input type="hidden" name="tenderId" value={tender?.id ?? ''} />
            <Field label="Hva ønsker dere?" htmlFor="rq-role">
              <Select id="rq-role" name="roleSought" required defaultValue="underleverandor">
                {PARTNER_ROLES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset>
              <legend className="mb-1 text-[13px] font-semibold text-ink">Kan dere levere hele oppdraget alene?</legend>
              {SELF_ASSESSMENTS.map((s) => (
                <label key={s.id} className="flex items-start gap-2 py-0.5 text-[14px]">
                  <input type="radio" name="selfAssessment" value={s.id} required className="mt-[3px] accent-navy-900" />
                  <span>{s.label}</span>
                </label>
              ))}
              <p className="mt-1 text-[12px] text-muted">Svarer dere at begge kan levere alene, sender vi ikke forespørselen.</p>
            </fieldset>
            <Field label="Melding" htmlFor="rq-msg" hint="Beskriv behovet (kapasitet, fag, utstyr, område). Ikke skriv priser.">
              <Textarea id="rq-msg" name="message" rows={4} required minLength={10} maxLength={2000} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Kontaktperson" htmlFor="rq-name">
                <Input id="rq-name" name="contactName" required maxLength={120} defaultValue={user?.name ?? ''} />
              </Field>
              <Field label="E-post" htmlFor="rq-email">
                <Input id="rq-email" name="contactEmail" type="email" required maxLength={254} defaultValue={user?.email ?? ''} />
              </Field>
            </div>
            <Checkbox name="confirmNoPrices" required label="Vi deler ikke priser, marginer eller tilbudsstrategi med mottakeren." />
            <Button type="submit">Send forespørsel</Button>
            <p className="text-[12px] text-muted">Mottakeren ser meldingen og kontaktinfoen over. Høyst 20 forespørsler per døgn.</p>
          </PostForm>
        )}
      </div>
    </Panel>
  );
}

function RequestItem({ r, incoming, canManage }: { r: PartnerRequestRow; incoming: boolean; canManage: boolean }) {
  const { user } = useUi();
  const st = STATUS_LABEL[r.status];
  const assessment = SELF_ASSESSMENTS.find((s) => s.id === r.selfAssessment)?.label ?? r.selfAssessment;
  return (
    <li className="space-y-2 px-5 py-3 text-[14px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-navy-900">{r.counterpartName ?? 'Profilen er skjult'}</span>
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="text-[12px] text-muted">{formatDateTime(r.createdAt, true)}</span>
      </div>
      <p className="text-[13px] text-muted">
        {PARTNER_ROLE_LABEL.get(r.roleSought) ?? r.roleSought}
        {r.tenderTitle && r.tenderId ? (
          <>
            {' · '}
            <a href={`/app/anbud/${r.tenderId}`}>{r.tenderTitle}</a>
          </>
        ) : null}
        {' · '}
        Egenvurdering: {assessment.toLowerCase()}
      </p>
      <p className="whitespace-pre-line">{r.message}</p>
      {incoming ? (
        <p className="text-[13px]">
          Kontakt: {r.requesterContactName} – <a href={`mailto:${r.requesterContactEmail}`}>{r.requesterContactEmail}</a>
        </p>
      ) : r.status === 'accepted' ? (
        <p className="text-[13px]">
          Kontakt: {r.responderContactName} – <a href={`mailto:${r.responderContactEmail}`}>{r.responderContactEmail}</a>
        </p>
      ) : null}
      {incoming && r.status === 'accepted' ? <p className="text-[12px] text-muted">Dere delte: {r.responderContactName} – {r.responderContactEmail}</p> : null}
      {canManage && r.status === 'pending' ? (
        incoming ? (
          <div className="flex flex-wrap items-start gap-3">
            <details className="rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer py-1 text-[13px] font-semibold text-navy-900">Godta og del kontaktinfo</summary>
              <PostForm action={`/app/partnere/foresporsel/${r.id}/svar`} className="mt-2 space-y-2">
                <input type="hidden" name="decision" value="accept" />
                <Field label="Kontaktperson" htmlFor={`ac-n-${r.id}`}>
                  <Input id={`ac-n-${r.id}`} name="contactName" required maxLength={120} defaultValue={user?.name ?? ''} />
                </Field>
                <Field label="E-post" htmlFor={`ac-e-${r.id}`}>
                  <Input id={`ac-e-${r.id}`} name="contactEmail" type="email" required maxLength={254} defaultValue={user?.email ?? ''} />
                </Field>
                <Button size="sm" type="submit">
                  Godta
                </Button>
              </PostForm>
            </details>
            <PostForm action={`/app/partnere/foresporsel/${r.id}/svar`}>
              <input type="hidden" name="decision" value="decline" />
              <Button size="sm" variant="secondary" type="submit">
                Avslå
              </Button>
            </PostForm>
          </div>
        ) : (
          <PostForm action={`/app/partnere/foresporsel/${r.id}/trekk`} confirm="Trekke tilbake forespørselen?">
            <Button size="sm" variant="ghost" type="submit">
              Trekk tilbake
            </Button>
          </PostForm>
        )
      ) : null}
    </li>
  );
}

export function TenderProfitTeaser({ tenderId, badge, enabled }: { tenderId: string; badge: { recommendation: Recommendation; marginPct: number | null; updatedAt: Date } | null; enabled: boolean }): ReactNode {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="border-b border-line px-5 py-4">
        <h2 className="text-[15px] font-semibold text-navy-900">Lønner det seg?</h2>
        <p className="mt-0.5 text-[13px] text-muted">Selvkost, minstepris, kontraktsrisiko og kapasitet – med deres egne tall.</p>
      </div>
      <div className="space-y-2 px-5 py-4 text-[14px]">
        {!enabled ? (
          <p className="text-muted">
            Lønnsomhetskalkulatoren er med i Profesjonell og Bedrift. <a href="/app/abonnement">Se planer</a>
          </p>
        ) : badge ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <RecommendationBadge value={badge.recommendation} />
              {badge.marginPct !== null ? <span className="num text-[13px]">Margin {fmtNumber(badge.marginPct)} % ved kontraktsverdi</span> : null}
            </p>
            <p className="text-[12px] text-muted">Oppdatert {relativeTime(badge.updatedAt)}</p>
            <a href={`/app/anbud/${tenderId}/lonnsomhet`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Åpne kalkylen
            </a>
          </>
        ) : (
          <a href={`/app/anbud/${tenderId}/lonnsomhet`} className={buttonVariants({ variant: 'primary', size: 'sm' })}>
            Regn på lønnsomhet
          </a>
        )}
      </div>
    </section>
  );
}

