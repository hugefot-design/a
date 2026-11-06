import { displayBuyer } from '@/domain/tenders/market';
import type { ReactNode } from 'react';
import { LuBookmark, LuBookmarkCheck, LuBuilding2, LuCircleAlert, LuCircleCheck, LuCircleX, LuInfo, LuMapPin } from 'react-icons/lu';
import { INDUSTRY_BY_ID, REGION_BY_CODE, STATUS_LABELS } from '@/domain/reference';
import type { TenderListItem } from '@/domain/tenders/queries';
import type { MatchBreakdown } from '@/domain/matching/engine';
import type { PointTone, Screening, ScreeningVerdict } from '@/domain/matching/screening';
import { Badge, cn, CsrfField, DeadlineChip, SampleBadge, ScoreBar, SourceTag } from './components';
import { formatMoney } from './format';

export function StatusBadge({ status }: { status: string }) {
  if (status === 'open') return null;
  const tone = status === 'cancelled' || status === 'withdrawn' ? 'danger' : status === 'awarded' ? 'info' : status === 'planned' ? 'ai' : 'outline';
  return <Badge tone={tone}>{STATUS_LABELS[status] ?? status}</Badge>;
}

export function BookmarkButton({ tenderId, bookmarked, compact = false }: { tenderId: string; bookmarked: boolean; compact?: boolean }) {
  return (
    <form method="post" action={`/app/anbud/${tenderId}/bokmerke`} data-bookmark>
      <CsrfField />
      <button
        type="submit"
        aria-pressed={bookmarked}
        title={bookmarked ? 'Fjern fra lagrede anbud' : 'Lagre anbudet'}
        className={cn(
          'group inline-flex items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold',
          compact ? 'h-8' : 'h-9',
          'border-line-strong bg-white text-navy-900 hover:border-navy-300 aria-pressed:border-navy-900 aria-pressed:bg-navy-900 aria-pressed:text-white',
        )}
      >
        <LuBookmark className="size-4 group-aria-pressed:hidden" aria-hidden />
        <LuBookmarkCheck className="hidden size-4 group-aria-pressed:block" aria-hidden />
        <span data-label>{bookmarked ? 'Lagret' : 'Lagre'}</span>
      </button>
    </form>
  );
}

/**
 * Stedet i listene. Et anbud kan gjelde mange fylker; da står «Oslo + 12 fylker» (med alle i
 * verktøytipset), så det er tydelig hvorfor anbudet dukker opp når man filtrerer på et annet fylke.
 */
export function placeLabel(place: string | null, regions: string[]): { label: string | null; all: string | null } {
  const names = regions.map((r) => REGION_BY_CODE.get(r)?.name).filter((n): n is string => Boolean(n));
  const nicePlace = place ? displayBuyer(place) : null;
  if (names.length >= 3) return { label: `${names[0]} + ${names.length - 1} fylker`, all: names.join(', ') };
  if (names.length === 2) return { label: names.join(', '), all: null };
  return { label: nicePlace ?? names[0] ?? null, all: null };
}

export function TenderMeta({ buyer, place, regions }: { buyer: string | null; place: string | null; regions: string[] }) {
  const { label: location, all } = placeLabel(place, regions);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      {buyer ? (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LuBuilding2 className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{buyer}</span>
        </span>
      ) : null}
      {location ? (
        <span className="inline-flex items-center gap-1.5" title={all ?? undefined}>
          <LuMapPin className="size-3.5 shrink-0" aria-hidden />
          {location}
        </span>
      ) : null}
    </div>
  );
}

const VERDICT_TONE: Record<ScreeningVerdict, 'ok' | 'urgent' | 'danger'> = { se_paa: 'ok', sjekk: 'urgent', passer_ikke: 'danger' };
const POINT_ICON: Record<PointTone, ReactNode> = {
  stop: <LuCircleX className="size-4 text-danger" aria-hidden />,
  warn: <LuCircleAlert className="size-4 text-urgent" aria-hidden />,
  info: <LuInfo className="size-4 text-muted" aria-hidden />,
  ok: <LuCircleCheck className="size-4 text-ok" aria-hidden />,
};

/** Forhåndsvurderingen som merkelapp (farge + tekst, aldri bare farge). */
export function ScreeningBadge({ screening }: { screening: Screening }) {
  return (
    <Badge tone={VERDICT_TONE[screening.verdict]} title="Forhåndsvurdering uten AI: frist, krav, befaring og vilkår i kunngjøringen">
      {screening.label}
    </Badge>
  );
}

