/**
 * AnbudRadar Intelligence: én side per anbud med anbefaling (Go/No-Go), risiko, lønnsomhet, konkurranse,
 * handlingsplan og læring. Alt bygger på rapporten fra src/domain/intelligence – siden viser bare, den regner ikke.
 * Hvert punkt er merket Fakta, Beregning eller AI-vurdering, med kilde der den finnes.
 */
import type { ReactNode } from 'react';
import {
  LuArrowLeft,
  LuCalculator,
  LuCalendarClock,
  LuCircleCheck,
  LuCircleHelp,
  LuCircleX,
  LuExternalLink,
  LuFileDown,
  LuFileText,
  LuGauge,
  LuGraduationCap,
  LuInfo,
  LuListChecks,
  LuLock,
  LuShieldAlert,
  LuTarget,
  LuTrophy,
  LuTriangleAlert,
} from 'react-icons/lu';
import { REQUIREMENT_KIND_LABEL } from '@/domain/intelligence/build';
import type { Basis, IntelligenceReport, Level, PlanStep, Point, SourceRef, Verdict } from '@/domain/intelligence/types';
import { fmtKr, fmtNumber } from '@/domain/profit/calculator';
import { RECOMMENDATION_LABEL } from '@/domain/profit/recommendation';
import { displayBuyer } from '@/domain/tenders/market';
import { StripChart } from '../../charts';
import { Alert, Badge, buttonVariants, cn, Panel, PanelHeader } from '../../components';
import { useUi } from '../../context';
import { daysUntil, formatDate, formatDateTime } from '../../format';
import { compactNumber } from '@/i18n/format';
import { AppShell } from '../../layouts';

const BASIS: Record<Basis, { label: string; tone: 'ok' | 'info' | 'ai'; title: string }> = {
  fact: { label: 'Fakta', tone: 'ok', title: 'Står i kunngjøringen, et dokument, en publisert tildeling eller i deres egne data' },
  calculation: { label: 'Beregning', tone: 'info', title: 'Regnet ut av AnbudRadar fra fakta' },
  ai: { label: 'AI-vurdering', tone: 'ai', title: 'Vurdert av AI – kontroller mot kilden' },
};

const VERDICT: Record<Verdict, { icon: typeof LuCircleCheck; soft: string; text: string; border: string; bar: string }> = {
  go: { icon: LuCircleCheck, soft: 'bg-ok-soft', text: 'text-ok', border: 'border-ok/30', bar: 'bg-ok' },
  clarify: { icon: LuCircleHelp, soft: 'bg-urgent-soft', text: 'text-urgent', border: 'border-urgent/30', bar: 'bg-urgent' },
  no_go: { icon: LuCircleX, soft: 'bg-danger-soft', text: 'text-danger', border: 'border-danger/30', bar: 'bg-danger' },
  insufficient: { icon: LuInfo, soft: 'bg-navy-50', text: 'text-navy-800', border: 'border-line-strong', bar: 'bg-navy-600' },
};

const LEVEL_BAR: Record<Level, string> = { lav: 'bg-ok', middels: 'bg-urgent', høy: 'bg-danger' };
const LEVEL_TEXT: Record<Level, string> = { lav: 'text-ok', middels: 'text-urgent', høy: 'text-danger' };
/** Datagrunnlag: mye data er bra (grønn), lite er en advarsel (gul) – ikke rødt. */
const CONFIDENCE_BAR: Record<Level, string> = { høy: 'bg-ok', middels: 'bg-navy-600', lav: 'bg-urgent' };

