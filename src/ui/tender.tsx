import type { ReactNode } from 'react';
import { LuBookmark, LuBookmarkCheck, LuBuilding2, LuCircleAlert, LuCircleCheck, LuCircleX, LuMapPin } from 'react-icons/lu';
import { INDUSTRY_BY_ID, REGION_BY_CODE, STATUS_LABELS } from '@/domain/reference';
import type { TenderListItem } from '@/domain/tenders/queries';
import type { MatchBreakdown } from '@/domain/matching/engine';
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

export function TenderMeta({ buyer, place, regions }: { buyer: string | null; place: string | null; regions: string[] }) {
  const regionNames = regions.map((r) => REGION_BY_CODE.get(r)?.name).filter(Boolean);
  const location = place ?? (regionNames.length ? regionNames.join(', ') : null);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      {buyer ? (
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <LuBuilding2 className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{buyer}</span>
        </span>
      ) : null}
      {location ? (
        <span className="inline-flex items-center gap-1.5">
          <LuMapPin className="size-3.5 shrink-0" aria-hidden />
          {location}
        </span>
      ) : null}
    </div>
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

export function MatchExplanation({ score, breakdown, excluded }: { score: number; breakdown: MatchBreakdown; excluded: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <ScoreBar score={score} />
        {excluded ? <Badge tone="outline">Ekskludert</Badge> : null}
      </div>
      <p className="text-[12px] text-muted">Viser hvor godt anbudet passer profilen din – ikke sjansen for å vinne.</p>
      <ExplanationList icon={<LuCircleCheck className="size-4 text-ok" aria-hidden />} title="Hvorfor det passer" items={breakdown.reasons} />
      <ExplanationList icon={<LuCircleAlert className="size-4 text-urgent" aria-hidden />} title="Mangler og avvik" items={breakdown.gaps} />
      <ExplanationList
        icon={<LuCircleX className="size-4 text-danger" aria-hidden />}
        title="Kan stoppe dere"
        items={breakdown.disqualifiers}
        highlight
      />
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