/** Alle punktene i forhåndsvurderingen, alvorligst først. */
export function ScreeningPoints({ screening, limit }: { screening: Screening; limit?: number }) {
  const points = limit ? screening.points.slice(0, limit) : screening.points;
  return (
    <ul className="space-y-1.5">
      {points.map((p) => (
        <li key={p.text} className="flex gap-2 text-[13px] leading-snug text-ink">
          <span className="mt-0.5 shrink-0">{POINT_ICON[p.tone]}</span>
          <span>{p.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function TenderRow({ item, showScore }: { item: TenderListItem; showScore: boolean }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/app/anbud/${item.id}`} className="text-[15px] font-semibold leading-snug text-navy-900 no-underline hover:underline">
            {item.title}
          </a>
          <StatusBadge status={item.status} />
          {item.isSample ? <SampleBadge /> : null}
        </div>
        <TenderMeta buyer={item.buyerName} place={item.placeText} regions={item.regionCodes} />
        {item.screening ? (
          <div className="flex flex-wrap items-start gap-2 pt-0.5">
            <ScreeningBadge screening={item.screening} />
            {item.screening.points[0] && item.screening.points[0].tone !== 'info' && item.screening.points[0].tone !== 'ok' ? (
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted">{item.screening.points[0].text}</span>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {item.industryIds.slice(0, 2).map((i) => (
            <Badge key={i} tone="neutral">
              {INDUSTRY_BY_ID.get(i)?.name ?? i}
            </Badge>
          ))}
          {item.sources.filter((s) => s !== 'sample').map((s) => (
            <SourceTag key={s} source={s} />
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-row flex-wrap items-center gap-3 sm:w-56 sm:flex-col sm:items-end sm:gap-2">
        <DeadlineChip deadline={item.deadlineAt} timeKnown={item.deadlineTimeKnown} />
        <span className="num text-[14px] font-semibold text-ink">{item.estimatedValue !== null ? formatMoney(item.estimatedValue, item.currency) : 'Verdi ikke oppgitt'}</span>
        {showScore && item.score !== null ? <ScoreBar score={item.score} /> : null}
        <BookmarkButton tenderId={item.id} bookmarked={item.bookmarked} compact />
      </div>
    </li>
  );
}

const UNCERTAINTY_LABEL: Record<string, { label: string; tone: 'ok' | 'urgent' | 'danger' }> = {
  lav: { label: 'Lav usikkerhet', tone: 'ok' },
  middels: { label: 'Middels usikkerhet', tone: 'urgent' },
  høy: { label: 'Høy usikkerhet', tone: 'danger' },
};

export function MatchExplanation({ score, breakdown, excluded }: { score: number; breakdown: MatchBreakdown; excluded: boolean }) {
  const v2 = breakdown.version === 2;
  const uncertainty = v2 ? UNCERTAINTY_LABEL[breakdown.uncertainty] : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <ScoreBar score={score} />
        {excluded ? <Badge tone="outline">Ekskludert</Badge> : null}
      </div>
      <p className="text-[12px] text-muted">
        Viser hvor godt anbudet passer profilen din (0–100) – ikke sjansen for å vinne. Regnet ut fra kunngjøringen og profilen, uten AI.
      </p>
      {uncertainty ? (
        <div>
          <Badge tone={uncertainty.tone}>{uncertainty.label}</Badge>
          {breakdown.uncertaintyReasons.length ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12px] text-muted">
              {breakdown.uncertaintyReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <ExplanationList icon={<LuCircleCheck className="size-4 text-ok" aria-hidden />} title="Hvorfor det passer" items={breakdown.reasons} />
      {v2 ? (
        <>
          <ExplanationList icon={<LuCircleCheck className="size-4 text-ok" aria-hidden />} title="Krav dere ser ut til å oppfylle" items={breakdown.fulfilled} />
          <ExplanationList icon={<LuCircleX className="size-4 text-danger" aria-hidden />} title="Krav dere ikke ser ut til å oppfylle" items={breakdown.unfulfilled} highlight />
          <ExplanationList icon={<LuCircleAlert className="size-4 text-urgent" aria-hidden />} title="Opplysninger som mangler" items={breakdown.missingInfo} />
          <ExplanationList icon={<LuCircleAlert className="size-4 text-urgent" aria-hidden />} title="Andre avvik" items={breakdown.gaps.filter((g) => !breakdown.unfulfilled.some((u) => u.includes(g.slice(0, 25))))} />
          {breakdown.caps.length ? <p className="text-[12px] text-muted">Poengsummen er begrenset: {breakdown.caps.join('; ')}.</p> : null}
        </>
      ) : (
        <>
          <ExplanationList icon={<LuCircleAlert className="size-4 text-urgent" aria-hidden />} title="Mangler og avvik" items={breakdown.gaps} />
          <ExplanationList icon={<LuCircleX className="size-4 text-danger" aria-hidden />} title="Kan stoppe dere" items={breakdown.disqualifiers} highlight />
        </>
      )}
      {breakdown.nextSteps.length ? (
        <div>
          <p className="text-[13px] font-semibold text-navy-900">Anbefalte neste steg</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] text-ink">
            {breakdown.nextSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function ExplanationList({ icon, title, items, highlight = false }: { icon: ReactNode; title: string; items: string[]; highlight?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-[13px] font-semibold text-navy-900">{title}</p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[13px] leading-snug text-ink">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span className={highlight ? 'hl' : undefined}>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