const money = (n: number | null | undefined, currency: string) => (n === null || n === undefined ? 'Mangler' : currency === 'NOK' ? fmtKr(n) : `${fmtNumber(Math.round(n))} ${currency}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------------------------------------- Byggeklosser
function BasisTag({ basis }: { basis: Basis }) {
  const b = BASIS[basis];
  return (
    <Badge tone={b.tone} title={b.title} className="mr-1.5 px-1.5 py-0 align-[1px] text-[10.5px] uppercase tracking-[0.06em]">
      {b.label}
    </Badge>
  );
}

function SourceLine({ source }: { source: SourceRef | null | undefined }) {
  if (!source) return null;
  const where = [source.label, source.page ? `side ${source.page}` : null].filter(Boolean).join(', ');
  return (
    <div className="mt-1 text-[12.5px] leading-snug text-muted">
      <span className="inline-flex flex-wrap items-center gap-x-1.5">
        <LuFileText className="size-3.5 shrink-0" aria-hidden />
        {source.href ? (
          <a href={source.href} target="_blank" rel="noopener noreferrer" className="font-medium text-navy-700 hover:text-navy-900">
            {where} <LuExternalLink className="inline size-3" aria-hidden />
          </a>
        ) : (
          <span>{where}</span>
        )}
        {source.kind === 'ai' ? (
          <span className={source.verified ? 'text-ok' : 'text-urgent'}>· {source.verified ? 'sitatet er funnet i kilden' : 'sitatet er ikke funnet ordrett'}</span>
        ) : null}
      </span>
      {source.quote ? (
        <details className="mt-0.5">
          <summary className="inline-flex min-h-6 cursor-pointer select-none items-center text-[12.5px] font-medium text-navy-700">Vis utdrag</summary>
          <blockquote className="mt-1 border-l-2 border-line-strong pl-2.5 text-[13px] italic text-ink/80">«{source.quote}»</blockquote>
        </details>
      ) : null}
    </div>
  );
}

function Points({ points, icon, empty }: { points: Point[]; icon?: ReactNode; empty?: string }) {
  if (!points.length) return empty ? <p className="text-[13.5px] text-muted">{empty}</p> : null;
  return (
    <ul className="space-y-2.5">
      {points.map((p, i) => (
        <li key={i} className="flex gap-2.5">
          {icon ?? <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-line-strong" aria-hidden />}
          <div className="min-w-0 text-[14px] leading-snug text-ink">
            <BasisTag basis={p.basis} />
            {p.text}
            <SourceLine source={p.source} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Meter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-paper" aria-hidden>
      <div className={cn('h-full rounded-full', className ?? 'bg-navy-600')} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Locked({ what, plan }: { what: string; plan: string | undefined }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-line-strong bg-paper/50 px-4 py-3 text-[14px]">
      <LuLock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <p>
        {what} er med i {plan ?? 'en høyere plan'}.{' '}
        <a href="/app/abonnement" className="font-semibold">
          Se planene
        </a>
      </p>
    </div>
  );
}

function Section({ id, num, icon, title, description, children }: { id: string; num: string; icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <Panel>
      <div id={id} className="scroll-mt-24" />
      <PanelHeader
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[12.5px] font-bold text-white">{num}</span>
            <span className="flex items-center gap-1.5">
              {icon}
              {title}
            </span>
          </span>
        }
        description={description}
      />
      <div className="space-y-5 px-5 py-5">{children}</div>
    </Panel>
  );
}

function Sub({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- Beslutning
function DecisionHero({ r }: { r: IntelligenceReport }) {
  const d = r.decision;
  const v = VERDICT[d.verdict];
  const Icon = v.icon;
  return (
    <section className={cn('overflow-hidden rounded-2xl border bg-white shadow-[0_18px_50px_-36px_rgba(6,14,27,0.55)]', v.border)} aria-labelledby="anbefaling">
      <div className={cn('flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6', v.soft)}>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Anbefaling · Go/No-Go</p>
          <h2 id="anbefaling" className={cn('mt-1 flex items-center gap-2 font-serif text-[28px] font-semibold leading-tight sm:text-[32px]', v.text)}>
            <Icon className="size-7 shrink-0" aria-hidden /> {d.label}
          </h2>
          <p className="mt-1.5 max-w-3xl text-[15.5px] leading-snug text-ink">{d.headline}</p>
        </div>
        <div className="shrink-0 rounded-xl border border-line bg-white/80 px-4 py-3 sm:w-72">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Datagrunnlag</p>
          <p className="mt-0.5 text-[15px] font-semibold text-night">
            {cap(d.confidence.level)} <span className="text-[13px] font-normal text-muted">({d.confidence.score} av {d.confidence.max})</span>
          </p>
          <div className="mt-2">
            <Meter value={d.confidence.score} max={d.confidence.max} className={CONFIDENCE_BAR[d.confidence.level]} />
          </div>
          <ul className="mt-2.5 space-y-1">
            {d.coverage.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="flex items-center gap-1.5 text-ink">
                  {c.available ? <LuCircleCheck className="size-3.5 text-ok" aria-hidden /> : <span className="size-3.5 rounded-full border border-line-strong" aria-hidden />}
                  {c.label}
                </span>
                <span className="text-right text-muted">{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 px-5 py-5 sm:px-6 lg:grid-cols-3">
        {d.blockers.length ? (
          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-danger">
              <LuCircleX className="size-4" aria-hidden /> Hindringer
            </h3>
            <Points points={d.blockers} icon={<LuCircleX className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />} />
          </div>
        ) : null}
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-ok">
            <LuCircleCheck className="size-4" aria-hidden /> Grunner for
          </h3>
          <Points points={d.reasons.slice(0, 6)} icon={<LuCircleCheck className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />} empty="Ingen tydelige grunner for ennå." />
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-urgent">
            <LuTriangleAlert className="size-4" aria-hidden /> Må avklares
          </h3>
          <Points points={d.concerns.slice(0, 7)} icon={<LuTriangleAlert className="mt-0.5 size-4 shrink-0 text-urgent" aria-hidden />} empty="Ingenting vesentlig å avklare." />
        </div>
        {d.missing.length ? (
          <div className={d.blockers.length ? 'lg:col-span-3' : ''}>
            <h3 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-semibold text-navy-800">
              <LuInfo className="size-4" aria-hidden /> Dette ville gjort vurderingen sikrere
            </h3>
            <ul className="space-y-1.5 text-[14px]">
              {d.missing.map((m) => (
                <li key={m.text}>{m.href ? <a href={m.href}>{m.text}</a> : m.text}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Tiles({ r }: { r: IntelligenceReport }) {
  const at = r.profit.calc?.atContractValue ?? null;
  const tiles: { href: string; icon: ReactNode; label: string; value: string; hint: string; tone?: string }[] = [
    {
      href: '#passer',
      icon: <LuTarget className="size-4" aria-hidden />,
      label: 'Passer',
      value: r.fit.score !== null ? `${r.fit.score}/100` : r.fit.availability === 'locked' ? 'Låst' : '–',
      hint: r.fit.level === 'ukjent' ? (r.fit.availability === 'no_profile' ? 'Profilen mangler' : 'Ikke regnet ut') : `${cap(r.fit.level)} treff`,
    },
    { href: '#risiko', icon: <LuShieldAlert className="size-4" aria-hidden />, label: 'Risiko', value: `${r.risk.score}/100`, hint: `${cap(r.risk.level)} risiko`, tone: LEVEL_TEXT[r.risk.level] },
    {
      href: '#lonnsomhet',
      icon: <LuCalculator className="size-4" aria-hidden />,
      label: 'Lønnsomhet',
      value: at ? `${fmtNumber(at.marginPct)} %` : r.profit.availability === 'locked' ? 'Låst' : '–',
      hint: at ? 'Margin ved kontraktsverdi' : r.profit.availability === 'no_costs' ? 'Kostnader mangler' : r.profit.availability === 'locked' ? 'Ikke i planen' : 'Kontraktsverdi ukjent',
    },
    {
      href: '#konkurranse',
      icon: <LuTrophy className="size-4" aria-hidden />,
      label: 'Konkurranse',
      value: r.competition.availability === 'locked' ? 'Låst' : r.competition.bids ? fmtNumber(r.competition.bids.median) : String((r.competition.buyer?.contracts ?? 0) + (r.competition.similar?.contracts ?? 0)),
      hint: r.competition.availability === 'locked' ? 'Ikke i planen' : r.competition.bids ? 'Tilbud i lignende (median)' : 'Kontrakter med kjent vinner',
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <a key={t.label} href={t.href} className="block rounded-2xl border border-line bg-white px-4 py-3.5 text-ink no-underline shadow-[0_1px_2px_rgba(6,14,27,0.04)] hover:border-line-strong">
          <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
            {t.icon} {t.label}
          </span>
          <span className={cn('num mt-1 block text-[24px] font-semibold leading-tight text-night', t.tone)}>{t.value}</span>
          <span className="block text-[12.5px] text-muted">{t.hint}</span>
        </a>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------- Seksjoner
function FitSection({ r }: { r: IntelligenceReport }) {
  const f = r.fit;
  return (
    <Section id="passer" num="1" icon={<LuTarget className="size-4 text-navy-600" aria-hidden />} title="Passer det for oss?" description="Treff mot bedriftsprofilen, kvalifikasjoner, geografi og kapasitet.">
      {f.availability === 'locked' ? <Locked what="Treff mot bedriftsprofilen" plan={r.lockedPlans.fit} /> : null}
      {f.availability === 'no_profile' ? (
        <Alert tone="warning" title="Bedriftsprofilen mangler">
          <a href="/app/profil">Fyll ut profilen</a>, så regner vi ut hvor godt anbudet passer.
        </Alert>
      ) : null}
      {f.availability === 'ok' && f.score === null ? <p className="text-[14px] text-muted">Treffet er ikke regnet ut for dette anbudet ennå.</p> : null}
      {f.score !== null ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Sub title={`Treff ${f.score} av 100`} aside={<BasisTag basis="calculation" />}>
            <ul className="space-y-2">
              {f.components.map((c) => (
                <li key={c.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3rem] items-center gap-3 text-[13.5px]">
                  <span className="truncate text-ink">{c.label}</span>
                  <Meter value={c.value} max={c.max} />
                  <span className="num text-right text-muted">
                    {c.value}/{c.max}
                  </span>
                </li>
              ))}
            </ul>
            {f.uncertainty ? (
              <p className="mt-2 text-[12.5px] text-muted">
                Usikkerhet: {f.uncertainty.level}
                {f.uncertainty.reasons[0] ? ` – ${f.uncertainty.reasons[0]}` : ''}
              </p>
            ) : null}
          </Sub>
          <div className="space-y-4">
            <Sub title="Det som passer">
              <Points points={f.strengths.slice(0, 5)} empty="Ingen tydelige treff mot profilen." />
            </Sub>
            <Sub title="Avvik og mangler">
              <Points points={f.gaps.slice(0, 6)} empty="Ingen avvik funnet." />
            </Sub>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Sub title="Kvalifikasjoner som nevnes" aside={<BasisTag basis="fact" />}>
          {f.qualifications.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {f.qualifications.map((q) => (
                <li key={q.label} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
                  <span className="min-w-0">
                    {q.label} {q.legal ? <Badge tone="marker">Lovpålagt</Badge> : null}
                  </span>
                  {q.have ? <Badge tone="ok">Har ({q.via === 'bemanning' ? 'bemanning' : 'profil'})</Badge> : <Badge tone="danger">Mangler</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted">Ingen kjente sertifiseringer eller godkjenninger er nevnt i teksten vi har lest.</p>
          )}
          {f.turnover ? (
            <p className="mt-2 text-[13.5px]">
              Omsetningskrav: minst <span className="num font-semibold">{fmtKr(f.turnover.required)}</span> · profilen: {f.turnover.have !== null ? fmtKr(f.turnover.have) : 'ikke oppgitt'}{' '}
              {f.turnover.ok === false ? <Badge tone="danger">Under kravet</Badge> : f.turnover.ok ? <Badge tone="ok">Oppfylt</Badge> : null}
            </p>
          ) : null}
        </Sub>
        <Sub title="Sted og kapasitet">
          <p className="text-[13.5px] text-ink">
            <BasisTag basis="fact" />
            {f.regions.names.length ? `${f.regions.names.slice(0, 5).join(', ')}${f.regions.names.length > 5 ? ` og ${f.regions.names.length - 5} til` : ''}` : 'Sted ikke oppgitt'}
            {f.regions.inProfile === true ? ' – i området dere dekker.' : f.regions.inProfile === false ? ' – utenfor områdene i profilen.' : '.'}
          </p>
          <p className="mt-2 text-[13.5px] text-ink">
            <BasisTag basis="calculation" />
            {f.capacity
              ? `Kapasitet: ${f.capacity.status}${f.capacity.gapHoursPerYear ? `, mangler ca. ${fmtNumber(f.capacity.gapHoursPerYear)} timer per år` : ''}.`
              : 'Kapasiteten regnes ut når timene er lagt inn i Lønnsomhet.'}
          </p>
        </Sub>
      </div>
      {f.ai ? (
        <div className="rounded-xl border border-ai/20 bg-ai-soft/60 px-4 py-3">
          <p className="text-[13.5px] font-semibold text-navy-900">
            AI-vurdering av egnethet: {f.ai.fit} {f.ai.isMock ? <Badge tone="outline">Simulert – testmodus</Badge> : null}
          </p>
          <p className="mt-1 text-[14px]">{f.ai.overall}</p>
          {f.ai.unfulfilled.length ? (
            <div className="mt-2">
              <Points points={f.ai.unfulfilled.slice(0, 4)} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function RiskGauge({ score, level }: { score: number; level: Level }) {
  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full" aria-hidden>
        <div className="absolute inset-y-0 left-0 w-1/4 bg-ok/25" />
        <div className="absolute inset-y-0 left-1/4 w-1/4 bg-urgent/25" />
        <div className="absolute inset-y-0 left-1/2 w-1/2 bg-danger/20" />
        <div className={cn('absolute inset-y-0 left-0 rounded-full', LEVEL_BAR[level])} style={{ width: `${Math.max(2, score)}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11.5px] text-muted" aria-hidden>
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  );
}

function RiskSection({ r }: { r: IntelligenceReport }) {
  const k = r.risk;
  const groups: { title: string; points: Point[]; count: number }[] = [
    { title: `${REQUIREMENT_KIND_LABEL.avvisning} og minstekrav`, points: k.rejection, count: k.counts.avvisning + k.counts.minstekrav },
    { title: 'Dokumentasjon og kvalifikasjon', points: k.documentation, count: k.counts.kvalifikasjon + k.counts.innlevering },
    { title: REQUIREMENT_KIND_LABEL.befaring, points: k.siteVisit, count: k.counts.befaring },
  ];
  return (
    <Section id="risiko" num="2" icon={<LuShieldAlert className="size-4 text-navy-600" aria-hidden />} title="Risiko" description="Krav, frister, dokumentasjon, avvisningsgrunner og kontraktsvilkår – med kilde og side.">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-muted">Risikoscore</p>
          <p className={cn('num mt-0.5 text-[34px] font-semibold leading-none', LEVEL_TEXT[k.level])}>
            {k.score}
            <span className="text-[16px] font-normal text-muted"> / 100</span>
          </p>
          <p className="mb-2 mt-1 text-[13.5px] font-semibold">{cap(k.level)} risiko</p>
          <RiskGauge score={k.score} level={k.level} />
          <p className="mt-2 text-[12.5px] leading-snug text-muted">
            <BasisTag basis="calculation" />
            Summen av faktorene (tak 100): under 25 lav, 25–49 middels, 50+ høy. Ikke en sannsynlighet.
          </p>
        </div>
        <div>
          {k.factors.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {k.factors.map((f) => (
                <li key={f.key} className="px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn('num rounded-md px-1.5 text-[12.5px] font-bold', f.severity === 'høy' ? 'bg-danger-soft text-danger' : f.severity === 'middels' ? 'bg-urgent-soft text-urgent' : 'bg-paper text-muted')}>+{f.points}</span>
                    <span className="text-[14px] font-semibold text-night">{f.label}</span>
                    {f.blocker ? <Badge tone="danger">Hindring</Badge> : null}
                    <BasisTag basis={f.basis} />
                  </div>
                  <p className="mt-1 text-[13.5px] leading-snug text-ink">{f.explanation}</p>
                  {f.sources.slice(0, 2).map((s, i) => (
                    <SourceLine key={i} source={s} />
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[14px] text-muted">Ingen risikofaktorer funnet i det vi har lest.</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Sub title="Frister" aside={<BasisTag basis="fact" />}>
          {k.deadlines.length ? (
            <ul className="space-y-1.5">
              {k.deadlines.map((d) => {
                const days = daysUntil(d.at);
                return (
                  <li key={d.key} className="flex items-center justify-between gap-3 text-[13.5px]">
                    <span className="flex items-center gap-1.5">
                      <LuCalendarClock className="size-4 text-navy-600" aria-hidden /> {d.label}
                    </span>
                    <span className="num text-right font-semibold">
                      {formatDateTime(d.at, d.timeKnown)}
                      {days !== null && days >= 0 ? <span className="ml-1.5 font-normal text-muted">({days} d)</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13.5px] text-muted">Ingen frister er oppgitt i kunngjøringen.</p>
          )}
        </Sub>
        <Sub title="Det vi har lest">
          <p className="text-[13.5px]">
            {k.read.noticeOnly ? (
              <>
                Bare kunngjøringen. <a href={`/app/anbud/${r.tender.id}#dokumenter-for-analyse`}>Last opp konkurransegrunnlaget</a> for alle krav og vilkår.
              </>
            ) : (
              <>
                Kunngjøringen og {k.read.documents} dokumenter ({k.read.pages} sider).
              </>
            )}
            {k.read.notReadable.length ? <span className="text-urgent"> Kunne ikke lese: {k.read.notReadable.join(', ')}.</span> : null}
          </p>
        </Sub>
      </div>

      <div className="space-y-2">
        {groups.map((g) => (
          <details key={g.title} className="group rounded-xl border border-line" open={g === groups[0] && g.points.length > 0}>
            <summary className="flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 px-4 py-2.5 text-[14px] font-semibold text-night">
              <span>{g.title}</span>
              <Badge tone={g.count ? 'neutral' : 'outline'}>{g.count}</Badge>
            </summary>
            <div className="border-t border-line px-4 py-3">
              <Points points={g.points} empty="Ingen setninger funnet." />
              {g.count > g.points.length ? (
                <p className="mt-2 text-[12.5px] text-muted">
                  Viser {g.points.length} av {g.count}. <a href={`/app/anbud/${r.tender.id}#krav`}>Se alle på anbudssiden</a>.
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>

      {k.terms.length ? (
        <Sub title="Kontraktsvilkår som kan koste" aside={<BasisTag basis="fact" />}>
          <ul className="space-y-3">
            {k.terms.map((t) => (
              <li key={t.category}>
                <p className="text-[14px] font-semibold text-night">{t.label}</p>
                {t.points.slice(0, 1).map((p, i) => (
                  <div key={i} className="text-[13.5px] text-ink">
                    <p className="line-clamp-3">{p.text}</p>
                    <SourceLine source={p.source ? { ...p.source, quote: null } : null} />
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </Sub>
      ) : null}
      {k.contractFindings.length ? (
        <Sub title="Kontraktsrisiko vurdert av AI (fra Lønnsomhet)">
          <Points points={k.contractFindings.slice(0, 6).map((f) => ({ ...f, text: `${f.text}${f.consequence ? ` ${f.consequence}` : ''}` }))} />
        </Sub>
      ) : null}
      {k.ai ? (
        <Sub title={`AI-analysen${k.ai.isMock ? ' (simulert – testmodus)' : ''}`} aside={<span className="text-[12.5px] text-muted">{formatDate(k.ai.at)}</span>}>
          <Points points={k.ai.points.slice(0, 6)} />
        </Sub>
      ) : null}
    </Section>
  );
}

function ProfitSection({ r }: { r: IntelligenceReport }) {
  const p = r.profit;
  const c = p.calc;
  const cur = p.currency;
  const link = `/app/anbud/${r.tender.id}/lonnsomhet`;
  // 0 % er det samme som «Som kalkulert» – vises én gang.
  const sens = c ? c.sensitivity.filter((s) => s.increasePct > 0 && s.profitAtContractValue !== null) : [];
  const maxAbs = c?.atContractValue ? Math.max(Math.abs(c.atContractValue.profit), ...sens.map((s) => Math.abs(s.profitAtContractValue!)), 1) : 1;
  return (
    <Section id="lonnsomhet" num="3" icon={<LuCalculator className="size-4 text-navy-600" aria-hidden />} title="Lønnsomhet" description="Fra kalkylen deres og publiserte tildelinger. Ingen anslag fylles inn.">
      {p.availability === 'locked' ? <Locked what="Lønnsomhetskalkulatoren" plan={r.lockedPlans.profit} /> : null}
      {p.availability === 'no_costs' ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-paper/50 px-4 py-3">
          <p className="text-[14px]">Kostnadene er ikke lagt inn. Legg inn timer, materialer og utstyr, så regner vi ut selvkost, minstepris, målpris og margin.</p>
          <a href={link} className={buttonVariants({ size: 'sm' })}>
            Legg inn kostnader
          </a>
        </div>
      ) : null}
      {c ? (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Selvkost', money(c.breakEven, cur)],
              ['Minstepris', money(c.minPrice, cur)],
              ['Målpris', money(c.targetPrice, cur)],
              ['Ved kontraktsverdi', c.atContractValue ? `${fmtNumber(c.atContractValue.marginPct)} % margin` : 'Verdi ukjent'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-paper px-3.5 py-3">
                <dt className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{label}</dt>
                <dd className="num mt-1 text-[17px] font-semibold text-night">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="-mt-2 text-[12.5px] text-muted">
            <BasisTag basis="calculation" />
            Regnet ut fra kostnadene deres{c.completeness.aiLines ? ` (${c.completeness.aiLines} mengder er AI-estimater – kontroller dem)` : ''}. <a href={link}>Åpne kalkylen</a>
          </p>
          {sens.length && c.atContractValue ? (
            <Sub title="Følsomhet: fortjeneste ved kontraktsverdien" aside={<BasisTag basis="calculation" />}>
              <ul className="space-y-2">
                {[{ label: 'Som kalkulert', v: c.atContractValue.profit }, ...sens.map((s) => ({ label: `+${s.increasePct} % kostnader`, v: s.profitAtContractValue! }))].map((row) => (
                  <li key={row.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_7.5rem] items-center gap-3 text-[13.5px]">
                    <span className="truncate">{row.label}</span>
                    <Meter value={Math.abs(row.v)} max={maxAbs} className={row.v >= 0 ? 'bg-ok' : 'bg-danger'} />
                    <span className={cn('num text-right font-semibold', row.v < 0 ? 'text-danger' : 'text-night')}>{money(row.v, cur)}</span>
                  </li>
                ))}
              </ul>
            </Sub>
          ) : null}
          {p.recommendation ? (
            <Sub title={`Anbefaling i Lønnsomhet: ${RECOMMENDATION_LABEL[p.recommendation.recommendation]}`}>
              <Points points={p.recommendation.reasons.slice(0, 5).map((text) => ({ text, basis: 'calculation' as const }))} />
            </Sub>
          ) : null}
        </>
      ) : null}
      {p.market ? (
        <Sub title={`Markedspris · ${p.market.n} tildelinger${p.market.label ? ` ${p.market.label}` : ''}`} aside={<BasisTag basis="calculation" />}>
          {p.market.stats ? (
            <>
              <StripChart
                points={p.market.values.map((v) => ({ value: v, tip: money(v, cur) }))}
                band={{ p25: p.market.stats.p25, median: p.market.stats.median, p75: p.market.stats.p75 }}
                markers={p.market.positions.map((pos) => ({ label: pos.label, value: pos.value, tip: money(pos.value, cur) }))}
                summary={`Median ${money(p.market.stats.median, cur)}, midterste halvdel ${money(p.market.stats.p25, cur)} til ${money(p.market.stats.p75, cur)}.`}
                axisLabel={(n) => compactNumber('nb', n)}
              />
              <p className="mt-2 text-[13.5px]">
                Median <span className="num font-semibold">{money(p.market.stats.median, cur)}</span>
                {p.market.unit === 'per_year' ? ' per år' : ''} · midterste halvdel {money(p.market.stats.p25, cur)} – {money(p.market.stats.p75, cur)}
              </p>
              {p.market.positions.map((pos) => (
                <p key={pos.key} className="text-[13.5px] text-ink">
                  {pos.label} {money(pos.value, cur)}: lavere enn {fmtNumber(pos.cheaperThanPct)} % av tildelingene.
                </p>
              ))}
              {p.market.strength === 'few' ? <p className="mt-1 text-[12.5px] text-urgent">Få sammenlignbare ({p.market.n}) – bruk tallene som en pekepinn.</p> : null}
            </>
          ) : (
            <p className="text-[13.5px] text-muted">For få sammenlignbare tildelinger ({p.market.n}) til å regne markedspris.</p>
          )}
          {p.market.excluded.frameworks || p.market.excluded.otherCurrency ? (
            <p className="mt-1 text-[12.5px] text-muted">
              Holdt utenfor: {p.market.excluded.frameworks} rammeavtaler (verdien er ofte et tak), {p.market.excluded.otherCurrency} i annen valuta.
            </p>
          ) : null}
        </Sub>
      ) : null}
      {p.calcAccuracy ? (
        <p className="text-[13.5px]">
          <BasisTag basis="calculation" />
          Tidligere kalkyler: målprisen har i median ligget {fmtNumber(Math.abs(p.calcAccuracy.medianPct))} % {p.calcAccuracy.medianPct >= 0 ? 'over' : 'under'} prisen som vant ({p.calcAccuracy.n} anbud).
        </p>
      ) : null}
    </Section>
  );
}

function WinnerTable({ rows, linkable }: { rows: { supplierId: string; name: string; wins: number; lastWin: Date | null; beatUs: number }[]; linkable: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {rows.map((w) => (
        <li key={w.supplierId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3.5 py-2 text-[13.5px]">
          <span className="min-w-0">
            {linkable ? <a href={`/app/konkurrenter/leverandor/${w.supplierId}`}>{displayBuyer(w.name)}</a> : displayBuyer(w.name)}{' '}
            {w.beatUs ? <Badge tone="urgent">Har slått dere {w.beatUs}×</Badge> : null}
          </span>
          <span className="num text-muted">
            <span className="font-semibold text-night">{w.wins}</span> {w.wins === 1 ? 'kontrakt' : 'kontrakter'}
            {w.lastWin ? ` · ${formatDate(w.lastWin)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CompetitionSection({ r }: { r: IntelligenceReport }) {
  const c = r.competition;
  return (
    <Section id="konkurranse" num="4" icon={<LuTrophy className="size-4 text-navy-600" aria-hidden />} title="Konkurranse" description="Bare publiserte tildelinger, siste fem år. Mange anskaffelser publiseres uten tildeling.">
      {c.availability === 'locked' ? (
        <Locked what="Konkurranseinnsikt" plan={r.lockedPlans.competition} />
      ) : (
        <>
          {c.thisTender.length ? (
            <Sub title="Tildelt i dette anbudet" aside={<BasisTag basis="fact" />}>
              <ul className="space-y-1 text-[14px]">
                {c.thisTender.map((a, i) => (
                  <li key={i}>
                    {displayBuyer(a.name)} {a.isUs ? <Badge tone="ok">Dere</Badge> : null}
                    {a.value !== null ? <span className="num text-muted"> · {money(a.value, a.currency ?? r.tender.currency)}</span> : null}
                  </li>
                ))}
              </ul>
            </Sub>
          ) : null}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Sub title={`Hos oppdragsgiveren, samme bransje${c.buyer ? ` · ${c.buyer.contracts} kontrakter` : ''}`} aside={<BasisTag basis="fact" />}>
              {c.buyer?.winners.length ? <WinnerTable rows={c.buyer.winners} linkable /> : <p className="text-[13.5px] text-muted">Ingen publiserte tildelinger hos oppdragsgiveren i samme bransje.</p>}
            </Sub>
            <Sub title={`Lignende kontrakter${c.similar ? ` · ${c.similar.contracts}` : ''}`} aside={<BasisTag basis="fact" />}>
              {c.similar?.winners.length ? (
                <>
                  <p className="mb-2 text-[12.5px] text-muted">{c.similar.label}</p>
                  <WinnerTable rows={c.similar.winners} linkable />
                </>
              ) : (
                <p className="text-[13.5px] text-muted">Ingen publiserte tildelinger for lignende kontrakter.</p>
              )}
            </Sub>
          </div>
          <p className="text-[13.5px]">
            <BasisTag basis="calculation" />
            {c.bids
              ? `Lignende konkurranser fikk median ${fmtNumber(c.bids.median)} tilbud (fra ${c.bids.min} til ${c.bids.max}, ${c.bids.n} konkurranser ${c.bids.label}).`
              : 'Antall tilbud er ikke oppgitt i nok lignende konkurranser til å si noe om konkurransen.'}
          </p>
        </>
      )}
    </Section>
  );
}

function LearningSection({ r }: { r: IntelligenceReport }) {
  const l = r.learning;
  const card = (title: string, g: typeof l.sameBuyer) => (
    <div className="rounded-xl bg-paper px-4 py-3">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</p>
      <p className="num mt-1 text-[15px] text-night">
        <span className="font-semibold">{g.won}</span> vunnet · <span className="font-semibold">{g.lost}</span> ikke vunnet{g.pending ? ` · ${g.pending} venter` : ''}
      </p>
      <p className="text-[12.5px] text-muted">{g.winRatePct !== null && g.won + g.lost >= l.minDecided ? `${fmtNumber(g.winRatePct)} % vunnet av avgjorte` : `${g.delivered} levert`}</p>
    </div>
  );
  return (
    <Section id="laering" num="6" icon={<LuGraduationCap className="size-4 text-navy-600" aria-hidden />} title="Læring fra resultatene deres" description={`Brukes når minst ${l.minDecided} tilbud er avgjort – færre gir tilfeldige tall.`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {card('Hos denne oppdragsgiveren', l.sameBuyer)}
        {card('I lignende anbud', l.similar)}
      </div>
      {l.insights.length ? <Points points={l.insights} /> : null}
      {l.applied.length ? (
        <Sub title="Slik påvirket det vurderingen">
          <ul className="list-disc space-y-1 pl-5 text-[14px]">
            {l.applied.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Sub>
      ) : (
        <p className="text-[13.5px] text-muted">
          Ikke nok avgjorte tilbud til at resultatene påvirker vurderingen ennå. <a href="/app/resultater">Registrer vunnet og tapt</a> på leverte tilbud.
        </p>
      )}
    </Section>
  );
}

function PlanPanel({ r }: { r: IntelligenceReport }) {
  return (
    <Panel>
      <div id="plan" className="scroll-mt-24" />
      <PanelHeader
        title={
          <span className="flex items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-[12.5px] font-bold text-white">5</span>
            <LuListChecks className="size-4 text-navy-600" aria-hidden /> Handlingsplan
          </span>
        }
        description={r.decision.verdict === 'no_go' ? 'Hvis dere likevel går videre.' : 'Stegene i rekkefølge, med frist der den finnes.'}
      />
      {r.plan.length ? (
        <ol className="space-y-0 px-4 py-3">
          {r.plan.map((s, i) => (
            <PlanItem key={s.key} s={s} n={i + 1} last={i === r.plan.length - 1} />
          ))}
        </ol>
      ) : (
        <p className="px-5 py-4 text-[14px] text-muted">Fristen har gått ut – ingen steg gjenstår.</p>
      )}
    </Panel>
  );
}

function PlanItem({ s, n, last }: { s: PlanStep; n: number; last: boolean }) {
  const external = s.href?.startsWith('http');
  return (
    <li className="relative flex gap-3 pb-4">
      {!last ? <span className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-line" aria-hidden /> : null}
      <span
        className={cn(
          'relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold',
          s.done ? 'bg-ok text-white' : s.priority === 'høy' ? 'bg-navy-900 text-white' : 'border border-line-strong bg-white text-navy-800',
        )}
      >
        {s.done ? <LuCircleCheck className="size-4" aria-label="Gjort" /> : n}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={cn('text-[14px] font-semibold leading-snug', s.done ? 'text-muted line-through' : 'text-night')}>{s.title}</p>
        {s.due ? (
          <p className="mt-0.5 text-[12.5px]">
            <span className={cn('num font-semibold', s.dueBasis === 'fact' ? 'text-navy-800' : 'text-muted')}>{formatDateTime(s.due, s.dueBasis === 'fact')}</span>
            <span className="text-muted">{s.dueBasis === 'calculation' ? ' · foreslått' : ' · frist'}</span>
          </p>
        ) : null}
        {s.detail ? <p className="mt-0.5 line-clamp-4 text-[13px] leading-snug text-muted">{s.detail}</p> : null}
        {s.href ? (
          <a href={s.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className="mt-1 inline-flex min-h-6 items-center gap-1 text-[13px] font-semibold">
            {s.hrefLabel ?? 'Åpne'} {external ? <LuExternalLink className="size-3.5" aria-hidden /> : null}
          </a>
        ) : null}
      </div>
    </li>
  );
}

function Method({ r }: { r: IntelligenceReport }) {
  return (
    <Panel>
      <details>
        <summary className="flex min-h-12 cursor-pointer select-none items-center gap-2 px-5 py-3 text-[14.5px] font-semibold text-night">
          <LuGauge className="size-4 text-navy-600" aria-hidden /> Slik er vurderingen laget
        </summary>
        <div className="space-y-2 border-t border-line px-5 py-4 text-[14px] leading-relaxed">
          <p>
            <BasisTag basis="fact" />
            står i kunngjøringen, et dokument, en publisert tildeling eller i deres egne data – med kilde og side der den finnes.
          </p>
          <p>
            <BasisTag basis="calculation" />
            er regnet ut av AnbudRadar fra fakta: treffet mot profilen, risikoscoren, kalkylen, markedsprisen og antall tilbud.
          </p>
          <p>
            <BasisTag basis="ai" />
            er en AI-vurdering, merket med om sitatet ble funnet ordrett i kilden.
            {r.ai.mode === 'off' ? ' AI er ikke slått på – denne vurderingen bygger bare på fakta og beregninger.' : r.ai.mode === 'mock' ? ' AI-svarene her er simulert (testmodus).' : ''}
          </p>
          <p>
            Anbefalingen: en hindring (frist ute eller under to døgn, utelukket av profilen, lovpålagt godkjenning mangler, tap ved kontraktsverdien) gir «Ikke gå videre». Uten
            profil og kalkyle: «For lite grunnlag». Svakt treff (under 40): «Ikke gå videre». Godt treff (60+) uten høy risiko og uten «Høy risiko» i Lønnsomhet: «Gå videre».
            Ellers «Avklar først».
          </p>
          <p className="text-muted">AnbudRadar anslår ikke sannsynligheten for å vinne. Kontroller kravene mot konkurransegrunnlaget før dere leverer.</p>
        </div>
      </details>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------- Siden
export function IntelligencePage({ report: r }: { report: IntelligenceReport }) {
  const { org } = useUi();
  const t = r.tender;
  const days = daysUntil(t.deadlineAt);
  return (
    <AppShell wide>
      <a href={`/app/anbud/${t.id}`} className="mb-4 inline-flex min-h-6 items-center gap-1.5 text-[13px] font-semibold text-muted no-underline hover:text-navy-900">
        <LuArrowLeft className="size-4" aria-hidden /> Til anbudet
      </a>
      <header className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-navy-700">
            <LuGauge className="size-4" aria-hidden /> AnbudRadar Intelligence
          </p>
          <h1 className="mt-1 max-w-4xl font-serif text-[24px] font-semibold leading-tight text-navy-900 sm:text-[30px]">{t.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-muted">
            <span>{t.buyerName ?? 'Oppdragsgiver ikke oppgitt'}</span>
            <span>
              {t.deadlineKind === 'participation' ? 'Frist for å be om å delta' : 'Tilbudsfrist'}:{' '}
              <span className="num font-semibold text-ink">{t.deadlineAt ? formatDateTime(t.deadlineAt, t.deadlineTimeKnown) : 'ikke oppgitt'}</span>
              {days !== null && days >= 0 ? ` (${days} dager)` : ''}
            </span>
            {t.sources.map((s) => (
              <span key={`${s.source}-${s.noticeId}`}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.source === 'doffin' ? 'Doffin' : s.source === 'ted' ? 'TED' : s.source} {s.noticeId}
                  </a>
                ) : (
                  `${s.source} ${s.noticeId}`
                )}
              </span>
            ))}
            {t.isSample ? <Badge tone="sample">Eksempeldata</Badge> : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <a href={`/app/anbud/${t.id}/intelligence/pdf`} className={buttonVariants({ size: 'sm', className: 'h-9' })}>
            <LuFileDown className="size-4" aria-hidden /> Last ned PDF
          </a>
          {org?.entitlements.profitCalculator ? (
            <a href={`/app/anbud/${t.id}/lonnsomhet`} className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'h-9' })}>
              Lønnsomhet
            </a>
          ) : null}
          <a href={`/app/anbud/${t.id}`} className={buttonVariants({ variant: 'secondary', size: 'sm', className: 'h-9' })}>
            Anbudet
          </a>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <span>Merking:</span>
        <BasisTag basis="fact" />
        <BasisTag basis="calculation" />
        <BasisTag basis="ai" />
        <span>{r.ai.mode === 'off' ? 'AI er ikke slått på – alt bygger på fakta og beregninger.' : r.ai.mode === 'mock' ? 'AI-svar er simulert (testmodus).' : ''}</span>
      </div>

      <div className="space-y-5">
        <DecisionHero r={r} />
        <Tiles r={r} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5 lg:order-2">
            <div className="lg:sticky lg:top-24">
              <PlanPanel r={r} />
            </div>
          </div>
          <div className="min-w-0 space-y-5 lg:order-1">
            <FitSection r={r} />
            <RiskSection r={r} />
            <ProfitSection r={r} />
            <CompetitionSection r={r} />
            <LearningSection r={r} />
            <Method r={r} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
